"""Tests for the LLM client module (backend/app/llm.py).

Tests cover:
- Schema: ChatResponse, TradeAction, WatchlistChange parsing and round-trip
- Constants: MODEL and EXTRA_BODY values
- Mock mode: is_mock_mode(), is_llm_enabled(), build_mock_response()
- complete_chat(): mock path (no network), real path (monkeypatched), error paths
"""

from __future__ import annotations

import pytest

# ---------------------------------------------------------------------------
# Task 1: Schema and constants tests
# ---------------------------------------------------------------------------


def test_chat_response_minimal():
    """ChatResponse with only message field parses correctly."""
    from app.llm import ChatResponse

    r = ChatResponse.model_validate_json('{"message": "hi"}')
    assert r.message == "hi"
    assert r.trades == []
    assert r.watchlist_changes == []


def test_chat_response_with_trades():
    """ChatResponse with trades parses each into a TradeAction."""
    from app.llm import ChatResponse, TradeAction

    payload = '{"message": "ok", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 5.0}]}'
    r = ChatResponse.model_validate_json(payload)
    assert len(r.trades) == 1
    trade = r.trades[0]
    assert isinstance(trade, TradeAction)
    assert trade.ticker == "AAPL"
    assert trade.side == "buy"
    assert trade.quantity == 5.0


def test_chat_response_with_watchlist_changes():
    """ChatResponse with watchlist_changes parses each into a WatchlistChange."""
    from app.llm import ChatResponse, WatchlistChange

    payload = '{"message": "added", "watchlist_changes": [{"ticker": "TSLA", "action": "add"}]}'
    r = ChatResponse.model_validate_json(payload)
    assert len(r.watchlist_changes) == 1
    wc = r.watchlist_changes[0]
    assert isinstance(wc, WatchlistChange)
    assert wc.ticker == "TSLA"
    assert wc.action == "add"


def test_model_constant():
    """MODEL constant matches the cerebras skill specification."""
    from app.llm import MODEL

    assert MODEL == "openrouter/openai/gpt-oss-120b"


def test_extra_body_constant():
    """EXTRA_BODY constant matches the cerebras skill specification."""
    from app.llm import EXTRA_BODY

    assert EXTRA_BODY == {"provider": {"order": ["cerebras"]}}


def test_chat_response_round_trip():
    """ChatResponse serializes and deserializes back to the same values."""
    from app.llm import ChatResponse, TradeAction, WatchlistChange

    original = ChatResponse(
        message="Buy some AAPL",
        trades=[TradeAction(ticker="AAPL", side="buy", quantity=10.0)],
        watchlist_changes=[WatchlistChange(ticker="MSFT", action="add")],
    )
    serialized = original.model_dump_json()
    restored = ChatResponse.model_validate_json(serialized)
    assert restored.message == original.message
    assert len(restored.trades) == 1
    assert restored.trades[0].ticker == "AAPL"
    assert len(restored.watchlist_changes) == 1
    assert restored.watchlist_changes[0].ticker == "MSFT"


# ---------------------------------------------------------------------------
# Task 2: Mock mode and complete_chat tests
# ---------------------------------------------------------------------------


def test_is_mock_mode_true_when_set(monkeypatch):
    """is_mock_mode() returns True when LLM_MOCK=true (case-insensitive)."""
    monkeypatch.setenv("LLM_MOCK", "true")
    from app.llm import is_mock_mode

    assert is_mock_mode() is True


def test_is_mock_mode_true_uppercase(monkeypatch):
    """is_mock_mode() returns True when LLM_MOCK=TRUE (uppercase)."""
    monkeypatch.setenv("LLM_MOCK", "TRUE")
    from app.llm import is_mock_mode

    assert is_mock_mode() is True


def test_is_mock_mode_false_when_not_set(monkeypatch):
    """is_mock_mode() returns False when LLM_MOCK is not set."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    from app.llm import is_mock_mode

    assert is_mock_mode() is False


def test_is_mock_mode_false_when_false(monkeypatch):
    """is_mock_mode() returns False when LLM_MOCK=false."""
    monkeypatch.setenv("LLM_MOCK", "false")
    from app.llm import is_mock_mode

    assert is_mock_mode() is False


def test_is_llm_enabled_with_api_key(monkeypatch):
    """is_llm_enabled() returns True when OPENROUTER_API_KEY is set."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-key")
    monkeypatch.delenv("LLM_MOCK", raising=False)
    from app.llm import is_llm_enabled

    assert is_llm_enabled() is True


