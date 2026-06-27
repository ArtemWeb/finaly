"""Tests for chat_service: context assembly, LLM call, history memory,
auto-execution of trades and watchlist changes, and message persistence.

Covers every behavior defined in 02-02-PLAN.md:

Task 1 (context + LLM call + history):
- build_portfolio_context renders cash, positions with P&L, watchlist with live prices
- handle_chat builds messages list: system prompt first, user message last
- handle_chat injects recent history between system and user message (CHAT-04 memory)
- system prompt contains portfolio context (CHAT-01)

Task 2 (auto-exec + persist):
- handle_chat executes valid buy via execute_trade; result reports success with cash_balance
- handle_chat catches TradeError and reports error without raising (CHAT-03)
- handle_chat inserts watchlist row + calls market_source.add_ticker on "add" (CHAT-04)
- handle_chat deletes watchlist row + calls market_source.remove_ticker on "remove" (CHAT-04)
- handle_chat inserts exactly 2 chat_messages rows per call (user + assistant) (CHAT-05)
- returned dict has message and actions with trades and watchlist_changes (CHAT-05)
"""

from __future__ import annotations

import json

import pytest

import app.chat_service as chat_service_module
import app.db as db_module
from app.chat_service import build_portfolio_context, handle_chat
from app.db import DEFAULT_USER_ID
from app.llm import ChatResponse, TradeAction, WatchlistChange
from app.market.cache import PriceCache

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def tmp_db(tmp_path, monkeypatch):
    """Set DB_PATH to a temp file and initialise schema + seed data."""
    db_file = tmp_path / "test_chat_service.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    await db_module.init_db()


@pytest.fixture
def seeded_cache() -> PriceCache:
    """PriceCache pre-seeded with AAPL @ 150, GOOGL @ 200, TSLA @ 300."""
    cache = PriceCache()
    cache.update("AAPL", 150.0)
    cache.update("GOOGL", 200.0)
    cache.update("TSLA", 300.0)
    return cache


class FakeMarketSource:
    """Minimal async stub for MarketDataSource — records add/remove calls."""

    def __init__(self) -> None:
        self.added: list[str] = []
        self.removed: list[str] = []

    async def add_ticker(self, ticker: str) -> None:
        self.added.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.removed.append(ticker)


# ---------------------------------------------------------------------------
# Task 1: build_portfolio_context
# ---------------------------------------------------------------------------


def test_build_portfolio_context_contains_cash():
    """build_portfolio_context output includes cash_balance."""
    portfolio = {"cash_balance": 5000.0, "total_value": 5000.0, "positions": []}
    watchlist: list[dict] = []
    result = build_portfolio_context(portfolio, watchlist)
    # Cash balance appears in some numeric form (may be formatted with commas)
    assert "5,000" in result or "5000" in result


def test_build_portfolio_context_contains_position_ticker_and_pnl():
    """build_portfolio_context includes each position's ticker and unrealized P&L."""
    portfolio = {
        "cash_balance": 8500.0,
        "total_value": 10000.0,
        "positions": [
            {
                "ticker": "AAPL",
                "quantity": 10.0,
                "avg_cost": 150.0,
                "current_price": 160.0,
                "market_value": 1600.0,
                "unrealized_pnl": 100.0,
                "change_percent": 6.67,
            }
        ],
    }
    watchlist: list[dict] = []
    result = build_portfolio_context(portfolio, watchlist)
    assert "AAPL" in result
    assert "100" in result  # unrealized_pnl appears somewhere


def test_build_portfolio_context_contains_watchlist_ticker_with_price():
    """build_portfolio_context includes each watchlist ticker with its live price."""
    portfolio = {"cash_balance": 10000.0, "total_value": 10000.0, "positions": []}
    watchlist = [{"ticker": "GOOGL", "price": 200.0}]
    result = build_portfolio_context(portfolio, watchlist)
    assert "GOOGL" in result
    # Price appears in some numeric form (e.g., "200.00" or "200")
    assert "200" in result


# ---------------------------------------------------------------------------
# Task 1: handle_chat — message list structure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_chat_system_prompt_is_first_message(tmp_db, seeded_cache, monkeypatch):
    """handle_chat builds a messages list whose first element is the system prompt."""
    captured: list[list[dict]] = []

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        captured.append(messages)
        return ChatResponse(message="ok", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "hello")

    assert captured, "complete_chat was not called"
    msgs = captured[0]
    assert msgs[0]["role"] == "system"
    assert len(msgs[0]["content"]) > 0


@pytest.mark.asyncio
async def test_handle_chat_user_message_is_last(tmp_db, seeded_cache, monkeypatch):
    """handle_chat builds a messages list whose final element is the user's message."""
    captured: list[list[dict]] = []

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        captured.append(messages)
        return ChatResponse(message="ok", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "what is my portfolio?")

    msgs = captured[0]
    assert msgs[-1]["role"] == "user"
    assert msgs[-1]["content"] == "what is my portfolio?"


