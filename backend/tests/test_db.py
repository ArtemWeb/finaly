"""Tests for the SQLite database initialization and seed module (app.db).

Covers: fresh schema creation (6 tables), default user seed, watchlist seed,
idempotent re-initialization, and get_watchlist_tickers().
"""

from __future__ import annotations

import os
import tempfile

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EXPECTED_TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}

_EXPECTED_TICKERS = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_db_path(tmp_path, monkeypatch):
    """Provide a temporary SQLite path and patch DB_PATH env so app.db uses it."""
    db_file = tmp_path / "test_finally.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    # Ensure any cached module-level state is reset by reimporting
    import importlib

    import app.db as db_module

    importlib.reload(db_module)
    return str(db_file), db_module


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fresh_init_creates_six_tables(tmp_db_path):
    """A brand-new database should have exactly the 6 expected tables after init_db()."""
    _, db = tmp_db_path
    await db.init_db()

    async with db.connect() as conn:
        cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        rows = await cursor.fetchall()

    table_names = {row[0] for row in rows}
    assert table_names == _EXPECTED_TABLES, f"Expected {_EXPECTED_TABLES}, got {table_names}"


@pytest.mark.asyncio
async def test_fresh_init_seeds_default_user(tmp_db_path):
    """After init_db(), users_profile must have exactly one row: id='default', cash=10000.0."""
    _, db = tmp_db_path
    await db.init_db()

    async with db.connect() as conn:
        cursor = await conn.execute("SELECT id, cash_balance FROM users_profile")
        rows = await cursor.fetchall()

    assert len(rows) == 1, f"Expected 1 user row, got {len(rows)}"
    assert rows[0][0] == "default"
    assert rows[0][1] == pytest.approx(10000.0)


@pytest.mark.asyncio
async def test_fresh_init_seeds_ten_watchlist_rows(tmp_db_path):
    """After init_db(), watchlist must have exactly 10 rows (one per default ticker)."""
    _, db = tmp_db_path
    await db.init_db()

    async with db.connect() as conn:
        cursor = await conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id='default' ORDER BY added_at"
        )
        rows = await cursor.fetchall()

    tickers = [row[0] for row in rows]
    assert len(tickers) == 10, f"Expected 10 watchlist rows, got {len(tickers)}"
    assert set(tickers) == set(_EXPECTED_TICKERS)


@pytest.mark.asyncio
async def test_idempotent_reinit_does_not_duplicate_user(tmp_db_path):
    """Calling init_db() twice must not create duplicate user rows."""
    _, db = tmp_db_path
    await db.init_db()
    await db.init_db()  # second call — must be a no-op for seeding

    async with db.connect() as conn:
        cursor = await conn.execute("SELECT COUNT(*) FROM users_profile")
        (count,) = await cursor.fetchone()

    assert count == 1, f"Expected 1 user row after double init, got {count}"


@pytest.mark.asyncio
async def test_idempotent_reinit_does_not_change_cash(tmp_db_path):
    """Re-running init_db() must NOT reset cash_balance to the seed value."""
    _, db = tmp_db_path
    await db.init_db()

    # Simulate a trade that changed cash balance
    async with db.connect() as conn:
        await conn.execute(
            "UPDATE users_profile SET cash_balance = 5000.0 WHERE id = 'default'"
        )
        await conn.commit()

    await db.init_db()  # reinit — must not overwrite cash

    async with db.connect() as conn:
        cursor = await conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = 'default'"
        )
        (cash,) = await cursor.fetchone()

    assert cash == pytest.approx(5000.0), f"Expected cash=5000.0 after reinit, got {cash}"


@pytest.mark.asyncio
async def test_idempotent_reinit_does_not_duplicate_watchlist(tmp_db_path):
    """Calling init_db() twice must leave exactly 10 watchlist rows (no duplicates)."""
    _, db = tmp_db_path
    await db.init_db()
    await db.init_db()

    async with db.connect() as conn:
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM watchlist WHERE user_id='default'"
        )
        (count,) = await cursor.fetchone()

    assert count == 10, f"Expected 10 watchlist rows after double init, got {count}"


@pytest.mark.asyncio
async def test_get_watchlist_tickers_returns_expected_symbols(tmp_db_path):
    """get_watchlist_tickers() returns the 10 seeded symbols."""
    _, db = tmp_db_path
    await db.init_db()

    tickers = await db.get_watchlist_tickers()

    assert isinstance(tickers, list)
    assert set(tickers) == set(_EXPECTED_TICKERS)
    assert len(tickers) == 10


@pytest.mark.asyncio
async def test_get_db_path_honors_env_var(tmp_db_path):
    """get_db_path() must return the value of DB_PATH env var when set."""
    db_path, db = tmp_db_path
    # The env is already patched to db_path in the fixture
    result = db.get_db_path()
    assert result == db_path


@pytest.mark.asyncio
async def test_get_db_path_creates_parent_directory(tmp_path, monkeypatch):
    """get_db_path() creates the parent directory if it does not exist."""
    nested = tmp_path / "nested" / "subdir" / "test.db"
    monkeypatch.setenv("DB_PATH", str(nested))

    import importlib

    import app.db as db_module

    importlib.reload(db_module)

    db_module.get_db_path()
    assert (tmp_path / "nested" / "subdir").is_dir()
