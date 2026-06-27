---
phase: 02-ai-chat-integration
reviewed: 2026-06-27T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - backend/app/llm.py
  - backend/tests/test_llm.py
  - backend/pyproject.toml
  - backend/app/chat_service.py
  - backend/tests/test_chat_service.py
  - backend/app/routes/chat.py
  - backend/tests/test_chat_route.py
  - backend/app/main.py
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-27T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The AI chat integration phase adds `llm.py` (LiteLLM wrapper with mock mode), `chat_service.py` (orchestration of context, LLM call, trade/watchlist execution, and persistence), `routes/chat.py` (FastAPI router), and wires it into `main.py`. The code is well-structured and the test suite is broad.

Three blockers were found: the async test functions in `test_llm.py` lack the `@pytest.mark.asyncio` decorator, which makes them silently pass without executing in any pytest version that does not auto-collect bare coroutines; the module-level `app = create_app()` call at the bottom of `main.py` triggers database initialisation and market-data source creation at import time with no guard, which will fail in CI or any import that does not have the environment set up; and `chat_service.py` has a partial-failure consistency hazard where a DB error on the `INSERT INTO chat_messages` step silently loses a trade that has already been committed to the positions/cash tables, leaving the action unrecorded.

Four warnings cover: missing input validation on `trade.side` and `trade.quantity` before they are forwarded to `execute_trade`, meaning a malicious or hallucinating LLM can supply arbitrary side strings that reach domain logic; the `complete_chat` real path discards the original exception before re-raising the fallback, swallowing the actual error class from logs; `_utc_now()` is duplicated verbatim in both `db.py`, `portfolio_service.py`, and `chat_service.py`; and `reasoning_effort="low"` is a hard-coded magic string in `llm.py` that is silently forwarded to the API and will cause a 400 error for any model/provider that does not support the field.

---

## Critical Issues

### CR-01: Async test functions missing `@pytest.mark.asyncio` — tests silently do not run

**File:** `backend/tests/test_llm.py:150`
**Issue:** Seven async test functions (`test_complete_chat_mock_mode_no_network_calls`, `test_complete_chat_mock_returns_mock_prefix`, `test_complete_chat_mock_deterministic`, `test_complete_chat_invalid_json_graceful`, `test_complete_chat_network_error_graceful`, `test_complete_chat_real_path_uses_correct_params`) are defined as plain `async def` without the `@pytest.mark.asyncio` decorator.

`pyproject.toml` sets `asyncio_mode = "auto"`, which is supposed to auto-mark coroutines. However `pytest-asyncio >= 0.21` changed the behaviour of `asyncio_mode = "auto"`: it only applies to **test functions collected inside packages that explicitly opt in**, or within fixture-scoped collection. A bare `async def test_*()` at module level without the decorator will be collected as a coroutine object by pytest, yield "passed" with a PytestUnraisableExceptionWarning, and never actually execute. All six async tests in `test_llm.py` are currently not running — the entire `complete_chat` behaviour is untested.

**Fix:** Add `@pytest.mark.asyncio` to every async test function, or verify via `pytest -v --co` that each test appears in the collected set and actually executes (check for `PASSED` not `XFAIL`/no-op). With `asyncio_mode = "auto"` correctly configured the decorator may be redundant, but it makes intent explicit and is immune to version drift.

```python
import pytest

@pytest.mark.asyncio
async def test_complete_chat_mock_mode_no_network_calls(monkeypatch):
    ...

@pytest.mark.asyncio
async def test_complete_chat_mock_returns_mock_prefix(monkeypatch):
    ...
```

Apply the same decorator to lines 179, 192, 220, 241 in `test_llm.py`.

---

### CR-02: Module-level `app = create_app()` runs at import time with no environment guard

**File:** `backend/app/main.py:189`
**Issue:** The statement `app = create_app()` at the bottom of `main.py` executes unconditionally when the module is imported. `create_app()` calls `create_market_data_source(cache)` which reads `MASSIVE_API_KEY`, and the `lifespan` registered by `create_app()` will call `init_db()` (touching `DB_PATH`) and `source.start(tickers)` on every TestClient context-manager entry. The real problem is subtler: **any `import app.main` in a test or at the REPL will create a live `PriceCache` and a live `MarketDataSource` immediately**, with no way to inject mocks. If `DB_PATH` is not set, `get_db_path()` defaults to `"db/finally.db"` and `os.makedirs` will create that directory in whatever cwd pytest runs from — potentially polluting the repo root.

The test `test_create_app_serves_chat_endpoint` monkeypatches `DB_PATH` and then calls `create_app()` directly (good), but it imports `from app.main import create_app` which triggers the module-level `app = create_app()` first, with the un-patched environment. This is a latent test pollution bug that becomes a hard failure if the `db/` directory cannot be created or if a `MASSIVE_API_KEY` is present.

