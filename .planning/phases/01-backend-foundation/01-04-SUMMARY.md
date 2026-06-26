---
phase: 01-backend-foundation
plan: "04"
subsystem: backend/app
tags: [fastapi, lifespan, health, routers, snapshot-loop, static-serving]
requirements: [CORE-01, CORE-02, CORE-04, PORT-04]

dependency_graph:
  requires:
    - 01-01  # db.py — init_db, get_watchlist_tickers
    - 01-02  # portfolio_service.py — record_snapshot, create_portfolio_router
    - 01-03  # create_watchlist_router
  provides:
    - app.main:app  # uvicorn entry point
    - GET /api/health
    - FastAPI lifespan (init_db + market source start + snapshot task)
  affects:
    - 02-*  # Phase 2 chat router plugs into create_app() extension point

tech_stack:
  added:
    - fastapi.StaticFiles — conditional static file mount for Next.js export
    - contextlib.asynccontextmanager — lifespan context manager pattern
    - asyncio.create_task — snapshot background task and simulator loop
  patterns:
    - App factory (create_app) for testability and Docker entry point
    - Lifespan context manager for startup/shutdown sequencing
    - Dependency injection via app.state for services shared across routers

key_files:
  created:
    - backend/app/main.py
    - backend/tests/test_main.py
  modified: []

decisions:
  - "Store cache, source, snapshot_interval on app.state so lifespan can access them without globals"
  - "Static mount skipped with logger.warning when STATIC_DIR absent — app starts cleanly in Phase 1"
  - "_snapshot_loop wraps record_snapshot in except Exception (not BaseException) so CancelledError propagates on shutdown"
  - "Integration tests use synchronous TestClient with time.sleep() so the ASGI event loop runs the snapshot task in its thread"

metrics:
  duration: "~15 minutes"
  completed: "2026-06-27"
  tasks_completed: 2
  files_created: 2
  tests_added: 4
  tests_total: 130

status: complete
---

# Phase 01 Plan 04: FastAPI App Assembly Summary

FastAPI app factory assembling DB init, market data source, all routers, health endpoint, periodic snapshot task, and conditional static file serving into a single `uvicorn app.main:app` entry point.

## What Was Built

### `backend/app/main.py`

`create_app() -> FastAPI` — reads `SNAPSHOT_INTERVAL` (default 30s) and `STATIC_DIR` (default `static`) from env at call time so tests can override via monkeypatch.

**Startup sequence (lifespan):**
1. `await init_db()` — creates 6 tables and seeds default user + 10 watchlist tickers
2. `await get_watchlist_tickers()` — reads seeded tickers from DB
3. `await source.start(tickers)` — GBM simulator or Massive client starts with watchlist
4. `asyncio.create_task(_snapshot_loop(...))` — periodic snapshot background task

**Shutdown (lifespan exit):** cancels snapshot task (CancelledError suppressed), then `await source.stop()`.

**Routers registered** (before static mount, so `/api/*` always wins):
- `/api/stream/prices` — SSE streaming (create_stream_router)
- `/api/portfolio/*` — portfolio valuation and trade execution (create_portfolio_router)
- `/api/watchlist/*` — watchlist management (create_watchlist_router)
- `GET /api/health` — liveness check, returns `{"status": "ok"}` (CORE-02)

**Static file serving (CORE-04):** Mounts `StaticFiles(directory=STATIC_DIR, html=True)` at `/` when the directory exists. Skips with `logger.warning` when absent — no error, app starts cleanly during Phase 1 before the frontend is built.

**Module-level `app = create_app()`** satisfies `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

### `backend/tests/test_main.py`

Four integration tests driving the assembled app via `TestClient` as a context manager (entering triggers lifespan startup):

| Test | What it proves |
|------|----------------|
| `test_health` | GET /api/health → 200 `{"status": "ok"}` |
| `test_cold_start_creates_schema_and_seed` | Lifespan creates 6 tables + 10 watchlist rows |
| `test_live_watchlist_returns_prices` | GET /api/watchlist → 10 tickers, ≥1 with live price |
| `test_snapshot_loop_records_rows` | portfolio_snapshots grows after 0.8s at 0.2s interval |

## Verification

All 130 backend tests pass:

```
======================== 130 passed, 130 warnings in 14.38s ========================
```

`ruff check app/ tests/` — clean.

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-04-01 static path traversal | Starlette StaticFiles normalizes paths — no manual path joining |
| T-04-02 snapshot loop crash kills app | `except Exception` catches errors, logs, continues; asyncio.sleep outside try so CancelledError propagates |
| T-04-03 MarketDataSource resource leak | lifespan cancels snapshot task then awaits source.stop() on shutdown |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no placeholder data or hardcoded empty values.

## Threat Flags

None — no new security surface beyond the plan's threat model.

## Self-Check

### Created files exist:
- backend/app/main.py: FOUND
- backend/tests/test_main.py: FOUND

### Commits exist:
- 8638d76: feat(01-04): FastAPI app factory, lifespan, health, routers, snapshot loop — FOUND
- 6028fe9: test(01-04): integration tests for cold start, health, watchlist, snapshot loop — FOUND

## Self-Check: PASSED