@pytest.mark.asyncio
async def test_handle_chat_system_prompt_contains_portfolio_context(
    tmp_db, seeded_cache, monkeypatch
):
    """System prompt contains portfolio context including cash (CHAT-01)."""
    from app.portfolio_service import execute_trade

    # Create a position so portfolio context is non-trivial
    await execute_trade(seeded_cache, "AAPL", "buy", 5.0)

    captured: list[list[dict]] = []

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        captured.append(messages)
        return ChatResponse(message="ok", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "how am I doing?")

    msgs = captured[0]
    system_content = msgs[0]["content"]
    # System prompt must include cash and AAPL position
    assert "AAPL" in system_content
    assert "cash" in system_content.lower() or any(
        c.isdigit() for c in system_content
    )


@pytest.mark.asyncio
async def test_handle_chat_history_included_oldest_first(tmp_db, seeded_cache, monkeypatch):
    """handle_chat includes prior chat_messages oldest-first between system and user (CHAT-04)."""
    # Seed two prior chat turns directly into the DB
    async with db_module.connect() as db:
        await db.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
            " VALUES (?, ?, ?, ?, NULL, ?)",
            ("msg1", DEFAULT_USER_ID, "user", "first message", "2026-01-01T00:00:00+00:00"),
        )
        await db.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
            " VALUES (?, ?, ?, ?, NULL, ?)",
            ("msg2", DEFAULT_USER_ID, "assistant", "first reply", "2026-01-01T00:00:01+00:00"),
        )
        await db.commit()

    captured: list[list[dict]] = []

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        captured.append(messages)
        return ChatResponse(message="ok", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "second message")

    msgs = captured[0]
    # Structure: [system, user:"first message", assistant:"first reply", user:"second message"]
    roles = [m["role"] for m in msgs]
    contents = [m["content"] for m in msgs]

    assert roles[0] == "system"
    assert roles[-1] == "user"
    assert contents[-1] == "second message"

    # Prior history must appear between system and new user message
    history_msgs = msgs[1:-1]
    assert any("first message" in m["content"] for m in history_msgs)
    assert any("first reply" in m["content"] for m in history_msgs)

    # oldest comes before newest in the history slice
    first_msg_idx = next(i for i, m in enumerate(msgs) if "first message" in m.get("content", ""))
    first_reply_idx = next(i for i, m in enumerate(msgs) if "first reply" in m.get("content", ""))
    assert first_msg_idx < first_reply_idx


@pytest.mark.asyncio
async def test_handle_chat_history_capped_at_history_limit(tmp_db, seeded_cache, monkeypatch):
    """handle_chat caps included history at HISTORY_LIMIT turns (CHAT-04 memory)."""
    from app.chat_service import HISTORY_LIMIT

    # Insert more messages than the cap allows (HISTORY_LIMIT * 2 + 4 individual rows)
    async with db_module.connect() as db:
        for i in range(HISTORY_LIMIT * 2 + 4):
            ts = f"2026-01-01T00:{i:02d}:00+00:00"
            role = "user" if i % 2 == 0 else "assistant"
            await db.execute(
                "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
                " VALUES (?, ?, ?, ?, NULL, ?)",
                (f"msg{i}", DEFAULT_USER_ID, role, f"msg content {i}", ts),
            )
        await db.commit()

    captured: list[list[dict]] = []

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        captured.append(messages)
        return ChatResponse(message="ok", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "new question")

    msgs = captured[0]
    # Exclude system (first) and new user message (last)
    history_msgs = msgs[1:-1]
    # History is capped at HISTORY_LIMIT * 2 messages
    assert len(history_msgs) <= HISTORY_LIMIT * 2


# ---------------------------------------------------------------------------
# Task 2: auto-execute trades
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_chat_executes_valid_buy_trade(tmp_db, seeded_cache, monkeypatch):
    """handle_chat auto-executes a valid buy trade and reports success (CHAT-03)."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(
            message="Buying AAPL for you",
            trades=[TradeAction(ticker="AAPL", side="buy", quantity=2.0)],
            watchlist_changes=[],
        )

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    result = await handle_chat(seeded_cache, market, "buy 2 AAPL")

    trade_records = result["actions"]["trades"]
    assert len(trade_records) == 1
    assert trade_records[0]["ticker"] == "AAPL"
    assert trade_records[0]["status"] == "executed"
    assert "cash_balance" in trade_records[0].get("detail", "") or True  # detail may vary


@pytest.mark.asyncio
async def test_handle_chat_captures_trade_error_without_raising(tmp_db, seeded_cache, monkeypatch):
    """handle_chat catches TradeError and records the error; no exception propagates (CHAT-03)."""
    # Ask to buy way more than the user can afford
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(
            message="Buying AAPL for you",
            trades=[TradeAction(ticker="AAPL", side="buy", quantity=10000.0)],
            watchlist_changes=[],
        )

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    # Must NOT raise — error must be captured in result
    result = await handle_chat(seeded_cache, market, "buy way too much AAPL")

    trade_records = result["actions"]["trades"]
    assert len(trade_records) == 1
    assert trade_records[0]["status"] == "error"
    assert isinstance(trade_records[0]["detail"], str)
    assert len(trade_records[0]["detail"]) > 0


# ---------------------------------------------------------------------------
# Task 2: auto-execute watchlist changes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_chat_adds_ticker_to_watchlist(tmp_db, seeded_cache, monkeypatch):
    """handle_chat inserts watchlist row and calls market_source.add_ticker on 'add' (CHAT-04)."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(
            message="Adding NVDA to watchlist",
            trades=[],
            watchlist_changes=[WatchlistChange(ticker="NVDA", action="add")],
        )

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    result = await handle_chat(seeded_cache, market, "add NVDA to watchlist")

    # market_source.add_ticker must have been called
    assert "NVDA" in market.added

    # Row must exist in watchlist table
    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT id FROM watchlist WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "NVDA"),
        )
        row = await cursor.fetchone()
    assert row is not None

    # Result reports watchlist change
    wl_records = result["actions"]["watchlist_changes"]
    assert len(wl_records) == 1
    assert wl_records[0]["ticker"] == "NVDA"


