"""Unit tests for app/db.py — schema creation, seed data, and lazy init."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

import app.db as db_module
from app.db import (
    _DEFAULT_CASH_BALANCE,
    _DEFAULT_TICKERS,
    _DEFAULT_USER_ID,
    get_connection,
    init_db,
    set_db_path,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path):
    """Point the module at a fresh temporary database for every test.

    ``autouse=True`` means every test in this module gets an isolated DB
    without having to request the fixture explicitly.
    """
    test_db = tmp_path / "test_finally.db"
    set_db_path(test_db)
    yield test_db
    # Teardown: reset to defaults so the module is clean for the next test.
    set_db_path(db_module._DEFAULT_DB_PATH)


# ---------------------------------------------------------------------------
# Schema creation tests
# ---------------------------------------------------------------------------


EXPECTED_TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


def test_schema_creates_all_tables():
    """All six tables must exist after init_db()."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        )
        tables = {row[0] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert EXPECTED_TABLES == tables, f"Missing tables: {EXPECTED_TABLES - tables}"


def test_schema_column_names_users_profile():
    """users_profile must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(users_profile);")
        columns = {row[1] for row in cursor.fetchall()}  # row[1] is column name
    finally:
        conn.close()

    assert columns == {"id", "cash_balance", "created_at"}


def test_schema_column_names_watchlist():
    """watchlist must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(watchlist);")
        columns = {row[1] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert columns == {"id", "user_id", "ticker", "added_at"}


def test_schema_column_names_positions():
    """positions must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(positions);")
        columns = {row[1] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert columns == {"id", "user_id", "ticker", "quantity", "avg_cost", "updated_at"}


def test_schema_column_names_trades():
    """trades must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(trades);")
        columns = {row[1] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert columns == {"id", "user_id", "ticker", "side", "quantity", "price", "executed_at"}


def test_schema_column_names_portfolio_snapshots():
    """portfolio_snapshots must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(portfolio_snapshots);")
        columns = {row[1] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert columns == {"id", "user_id", "total_value", "recorded_at"}


def test_schema_column_names_chat_messages():
    """chat_messages must have exactly the specified columns."""
    init_db()
    conn = sqlite3.connect(str(db_module._db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(chat_messages);")
        columns = {row[1] for row in cursor.fetchall()}
    finally:
        conn.close()

    assert columns == {"id", "user_id", "role", "content", "actions", "created_at"}


# ---------------------------------------------------------------------------
# Seed data tests
# ---------------------------------------------------------------------------


def test_seed_creates_default_user():
    """A single default user profile with $10,000 cash must be seeded."""
    init_db()
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users_profile WHERE id = ?", (_DEFAULT_USER_ID,)).fetchone()
    finally:
        conn.close()

    assert row is not None, "Default user profile not found"
    assert row["id"] == _DEFAULT_USER_ID
    assert row["cash_balance"] == _DEFAULT_CASH_BALANCE
    assert row["created_at"] is not None


def test_seed_creates_ten_watchlist_entries():
    """Exactly ten watchlist entries for the default user must be seeded."""
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY ticker",
            (_DEFAULT_USER_ID,),
        ).fetchall()
    finally:
        conn.close()

    tickers = {row["ticker"] for row in rows}
    assert len(rows) == 10, f"Expected 10 watchlist entries, got {len(rows)}"
    assert tickers == set(_DEFAULT_TICKERS), f"Unexpected tickers: {tickers ^ set(_DEFAULT_TICKERS)}"


def test_seed_watchlist_has_user_id():
    """Every seeded watchlist entry must belong to the default user."""
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute("SELECT user_id FROM watchlist").fetchall()
    finally:
        conn.close()

    for row in rows:
        assert row["user_id"] == _DEFAULT_USER_ID


def test_seed_watchlist_has_unique_ids():
    """Every watchlist entry must have a unique id (UUID)."""
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute("SELECT id FROM watchlist").fetchall()
    finally:
        conn.close()

    ids = [row["id"] for row in rows]
    assert len(ids) == len(set(ids)), "Duplicate watchlist IDs found"


def test_seed_no_extra_user_profiles():
    """Only one user profile row should exist after seeding."""
    init_db()
    conn = get_connection()
    try:
        count = conn.execute("SELECT COUNT(*) FROM users_profile").fetchone()[0]
    finally:
        conn.close()

    assert count == 1


# ---------------------------------------------------------------------------
# Lazy init / idempotency tests
# ---------------------------------------------------------------------------


def test_init_db_is_idempotent(tmp_path: Path):
    """Calling init_db() multiple times must not duplicate rows."""
    db_path = tmp_path / "idempotent.db"
    set_db_path(db_path)

    init_db()
    init_db()
    init_db()

    conn = sqlite3.connect(str(db_path))
    try:
        user_count = conn.execute("SELECT COUNT(*) FROM users_profile").fetchone()[0]
        watch_count = conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
    finally:
        conn.close()

    assert user_count == 1, f"Expected 1 user profile, got {user_count}"
    assert watch_count == 10, f"Expected 10 watchlist entries, got {watch_count}"


def test_get_connection_triggers_lazy_init(tmp_path: Path):
    """get_connection() alone (without explicit init_db()) must initialise the DB."""
    db_path = tmp_path / "lazy.db"
    set_db_path(db_path)

    # Do NOT call init_db() — rely on lazy init inside get_connection().
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users_profile WHERE id = ?", (_DEFAULT_USER_ID,)).fetchone()
    finally:
        conn.close()

    assert row is not None, "Lazy init via get_connection() did not seed the database"


def test_initialized_flag_set_after_init(tmp_path: Path):
    """_initialized must be True after init_db() and False before."""
    db_path = tmp_path / "flag.db"
    set_db_path(db_path)

    assert db_module._initialized is False
    init_db()
    assert db_module._initialized is True


def test_set_db_path_resets_initialized_flag(tmp_path: Path):
    """set_db_path() must reset _initialized so the new path is initialised."""
    db_path_1 = tmp_path / "db1.db"
    db_path_2 = tmp_path / "db2.db"

    set_db_path(db_path_1)
    init_db()
    assert db_module._initialized is True

    set_db_path(db_path_2)
    assert db_module._initialized is False, "set_db_path should reset _initialized"


def test_get_connection_returns_row_factory():
    """Connections returned by get_connection() must use sqlite3.Row as row_factory."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, cash_balance FROM users_profile").fetchone()
    finally:
        conn.close()

    assert isinstance(row, sqlite3.Row), "Expected sqlite3.Row instances"
    # Access by column name (only works if row_factory = sqlite3.Row)
    assert row["id"] == _DEFAULT_USER_ID
    assert row["cash_balance"] == _DEFAULT_CASH_BALANCE


def test_db_file_created_on_init(tmp_path: Path):
    """The SQLite file must be created on disk after init_db()."""
    db_path = tmp_path / "subdir" / "finally.db"
    set_db_path(db_path)

    assert not db_path.exists(), "DB file should not exist before init"
    init_db()
    assert db_path.exists(), "DB file must be created by init_db()"
