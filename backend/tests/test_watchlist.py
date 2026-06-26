"""Tests for the watchlist management endpoints (app.routes.watchlist).

Covers:
- GET /api/watchlist returns seeded tickers with live prices from PriceCache
- GET /api/watchlist returns price=None for a ticker absent from PriceCache
- POST /api/watchlist adds ticker to DB and triggers market_source.add_ticker
- POST /api/watchlist normalizes ticker to uppercase
- POST /api/watchlist with duplicate ticker does not create duplicate row
- POST /api/watchlist with empty or non-alphanumeric ticker returns HTTP 400
- DELETE /api/watchlist/{ticker} removes ticker from DB and triggers remove_ticker
- DELETE /api/watchlist/{ticker} normalizes path parameter to uppercase
"""

from __future__ import annotations

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.market import MarketDataSource, PriceCache
from app.routes.watchlist import create_watchlist_router

# ---------------------------------------------------------------------------
# Fake MarketDataSource
# ---------------------------------------------------------------------------


class _FakeMarketDataSource(MarketDataSource):
    """Lightweight fake that records add/remove calls for assertion."""

    def __init__(self) -> None:
        self.added: list[str] = []
        self.removed: list[str] = []

    async def start(self, tickers: list[str]) -> None:
        """No-op start for testing."""

    async def stop(self) -> None:
        """No-op stop for testing."""

    async def add_ticker(self, ticker: str) -> None:
        """Record the ticker addition."""
        self.added.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        """Record the ticker removal."""
        self.removed.append(ticker)

    def get_tickers(self) -> list[str]:
        """Return empty list (not needed for watchlist tests)."""
        return []


# ---------------------------------------------------------------------------
# DB assertion helper (runs async queries from sync test bodies)
# ---------------------------------------------------------------------------


async def _count_watchlist_ticker(db_mod, ticker: str) -> int:
    """Return the number of watchlist rows for the given ticker."""
    async with db_mod.connect() as conn:
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM watchlist WHERE user_id = ? AND ticker = ?",
            (db_mod.DEFAULT_USER_ID, ticker),
        )
        (count,) = await cursor.fetchone()
    return count


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def watchlist_client(tmp_path, monkeypatch):
    """Provide a TestClient for a minimal FastAPI app with the watchlist router.

    Steps:
    1. Patch DB_PATH to a temp SQLite file and reload app.db.
    2. Initialize schema + seed data (10 default watchlist tickers).
    3. Seed PriceCache with a price for each default ticker.
    4. Build a _FakeMarketDataSource.
    5. Create a minimal FastAPI app including the watchlist router.
    6. Yield (TestClient, db_module, cache, fake_source).
    """
    import app.db as db_mod

    db_file = tmp_path / "test_watchlist.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    importlib.reload(db_mod)

    asyncio.run(db_mod.init_db())

    cache = PriceCache()
    for ticker in db_mod.DEFAULT_WATCHLIST:
        cache.update(ticker, 150.0)

    fake_source = _FakeMarketDataSource()

    app = FastAPI()
    app.include_router(create_watchlist_router(cache, fake_source))

    with TestClient(app) as client:
        yield client, db_mod, cache, fake_source


# ---------------------------------------------------------------------------
# Tests — GET /api/watchlist
# ---------------------------------------------------------------------------


def test_get_watchlist_returns_seeded_tickers_with_prices(watchlist_client):
    """GET /api/watchlist returns exactly 10 entries, each with a non-null price."""
    client, db_mod, _cache, _fake = watchlist_client

    response = client.get("/api/watchlist")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 10
    tickers = {entry["ticker"] for entry in data}
    assert tickers == set(db_mod.DEFAULT_WATCHLIST)
    for entry in data:
        assert "price" in entry
        assert entry["price"] is not None
        assert entry["price"] == pytest.approx(150.0)


