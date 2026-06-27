---
phase: 02-ai-chat-integration
plan: "03"
subsystem: chat-route
tags: [fastapi, chat, llm, routing, tdd]
status: complete

dependency_graph:
  requires:
    - 02-02  # handle_chat() and chat_service module
    - 01-02  # portfolio router + execute_trade + get_portfolio
    - 01-03  # watchlist router
  provides:
    - POST /api/chat endpoint
    - create_chat_router factory
    - ChatRequest Pydantic model
  affects:
    - backend/app/main.py (router registration)

tech_stack:
  added:
    - create_chat_router factory (routes/chat.py)
    - ChatRequest Pydantic model
  patterns:
    - Router factory pattern (matching portfolio.py + watchlist.py exactly)
    - TDD (RED/GREEN cycle with ruff fix pass)
    - Dependency injection: cache + market_source passed at factory time

key_files:
  created:
    - backend/app/routes/chat.py
    - backend/tests/test_chat_route.py
  modified:
    - backend/app/main.py

decisions:
  - Test for Task 2 (full-app wiring) was included in test_chat_route.py rather than test_main.py to co-locate all chat endpoint tests
  - Empty/whitespace message guard placed in route handler (not chat_service) to match T-02-08 mitigation at the HTTP boundary
  - monkeypatch targets app.chat_service.complete_chat for cross-endpoint tests to avoid patching litellm internals

metrics:
  duration: "6m"
  completed: "2026-06-27"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
  tests_added: 8
  tests_total_after: 173
---

# Phase 02 Plan 03: Chat Route and App Wiring Summary

POST /api/chat router factory using dependency injection, wired into create_app(), with 8 tests proving CHAT-01/03/04/05/06 end-to-end under LLM_MOCK=true.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| TDD-RED | Failing tests for chat route | 2d38fd1 | backend/tests/test_chat_route.py |
| 1 | Create POST /api/chat router factory | ae76e53 | backend/app/routes/chat.py, backend/tests/test_chat_route.py |
| 2 | Register chat router in create_app() | 2c43b53 | backend/app/main.py |

## What Was Built

### backend/app/routes/chat.py

- `ChatRequest(BaseModel)`: single `message: str` field validated by Pydantic (422 on missing field)
- `create_chat_router(cache, market_source) -> APIRouter`: factory with `prefix="/api/chat"`, `tags=["chat"]`
- Single `POST ""` handler that guards empty/whitespace messages (HTTP 400) then delegates to `await handle_chat(cache, market_source, body.message)`
- Returns the structured dict `{message, actions: {trades, watchlist_changes}}` from handle_chat directly
- No broad try/except needed: handle_chat captures all LLM/trade errors internally

### backend/app/main.py (modified)

- Added `from .routes.chat import create_chat_router` to imports
- Added `application.include_router(create_chat_router(cache, source))` after watchlist, before health endpoint and StaticFiles mount
- Updated docstring to list `/api/chat/*` router

### backend/tests/test_chat_route.py

8 tests covering all PLAN behaviors:

1. `test_chat_valid_message_returns_200_with_message_and_actions` — CHAT-01/CHAT-05/CHAT-06: 200 with {message, actions}
2. `test_chat_mock_response_contains_mock_marker` — CHAT-06: deterministic mock response
3. `test_chat_empty_message_returns_400` — T-02-08: empty message rejected
4. `test_chat_whitespace_only_message_returns_400` — T-02-08: whitespace-only rejected
5. `test_chat_missing_message_field_returns_422` — Pydantic validation
6. `test_chat_buy_trade_reduces_cash_and_creates_position` — CHAT-03: auto-trade wiring
7. `test_chat_watchlist_add_is_reflected_in_get_watchlist` — CHAT-04: auto-watchlist wiring
8. `test_create_app_serves_chat_endpoint` — Task 2: full-app integration

## Verification Results

- `pytest tests/test_chat_route.py -v` — 8/8 tests pass
- `pytest -q` (full suite) — 173/173 tests pass, no regressions
- `ruff check app/ tests/` — all checks passed
- `grep -c "create_chat_router" backend/app/main.py` — returns 2 (import + include_router)
- chat router registered before StaticFiles mount (line 155 vs line 171 in main.py)

## Deviations from Plan

None — plan executed exactly as written. The ruff import-sort fix on test_chat_route.py was an auto-fix (ruff --fix), not a deviation.

## Known Stubs

None — all data flows are wired through real service functions (handle_chat, execute_trade, get_portfolio, get_watchlist).

## Threat Surface Scan

No new trust boundaries introduced beyond those documented in the plan's threat model:
- T-02-08 (ChatRequest body validation + empty-message guard): mitigated in route handler
- T-02-09 (slow LLM blocking event loop): mitigated by asyncio.to_thread in complete_chat
- T-02-10 (chat auto-executes trades): mitigated by execute_trade's existing balance/share validation

## Self-Check: PASSED

- [x] `backend/app/routes/chat.py` exists
- [x] `backend/tests/test_chat_route.py` exists
- [x] Commit 2d38fd1 exists (test RED)
- [x] Commit ae76e53 exists (feat: router factory)
- [x] Commit 2c43b53 exists (feat: app wiring)
- [x] 173 tests pass, 0 failures
- [x] ruff clean
