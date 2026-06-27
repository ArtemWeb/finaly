"""Tests for the chat route (POST /api/chat) and its registration in create_app().

Covers behaviors defined in 02-03-PLAN.md:

Task 1 (route):
- POST /api/chat with a valid message returns 200 with {message, actions} in mock mode (CHAT-06)
- POST /api/chat with an empty message body returns 400
- POST /api/chat with a missing message field returns 422
- Chat-driven trade (mocked) is visible via GET /api/portfolio (CHAT-03)
- Chat-driven watchlist add (mocked) is visible via GET /api/watchlist (CHAT-04)

Task 2 (wiring):
- The real create_app() serves POST /api/chat and returns 200 in mock mode
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.db as db_module
from app.llm import ChatResponse, TradeAction, WatchlistChange
from app.market.cache import PriceCache
from app.routes.chat import create_chat_router
from app.routes.portfolio import create_portfolio_router
from app.routes.watchlist import create_watchlist_router


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeMarketSource:
    """Minimal async MarketDataSource stub for tests — no real I/O."""

    def __init__(self) -> None:
        self.added: list[str] = []
        self.removed: list[str] = []

    async def add_ticker(self, ticker: str) -> None:
        self.added.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.removed.append(ticker)

    async def start(self, tickers: list[str]) -> None:
        pass

    async def stop(self) -> None:
        pass

    def get_tickers(self) -> list[str]:
        return []


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def chat_client(tmp_path, monkeypatch):
    """Sync fixture: temp DB, LLM_MOCK=true, seeded PriceCache, TestClient.

    Registers create_chat_router plus create_portfolio_router and
    create_watchlist_router on the same FastAPI app so cross-endpoint
    side-effects (trade execution, watchlist changes) can be verified.
    """
    db_file = tmp_path / "test_chat_route.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("LLM_MOCK", "true")

    asyncio.run(db_module.init_db())

    cache = PriceCache()
    cache.update("AAPL", 150.0)
    cache.update("TSLA", 200.0)

    fake_source = _FakeMarketSource()

    app = FastAPI()
    app.include_router(create_chat_router(cache, fake_source))
    app.include_router(create_portfolio_router(cache))
    app.include_router(create_watchlist_router(cache, fake_source))

    with TestClient(app) as client:
        yield client, cache, fake_source


# ---------------------------------------------------------------------------
# Task 1 tests: POST /api/chat route
# ---------------------------------------------------------------------------


def test_chat_valid_message_returns_200_with_message_and_actions(chat_client):
    """POST /api/chat with a valid message returns 200 with 'message' and 'actions' keys (CHAT-06)."""
    client, _, __ = chat_client
    resp = client.post("/api/chat", json={"message": "hello"})

    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data, f"Expected 'message' key in response: {data}"
    assert "actions" in data, f"Expected 'actions' key in response: {data}"

    actions = data["actions"]
    assert "trades" in actions, f"Expected 'trades' key in actions: {actions}"
    assert "watchlist_changes" in actions, f"Expected 'watchlist_changes' key in actions: {actions}"


def test_chat_mock_response_contains_mock_marker(chat_client):
    """POST /api/chat in mock mode returns a response containing '[MOCK]'."""
    client, _, __ = chat_client
    resp = client.post("/api/chat", json={"message": "test message"})

    assert resp.status_code == 200
    data = resp.json()
    assert "[MOCK]" in data["message"], (
        f"Expected '[MOCK]' marker in mock response message: {data['message']!r}"
    )


def test_chat_empty_message_returns_400(chat_client):
    """POST /api/chat with an empty string message body is rejected with HTTP 400."""
    client, _, __ = chat_client
    resp = client.post("/api/chat", json={"message": ""})

    assert resp.status_code == 400
    assert "detail" in resp.json()


def test_chat_whitespace_only_message_returns_400(chat_client):
    """POST /api/chat with a whitespace-only message is rejected with HTTP 400."""
    client, _, __ = chat_client
    resp = client.post("/api/chat", json={"message": "   "})

    assert resp.status_code == 400


def test_chat_missing_message_field_returns_422(chat_client):
    """POST /api/chat with a missing message field returns 422 (Pydantic validation error)."""
    client, _, __ = chat_client
    resp = client.post("/api/chat", json={})

    assert resp.status_code == 422


def test_chat_buy_trade_reduces_cash_and_creates_position(chat_client, monkeypatch):
    """CHAT-03: mocked LLM returning a buy trade is auto-executed; GET /api/portfolio shows position."""
    client, cache, fake_source = chat_client

    # Patch complete_chat to return a buy 1 share of AAPL at $150
    from app import chat_service

    async def _mock_complete_chat(messages):
        return ChatResponse(
            message="Buying AAPL for you",
            trades=[TradeAction(ticker="AAPL", side="buy", quantity=1.0)],
            watchlist_changes=[],
        )

    monkeypatch.setattr(chat_service, "complete_chat", _mock_complete_chat)

    resp = client.post("/api/chat", json={"message": "buy aapl"})
    assert resp.status_code == 200

    # Verify the trade was executed: portfolio should have AAPL position
    portfolio_resp = client.get("/api/portfolio")
    assert portfolio_resp.status_code == 200
    portfolio = portfolio_resp.json()

    positions = portfolio["positions"]
    tickers = [p["ticker"] for p in positions]
    assert "AAPL" in tickers, f"Expected AAPL position after chat trade, got: {tickers}"

    # Cash should be reduced by 1 * $150 = $150
    from app.db import DEFAULT_CASH

    assert portfolio["cash_balance"] == pytest.approx(DEFAULT_CASH - 150.0, rel=1e-6)


def test_chat_watchlist_add_is_reflected_in_get_watchlist(chat_client, monkeypatch):
    """CHAT-04: mocked LLM returning a watchlist add is executed; GET /api/watchlist shows new ticker."""
    client, cache, fake_source = chat_client

    from app import chat_service

    async def _mock_complete_chat(messages):
        return ChatResponse(
            message="Adding TSLA to watchlist",
            trades=[],
            watchlist_changes=[WatchlistChange(ticker="TSLA", action="add")],
        )

    monkeypatch.setattr(chat_service, "complete_chat", _mock_complete_chat)

    resp = client.post("/api/chat", json={"message": "add tsla to watchlist"})
    assert resp.status_code == 200

    # Verify watchlist now contains TSLA
    watchlist_resp = client.get("/api/watchlist")
    assert watchlist_resp.status_code == 200
    watchlist = watchlist_resp.json()

    tickers = [item["ticker"] for item in watchlist]
    assert "TSLA" in tickers, f"Expected TSLA in watchlist after chat command, got: {tickers}"


# ---------------------------------------------------------------------------
# Task 2 tests: create_app() integration
# ---------------------------------------------------------------------------


def test_create_app_serves_chat_endpoint(tmp_path, monkeypatch):
    """create_app() registers POST /api/chat and returns 200 in mock mode."""
    db_file = tmp_path / "test_chat_main.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "nonexistent"))  # skip static mount

    from app.main import create_app

    application = create_app()
    with TestClient(application) as client:
        resp = client.post("/api/chat", json={"message": "hi"})

    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data, f"Expected 'message' key in full-app chat response: {data}"
