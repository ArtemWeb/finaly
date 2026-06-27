"""Full-app integration coverage for portfolio, history, and watchlist GETs.

Closes the TEST-02 gap identified in 04-RESEARCH.md: test_main.py exercises
watchlist end-to-end through create_app() but not portfolio/history.
These tests build the fully assembled app (create_app()) and drive the
FastAPI TestClient as a context manager so lifespan startup (init_db,
market source start, snapshot loop) and shutdown run.

Each test uses a per-test tempfile DB (monkeypatch.setenv DB_PATH) so the
real db/finally.db is never touched (Pitfall 8). STATIC_DIR is pointed at a
nonexistent path to skip the static mount, matching test_chat_route.py:221.
SNAPSHOT_INTERVAL is patched to 0.2s so any snapshot-loop interaction is
fast (mirrors test_main.py).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Point DB_PATH at a per-test tempfile, set fast SNAPSHOT_INTERVAL, skip static mount.

    Returns the absolute path to the temp SQLite file so the test body can
    re-open it with the stdlib sqlite3 module for any post-hoc DB assertion.
    """
    db_file = tmp_path / "test_main_api_coverage.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("SNAPSHOT_INTERVAL", "0.2")
    # Skip the static mount so the test does not depend on a built frontend
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "nonexistent"))
    return str(db_file)


# ---------------------------------------------------------------------------
# Full-app create_app() round-trips for portfolio + history + watchlist
# ---------------------------------------------------------------------------


def test_get_portfolio_via_create_app(tmp_db):
    """GET /api/portfolio through create_app() returns 200 with default cash + empty positions.

    The full-app path exercises lifespan startup (init_db seeds default user
    with DEFAULT_CASH), the registered /api/portfolio router, and the
    PriceCache dependency. No trades have been executed, so cash_balance
    must equal the seeded DEFAULT_CASH (10000.0) and positions must be [].
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        response = client.get("/api/portfolio")

    assert response.status_code == 200, (
        f"Expected 200 from GET /api/portfolio, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert body["cash_balance"] == pytest.approx(10000.0), (
        f"Expected fresh cash_balance == 10000.0, got {body.get('cash_balance')!r}"
    )
    assert body["positions"] == [], (
        f"Expected empty positions list on fresh app, got {body.get('positions')!r}"
    )


def test_get_portfolio_history_via_create_app(tmp_db):
    """GET /api/portfolio/history through create_app() returns 200 with a list.

    On a fresh app no trades have been executed, so the history list should
    be empty (length 0). The shape assertion (isinstance list) is the
    structural contract; the snapshot-loop tests in test_main.py cover the
    populated case.
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        response = client.get("/api/portfolio/history")

    assert response.status_code == 200, (
        f"Expected 200 from GET /api/portfolio/history, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert isinstance(body, list), (
        f"Expected history body to be a list, got {type(body).__name__}"
    )


def test_get_watchlist_via_create_app_returns_10_tickers(tmp_db):
    """GET /api/watchlist through create_app() returns 200 with exactly 10 tickers.

    init_db() seeds 10 default tickers during lifespan startup, so the
    watchlist router must return that list. This is the structural companion
    to test_main.test_live_watchlist_returns_prices (which additionally
    asserts live prices after the market source starts).
    """
    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        response = client.get("/api/watchlist")

    assert response.status_code == 200, (
        f"Expected 200 from GET /api/watchlist, got {response.status_code}: {response.text}"
    )
    items = response.json()
    assert len(items) == 10, f"Expected 10 watchlist entries, got {len(items)}"
