---
phase: 02-ai-chat-integration
plan: "02"
subsystem: chat-service
tags: [chat, llm, auto-execute, portfolio-context, persistence, tdd]
status: complete

dependency_graph:
  requires:
    - 02-01  # complete_chat + ChatResponse + LLM client
    - 01-02  # execute_trade + TradeError + get_portfolio
    - 01-01  # PriceCache, init_db, connect, DEFAULT_USER_ID
  provides:
    - handle_chat  # full chat turn orchestrator
    - build_portfolio_context  # portfolio+watchlist text renderer
    - SYSTEM_PROMPT  # LLM persona constant
    - HISTORY_LIMIT  # cap for history injection
  affects:
    - chat_messages table (INSERT user + assistant rows per turn)
    - watchlist table (INSERT/DELETE via watchlist_changes auto-exec)
    - positions table (via execute_trade on LLM-decided trades)
    - users_profile table (cash_balance updated by successful trades)

tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN with monkeypatched complete_chat for pure unit testing)
    - Async context manager (aiosqlite connect()) for all DB writes
    - Parameterized queries (? placeholders — no f-string interpolation; T-02-05)
    - Dependency reuse (execute_trade, get_portfolio — no reimplementation)
    - Stub MarketDataSource (FakeMarketSource) for watchlist tests

key_files:
  created:
    - backend/app/chat_service.py
    - backend/tests/test_chat_service.py
  modified: []

decisions:
  - "handle_chat loads history DESC with LIMIT then reverses to get oldest-first without a subquery"
  - "HISTORY_LIMIT=10 means up to 20 rows (10 user + 10 assistant) per call — same semantic as 10 conversation turns"
  - "SYSTEM_PROMPT includes the full JSON schema inline so the model always knows the required output format"
  - "Watchlist context uses cache.get(ticker).price directly (not to_dict()) for a simpler, safer read"
  - "Both Task 1 and Task 2 share the same GREEN commit — the implementation was complete enough to satisfy all 16 tests in one pass"

metrics:
  duration: "5 minutes"
  completed: "2026-06-27T06:48:47Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 02 Plan 02: Chat Service (Context, LLM, Auto-Exec, Persistence) Summary

**One-liner:** Chat orchestration service assembling full portfolio/watchlist/history context, calling the LLM via complete_chat, auto-executing trades via execute_trade and watchlist changes via DB+market_source, persisting user+assistant rows with JSON actions, and returning a structured result dict.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| RED (Task 1+2) | Write 16 failing tests covering all behaviors | 1c57dce | Complete |
| GREEN (Task 1+2) | Implement chat_service.py + fix test format assertions | 5d42f48 | Complete |

## What Was Built

### `backend/app/chat_service.py`

**Public symbols:**

- `SYSTEM_PROMPT` (str) — Positions the model as "FinAlly, an AI trading assistant" with instructions to analyze portfolios, suggest/execute trades, manage watchlists, and always respond with valid structured JSON matching the ChatResponse schema.

- `HISTORY_LIMIT` (int = 10) — Number of recent conversation turns to include. Implementation fetches `HISTORY_LIMIT * 2` rows (user + assistant rows per turn), retrieves them DESC by created_at for efficiency, then reverses them to oldest-first order before injection into the messages list.

- `build_portfolio_context(portfolio, watchlist) -> str` — Renders a compact text block:
  - Cash balance + total portfolio value
  - Per position: ticker, quantity, avg_cost, current_price, P&L ($), change_percent
  - Per watchlist entry: ticker + live price (from PriceCache via cache.get())
  This block is appended to SYSTEM_PROMPT to satisfy CHAT-01.

- `handle_chat(cache, market_source, user_message) -> dict` — Full chat turn:
  1. Loads portfolio via `get_portfolio(cache)` (reuses Phase 1 validated path)
  2. Loads watchlist via `_load_watchlist(cache)` (mirrors GET watchlist read, no router import)
  3. Loads conversation history via `_load_history()` (capped at HISTORY_LIMIT*2 rows)
  4. Builds messages: `[system + context] + history + [user_message]`
  5. Calls `await complete_chat(messages)` (Plan 01 LLM client)
  6. Iterates `response.trades`: calls `execute_trade` per trade; catches `TradeError` and records error in result without propagating (CHAT-03)
  7. Iterates `response.watchlist_changes`: INSERT OR IGNORE + `add_ticker` for "add"; DELETE + `remove_ticker` for "remove"; unknown actions recorded as error (CHAT-04)
  8. Persists user row (actions=NULL) + assistant row (actions=JSON) to chat_messages (CHAT-05)
  9. Returns `{"message": ..., "actions": {"trades": [...], "watchlist_changes": [...]}}` (CHAT-05)