def test_get_watchlist_ticker_without_cache_has_null_price(watchlist_client):
    """GET returns price=None for a ticker not present in PriceCache."""
    client, _db, cache, _fake = watchlist_client

    cache.remove("AAPL")

    response = client.get("/api/watchlist")

    assert response.status_code == 200
    data = response.json()
    aapl = next(e for e in data if e["ticker"] == "AAPL")
    assert aapl["price"] is None


# ---------------------------------------------------------------------------
# Tests — POST /api/watchlist
# ---------------------------------------------------------------------------


def test_post_watchlist_adds_ticker_and_triggers_tracking(watchlist_client):
    """POST inserts exactly one watchlist row and calls market_source.add_ticker."""
    client, db_mod, _cache, fake = watchlist_client

    response = client.post("/api/watchlist", json={"ticker": "GS"})

    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "GS"
    assert body["status"] == "ok"

    count = asyncio.run(_count_watchlist_ticker(db_mod, "GS"))
    assert count == 1

    assert "GS" in fake.added


def test_post_watchlist_normalizes_ticker_to_uppercase(watchlist_client):
    """POST normalizes lowercase ticker to uppercase before inserting."""
    client, db_mod, _cache, fake = watchlist_client

    response = client.post("/api/watchlist", json={"ticker": "gs"})

    assert response.status_code == 200
    assert response.json()["ticker"] == "GS"

    count = asyncio.run(_count_watchlist_ticker(db_mod, "GS"))
    assert count == 1
    assert "GS" in fake.added


def test_post_watchlist_duplicate_does_not_create_duplicate_row(watchlist_client):
    """Posting the same ticker twice leaves exactly one watchlist row."""
    client, db_mod, _cache, _fake = watchlist_client

    client.post("/api/watchlist", json={"ticker": "GS"})
    client.post("/api/watchlist", json={"ticker": "GS"})

    count = asyncio.run(_count_watchlist_ticker(db_mod, "GS"))
    assert count == 1


def test_post_watchlist_empty_ticker_returns_400(watchlist_client):
    """POST with an empty ticker string returns HTTP 400."""
    client, _db, _cache, _fake = watchlist_client

    response = client.post("/api/watchlist", json={"ticker": ""})

    assert response.status_code == 400


def test_post_watchlist_nonalphanumeric_ticker_returns_400(watchlist_client):
    """POST with a non-alphanumeric ticker returns HTTP 400."""
    client, _db, _cache, _fake = watchlist_client

    bad_tickers = ["BRK.B", "SPY-ETF", "!TSLA", "a b", "S P Y"]
    for bad in bad_tickers:
        response = client.post("/api/watchlist", json={"ticker": bad})
        assert response.status_code == 400, f"Expected 400 for ticker {bad!r}"


# ---------------------------------------------------------------------------
# Tests — DELETE /api/watchlist/{ticker}
# ---------------------------------------------------------------------------


def test_delete_watchlist_removes_row_and_stops_tracking(watchlist_client):
    """DELETE removes the DB row and calls market_source.remove_ticker."""
    client, db_mod, _cache, fake = watchlist_client

    client.post("/api/watchlist", json={"ticker": "GS"})
    assert asyncio.run(_count_watchlist_ticker(db_mod, "GS")) == 1

    response = client.delete("/api/watchlist/GS")

    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "GS"
    assert body["status"] == "ok"

    count = asyncio.run(_count_watchlist_ticker(db_mod, "GS"))
    assert count == 0

    assert "GS" in fake.removed


def test_delete_watchlist_normalizes_path_param_to_uppercase(watchlist_client):
    """DELETE /api/watchlist/{ticker} normalizes ticker to uppercase."""
    client, db_mod, _cache, fake = watchlist_client

    client.post("/api/watchlist", json={"ticker": "GS"})
    response = client.delete("/api/watchlist/gs")

    assert response.status_code == 200
    assert response.json()["ticker"] == "GS"
    assert asyncio.run(_count_watchlist_ticker(db_mod, "GS")) == 0
    assert "GS" in fake.removed
