"""Route integration tests for FinAlly backend.

Tests use httpx.AsyncClient against the FastAPI app with a fresh in-memory
SQLite database per test so they are completely isolated.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_db(tmp_path):
    """Point the db module at a fresh temporary SQLite file for each test."""
    import app.db as db_module

    db_file = tmp_path / "test_finally.db"
    db_module.set_db_path(db_file)
    db_module.init_db()
    yield
    # Cleanup: reset path after test (next test's autouse fixture will set a new one)
    db_module._initialized = False


@pytest_asyncio.fixture
async def client():
    """Async HTTP client wired to the FastAPI app (no real network)."""
    # Import after isolated_db has pointed the db module at the temp file
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


def _seed_price(ticker: str, price: float = 100.0) -> None:
    """Inject a price directly into the shared cache so route tests can trade."""
    from app.price_cache import price_cache

    price_cache.update(ticker, price)


def _clear_cache() -> None:
    """Remove all entries from the shared price cache."""
    from app.price_cache import price_cache

    for ticker in list(price_cache.get_all().keys()):
        price_cache.remove(ticker)


@pytest.fixture(autouse=True)
def clean_price_cache():
    """Ensure the price cache is empty at the start of each test."""
    _clear_cache()
    yield
    _clear_cache()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Portfolio — GET /api/portfolio
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_portfolio_empty(client):
    r = await client.get("/api/portfolio")
    assert r.status_code == 200
    data = r.json()
    assert data["cash_balance"] == pytest.approx(10000.0)
    assert data["positions"] == []
    assert data["total_value"] == pytest.approx(10000.0)


@pytest.mark.asyncio
async def test_portfolio_shape(client):
    r = await client.get("/api/portfolio")
    assert r.status_code == 200
    data = r.json()
    assert "cash_balance" in data
    assert "positions" in data
    assert "total_value" in data


# ---------------------------------------------------------------------------
# Portfolio — POST /api/portfolio/trade  (buy)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buy_reduces_cash(client):
    _seed_price("AAPL", 100.0)
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["cash_balance"] == pytest.approx(9000.0)


@pytest.mark.asyncio
async def test_buy_creates_position(client):
    _seed_price("MSFT", 200.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "MSFT", "quantity": 5, "side": "buy"},
    )
    r = await client.get("/api/portfolio")
    data = r.json()
    positions = {p["ticker"]: p for p in data["positions"]}
    assert "MSFT" in positions
    assert positions["MSFT"]["quantity"] == pytest.approx(5.0)
    assert positions["MSFT"]["avg_cost"] == pytest.approx(200.0)


@pytest.mark.asyncio
async def test_buy_updates_avg_cost(client):
    """Buying more of the same ticker updates the weighted-average cost."""
    _seed_price("AAPL", 100.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    # Price changes; buy more
    _seed_price("AAPL", 200.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    r = await client.get("/api/portfolio")
    positions = {p["ticker"]: p for p in r.json()["positions"]}
    # avg_cost should be (10*100 + 10*200) / 20 = 150
    assert positions["AAPL"]["quantity"] == pytest.approx(20.0)
    assert positions["AAPL"]["avg_cost"] == pytest.approx(150.0)


@pytest.mark.asyncio
async def test_buy_insufficient_cash(client):
    _seed_price("NVDA", 9999.0)
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "NVDA", "quantity": 2, "side": "buy"},  # needs $19998
    )
    assert r.status_code == 400
    assert "Insufficient cash" in r.json()["detail"]


@pytest.mark.asyncio
async def test_buy_no_price_data(client):
    """Trade on a ticker with no price data should return 400."""
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "UNKNOWN", "quantity": 1, "side": "buy"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Portfolio — POST /api/portfolio/trade  (sell)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sell_increases_cash(client):
    _seed_price("AAPL", 100.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "sell"},
    )
    assert r.status_code == 200
    data = r.json()
    # Cash after buy: 10000 - 1000 = 9000; after sell: 9000 + 500 = 9500
    assert data["cash_balance"] == pytest.approx(9500.0)


@pytest.mark.asyncio
async def test_sell_removes_position_when_all_sold(client):
    _seed_price("AAPL", 100.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "buy"},
    )
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "sell"},
    )
    r = await client.get("/api/portfolio")
    positions = {p["ticker"]: p for p in r.json()["positions"]}
    assert "AAPL" not in positions


@pytest.mark.asyncio
async def test_sell_insufficient_shares(client):
    _seed_price("AAPL", 100.0)
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "sell"},  # own 0
    )
    assert r.status_code == 400
    assert "Insufficient shares" in r.json()["detail"]


@pytest.mark.asyncio
async def test_sell_more_than_owned(client):
    _seed_price("AAPL", 100.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5, "side": "buy"},
    )
    r = await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10, "side": "sell"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Portfolio — GET /api/portfolio/history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_portfolio_history_empty(client):
    r = await client.get("/api/portfolio/history")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_portfolio_history_has_entry_after_trade(client):
    _seed_price("AAPL", 100.0)
    await client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1, "side": "buy"},
    )
    r = await client.get("/api/portfolio/history")
    data = r.json()
    assert len(data) >= 1
    assert "total_value" in data[0]
    assert "recorded_at" in data[0]


# ---------------------------------------------------------------------------
# Watchlist — GET /api/watchlist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_watchlist_returns_default_tickers(client):
    r = await client.get("/api/watchlist")
    assert r.status_code == 200
    tickers = [item["ticker"] for item in r.json()]
    assert "AAPL" in tickers
    assert len(tickers) == 10


@pytest.mark.asyncio
async def test_watchlist_item_shape(client):
    r = await client.get("/api/watchlist")
    item = r.json()[0]
    assert "ticker" in item
    assert "price" in item
    assert "prev_price" in item
    assert "direction" in item


# ---------------------------------------------------------------------------
# Watchlist — POST /api/watchlist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_ticker_to_watchlist(client):
    r = await client.post("/api/watchlist", json={"ticker": "PYPL"})
    assert r.status_code == 201
    assert r.json()["ticker"] == "PYPL"

    r2 = await client.get("/api/watchlist")
    tickers = [item["ticker"] for item in r2.json()]
    assert "PYPL" in tickers


@pytest.mark.asyncio
async def test_add_ticker_uppercase_normalisation(client):
    r = await client.post("/api/watchlist", json={"ticker": "pypl"})
    assert r.status_code == 201
    assert r.json()["ticker"] == "PYPL"


@pytest.mark.asyncio
async def test_add_duplicate_ticker_returns_409(client):
    await client.post("/api/watchlist", json={"ticker": "PYPL"})
    r = await client.post("/api/watchlist", json={"ticker": "PYPL"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_add_ticker_already_in_default_watchlist_returns_409(client):
    r = await client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Watchlist — DELETE /api/watchlist/{ticker}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_ticker_from_watchlist(client):
    await client.post("/api/watchlist", json={"ticker": "PYPL"})
    r = await client.delete("/api/watchlist/PYPL")
    assert r.status_code == 200

    r2 = await client.get("/api/watchlist")
    tickers = [item["ticker"] for item in r2.json()]
    assert "PYPL" not in tickers


@pytest.mark.asyncio
async def test_remove_nonexistent_ticker_returns_404(client):
    r = await client.delete("/api/watchlist/ZZZZ")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_remove_ticker_case_insensitive(client):
    """DELETE /api/watchlist/aapl should work even though stored as AAPL."""
    r = await client.delete("/api/watchlist/aapl")
    assert r.status_code == 200
