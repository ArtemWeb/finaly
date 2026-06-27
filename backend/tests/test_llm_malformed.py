"""Tests for LLM graceful fallback on valid-JSON-wrong-schema responses.

Closes the TEST-03 gap identified in 04-RESEARCH.md and 04-PATTERNS.md:
test_llm.py covers invalid JSON (test_complete_chat_invalid_json_graceful)
and network errors (test_complete_chat_network_error_graceful) but NOT
"valid JSON, wrong schema" — e.g. the LLM returns ``{"trades": []}``
with the required ``message`` field missing, or ``{"message": 12345}``
with a wrongly-typed field.

These tests prove complete_chat's existing graceful-fallback path handles
adversarial/malformed-but-valid-JSON output by returning a ChatResponse
with a truthy fallback ``message`` and empty ``trades`` — no unvalidated
trades ever leak through.

Import-ordering pitfall: ``monkeypatch llm_mod.completion`` MUST happen
AFTER ``import app.llm as llm_mod`` and BEFORE ``from app.llm import
complete_chat`` so the module-level ``completion`` reference inside the
real path is the patched function. Mirrors the analog at
test_llm.py:158-166.
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Shared fake-response builders
# ---------------------------------------------------------------------------


class _FakeMessage:
    """Stand-in for litellm's ``Message`` — exposes ``.content``."""

    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    """Stand-in for litellm's choice wrapper — exposes ``.message``."""

    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeResponse:
    """Stand-in for litellm's completion response — exposes ``.choices``."""

    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]


# ---------------------------------------------------------------------------
# Valid-JSON-wrong-schema graceful fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_chat_json_missing_message_field(monkeypatch):
    """LLM returns valid JSON missing the required 'message' field — graceful fallback.

    The real path's try/except catches pydantic ValidationError and returns
    a ChatResponse with a fallback apology message and empty trades.
    """
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")

    import app.llm as llm_mod

    monkeypatch.setattr(
        llm_mod,
        "completion",
        lambda *args, **kwargs: _FakeResponse('{"trades": []}'),  # missing 'message'
    )

    from app.llm import ChatResponse, complete_chat

    result = await complete_chat([{"role": "user", "content": "hello"}])

    assert isinstance(result, ChatResponse), (
        f"Expected ChatResponse fallback, got {type(result).__name__}"
    )
    assert result.message, "Expected a truthy fallback message on schema violation"
    assert result.trades == [], (
        f"Expected empty trades on schema violation, got {result.trades!r}"
    )
    assert result.watchlist_changes == [], (
        f"Expected empty watchlist_changes on schema violation, got {result.watchlist_changes!r}"
    )


@pytest.mark.asyncio
async def test_complete_chat_json_wrong_type_message(monkeypatch):
    """LLM returns valid JSON with a wrongly-typed 'message' (int) — graceful fallback.

    Pydantic must reject ``{"message": 12345, "trades": []}`` because
    ChatResponse.message is typed as str. The graceful fallback must catch
    this and return a ChatResponse with a truthy message and empty trades.
    """
    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")

    import app.llm as llm_mod

    monkeypatch.setattr(
        llm_mod,
        "completion",
        lambda *args, **kwargs: _FakeResponse('{"message": 12345, "trades": []}'),
    )

    from app.llm import ChatResponse, complete_chat

    result = await complete_chat([{"role": "user", "content": "hello"}])

    assert isinstance(result, ChatResponse), (
        f"Expected ChatResponse fallback, got {type(result).__name__}"
    )
    assert result.message, "Expected a truthy fallback message on type mismatch"
    assert result.trades == [], (
        f"Expected empty trades on type mismatch, got {result.trades!r}"
    )
