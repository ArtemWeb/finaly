"""LLM client for FinAlly.

Calls the LLM via LiteLLM → OpenRouter using Cerebras as the inference provider.
Uses structured outputs to get typed responses with optional trade/watchlist actions.

Set LLM_MOCK=true in the environment to bypass the real API and get a deterministic
mock response — useful for tests and development without an API key.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model constants (cerebras skill)
# ---------------------------------------------------------------------------

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}

_SYSTEM_PROMPT = (
    "You are FinAlly, an AI trading assistant. "
    "Analyze portfolios, suggest trades, execute them when asked. "
    "Be concise and data-driven. "
    "Always respond with valid JSON."
)

# ---------------------------------------------------------------------------
# Structured output schema
# ---------------------------------------------------------------------------


class TradeAction(BaseModel):
    ticker: str
    side: str  # "buy" or "sell"
    quantity: float


class WatchlistChange(BaseModel):
    ticker: str
    action: str  # "add" or "remove"


class LLMResponse(BaseModel):
    message: str
    trades: Optional[list[TradeAction]] = []
    watchlist_changes: Optional[list[WatchlistChange]] = []


# ---------------------------------------------------------------------------
# Mock response
# ---------------------------------------------------------------------------

_MOCK_RESPONSE = LLMResponse(
    message="I've reviewed your portfolio. You have $10,000 in cash ready to invest.",
    trades=[],
    watchlist_changes=[],
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def call_llm(
    user_message: str,
    portfolio_context: str,
    conversation_history: list[dict],
) -> LLMResponse:
    """Call the LLM and return a parsed LLMResponse.

    Args:
        user_message:        The user's latest message text.
        portfolio_context:   A pre-formatted string describing the portfolio state.
        conversation_history: List of {"role": ..., "content": ...} dicts (recent history).

    Returns:
        A parsed LLMResponse with message, trades, and watchlist_changes.
        Falls back to a safe error response if the LLM call or parsing fails.
    """
    # Mock mode — deterministic, never calls the real API.
    if os.environ.get("LLM_MOCK", "").lower() == "true":
        logger.info("LLM_MOCK=true — returning mock response")
        return _MOCK_RESPONSE

    # Lazy import so the module can be imported without litellm installed
    # in environments where only mock mode is used.
    try:
        from litellm import completion  # noqa: PLC0415
    except ImportError as exc:
        logger.error("litellm not installed: %s", exc)
        return LLMResponse(message="LLM unavailable: litellm not installed.", trades=[], watchlist_changes=[])

    # Load API key — .env should already be loaded by the time this runs
    # (the application entry point calls load_dotenv at startup).
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        logger.warning("OPENROUTER_API_KEY not set — LLM call will likely fail")

    # Build messages array
    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "system", "content": f"Current portfolio context:\n{portfolio_context}"},
        *conversation_history,
        {"role": "user", "content": user_message},
    ]

    try:
        response = completion(
            model=MODEL,
            messages=messages,
            response_format=LLMResponse,
            reasoning_effort="low",
            extra_body=EXTRA_BODY,
            api_key=api_key,
        )
        raw = response.choices[0].message.content
        return LLMResponse.model_validate_json(raw)
    except Exception as exc:
        logger.error("LLM call failed: %s", exc)
        return LLMResponse(
            message=f"I encountered an error processing your request: {exc}",
            trades=[],
            watchlist_changes=[],
        )


def build_portfolio_context(portfolio: dict) -> str:
    """Format a portfolio dict (from GET /api/portfolio) into a context string for the LLM."""
    lines = [
        f"Cash balance: ${portfolio.get('cash_balance', 0):.2f}",
        f"Total portfolio value: ${portfolio.get('total_value', 0):.2f}",
        "",
        "Positions:",
    ]
    positions = portfolio.get("positions", [])
    if positions:
        for pos in positions:
            pnl = pos.get("unrealized_pnl", 0)
            pnl_pct = pos.get("pnl_pct", 0)
            lines.append(
                f"  {pos['ticker']}: {pos['quantity']} shares @ avg ${pos['avg_cost']:.2f}, "
                f"current ${pos['current_price']:.2f}, P&L ${pnl:.2f} ({pnl_pct:.2f}%)"
            )
    else:
        lines.append("  (no open positions)")

    return "\n".join(lines)