**Fix:** Guard the module-level instantiation:

```python
# Module-level app instance — required for ``uvicorn app.main:app``
# Only created when not running under pytest to avoid import-time side effects.
import os as _os

if _os.environ.get("PYTEST_CURRENT_TEST") is None:
    app = create_app()
```

Alternatively, use a lazy accessor or document that the module must be imported only after the environment is fully configured — and update `test_create_app_serves_chat_endpoint` to not rely on the module-level `app`.

---

### CR-03: Trade committed to DB before `chat_messages` insert — partial failure leaves invisible executed trade

**File:** `backend/app/chat_service.py:305-328`
**Issue:** In `handle_chat`, steps 5 and 6 (trade execution and watchlist changes) commit to the database via `execute_trade` (which calls `db.commit()` internally) and via explicit `await db.commit()` calls in the watchlist block. Step 7 then opens a separate `connect()` context and performs two `INSERT INTO chat_messages` rows in one commit.

If the `chat_messages` INSERT fails (e.g., schema mismatch, disk full, connection drop), the trade is already durably committed but the `chat_messages` record — including the `actions` JSON — is never written. The caller receives an unhandled exception, the frontend sees a 500, but the trade has already been executed. There is no way to reconcile the missing record without manually inspecting the `trades` table.

This is not a theoretical risk: `chat_messages.id` is a `uuid4().hex` string primary key; if any uniqueness collision occurs (birthday paradox at scale or a test double that reuses IDs), the second INSERT fails after the first succeeds, leaving one orphaned message row and one missing.

**Fix:** Persist chat messages inside the same transaction as trade execution, or wrap the entire step 5-7 sequence in a try/except that records partial failure. At minimum, the `chat_messages` INSERT should be wrapped in its own try/except with explicit logging so the failure is surfaced rather than silently propagated:

```python
try:
    async with connect() as db:
        await db.execute(
            "INSERT INTO chat_messages ...",
            (..., "user", user_message, now),
        )
        await db.execute(
            "INSERT INTO chat_messages ...",
            (..., "assistant", response.message, json.dumps(actions_payload), now),
        )
        await db.commit()
except Exception:
    logger.exception(
        "Failed to persist chat_messages; trade/watchlist changes already committed"
    )
    # Still return the result so the user sees the LLM reply
```

---

## Warnings

### WR-01: LLM-supplied `side` and `quantity` values forwarded to `execute_trade` without validation

**File:** `backend/app/chat_service.py:230`
**Issue:** In the trade auto-execution loop (step 5), the values `trade.side` and `trade.quantity` are taken directly from the `ChatResponse` Pydantic model and passed to `execute_trade` without any sanitisation beyond `ticker.upper()`. `TradeAction.side` is typed as `str` with no `Literal["buy", "sell"]` constraint, and `TradeAction.quantity` is typed as `float` with no `gt=0` constraint.

This means a hallucinating or adversarially-prompted LLM can return `{"side": "short", "quantity": -100}` and the values will reach `execute_trade` unfiltered. While `execute_trade` does validate both (`side not in {"buy", "sell"}` and `quantity <= 0`), the failure surfaces as a `TradeError` that is caught and logged — but the invalid action is silently recorded in `trade_records` with `status: "error"` and returned to the caller. There is no rate-limiting or circuit breaker on repeated LLM-driven invalid trade attempts.

The more direct concern is that `trade.quantity` of type `float` can be `inf` or `nan` (both valid Python floats, accepted by Pydantic by default). `inf * fill_price = inf`, which exceeds any cash balance; `nan * fill_price = nan`, which passes the `cost > cash` check (`nan > float` is always `False`), potentially inserting a `nan` cost into the `positions` table.

**Fix:** Add `Literal` and `Field` constraints to `TradeAction` and `WatchlistChange` in `llm.py`:

```python
from typing import Literal
from pydantic import Field

class TradeAction(BaseModel):
    ticker: str
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0, lt=1e9)  # also excludes inf/nan via finite check

class WatchlistChange(BaseModel):
    ticker: str
    action: Literal["add", "remove"]
```

Pydantic v2 rejects `inf`/`nan` when `gt` or `lt` is applied, so this closes both the invalid-side and infinite-quantity issues.

---

### WR-02: `reasoning_effort="low"` hard-coded as positional keyword — breaks non-Cerebras models silently

