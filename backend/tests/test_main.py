"""Integration tests for app.main: cold start, health, live watchlist, snapshot loop.

Each test creates a fresh database via the tmp_db fixture (monkeypatches DB_PATH
to a per-test tempfile) and drives the fully assembled app through the FastAPI
TestClient used as a context manager — entering the context triggers lifespan
startup, exiting triggers shutdown.

SNAPSHOT_INTERVAL is patched to 0.2s so snapshot-loop tests can collect rows
within a sub-second sleep.
"""

from __future__ import annotations

import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Point DB_PATH at a per-test tempfile and set a fast SNAPSHOT_INTERVAL.

    Returns the absolute path to the temp SQLite file so tests can open it
    with the standard sqlite3 module to assert DB state after the lifespan runs.
    """
    db_file = tmp_path / "test_main.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    # Fast interval so the snapshot loop can fire multiple times in < 1s
    monkeypatch.setenv("SNAPSHOT_INTERVAL", "0.2")
    return str(db_file)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_health(tmp_db):
    """GET /api/health returns HTTP 200 with {"status": "ok"} (CORE-02)."""
    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert "status" in body
    assert body["status"] == "ok"


def test_cold_start_creates_schema_and_seed(tmp_db):
    """Entering the TestClient context triggers init_db which creates 6 tables and 10 watchlist rows.

    Proves cold-start auto-initialisation: fresh DB_PATH → no existing file →
    lifespan calls init_db() → schema created, default user and watchlist seeded.
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application):
        pass  # lifespan startup runs init_db(); we just need to enter the context

    conn = sqlite3.connect(tmp_db)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    watchlist_count = conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
    conn.close()

    expected_tables = {
        "users_profile",
        "watchlist",
        "positions",
        "trades",
        "portfolio_snapshots",
        "chat_messages",
    }
    assert tables == expected_tables, f"Expected {expected_tables}, got {tables}"
    assert watchlist_count == 10, f"Expected 10 seeded watchlist rows, got {watchlist_count}"


def test_live_watchlist_returns_prices(tmp_db):
    """GET /api/watchlist returns 200 with 10 tickers, at least one with a live price.

    SimulatorDataSource.start() seeds the PriceCache immediately, so prices are
    available right after lifespan completes. A short sleep guards against any
    timing edge-cases.
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        # Simulator seeds the cache in start(); brief sleep for safety
        time.sleep(0.3)
        response = client.get("/api/watchlist")

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 10, f"Expected 10 watchlist entries, got {len(items)}"

    live_prices = [item for item in items if item.get("price") is not None]
    assert len(live_prices) >= 1, (
        "Expected at least one ticker to have a live price after the market source started"
    )


def test_snapshot_loop_records_rows(tmp_db):
    """Portfolio snapshots accumulate in portfolio_snapshots while the app runs (PORT-04).

    With SNAPSHOT_INTERVAL=0.2s, sleeping 0.8s inside the TestClient context
    allows the snapshot loop to fire at least once (typically 3-4 times).
    Rows are verified after the TestClient exits (lifespan shutdown completes).
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application):
        # Allow 4+ snapshot intervals to elapse while the lifespan is active
        time.sleep(0.8)

    conn = sqlite3.connect(tmp_db)
    count = conn.execute("SELECT COUNT(*) FROM portfolio_snapshots").fetchone()[0]
    conn.close()

    assert count >= 1, f"Expected at least 1 portfolio_snapshot row, got {count}"
