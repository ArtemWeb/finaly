"""LLM client for FinAlly's AI chat feature.

Public API:
    TradeAction         - Pydantic model: ticker, side, quantity
    WatchlistChange     - Pydantic model: ticker, action
    ChatResponse        - Pydantic model: message, trades, watchlist_changes
    MODEL               - LiteLLM model string (OpenRouter → Cerebras provider)
    EXTRA_BODY          - LiteLLM extra_body routing Cerebras as inference provider
    is_mock_mode()      - True when LLM_MOCK env var is "true" / "1"
    is_llm_enabled()    - True when OPENROUTER_API_KEY is set OR mock mode is active
    build_mock_response(messages) - Deterministic ChatResponse without any network call
    complete_chat(messages)       - Async: mock path or real LiteLLM → OpenRouter → Cerebras call
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Literal

from litellm import completion
from pydantic import BaseModel, Field

__all__ = [
    "TradeAction",
    "WatchlistChange",
    "ChatResponse",
    "MODEL",
    "EXTRA_BODY",
    "is_mock_mode",
    "is_llm_enabled",
    "build_mock_response",
    "complete_chat",
]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (source of truth: .claude/skills/cerebras/SKILL.md)
# ---------------------------------------------------------------------------

MODEL: str = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY: dict = {"provider": {"order": ["cerebras"]}}

# ---------------------------------------------------------------------------
# Structured-output schemas
# ---------------------------------------------------------------------------


class TradeAction(BaseModel):
    """A single trade instruction from the LLM."""

    ticker: str
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0, lt=1e9)  # excludes inf/nan via finite bound check


class WatchlistChange(BaseModel):
    """A watchlist add/remove instruction from the LLM."""

    ticker: str
    action: Literal["add", "remove"]


class ChatResponse(BaseModel):
    """Structured JSON response from the LLM.

    The LLM is instructed to always respond with JSON matching this schema:
    - message: conversational text shown to the user
    - trades: optional list of trades to auto-execute
    - watchlist_changes: optional list of watchlist modifications
    """

    message: str
    trades: list[TradeAction] = Field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------


def is_mock_mode() -> bool:
    """Return True when the LLM_MOCK environment variable is set to "true" or "1".

    Case-insensitive: "true", "TRUE", "True" all count.
    """
    value = os.environ.get("LLM_MOCK", "").lower()
    return value in ("true", "1")


def is_llm_enabled() -> bool:
    """Return True when LLM functionality is available.

    LLM is enabled when:
    - Mock mode is active (LLM_MOCK=true) — no API key required, or
    - OPENROUTER_API_KEY is set to a non-empty value
    """
    return is_mock_mode() or bool(os.environ.get("OPENROUTER_API_KEY"))


# ---------------------------------------------------------------------------
# Mock response builder
# ---------------------------------------------------------------------------


def build_mock_response(messages: list[dict]) -> ChatResponse:
    """Return a deterministic ChatResponse without any network call.

    Determinism guarantee: identical ``messages`` input produces byte-identical
    output. The last user message content is echoed back in the response so the
    mock is recognisable in tests and development.

    This function MUST NOT import or call litellm.
    """
    last_user_content = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_user_content = msg.get("content", "")
            break

    # Fixed, deterministic response — starts with [MOCK] for easy identification
    message = f"[MOCK] I received your message: {last_user_content!r}. (LLM mock mode is active)"
    return ChatResponse(message=message, trades=[], watchlist_changes=[])


# ---------------------------------------------------------------------------
# Core chat function
# ---------------------------------------------------------------------------


async def complete_chat(messages: list[dict]) -> ChatResponse:
    """Send messages to the LLM and return a structured ChatResponse.

    Behaviour:
    - If mock mode is active (LLM_MOCK=true/1): returns build_mock_response()
      immediately — zero network calls, fully deterministic.
    - Otherwise: calls litellm.completion via asyncio.to_thread (litellm is sync;
      running it off the event loop prevents blocking FastAPI's async loop).
      Parses the JSON response into ChatResponse via model_validate_json.

    Error handling:
    - Any exception from litellm (network errors, timeouts, etc.) or from pydantic
      parsing (malformed JSON, schema mismatch) is caught, logged, and replaced
      with a graceful fallback ChatResponse that surfaces the error in ``message``
      while leaving trades and watchlist_changes empty.
    """
    if is_mock_mode():
        return build_mock_response(messages)

    try:
        # litellm.completion is synchronous — run in a thread to avoid blocking
        response = await asyncio.to_thread(
            completion,
            model=MODEL,
            messages=messages,
            response_format=ChatResponse,
            reasoning_effort="low",
            extra_body=EXTRA_BODY,
        )
        raw_content: str = response.choices[0].message.content
        return ChatResponse.model_validate_json(raw_content)
    except Exception:
        logger.exception("LLM call or response parsing failed; returning fallback response")
        return ChatResponse(
            message="I'm sorry, I encountered an error processing your request. Please try again.",
            trades=[],
            watchlist_changes=[],
        )