**File:** `backend/app/llm.py:159`
**Issue:** `reasoning_effort="low"` is passed to `litellm.completion` unconditionally. This parameter is a LiteLLM extension that maps to provider-specific fields; for OpenRouter + Cerebras it is not a standard parameter and litellm may forward it in `extra_body` or as a raw kwarg. If the model or provider changes, litellm may forward an unsupported `reasoning_effort` field in the API request body and receive a `400 Bad Request`, which is then caught by the broad `except Exception` block and turned into a silent "I encountered an error" fallback — the user sees a failure with no actionable log beyond "LLM call or response parsing failed".

The value `"low"` is also a magic string with no constant or documentation explaining what values are valid.

**Fix:** Either move `reasoning_effort` into `EXTRA_BODY` with a comment referencing the Cerebras/OpenRouter spec, or define a constant and add a note:

```python
# Cerebras inference effort level: "low" | "medium" | "high"
# See: https://docs.openrouter.ai/providers/cerebras
REASONING_EFFORT: str = "low"

response = await asyncio.to_thread(
    completion,
    model=MODEL,
    messages=messages,
    response_format=ChatResponse,
    extra_body={**EXTRA_BODY, "reasoning_effort": REASONING_EFFORT},
)
```

---

### WR-03: `_utc_now()` duplicated across three modules

**File:** `backend/app/chat_service.py:171`, `backend/app/db.py:156`, `backend/app/portfolio_service.py:36`
**Issue:** An identical `_utc_now()` function is defined in three separate modules:

```python
def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
```

This is not merely a style concern: if the timestamp format ever needs to change (e.g., switching to `isoformat(timespec='seconds')` for SQLite sorting consistency), all three copies must be updated in sync. A missed copy produces subtly inconsistent timestamp formats across tables, which can break ORDER BY queries that rely on lexicographic ISO-8601 sort.

**Fix:** Move `_utc_now()` to `app/db.py` (already the persistence layer) and export it, or create a `app/utils.py` module and import from there.

---

### WR-04: `complete_chat` error handler swallows the original exception class — degrades observability

**File:** `backend/app/llm.py:164`
**Issue:** The `except Exception:` block in `complete_chat` calls `logger.exception(...)` and returns a fallback `ChatResponse`. `logger.exception` does log the full traceback, so the stack trace is preserved. However, the error type is completely lost to the caller — the fallback message "I'm sorry, I encountered an error..." gives the user and the frontend no signal about whether this was a network timeout, a 429 rate-limit, a 401 auth failure, or a Pydantic validation error. All failures look identical.

More critically, **authentication failures (401) and rate limits (429)** are treated identically to transient network errors. A permanently-invalid API key will silently degrade every chat turn to a fallback message with no escalation path.

**Fix:** At minimum, log the exception type and status code when available, and distinguish auth/rate-limit errors from transient errors:

```python
except Exception as exc:
    logger.exception("LLM call failed: %s: %s", type(exc).__name__, exc)
    # Distinguish permanent vs transient failures for monitoring
    msg = "I'm sorry, I encountered an error processing your request. Please try again."
    return ChatResponse(message=msg, trades=[], watchlist_changes=[])
```

For a more robust fix, re-raise non-transient errors (401, 403) so the caller (the chat route) can return a proper HTTP 503/401 rather than a silent 200 with an error message.

---

## Info

### IN-01: `ChatRequest.message` has no maximum-length constraint

**File:** `backend/app/routes/chat.py:39`
**Issue:** `ChatRequest.message` is typed as bare `str` with no `max_length` constraint. A client can POST an arbitrarily large message body. This message is concatenated into the LLM messages list and sent to the API, incurring token costs proportional to the input size and potentially hitting context-window limits silently (litellm will raise, which is caught and becomes a fallback response). At very large sizes (MBs) it also consumes memory assembling the messages list.

**Fix:** Add a reasonable max length via Pydantic `Field`:

```python
from pydantic import Field

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4096)
```

This also eliminates the need for the manual `body.message.strip()` empty-check since `min_length=1` handles it, though the strip-and-check behaviour (rejecting whitespace-only messages) would still be needed separately.

---

### IN-02: `build_mock_response` accesses `msg.get("content", "")` without checking `content` type

**File:** `backend/app/llm.py:120`
**Issue:** In `build_mock_response`, the loop extracts `last_user_content = msg.get("content", "")`. If `content` is not a string (e.g., a list of content parts as used in OpenAI vision/multimodal message format), the f-string on line 124 will call `repr()` on the list, which is harmless but produces noise in the mock output. This is low severity since the mock is only used in development/testing, but it is inconsistent with the real path where `response.choices[0].message.content` is always a string from the API.

**Fix:** Add a `str()` coerce or type guard:

```python
content = msg.get("content", "")
last_user_content = content if isinstance(content, str) else str(content)
```

---

_Reviewed: 2026-06-27T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
