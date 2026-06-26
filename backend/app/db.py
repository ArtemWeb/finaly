"""Database initialisation, connection management, and seed data.

The SQLite file is created lazily on first use — no manual setup required.
Schema creation and seeding are idempotent (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE).

Default db path: <project_root>/db/finally.db
  Resolved as: Path(__file__).parent.parent.parent / "db" / "finally.db"
  Override by passing a custom path to `init_db()` or by setting _db_path before first use.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

# Project root is three levels up from this file:
#   backend/app/db.py  →  backend/app  →  backend  →  project_root
_PROJECT_ROOT = Path(__file__).parent.parent.parent
_DEFAULT_DB_PATH = _PROJECT_ROOT / "db" / "finally.db"

# Module-level path used by get_connection(); can be overridden before init.
_db_path: Path = _DEFAULT_DB_PATH

# Guard: set to True after the schema + seed have been applied.
_initialized: bool = False

# ---------------------------------------------------------------------------
# Default seed data
# ---------------------------------------------------------------------------

_DEFAULT_USER_ID = "default"
_DEFAULT_CASH_BALANCE = 10000.0
_DEFAULT_TICKERS = [
    "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA",
    "NVDA", "META", "JPM", "V", "NFLX",
]

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _create_schema(conn: sqlite3.Connection) -> None:
    """Create all tables if they do not already exist."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users_profile (
            id           TEXT PRIMARY KEY,
            cash_balance REAL NOT NULL DEFAULT 10000.0,
            created_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS watchlist (
            id       TEXT PRIMARY KEY,
            user_id  TEXT NOT NULL DEFAULT 'default',
            ticker   TEXT NOT NULL,
            added_at TEXT NOT NULL,
            UNIQUE (user_id, ticker)
        );

        CREATE TABLE IF NOT EXISTS positions (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL DEFAULT 'default',
            ticker     TEXT NOT NULL,
            quantity   REAL NOT NULL,
            avg_cost   REAL NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (user_id, ticker)
        );

        CREATE TABLE IF NOT EXISTS trades (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL DEFAULT 'default',
            ticker      TEXT NOT NULL,
            side        TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
            quantity    REAL NOT NULL,
            price       REAL NOT NULL,
            executed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL DEFAULT 'default',
            total_value REAL NOT NULL,
            recorded_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL DEFAULT 'default',
            role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content    TEXT NOT NULL,
            actions    TEXT,
            created_at TEXT NOT NULL
        );
        """
    )


def _seed_data(conn: sqlite3.Connection) -> None:
    """Insert default user profile and watchlist entries (idempotent)."""
    now = _now_iso()

    # Default user profile — INSERT OR IGNORE so re-runs are safe.
    conn.execute(
        "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (_DEFAULT_USER_ID, _DEFAULT_CASH_BALANCE, now),
    )

    # Default watchlist entries
    for ticker in _DEFAULT_TICKERS:
        conn.execute(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), _DEFAULT_USER_ID, ticker, now),
        )

    conn.commit()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def set_db_path(path: Path | str) -> None:
    """Override the database file path before the first connection is made.

    Calling this after ``init_db()`` has already run has no effect on the
    current connection but will reset the initialisation flag so the next
    call to ``get_connection()`` re-initialises against the new path.

    Primarily used by tests to point at a temporary file.
    """
    global _db_path, _initialized
    _db_path = Path(path)
    _initialized = False


def init_db(path: Optional[Path | str] = None) -> None:
    """Explicitly initialise the database.

    Creates the parent directory, the SQLite file, all tables, and seeds
    default data if they do not already exist.  Safe to call multiple times —
    subsequent calls are no-ops.

    Args:
        path: Optional override for the database file path.  If supplied the
              module-level ``_db_path`` is updated before connecting.
    """
    global _initialized

    if path is not None:
        set_db_path(path)

    if _initialized:
        return

    # Ensure the directory exists (important for Docker volumes / fresh clones).
    _db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(_db_path))
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        _create_schema(conn)
        _seed_data(conn)
    finally:
        conn.close()

    _initialized = True


def get_connection() -> sqlite3.Connection:
    """Return a new SQLite connection to the configured database.

    Calls ``init_db()`` on first use (lazy initialisation).  The caller is
    responsible for closing the connection.

    Returns:
        An open ``sqlite3.Connection`` with ``row_factory`` set to
        ``sqlite3.Row`` so rows can be accessed by column name.
    """
    init_db()
    conn = sqlite3.connect(str(_db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn
