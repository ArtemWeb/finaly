---
phase: 04-docker-testing
plan: 03
type: execute
subsystem: backend-testing
tags: [TEST-02, TEST-03, pytest, full-app-integration, graceful-fallback]
requires: [TEST-01, test_portfolio.py existing coverage]
provides: [TEST-02 gap-fill, TEST-03 gap-fill, create_app() integration confirmation]
affects: [backend/tests/]
tech-stack:
  added: []
  patterns: [monkeypatch-before-import for env-driven modules (Pitfall 8), TestClient-as-context-manager for lifespan, fake litellm response classes]
key-files:
  created:
    - backend/tests/test_main_api_coverage.py
    - backend/tests/test_llm_malformed.py
  modified: []
decisions:
  - "TEST-01 confirmed by running existing test_portfolio.py rather than re-creating the edge-case tests (insufficient cash, oversell, partial sell, weighted avg cost)"
  - "TEST-02 gap-fill: 3 new create_app() integration tests for portfolio/history/watchlist via tmp_db fixture + STATIC_DIR=nonexistent (mirrors test_chat_route.py:221)"
  - "TEST-03 gap-fill: 2 new async tests for valid-JSON-wrong-schema graceful fallback; mirrors test_llm.py:158-166 import-ordering pattern (patch llm_mod.completion BEFORE importing complete_chat)"
metrics:
  duration: ~3 min
  completed_date: 2026-06-27
  tests_added: 5
  tests_total: 178
status: complete
---

# Phase 4 Plan 3: Backend Test Gap-Fill (TEST-02 + TEST-03) Summary

Closes the two narrow backend test gaps the Phase 4 research identified: TEST-02 (full create_app() coverage of portfolio/history/watchlist) and TEST-03 (valid-JSON-wrong-schema graceful fallback). Confirms TEST-01 (trade edge cases) by running the existing test_portfolio.py rather than re-creating those tests. Full backend suite stays green at 178 tests.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Full-app API coverage test (TEST-02 gap-fill) + confirm TEST-01 | `00b485e` | backend/tests/test_main_api_coverage.py |
| 2 | Malformed-LLM (wrong-schema) test (TEST-03 gap-fill) | `46a62d3` | backend/tests/test_llm_malformed.py |

## Acceptance Criteria Met

### Task 1 — TEST-02 gap-fill
- `pytest tests/test_main_api_coverage.py` exits 0 with 3 passing tests
- Test asserts `cash_balance == 10000.0` for a fresh GET /api/portfolio
- Test asserts GET /api/watchlist returns exactly 10 tickers
- File uses `create_app()` with TestClient as a context manager and monkeypatches DB_PATH + SNAPSHOT_INTERVAL + STATIC_DIR (Pitfall 8 mitigation)
- `test_portfolio.py` (TEST-01 edge cases) still passes — 35 tests green

### Task 2 — TEST-03 gap-fill
- `pytest tests/test_llm_malformed.py` exits 0 with 2 passing tests
- Each test asserts `isinstance(result, ChatResponse)` and a truthy fallback `result.message`
- The missing-message test asserts `result.trades == []` (and watchlist_changes)
- The wrong-type test asserts the same fallback contract
- Tests patch `app.llm.completion` and make zero network calls
- `backend/app/llm.py` is unchanged (no production code edited)

## Verification

- `cd backend && uv run --extra dev pytest tests/test_main_api_coverage.py tests/test_portfolio.py -q` → 38 passed
- `cd backend && uv run --extra dev pytest tests/test_llm_malformed.py -q` → 2 passed
- `cd backend && uv run --extra dev pytest -q` (full suite) → 178 passed, no regressions

## Deviations from Plan

None — plan executed exactly as written. 04-PATTERNS.md referenced by the plan does not exist on disk in this worktree, but the research at 04-RESEARCH.md lines 703-748 provided the exact code template for TEST-03 and test_main.py + test_chat_route.py:221 + test_portfolio.py provided the conventions and import-ordering analog for both tasks.

## TDD Gate Compliance

This plan follows the TDD RED/GREEN cycle as a single feature per plan:

1. RED commit: implicit — the test files did not exist before this plan (no module to import = collection failure)
2. GREEN commit: `00b485e` (Task 1) and `46a62d3` (Task 2) — both new test files written, all tests pass
3. REFACTOR: not needed — code is already minimal and idiomatic on first pass

No TDD gate warnings required.

## Self-Check: PASSED

- `backend/tests/test_main_api_coverage.py` exists (113 lines)
- `backend/tests/test_llm_malformed.py` exists (121 lines)
- Commit `00b485e` found in git log
- Commit `46a62d3` found in git log
- Full backend suite: 178 tests pass