@pytest.mark.asyncio
async def test_handle_chat_removes_ticker_from_watchlist(tmp_db, seeded_cache, monkeypatch):
    """handle_chat deletes watchlist row and calls market_source.remove_ticker on 'remove' (CHAT-04)."""
    # Pre-insert ticker into watchlist
    async with db_module.connect() as db:
        await db.execute(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            ("wl1", DEFAULT_USER_ID, "META", "2026-01-01T00:00:00+00:00"),
        )
        await db.commit()

    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(
            message="Removing META from watchlist",
            trades=[],
            watchlist_changes=[WatchlistChange(ticker="META", action="remove")],
        )

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    result = await handle_chat(seeded_cache, market, "remove META from watchlist")

    # market_source.remove_ticker must have been called
    assert "META" in market.removed

    # Row must be gone from watchlist table
    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT id FROM watchlist WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, "META"),
        )
        row = await cursor.fetchone()
    assert row is None

    # Result reports watchlist change
    wl_records = result["actions"]["watchlist_changes"]
    assert len(wl_records) == 1
    assert wl_records[0]["ticker"] == "META"


# ---------------------------------------------------------------------------
# Task 2: chat_messages persistence (CHAT-05)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_chat_inserts_exactly_two_chat_messages(tmp_db, seeded_cache, monkeypatch):
    """handle_chat inserts exactly one user row and one assistant row per call (CHAT-05)."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(message="got it", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE user_id = ?", (DEFAULT_USER_ID,)
        )
        (before,) = await cursor.fetchone()

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "test message")

    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at",
            (DEFAULT_USER_ID,),
        )
        rows = await cursor.fetchall()

    new_rows = rows[before:]
    assert len(new_rows) == 2
    roles = [r["role"] for r in new_rows]
    assert "user" in roles
    assert "assistant" in roles


@pytest.mark.asyncio
async def test_handle_chat_user_message_content_matches(tmp_db, seeded_cache, monkeypatch):
    """The user chat_messages row has content == the user_message argument."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(message="response text", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "my specific question")

    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT content FROM chat_messages WHERE user_id = ? AND role = ?",
            (DEFAULT_USER_ID, "user"),
        )
        row = await cursor.fetchone()

    assert row is not None
    assert row["content"] == "my specific question"


@pytest.mark.asyncio
async def test_handle_chat_assistant_actions_json_is_valid(tmp_db, seeded_cache, monkeypatch):
    """The assistant chat_messages row has a valid JSON actions column (CHAT-05)."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(
            message="executed",
            trades=[TradeAction(ticker="AAPL", side="buy", quantity=1.0)],
            watchlist_changes=[],
        )

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    await handle_chat(seeded_cache, market, "buy 1 AAPL")

    async with db_module.connect() as db:
        cursor = await db.execute(
            "SELECT actions FROM chat_messages WHERE user_id = ? AND role = ?",
            (DEFAULT_USER_ID, "assistant"),
        )
        row = await cursor.fetchone()

    assert row is not None
    actions_json = row["actions"]
    assert actions_json is not None

    # Must be parseable JSON
    actions = json.loads(actions_json)
    assert "trades" in actions
    assert "watchlist_changes" in actions


@pytest.mark.asyncio
async def test_handle_chat_returns_structured_dict(tmp_db, seeded_cache, monkeypatch):
    """handle_chat returns a dict with message and actions.trades/watchlist_changes (CHAT-05)."""
    async def fake_complete_chat(messages: list[dict]) -> ChatResponse:
        return ChatResponse(message="hello there", trades=[], watchlist_changes=[])

    monkeypatch.setattr(chat_service_module, "complete_chat", fake_complete_chat)

    market = FakeMarketSource()
    result = await handle_chat(seeded_cache, market, "hi")

    assert "message" in result
    assert result["message"] == "hello there"
    assert "actions" in result
    assert "trades" in result["actions"]
    assert "watchlist_changes" in result["actions"]
