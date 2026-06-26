"""Unit tests for the LLM integration module (app/llm.py).

All tests run with LLM_MOCK=true — no real API calls are made.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

# Ensure mock mode is active for all tests in this file
os.environ["LLM_MOCK"] = "true"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _import_llm():
    """Import the llm module after env vars are set."""
    import app.llm as llm  # noqa: PLC0415
    return llm


# ---------------------------------------------------------------------------
# Mock mode tests
# ---------------------------------------------------------------------------


def test_mock_mode_returns_llm_response():
    """With LLM_MOCK=true, call_llm returns an LLMResponse without hitting the API."""
    llm = _import_llm()
    result = llm.call_llm("Hello", "cash: $10000", [])
    assert isinstance(result, llm.LLMResponse)


def test_mock_mode_returns_correct_message():
    """Mock response has the expected message string."""
    llm = _import_llm()
    result = llm.call_llm("Hello", "portfolio context", [])
    assert "portfolio" in result.message.lower() or "cash" in result.message.lower()


def test_mock_mode_returns_empty_trades():
    """Mock response has an empty trades list."""
    llm = _import_llm()
    result = llm.call_llm("Hello", "", [])
    assert result.trades == [] or result.trades is None


def test_mock_mode_returns_empty_watchlist_changes():
    """Mock response has an empty watchlist_changes list."""
    llm = _import_llm()
    result = llm.call_llm("Hello", "", [])
    assert result.watchlist_changes == [] or result.watchlist_changes is None


def test_mock_mode_ignores_user_message():
    """Mock response is deterministic regardless of the user message."""
    llm = _import_llm()
    r1 = llm.call_llm("Buy AAPL", "context", [])
    r2 = llm.call_llm("Sell everything", "context", [])
    assert r1.message == r2.message


def test_mock_mode_ignores_conversation_history():
    """Mock response is deterministic regardless of conversation history."""
    llm = _import_llm()
    history = [
        {"role": "user", "content": "Previous message"},
        {"role": "assistant", "content": "Previous response"},
    ]
    r1 = llm.call_llm("Hello", "context", [])
    r2 = llm.call_llm("Hello", "context", history)
    assert r1.message == r2.message


# ---------------------------------------------------------------------------
# Structured output schema tests
# ---------------------------------------------------------------------------


def test_llm_response_valid_minimal():
    """LLMResponse can be constructed with only the message field."""
    llm = _import_llm()
    resp = llm.LLMResponse(message="Hello")
    assert resp.message == "Hello"
    assert resp.trades == [] or resp.trades is None
    assert resp.watchlist_changes == [] or resp.watchlist_changes is None


def test_llm_response_with_trades():
    """LLMResponse correctly stores a list of TradeAction objects."""
    llm = _import_llm()
    resp = llm.LLMResponse(
        message="Buying AAPL",
        trades=[llm.TradeAction(ticker="AAPL", side="buy", quantity=10)],
    )
    assert len(resp.trades) == 1
    assert resp.trades[0].ticker == "AAPL"
    assert resp.trades[0].side == "buy"
    assert resp.trades[0].quantity == 10.0


def test_llm_response_with_watchlist_changes():
    """LLMResponse correctly stores a list of WatchlistChange objects."""
    llm = _import_llm()
    resp = llm.LLMResponse(
        message="Adding PYPL to watchlist",
        watchlist_changes=[llm.WatchlistChange(ticker="PYPL", action="add")],
    )
    assert len(resp.watchlist_changes) == 1
    assert resp.watchlist_changes[0].ticker == "PYPL"
    assert resp.watchlist_changes[0].action == "add"


def test_llm_response_parse_valid_json():
    """model_validate_json correctly parses a valid JSON string."""
    llm = _import_llm()
    json_str = json.dumps({
        "message": "Analyzed your portfolio.",
        "trades": [{"ticker": "MSFT", "side": "buy", "quantity": 5}],
        "watchlist_changes": [{"ticker": "GOOGL", "action": "remove"}],
    })
    resp = llm.LLMResponse.model_validate_json(json_str)
    assert resp.message == "Analyzed your portfolio."
    assert len(resp.trades) == 1
    assert resp.trades[0].ticker == "MSFT"
    assert len(resp.watchlist_changes) == 1
    assert resp.watchlist_changes[0].ticker == "GOOGL"


def test_llm_response_parse_message_only():
    """model_validate_json works when trades and watchlist_changes are absent."""
    llm = _import_llm()
    json_str = json.dumps({"message": "No actions needed."})
    resp = llm.LLMResponse.model_validate_json(json_str)
    assert resp.message == "No actions needed."


def test_llm_response_parse_empty_arrays():
    """model_validate_json works with explicit empty arrays."""
    llm = _import_llm()
    json_str = json.dumps({"message": "All clear.", "trades": [], "watchlist_changes": []})
    resp = llm.LLMResponse.model_validate_json(json_str)
    assert resp.trades == []
    assert resp.watchlist_changes == []


# ---------------------------------------------------------------------------
# Portfolio context formatting
# ---------------------------------------------------------------------------


def test_build_portfolio_context_includes_cash():
    """build_portfolio_context includes the cash balance."""
    llm = _import_llm()
    portfolio = {"cash_balance": 5000.0, "total_value": 5000.0, "positions": []}
    context = llm.build_portfolio_context(portfolio)
    assert "5000" in context
    assert "cash" in context.lower()


def test_build_portfolio_context_includes_positions():
    """build_portfolio_context includes ticker and quantity for open positions."""
    llm = _import_llm()
    portfolio = {
        "cash_balance": 8000.0,
        "total_value": 10000.0,
        "positions": [
            {
                "ticker": "AAPL",
                "quantity": 10.0,
                "avg_cost": 150.0,
                "current_price": 200.0,
                "unrealized_pnl": 500.0,
                "pnl_pct": 33.33,
            }
        ],
    }
    context = llm.build_portfolio_context(portfolio)
    assert "AAPL" in context
    assert "10" in context


def test_build_portfolio_context_no_positions():
    """build_portfolio_context gracefully handles an empty positions list."""
    llm = _import_llm()
    portfolio = {"cash_balance": 10000.0, "total_value": 10000.0, "positions": []}
    context = llm.build_portfolio_context(portfolio)
    assert "no open positions" in context.lower() or "10000" in context


def test_build_portfolio_context_total_value():
    """build_portfolio_context includes total portfolio value."""
    llm = _import_llm()
    portfolio = {
        "cash_balance": 5000.0,
        "total_value": 12345.0,
        "positions": [],
    }
    context = llm.build_portfolio_context(portfolio)
    assert "12345" in context


# ---------------------------------------------------------------------------
# Malformed LLM response handling (non-mock path)
# ---------------------------------------------------------------------------


def test_malformed_response_returns_error_message():
    """When the real LLM path returns malformed JSON, call_llm returns a safe error response."""
    # Temporarily disable mock mode
    original = os.environ.get("LLM_MOCK")
    os.environ["LLM_MOCK"] = "false"
    os.environ.setdefault("OPENROUTER_API_KEY", "fake-key-for-test")

    try:
        llm = _import_llm()

        # Patch litellm.completion to return a fake response with malformed content
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "this is not valid json {{"

        with patch("litellm.completion", return_value=mock_response):
            result = llm.call_llm("test", "context", [])

        # Should return a safe LLMResponse with an error message, not raise
        assert isinstance(result, llm.LLMResponse)
        assert result.message  # non-empty error message
        assert result.trades == [] or result.trades is None
        assert result.watchlist_changes == [] or result.watchlist_changes is None
    finally:
        if original is None:
            del os.environ["LLM_MOCK"]
        else:
            os.environ["LLM_MOCK"] = original


def test_api_exception_returns_error_message():
    """When litellm raises an exception, call_llm returns a safe error response."""
    original = os.environ.get("LLM_MOCK")
    os.environ["LLM_MOCK"] = "false"
    os.environ.setdefault("OPENROUTER_API_KEY", "fake-key-for-test")

    try:
        llm = _import_llm()

        with patch("litellm.completion", side_effect=Exception("API error")):
            result = llm.call_llm("test", "context", [])

        assert isinstance(result, llm.LLMResponse)
        assert "error" in result.message.lower() or "encountered" in result.message.lower()
    finally:
        if original is None:
            del os.environ["LLM_MOCK"]
        else:
            os.environ["LLM_MOCK"] = original
