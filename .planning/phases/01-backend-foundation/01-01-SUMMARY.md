---
phase: 01-backend-foundation
plan: "01"
subsystem: database
tags: [sqlite, aiosqlite, schema, seed, tdd]
dependency_graph:
  requires: []
  provides: [app.db, db-schema, db-seed]
  affects: [portfolio-routes, watchlist-routes, app-lifecycle]
tech_stack:
  added: [aiosqlite==0.22.1, httpx==0.28.1]
  patterns: [async-context-manager, parameterized-queries, idempotent-seed, tdd-red-green]
key_files:
  created:
    - backend/app/db.py
    - backend/tests/test_db.py
    - backend/app/routes/__init__.py
    - db/.gitkeep
  modified:
    - backend/pyproject.toml
    - backend/uv.lock
    - .gitignore
decisions:
  - "Used INSERT OR IGNORE for watchlist seed (UNIQUE constraint makes it a no-op on re-run)"
  - "Used SELECT-before-INSERT for user seed to avoid triggering constraint and to allow cash mutations to persist"
  - "DEFAULT_WATCHLIST order matches SEED_PRICES keys in app.market.seed_prices so every ticker has a simulated price"
  - "get_db_path() calls os.makedirs(parent, exist_ok=True) to auto-create the db/ directory in any environment"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-27"
  tasks_completed: 2
  tasks_skipped: 1
  files_created: 4
  files_modified: 3
status: complete
---

# Phase 01 Plan 01: SQLite Database Foundation Summary

**One-liner:** Async aiosqlite persistence layer with 6-table schema, idempotent seed ($10k user + 10 watchlist tickers), and 9 passing TDD tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify legitimacy of new pip packages | SKIPPED (human-approved) | — |
| 2 | Add async DB driver dependency and repo hygiene | 8ec7284 | pyproject.toml, uv.lock, .gitignore, db/.gitkeep, routes/__init__.py |
| 3 (RED) | Add failing tests for DB init, seed, idempotency | 3f68478 | backend/tests/test_db.py |
| 3 (GREEN) | Implement SQLite schema, lazy init, seed module | e3ea9f4 | backend/app/db.py, backend/tests/test_db.py |

## What Was Built

### `backend/app/db.py`

Public API surface:
- `SCHEMA` — SQL DDL for all 6 tables using `CREATE TABLE IF NOT EXISTS`
- `DEFAULT_USER_ID = "default"`, `DEFAULT_CASH = 10000.0`, `DEFAULT_WATCHLIST` (10 tickers matching SEED_PRICES)
- `get_db_path() -> str` — reads `DB_PATH` env var, defaults to `db/finally.db`, ensures parent directory exists
- `connect()` — async context manager yielding `aiosqlite.Connection` with `row_factory = aiosqlite.Row` and foreign key enforcement
- `init_db() -> None` — creates schema then seeds idempotently (SELECT-before-INSERT for user, INSERT OR IGNORE for watchlist)
- `get_watchlist_tickers() -> list[str]` — queries watchlist ordered by `added_at`

### 6-Table Schema (per planning/PLAN.md section 7)

| Table | Purpose |
|-------|---------|
| `users_profile` | Cash balance, single "default" user |
| `watchlist` | Tickers being tracked, UNIQUE(user_id, ticker) |
| `positions` | Current holdings, UNIQUE(user_id, ticker) |
| `trades` | Append-only trade history log |
| `portfolio_snapshots` | Time-series portfolio value for P&L chart |
| `chat_messages` | LLM conversation history with executed actions |

### Security Mitigations Applied

- **T-01-01 (Tampering):** All SQL values use `?` parameterized queries — no f-string or `.format()` SQL interpolation anywhere in `db.py`
- **T-01-02 (Information Disclosure):** `.gitignore` now includes `db/finally.db`, `db/*.db-journal`, `db/*.db-wal`, `db/*.db-shm` — runtime database file never committed

### `backend/tests/test_db.py` (9 tests, all passing)

| Test | Behavior Verified |
|------|------------------|
| `test_fresh_init_creates_six_tables` | sqlite_master has exactly the 6 expected tables |
| `test_fresh_init_seeds_default_user` | 1 user row, id="default", cash=10000.0 |
| `test_fresh_init_seeds_ten_watchlist_rows` | 10 watchlist rows with correct ticker set |
| `test_idempotent_reinit_does_not_duplicate_user` | count=1 after two init_db() calls |
| `test_idempotent_reinit_does_not_change_cash` | cash unchanged after simulated trade + reinit |
| `test_idempotent_reinit_does_not_duplicate_watchlist` | count=10 after two init_db() calls |
| `test_get_watchlist_tickers_returns_expected_symbols` | Returns all 10 expected symbols |
| `test_get_db_path_honors_env_var` | DB_PATH env var respected |
| `test_get_db_path_creates_parent_directory` | Parent dir auto-created if missing |

## Verification Results

```
9 passed in 0.96s
ruff check: All checks passed
python -c "import aiosqlite, httpx": OK (aiosqlite==0.22.1, httpx==0.28.1)
```

## TDD Gate Compliance

- RED commit: `3f68478` — `test(01-01): add failing tests for db init, seed, and idempotency` — all 9 tests failed with `ModuleNotFoundError: No module named 'app.db'`
- GREEN commit: `e3ea9f4` — `feat(01-01): implement SQLite schema, lazy init, and seed module` — all 9 tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused imports in test file (ruff F401)**
- **Found during:** Task 3 GREEN phase, ruff lint check
- **Issue:** Test file had `import os` and `import tempfile` left from drafting — both unused in final implementation
- **Fix:** Removed both unused imports
- **Files modified:** `backend/tests/test_db.py`
- **Commit:** Included in e3ea9f4 (part of GREEN commit, not a separate fix commit)

## Known Stubs

None — all public API functions are fully implemented and tested.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. Schema is local SQLite only.

## Self-Check: PASSED

- [x] `backend/app/db.py` — FOUND
- [x] `backend/tests/test_db.py` — FOUND
- [x] `backend/app/routes/__init__.py` — FOUND
- [x] `db/.gitkeep` — FOUND
- [x] Commit 8ec7284 — FOUND (chore: deps + hygiene)
- [x] Commit 3f68478 — FOUND (test: RED gate)
- [x] Commit e3ea9f4 — FOUND (feat: GREEN implementation)
- [x] All 9 tests pass
- [x] ruff lint clean
- [x] aiosqlite and httpx importable
