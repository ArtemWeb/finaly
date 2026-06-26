"""Tests for portfolio_service and portfolio router.

Covers every behavior defined in 01-02-PLAN.md:

Task 1 (service):
- execute_trade buy/sell happy paths
- execute_trade validation errors (no state changes on failure)
- get_portfolio P&L calculations
- record_snapshot / get_history snapshot recording

Task 2 (router):
- GET /api/portfolio returns 200 with cash_balance, total_value, positions
- POST /api/portfolio/trade (valid buy) returns 200
- POST /api/portfolio/trade (insufficient cash) returns 400
- GET /api/portfolio/history returns 200 with snapshot list
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.db as db_module
from app.db import DEFAULT_CASH, DEFAULT_USER_ID
from app.market.cache import PriceCache
from app.portfolio_service import (
    TradeError,
    execute_trade,
    get_history,
    get_portfolio,
    record_snapshot,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def tmp_db(tmp_path, monkeypatch):
    """Set DB_PATH to a temp file and initialise schema + seed data."""
    db_file = tmp_path / "test_portfolio.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    await db_module.init_db()


@pytest.fixture
def seeded_cache() -> PriceCache:
    """PriceCache pre-seeded with AAPL @ 150 and GOOGL @ 200."""
    cache = PriceCache()
    cache.update("AAPL", 150.0)
    cache.update("GOOGL", 200.0)
    return cache


# ---------------------------------------------------------------------------
# execute_trade — buy happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buy_deducts_cash(tmp_db, seeded_cache):
    """A buy reduces cash_balance by quantity * fill_price."""
    qty = 10.0
    fill = 150.0  # AAPL price

    result = await execute_trade(seeded_cache, "AAPL", "buy", qty)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?",
            (DEFAULT_USER_ID,),
        )
        row = await cur.fetchone()

    expected = DEFAULT_CASH - qty * fill
    assert row["cash_balance"] == pytest.approx(expected)
    assert result["cash_balance"] == pytest.approx(expected)


@pytest.mark.asyncio
async def test_buy_creates_position_with_fill_price_as_avg_cost(tmp_db, seeded_cache):
    """A buy on a new ticker creates a positions row with avg_cost == fill_price."""
    await execute_trade(seeded_cache, "AAPL", "buy", 5.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        row = await cur.fetchone()

    assert row is not None
    assert row["quantity"] == pytest.approx(5.0)
    assert row["avg_cost"] == pytest.approx(150.0)


@pytest.mark.asyncio
async def test_buy_appends_one_trades_row(tmp_db, seeded_cache):
    """A successful buy appends exactly one row to the trades table."""
    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM trades WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (before,) = await cur.fetchone()

    await execute_trade(seeded_cache, "AAPL", "buy", 2.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM trades WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (after,) = await cur.fetchone()

    assert after == before + 1


@pytest.mark.asyncio
async def test_buy_records_one_snapshot(tmp_db, seeded_cache):
    """Each successful buy records exactly one portfolio_snapshots row."""
    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (before,) = await cur.fetchone()

    await execute_trade(seeded_cache, "AAPL", "buy", 1.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (after,) = await cur.fetchone()

    assert after == before + 1


@pytest.mark.asyncio
async def test_buy_weighted_avg_cost_on_existing_position(tmp_db, seeded_cache):
    """Adding to an existing position yields a weighted-average cost basis."""
    # First lot: 10 shares @ 150 = cost 1500
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)

    # Second lot: 10 shares @ 200 (price updated)
    seeded_cache.update("AAPL", 200.0)
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        row = await cur.fetchone()

    # (10*150 + 10*200) / 20 == 175.0
    assert row["quantity"] == pytest.approx(20.0)
    assert row["avg_cost"] == pytest.approx(175.0)


# ---------------------------------------------------------------------------
# execute_trade — buy failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buy_insufficient_cash_raises_trade_error(tmp_db, seeded_cache):
    """Buying when cost > cash raises TradeError."""
    # 100 shares @ 150 = 15000 > DEFAULT_CASH (10000)
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "buy", 100.0)


@pytest.mark.asyncio
async def test_buy_insufficient_cash_leaves_db_unchanged(tmp_db, seeded_cache):
    """A failed buy must not modify cash, positions, trades, or snapshots."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "buy", 100.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        )
        (cash,) = await cur.fetchone()

        cur = await db.execute(
            "SELECT COUNT(*) FROM positions WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (pos_count,) = await cur.fetchone()

        cur = await db.execute(
            "SELECT COUNT(*) FROM trades WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (trade_count,) = await cur.fetchone()

        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (snap_count,) = await cur.fetchone()

    assert cash == pytest.approx(DEFAULT_CASH)
    assert pos_count == 0
    assert trade_count == 0
    assert snap_count == 0


# ---------------------------------------------------------------------------
# execute_trade — sell happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sell_adds_cash(tmp_db, seeded_cache):
    """A sell increases cash by quantity * fill_price."""
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        )
        (cash_before,) = await cur.fetchone()

    result = await execute_trade(seeded_cache, "AAPL", "sell", 5.0)

    assert result["cash_balance"] == pytest.approx(cash_before + 5.0 * 150.0)


@pytest.mark.asyncio
async def test_sell_reduces_position_quantity(tmp_db, seeded_cache):
    """A partial sell reduces the position quantity; avg_cost is unchanged."""
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)
    await execute_trade(seeded_cache, "AAPL", "sell", 3.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT quantity FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        row = await cur.fetchone()

    assert row is not None
    assert row["quantity"] == pytest.approx(7.0)


@pytest.mark.asyncio
async def test_full_sell_deletes_position_row(tmp_db, seeded_cache):
    """Selling the entire position removes the positions row."""
    await execute_trade(seeded_cache, "AAPL", "buy", 5.0)
    await execute_trade(seeded_cache, "AAPL", "sell", 5.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        (count,) = await cur.fetchone()

    assert count == 0


@pytest.mark.asyncio
async def test_sell_records_one_snapshot(tmp_db, seeded_cache):
    """A successful sell records exactly one portfolio_snapshots row."""
    await execute_trade(seeded_cache, "AAPL", "buy", 5.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (before,) = await cur.fetchone()

    await execute_trade(seeded_cache, "AAPL", "sell", 5.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (after,) = await cur.fetchone()

    assert after == before + 1


# ---------------------------------------------------------------------------
# execute_trade — sell failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sell_insufficient_shares_raises_trade_error(tmp_db, seeded_cache):
    """Selling more shares than owned raises TradeError."""
    await execute_trade(seeded_cache, "AAPL", "buy", 3.0)
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "sell", 10.0)


@pytest.mark.asyncio
async def test_sell_no_position_raises_trade_error(tmp_db, seeded_cache):
    """Selling a ticker with no position raises TradeError."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "sell", 1.0)


@pytest.mark.asyncio
async def test_sell_failure_leaves_db_unchanged(tmp_db, seeded_cache):
    """A failed sell must not change cash or position quantity."""
    await execute_trade(seeded_cache, "AAPL", "buy", 3.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        )
        (cash_before,) = await cur.fetchone()
        cur = await db.execute(
            "SELECT quantity FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        row = await cur.fetchone()
        qty_before = row["quantity"]

    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "sell", 10.0)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        )
        (cash_after,) = await cur.fetchone()
        cur = await db.execute(
            "SELECT quantity FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "AAPL"),
        )
        row = await cur.fetchone()
        qty_after = row["quantity"]

    assert cash_after == pytest.approx(cash_before)
    assert qty_after == pytest.approx(qty_before)


# ---------------------------------------------------------------------------
# execute_trade — input validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_zero_quantity_raises_trade_error(tmp_db, seeded_cache):
    """Quantity == 0 raises TradeError."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "buy", 0.0)


@pytest.mark.asyncio
async def test_negative_quantity_raises_trade_error(tmp_db, seeded_cache):
    """Negative quantity raises TradeError."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "buy", -5.0)


@pytest.mark.asyncio
async def test_invalid_side_raises_trade_error(tmp_db, seeded_cache):
    """Side other than 'buy'/'sell' raises TradeError."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "AAPL", "hold", 1.0)


@pytest.mark.asyncio
async def test_no_price_for_ticker_raises_trade_error(tmp_db, seeded_cache):
    """TradeError raised when PriceCache has no price for the requested ticker."""
    with pytest.raises(TradeError):
        await execute_trade(seeded_cache, "UNKNOWN", "buy", 1.0)


@pytest.mark.asyncio
async def test_ticker_normalised_to_uppercase(tmp_db, seeded_cache):
    """Lowercase ticker is normalised to uppercase in the result."""
    result = await execute_trade(seeded_cache, "aapl", "buy", 1.0)
    assert result["ticker"] == "AAPL"


# ---------------------------------------------------------------------------
# get_portfolio
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_portfolio_cash_balance(tmp_db, seeded_cache):
    """get_portfolio returns DEFAULT_CASH when no trades have been made."""
    portfolio = await get_portfolio(seeded_cache)
    assert portfolio["cash_balance"] == pytest.approx(DEFAULT_CASH)


@pytest.mark.asyncio
async def test_get_portfolio_empty_positions(tmp_db, seeded_cache):
    """get_portfolio returns an empty positions list when no positions exist."""
    portfolio = await get_portfolio(seeded_cache)
    assert portfolio["positions"] == []


@pytest.mark.asyncio
async def test_get_portfolio_total_value_equals_cash_plus_market_values(tmp_db, seeded_cache):
    """total_value == cash + sum(market_value per position)."""
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)  # cost = 10 * 150 = 1500

    portfolio = await get_portfolio(seeded_cache)

    # cash = 10000 - 1500 = 8500; market_value = 10 * 150 = 1500; total = 10000
    assert portfolio["total_value"] == pytest.approx(DEFAULT_CASH)
    assert portfolio["cash_balance"] == pytest.approx(DEFAULT_CASH - 1500.0)


@pytest.mark.asyncio
async def test_get_portfolio_unrealized_pnl(tmp_db, seeded_cache):
    """unrealized_pnl == (current_price - avg_cost) * quantity."""
    await execute_trade(seeded_cache, "AAPL", "buy", 10.0)  # avg_cost = 150

    # Move price up
    seeded_cache.update("AAPL", 160.0)
    portfolio = await get_portfolio(seeded_cache)

    pos = portfolio["positions"][0]
    assert pos["unrealized_pnl"] == pytest.approx((160.0 - 150.0) * 10.0)
    assert pos["change_percent"] == pytest.approx((160.0 - 150.0) / 150.0 * 100.0)


@pytest.mark.asyncio
async def test_get_portfolio_position_fields(tmp_db, seeded_cache):
    """Each position dict has the required fields."""
    await execute_trade(seeded_cache, "AAPL", "buy", 5.0)

    portfolio = await get_portfolio(seeded_cache)
    pos = portfolio["positions"][0]

    required = {"ticker", "quantity", "avg_cost", "current_price", "market_value",
                "unrealized_pnl", "change_percent"}
    assert required.issubset(pos.keys())


# ---------------------------------------------------------------------------
# record_snapshot / get_history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_history_empty_initially(tmp_db):
    """get_history returns [] when no snapshots have been recorded."""
    history = await get_history()
    assert history == []


@pytest.mark.asyncio
async def test_get_history_returns_snapshots_ascending(tmp_db, seeded_cache):
    """Snapshots are returned in ascending recorded_at order."""
    await execute_trade(seeded_cache, "AAPL", "buy", 1.0)
    await execute_trade(seeded_cache, "AAPL", "sell", 1.0)

    history = await get_history()

    assert len(history) == 2
    assert "total_value" in history[0]
    assert "recorded_at" in history[0]
    assert history[0]["recorded_at"] <= history[1]["recorded_at"]


@pytest.mark.asyncio
async def test_record_snapshot_inserts_row(tmp_db, seeded_cache):
    """record_snapshot inserts exactly one row into portfolio_snapshots."""
    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (before,) = await cur.fetchone()

    await record_snapshot(seeded_cache)

    async with db_module.connect() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM portfolio_snapshots WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (after,) = await cur.fetchone()

    assert after == before + 1


# ---------------------------------------------------------------------------
# Portfolio router — Task 2
# ---------------------------------------------------------------------------
# These tests use a sync fixture + TestClient so the ASGI app runs in a
# dedicated thread (Starlette's TestClient thread pool), avoiding event-loop
# conflicts with pytest-asyncio.
# ---------------------------------------------------------------------------


@pytest.fixture
def portfolio_client(tmp_path, monkeypatch):
    """Sync fixture: initialise temp DB, seed a PriceCache, build TestClient."""
    from app.routes.portfolio import create_portfolio_router

    db_file = tmp_path / "test_portfolio_router.db"
    monkeypatch.setenv("DB_PATH", str(db_file))

    # Initialise schema + seed data using a fresh event loop (sync context)
    asyncio.run(db_module.init_db())

    cache = PriceCache()
    cache.update("AAPL", 150.0)

    app = FastAPI()
    app.include_router(create_portfolio_router(cache))

    with TestClient(app) as client:
        yield client, cache


def test_get_portfolio_returns_200_with_required_fields(portfolio_client):
    """GET /api/portfolio returns 200 with cash_balance, total_value, positions."""
    client, _ = portfolio_client
    resp = client.get("/api/portfolio")

    assert resp.status_code == 200
    data = resp.json()
    assert "cash_balance" in data
    assert "total_value" in data
    assert "positions" in data
    assert isinstance(data["positions"], list)


def test_get_portfolio_cash_balance_is_default(portfolio_client):
    """GET /api/portfolio with no prior trades returns DEFAULT_CASH as cash_balance."""
    client, _ = portfolio_client
    data = client.get("/api/portfolio").json()
    assert data["cash_balance"] == pytest.approx(DEFAULT_CASH)


def test_post_trade_valid_buy_returns_200(portfolio_client):
    """POST /api/portfolio/trade with a valid buy returns 200 and confirmation dict."""
    client, _ = portfolio_client
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 5.0, "side": "buy"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ticker"] == "AAPL"
    assert data["side"] == "buy"
    assert data["quantity"] == pytest.approx(5.0)
    assert data["price"] == pytest.approx(150.0)
    assert "cash_balance" in data


def test_post_trade_insufficient_cash_returns_400(portfolio_client):
    """POST /api/portfolio/trade with insufficient cash returns HTTP 400."""
    client, _ = portfolio_client
    # 200 shares × $150 = $30 000 > DEFAULT_CASH ($10 000)
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 200.0, "side": "buy"},
    )

    assert resp.status_code == 400
    assert "detail" in resp.json()