def test_is_llm_enabled_with_mock(monkeypatch):
    """is_llm_enabled() returns True when LLM_MOCK=true (no API key needed)."""
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    from app.llm import is_llm_enabled

    assert is_llm_enabled() is True


def test_is_llm_enabled_false_when_neither(monkeypatch):
    """is_llm_enabled() returns False when neither LLM_MOCK nor API key is set."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    from app.llm import is_llm_enabled

    assert is_llm_enabled() is False


@pytest.mark.asyncio
async def test_complete_chat_mock_mode_no_network_calls(monkeypatch):
    """With LLM_MOCK=true, complete_chat returns ChatResponse and makes zero network calls."""
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    # Monkeypatch litellm.completion to raise if called — it must NOT be called in mock mode
    import app.llm as llm_mod

    def _forbidden(*args, **kwargs):
        raise AssertionError("litellm.completion should not be called in mock mode")

    monkeypatch.setattr(llm_mod, "completion", _forbidden)

    from app.llm import ChatResponse, complete_chat

    result = await complete_chat([{"role": "user", "content": "hello"}])
    assert isinstance(result, ChatResponse)
    assert result.message  # non-empty


@pytest.mark.asyncio
async def test_complete_chat_mock_returns_mock_prefix(monkeypatch):
    """Mock response message starts with [MOCK] prefix."""
    monkeypatch.setenv("LLM_MOCK", "true")
    from app.llm import complete_chat

    result = await complete_chat([{"role": "user", "content": "test"}])
    assert result.message.startswith("[MOCK]")


@pytest.mark.asyncio
async def test_complete_chat_mock_deterministic(monkeypatch):
    """Same input messages produce identical ChatResponse in mock mode."""
    monkeypatch.setenv("LLM_MOCK", "true")
    from app.llm import complete_chat

    messages = [{"role": "user", "content": "buy 10 AAPL"}]
    r1 = await complete_chat(messages)
    r2 = await complete_chat(messages)
    assert r1.message == r2.message
    assert r1.trades == r2.trades
    assert r1.watchlist_changes == r2.watchlist_changes


@pytest.mark.asyncio
async def test_complete_chat_invalid_json_graceful(monkeypatch):
    """When litellm returns non-JSON content, complete_chat returns a graceful ChatResponse."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-key")

    import app.llm as llm_mod

    class _FakeMessage:
        content = "not json at all"

    class _FakeChoice:
        message = _FakeMessage()

    class _FakeResponse:
        choices = [_FakeChoice()]

    monkeypatch.setattr(llm_mod, "completion", lambda *a, **kw: _FakeResponse())

    from app.llm import ChatResponse, complete_chat

    result = await complete_chat([{"role": "user", "content": "hello"}])
    assert isinstance(result, ChatResponse)
    assert result.trades == []
    assert result.watchlist_changes == []
    # message should explain the failure
    assert result.message  # non-empty apology/error message


@pytest.mark.asyncio
async def test_complete_chat_network_error_graceful(monkeypatch):
    """When litellm raises an exception, complete_chat returns a graceful ChatResponse."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-key")

    import app.llm as llm_mod

    def _raise_network(*args, **kwargs):
        raise ConnectionError("simulated network failure")

    monkeypatch.setattr(llm_mod, "completion", _raise_network)

    from app.llm import ChatResponse, complete_chat

    result = await complete_chat([{"role": "user", "content": "hello"}])
    assert isinstance(result, ChatResponse)
    assert result.trades == []
    assert result.watchlist_changes == []
    assert result.message  # non-empty apology


@pytest.mark.asyncio
async def test_complete_chat_real_path_uses_correct_params(monkeypatch):
    """On the real (non-mock) path, complete_chat calls litellm with MODEL and EXTRA_BODY."""
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-key")

    import app.llm as llm_mod
    from app.llm import EXTRA_BODY, MODEL, ChatResponse, complete_chat

    captured: dict = {}

    class _FakeMessage:
        content = '{"message": "sure", "trades": [], "watchlist_changes": []}'

    class _FakeChoice:
        message = _FakeMessage()

    class _FakeResponse:
        choices = [_FakeChoice()]

    def _fake_completion(*args, **kwargs):
        captured.update(kwargs)
        return _FakeResponse()

    monkeypatch.setattr(llm_mod, "completion", _fake_completion)

    result = await complete_chat([{"role": "user", "content": "hi"}])
    assert isinstance(result, ChatResponse)
    assert captured.get("model") == MODEL
    assert captured.get("extra_body") == EXTRA_BODY
