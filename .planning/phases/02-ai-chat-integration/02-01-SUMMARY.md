---
phase: 02-ai-chat-integration
plan: "01"
subsystem: llm-client
status: complete
tags: [llm, litellm, pydantic, mock-mode, structured-output, cerebras, tdd]
completed_date: "2026-06-27"
duration_minutes: 6

dependency_graph:
  requires: []
  provides:
    - backend/app/llm.py: [TradeAction, WatchlistChange, ChatResponse, MODEL, EXTRA_BODY, is_mock_mode, is_llm_enabled, build_mock_response, complete_chat]
    - .env.example
  affects:
    - backend/app/chat_service.py  # plan 02 imports complete_chat
    - backend/app/routes/chat.py   # plan 03 imports is_llm_enabled, complete_chat

tech_stack:
  added:
    - litellm>=1.0.0 (OpenRouter/Cerebras inference client)
    - pydantic>=2.0.0 (structured output schema validation)
  patterns:
    - Pydantic v2 BaseModel for structured LLM JSON output
    - asyncio.to_thread wrapping sync litellm.completion call
    - Mock mode via LLM_MOCK env var — zero network calls, deterministic output
    - Broad try/except with graceful fallback ChatResponse on any LLM/parse error

key_files:
  created:
    - backend/app/llm.py
    - backend/tests/test_llm.py
    - .env.example
  modified:
    - backend/pyproject.toml (added litellm, pydantic deps)
    - backend/uv.lock (updated by uv add)

decisions:
  - "asyncio.to_thread used for litellm.completion because litellm is synchronous — runs off the FastAPI event loop to prevent blocking other requests (T-02-03 mitigation)"
  - "broad except Exception in complete_chat catches both pydantic ValidationError and network errors, logging with logger.exception for full stack traces"
  - "_FakeMessage inner-class pattern replaced with a named class to satisfy ruff N801 naming rule in tests"
  - "LLM_MOCK accepts 'true'/'TRUE'/'1' (case-insensitive) for flexibility in CI environments"

requirements_covered: [CHAT-02, CHAT-06]
---

# Phase 02 Plan 01: LLM Client Core Summary

**One-liner:** Structured-output Pydantic schemas + LiteLLM → OpenRouter → Cerebras call with mock mode and defensive error handling.

## What Was Built

`backend/app/llm.py` implements the pure I/O boundary of FinAlly's AI chat feature:

- **Schema layer:** Three Pydantic v2 models — `TradeAction` (ticker/side/quantity), `WatchlistChange` (ticker/action), `ChatResponse` (message + optional trades + optional watchlist_changes). All use `Field(default_factory=list)` for mutable defaults, enabling safe `model_validate_json` from LLM output.
- **Constants:** `MODEL = "openrouter/openai/gpt-oss-120b"` and `EXTRA_BODY = {"provider": {"order": ["cerebras"]}}` — exactly as specified in the cerebras skill.
- **Environment helpers:** `is_mock_mode()` (checks `LLM_MOCK` env var, case-insensitive) and `is_llm_enabled()` (true if mock mode OR `OPENROUTER_API_KEY` set).
- **Mock path:** `build_mock_response(messages)` returns a deterministic `[MOCK]`-prefixed `ChatResponse` without any litellm import at call time — safe for CI with no API key.
- **Real path:** `async def complete_chat(messages)` dispatches to mock path immediately if `LLM_MOCK=true`; otherwise calls `litellm.completion` via `asyncio.to_thread` (keeping FastAPI's event loop unblocked), then parses via `ChatResponse.model_validate_json`.
- **Defensive handling:** A broad `except Exception` catches all litellm errors (network, timeout, auth) and all pydantic parse errors (malformed/non-JSON LLM output); logs with `logger.exception`, returns graceful fallback `ChatResponse` — never propagates an exception to the caller.
- **`.env.example`:** Created at repo root with all six env vars documented (OPENROUTER_API_KEY, LLM_MOCK, MASSIVE_API_KEY, DB_PATH, SNAPSHOT_INTERVAL, STATIC_DIR).

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | 33620cd | PASS — `test(02-01): add failing tests...` committed before implementation |
| GREEN (feat) | 3bb39b1 | PASS — `feat(02-01): implement LLM client...` makes all 19 tests pass |

Tests written first, ran to failure (ModuleNotFoundError on `app.llm`), then implementation written. All 19 tests passed on first GREEN run.

## Tasks Completed

| Task | Description | Commit | Tests |
|------|-------------|--------|-------|
| 1 (RED) | Failing schema/constants/mock/complete_chat tests | 33620cd | 19 written |
| 1+2 (GREEN) | llm.py + deps + .env.example — all tests pass | 3bb39b1 | 19/19 green |

Note: Both TDD tasks (Task 1 and Task 2) share the same RED/GREEN cycle since the test file covers both schemas (Task 1) and behavioral functions (Task 2), and the implementation covers both in a single coherent module.

## Verification Results

```
19 passed in 5.89s
ruff check app/llm.py tests/test_llm.py: All checks passed!
```

End-to-end smoke test:
```
$ uv run python -c "import asyncio, os; os.environ['LLM_MOCK']='true'; from app.llm import complete_chat, is_llm_enabled; print(is_llm_enabled()); print(asyncio.run(complete_chat([{'role':'user','content':'hi'}])).message)"
True
[MOCK] I received your message: 'hi'. (LLM mock mode is active)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed inner `class message:` to avoid ruff N801**
- **Found during:** Task 1 ruff check after GREEN
- **Issue:** Test helper classes using `class message:` (lowercase) violated ruff's N801 rule requiring CapWords class names. Ruff reported this as a lint error.
- **Fix:** Replaced the nested class-in-class pattern with a separate `_FakeMessage` class used as an instance attribute: `class _FakeMessage: content = "..."` then `class _FakeChoice: message = _FakeMessage()`.
- **Files modified:** `backend/tests/test_llm.py`
- **Committed with:** 3bb39b1 (same GREEN commit, fix applied before commit)

**2. [Rule 1 - Bug] Removed unused `import pytest` and fixed import sort**
- **Found during:** Task 1 ruff check after GREEN
- **Issue:** `import pytest` was unused (tests don't need explicit pytest import when using monkeypatch fixture); ruff F401 flagged it. Ruff I001 flagged the import block ordering.
- **Fix:** Removed `import pytest`; ran `ruff check --fix` to auto-sort the import block.
- **Files modified:** `backend/tests/test_llm.py`
- **Committed with:** 3bb39b1

## Threat Mitigations Applied

| Threat ID | Mitigation | Location |
|-----------|------------|----------|
| T-02-01 | OPENROUTER_API_KEY read only from `os.environ`; never logged or returned in responses | `is_llm_enabled()`, `complete_chat()` |
| T-02-02 | All LLM output parsed via `ChatResponse.model_validate_json`; malformed content replaced with safe fallback | `complete_chat()` try/except |
| T-02-03 | `asyncio.to_thread` prevents blocking the FastAPI event loop on slow LLM calls | `complete_chat()` |
| T-02-SC | litellm and pydantic are mandated packages per cerebras skill; installed via uv with lockfile | `backend/uv.lock` |

## Known Stubs

None — `llm.py` is a pure function module with no hardcoded empty values flowing to UI rendering.

## Threat Flags

None — no new network endpoints introduced. The `complete_chat` function is an internal async function, not a route handler. Routes will be added in Plan 03.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `backend/app/llm.py` | FOUND |
| `backend/tests/test_llm.py` | FOUND |
| `.env.example` | FOUND |
| `02-01-SUMMARY.md` | FOUND |
| Commit 33620cd (RED) | FOUND |
| Commit 3bb39b1 (GREEN) | FOUND |
| 19 tests pass | VERIFIED |
| ruff clean | VERIFIED |