### `backend/tests/test_chat_service.py`

16 tests covering all plan behaviors:

**Context (Task 1):**
- `test_build_portfolio_context_contains_cash` — cash appears in formatted output
- `test_build_portfolio_context_contains_position_ticker_and_pnl` — ticker + P&L in output
- `test_build_portfolio_context_contains_watchlist_ticker_with_price` — watchlist ticker + price
- `test_handle_chat_system_prompt_is_first_message` — system is messages[0]
- `test_handle_chat_user_message_is_last` — user message is messages[-1]
- `test_handle_chat_system_prompt_contains_portfolio_context` — AAPL position in system content (CHAT-01)
- `test_handle_chat_history_included_oldest_first` — prior DB rows appear oldest-first between system and user (CHAT-04)
- `test_handle_chat_history_capped_at_history_limit` — history slice ≤ HISTORY_LIMIT*2 messages

**Auto-exec (Task 2):**
- `test_handle_chat_executes_valid_buy_trade` — valid trade returns status="executed" (CHAT-03)
- `test_handle_chat_captures_trade_error_without_raising` — insufficient funds captured, no raise (CHAT-03)
- `test_handle_chat_adds_ticker_to_watchlist` — watchlist row inserted + add_ticker called (CHAT-04)
- `test_handle_chat_removes_ticker_from_watchlist` — watchlist row deleted + remove_ticker called (CHAT-04)

**Persistence (Task 2):**
- `test_handle_chat_inserts_exactly_two_chat_messages` — exactly 1 user + 1 assistant row (CHAT-05)
- `test_handle_chat_user_message_content_matches` — user row content == user_message (CHAT-05)
- `test_handle_chat_assistant_actions_json_is_valid` — assistant row actions is valid JSON with trades + watchlist_changes (CHAT-05)
- `test_handle_chat_returns_structured_dict` — returned dict has message + actions.trades + actions.watchlist_changes (CHAT-05)

## Security (Threat Model Coverage)

| Threat | Mitigation Applied |
|--------|--------------------|
| T-02-04: LLM-decided trades bypass validation | Trades route through `execute_trade` — cash/shares/side/quantity validation unchanged. `TradeError` is caught and reported, never bypassed. |
| T-02-05: SQL injection via user_message/assistant text | All `chat_messages` INSERTs use `?` parameterized queries (lines 311-325 in chat_service.py) — no f-string interpolation. Same pattern as db.py and portfolio_service.py. |
| T-02-06: Prompt injection | user_message is embedded in messages list but cannot influence anything outside ChatResponse schema. Unknown watchlist actions are caught as errors, not executed. |
| T-02-07: Portfolio data disclosure | Single-user app (DEFAULT_USER_ID); accepted per plan. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion format mismatch for formatted cash balance**
- **Found during:** GREEN verification of test_build_portfolio_context_contains_cash
- **Issue:** `build_portfolio_context` formats cash as `$5,000.00` (with comma thousands separator), but test asserted `"5000"` as substring — not present in `"5,000"`.
- **Fix:** Updated test to assert `"5,000" in result or "5000" in result` to be format-agnostic. Both formats satisfy the intent: the value is rendered in the output.
- **Files modified:** `backend/tests/test_chat_service.py`
- **Commit:** 5d42f48 (included in GREEN commit)

**2. [Rule 3 - Blocking] ruff I001 import ordering in test file**
- **Found during:** ruff check after GREEN
- **Issue:** `import app.chat_service as chat_service_module` appeared after `import app.db as db_module` but ruff isort required alphabetical ordering.
- **Fix:** `uv run --extra dev ruff check --fix tests/test_chat_service.py` auto-fixed the import block.
- **Files modified:** `backend/tests/test_chat_service.py`
- **Commit:** 5d42f48 (included in GREEN commit)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test-only commit, all tests fail) | 1c57dce | PASSED — tests failed at collection (ModuleNotFoundError: no module app.chat_service) |
| GREEN (implementation commit, all tests pass) | 5d42f48 | PASSED — 16/16 tests green |
| REFACTOR | N/A | Not required — implementation clean on first pass |

## Known Stubs

None. `build_portfolio_context` renders live portfolio data from `get_portfolio(cache)` and live prices from `PriceCache`. No hardcoded empty values or placeholder text flow to UI rendering.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond those already declared in the plan's threat model.

## Self-Check

Files exist:
- `backend/app/chat_service.py` — FOUND
- `backend/tests/test_chat_service.py` — FOUND

Commits exist:
- `1c57dce` — FOUND (RED: test commit)
- `5d42f48` — FOUND (GREEN: implementation commit)

## Self-Check: PASSED
