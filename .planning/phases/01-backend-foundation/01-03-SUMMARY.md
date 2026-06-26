---
phase: 01-backend-foundation
plan: "03"
subsystem: watchlist-api
tags: [fastapi, sqlite, watchlist, market-data]
status: complete

dependency_graph:
  requires:
    - 01-01  # routes package + DB foundation
  provides:
    - create_watchlist_router factory
    - GET /api/watchlist
    - POST /api/watchlist
    - DELETE /api/watchlist/{ticker}
  affects:
    - frontend SSE integration (tickers tracked by MarketDataSource)
    - main.py router registration (future)

tech_stack:
  added:
    - pydantic BaseModel (WatchlistAddRequest request body)
  patterns:
    - Factory pattern: create_watchlist_router(cache, market_source) -> APIRouter
    - INSERT OR IGNORE for idempotent duplicate handling
    - Parameterized ? queries throughout (T-03-01 mitigation)

key_files:
  created:
    - backend/app/routes/watchlist.py
    - backend/tests/test_watchlist.py
  modified: []

decisions:
  - "Created router inside factory function rather than using module-level global router (cleaner than stream.py pattern, avoids shared mutable state)"
  - "Ticker validation uses str.isalnum() — rejects dots/hyphens per plan spec; sufficient for v1 default tickers (all alphanumeric)"
  - "asyncio.run() used in sync test fixture for DB setup and assertions; safe because TestClient runs ASGI in background thread leaving main thread loop-free"

metrics:
  duration_minutes: 15
  completed_date: "2026-06-27"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
---

# Phase 01 Plan 03: Watchlist API Summary

**One-liner:** FastAPI watchlist router with live-price annotation from PriceCache, idempotent add/remove, and MarketDataSource integration via factory injection.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Watchlist router (GET list+prices, POST add+track, DELETE remove+untrack) | e6cc175 | backend/app/routes/watchlist.py, backend/tests/test_watchlist.py |

## What Was Built

### backend/app/routes/watchlist.py

Exports `WatchlistAddRequest` (Pydantic BaseModel) and `create_watchlist_router(cache, market_source)` factory.

**GET /api/watchlist (WTCH-01):** Queries `watchlist` table for `DEFAULT_USER_ID`, then annotates each row with the latest `PriceUpdate` from `PriceCache.get(ticker)`. Returns `price=None` if the ticker has no cached price yet.

**POST /api/watchlist (WTCH-02):** Normalizes ticker to uppercase, validates non-empty alphanumeric (HTTP 400 otherwise), inserts via `INSERT OR IGNORE` (idempotent against UNIQUE(user_id, ticker) constraint), commits, then calls `await market_source.add_ticker(ticker)` so live price streaming begins.

**DELETE /api/watchlist/{ticker} (WTCH-03):** Normalizes ticker to uppercase, deletes the row with parameterized query, commits, then calls `await market_source.remove_ticker(ticker)` to stop streaming.

### backend/tests/test_watchlist.py

9 tests using `TestClient` (sync) with a temp SQLite DB (monkeypatched `DB_PATH`) and a `_FakeMarketDataSource` that records `add_ticker`/`remove_ticker` calls:

- `test_get_watchlist_returns_seeded_tickers_with_prices` — 10 entries with non-null prices
- `test_get_watchlist_ticker_without_cache_has_null_price` — price=None when cache misses
- `test_post_watchlist_adds_ticker_and_triggers_tracking` — DB row inserted, add_ticker called
- `test_post_watchlist_normalizes_ticker_to_uppercase` — lowercase input stored as uppercase
- `test_post_watchlist_duplicate_does_not_create_duplicate_row` — idempotent duplicate
- `test_post_watchlist_empty_ticker_returns_400` — empty string rejected
- `test_post_watchlist_nonalphanumeric_ticker_returns_400` — dots/hyphens/spaces rejected
- `test_delete_watchlist_removes_row_and_stops_tracking` — DB row removed, remove_ticker called
- `test_delete_watchlist_normalizes_path_param_to_uppercase` — lowercase path param normalized

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-03-01: SQL injection via ticker | Parameterized `?` queries used exclusively for all INSERT, DELETE, SELECT |
| T-03-02: Invalid ticker input | Uppercase normalization + `isalnum()` validation; HTTP 400 for violations |
| T-03-03: Unbounded watchlist growth | UNIQUE(user_id, ticker) + INSERT OR IGNORE prevents duplicates |

## Deviations from Plan

None. Plan executed exactly as written.

## Known Stubs

None. All endpoints return real data from SQLite and PriceCache.

## Threat Flags

None. No new network surface or trust boundaries beyond what the plan specified.

## Self-Check: PASSED

- backend/app/routes/watchlist.py: FOUND
- backend/tests/test_watchlist.py: FOUND
- Commit e6cc175: FOUND (git log confirms)
- All 9 tests: PASSED
- ruff check: All checks passed