def test_post_trade_invalid_side_returns_400(portfolio_client):
    """POST /api/portfolio/trade with an unknown side returns HTTP 400."""
    client, _ = portfolio_client
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1.0, "side": "hold"},
    )

    assert resp.status_code == 400


def test_post_trade_insufficient_shares_returns_400(portfolio_client):
    """POST /api/portfolio/trade sell with more shares than owned returns HTTP 400."""
    client, _ = portfolio_client
    # Buy 3 shares first
    client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 3.0, "side": "buy"},
    )
    # Try to sell 10 — should fail
    resp = client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 10.0, "side": "sell"},
    )

    assert resp.status_code == 400


def test_get_history_returns_200_with_list(portfolio_client):
    """GET /api/portfolio/history returns 200 with a list (may be empty)."""
    client, _ = portfolio_client
    resp = client.get("/api/portfolio/history")

    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_history_after_trade_has_snapshot(portfolio_client):
    """GET /api/portfolio/history returns at least one entry after a trade."""
    client, _ = portfolio_client
    client.post(
        "/api/portfolio/trade",
        json={"ticker": "AAPL", "quantity": 1.0, "side": "buy"},
    )
    resp = client.get("/api/portfolio/history")

    history = resp.json()
    assert len(history) >= 1
    assert "total_value" in history[0]
    assert "recorded_at" in history[0]
