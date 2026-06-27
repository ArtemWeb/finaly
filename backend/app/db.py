"""SQLite persistence layer for the FinAlly backend.

Public API:
    SCHEMA              - SQL DDL string for all 6 tables (CREATE TABLE IF NOT EXISTS)
    DEFAULT_USER_ID     - ID of the single hardcoded user ("default")
    DEFAULT_CASH        - Starting cash balance in USD (10000.0)
    DEFAULT_WATCHLIST   - 10 default ticker symbols seeded into the watchlist
    get_db_path()       - Return the SQLite file path (honours DB_PATH env var)
    connect()           - Async context manager yielding an aiosqlite.Connection
    init_db()           - Create schema + seed default data idempotently
    get_watchlist_tickers() - Return the seeded ticker symbols as list[str]
"""

from __future__ import annotations

import contextlib
import logging
import os
import uuid
from datetime import datetime, timezone

import aiosqlite

__all__ = [
    "SCHEMA",
    "DEFAULT_USER_ID",
    "DEFAULT_CASH",
    "DEFAULT_WATCHLIST",
    "get_db_path",
    "connect",
    "init_db",
    "get_watchlist_tickers",
    "utc_now",
]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_USER_ID: str = "default"
DEFAULT_CASH: float = 10_000.0

# NOTE: DEFAULT_WATCHLIST must exactly match the keys of
# app.market.seed_prices.SEED_PRICES so every seeded ticker has a simulated
# live price from the market data source.
DEFAULT_WATCHLIST: list[str] = [
    "AAPL",
    "GOOGL",
    "MSFT",
    "AMZN",
    "TSLA",
    "NVDA",
    "META",
    "JPM",
    "V",
    "NFLX",
]

# ---------------------------------------------------------------------------
# Schema (6 tables — per planning/PLAN.md section 7)
# ---------------------------------------------------------------------------

SCHEMA: str = """
CREATE TABLE IF NOT EXISTS users_profile (
    id           TEXT PRIMARY KEY,
    cash_balance REAL NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    ticker   TEXT NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS positions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    ticker     TEXT NOT NULL,
    quantity   REAL NOT NULL,
    avg_cost   REAL NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS trades (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    side        TEXT NOT NULL,
    quantity    REAL NOT NULL,
    price       REAL NOT NULL,
    executed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    total_value REAL NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    actions    TEXT,
    created_at TEXT NOT NULL
);
"""

# ---------------------------------------------------------------------------
# Database path
# ---------------------------------------------------------------------------


def get_db_path() -> str:
    """Return the SQLite file path.

    Reads the DB_PATH environment variable; defaults to 'db/finally.db'.
    Ensures the parent directory exists before returning.
    """
    path = os.environ.get("DB_PATH", "db/finally.db")
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------


@contextlib.asynccontextmanager
async def connect():  # type: ignore[return]
    """Async context manager that yields an open aiosqlite.Connection.

    Sets row_factory to aiosqlite.Row so rows support column-name access.
    Enables foreign key enforcement for all connections.
    """
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        yield db


# ---------------------------------------------------------------------------
# Initialisation + seed
# ---------------------------------------------------------------------------


def utc_now() -> str:
    """Return the current UTC time as an ISO-8601 string.

    Single source of truth for UTC timestamps across all persistence modules.
    Format: ISO-8601 (e.g. '2026-06-27T12:34:56.789012+00:00').
    Consistent format ensures lexicographic ORDER BY works correctly on timestamps.
    """
    return datetime.now(timezone.utc).isoformat()


async def init_db() -> None:
    """Create all tables and seed default data idempotently.

    Safe to call on every application start:
    - Tables are created with IF NOT EXISTS (no-op if already present).
    - User row is inserted only if absent (checked by SELECT before INSERT).
    - Watchlist rows use INSERT OR IGNORE so the UNIQUE(user_id, ticker)
      constraint silently skips duplicates.

    All SQL values are passed via ? parameterized queries (never f-strings).
    """
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(SCHEMA)
        await db.commit()

        # Seed default user only if not present
        cursor = await db.execute(
            "SELECT id FROM users_profile WHERE id = ?",
            (DEFAULT_USER_ID,),
        )
        existing_user = await cursor.fetchone()
        if existing_user is None:
            await db.execute(
                "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
                (DEFAULT_USER_ID, DEFAULT_CASH, utc_now()),
            )
            logger.info("Seeded default user with cash_balance=%.2f", DEFAULT_CASH)
        else:
            logger.debug("Default user already exists — skipping user seed")

        # Seed default watchlist — INSERT OR IGNORE makes re-seed a no-op
        inserted = 0
        for ticker in DEFAULT_WATCHLIST:
            result = await db.execute(
                "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
                (uuid.uuid4().hex, DEFAULT_USER_ID, ticker, utc_now()),
            )
            inserted += result.rowcount

        await db.commit()

        if inserted:
            logger.info("Seeded %d watchlist ticker(s)", inserted)
        else:
            logger.debug("Watchlist already seeded — skipping watchlist seed")


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


async def get_watchlist_tickers() -> list[str]:
    """Return the ticker symbols from the default user's watchlist, ordered by added_at."""
    async with connect() as db:
        cursor = await db.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at",
            (DEFAULT_USER_ID,),
        )
        rows = await cursor.fetchall()
    return [row["ticker"] for row in rows]
