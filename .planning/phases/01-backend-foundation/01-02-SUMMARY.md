---
phase: 01-backend-foundation
plan: "02"
subsystem: portfolio
status: complete
tags: [portfolio, trading, pnl, snapshots, fastapi, sqlite, aiosqlite]
dependency_graph:
  requires: [01-01]
  provides: [portfolio_service, portfolio_router]
  affects: [01-03, 01-04]
tech_stack:
  added: []
  patterns: [factory-router, tdd-red-green, async-sqlite-transaction, dependency-injection]
key_files:
  created:
    - backend/app/portfolio_service.py
    - backend/app/routes/portfolio.py
    - backend/tests/test_portfolio.py
  modified: []
decisions:
  - "Validation before DB: side/quantity/price checks happen before opening a connection to avoid wasted I/O"
  - "Single aiosqlite transaction for buy/sell: read-validate-write committed atomically (T-02-03)"
  - "record_snapshot called after commit, not inside transaction: cleanly separates trade atomicity from snapshot recording"
  - "Full-sell deletes the positions row rather than setting quantity=0 to keep joins clean"
  - "Avg cost unchanged on partial sell: only buy lots affect cost basis"
  - "Sync fixture + asyncio.run() for router TestClient tests: avoids event-loop conflicts with pytest-asyncio"
metrics:
  duration_minutes: 5
  completed: "2026-06-27"
  tasks_completed: 2
  files_created: 3
  tests_added: 35
---

# Phase 01 Plan 02: Portfolio Service + Trade API Summary

Portfolio valuation and trade execution: atomic SQLite transactions for buy/sell, live P&L calculation using PriceCache, immediate post-trade snapshots, and three FastAPI endpoints.

## Tasks Completed

| # | Name | Commit | Type |
|---|------|--------|------|
| 0 | Failing tests (RED) | 011de83 | test |
| 1 | Portfolio service implementation (GREEN) | 58c0340 | feat |
| 2 | Portfolio router + extended tests | 93baac6 | feat |

## What Was Built

### `backend/app/portfolio_service.py`

- **`TradeError`** — domain exception for all trade validation and business rule failures
- **`execute_trade(cache, ticker, side, quantity) → dict`** — buy or sell at live fill price from PriceCache. Validates side/quantity/price before touching the DB. Runs positions upsert + cash update + trades insert atomically in a single aiosqlite transaction. Calls `record_snapshot` after commit (PORT-05). Ticker normalised to uppercase.
- **`get_portfolio(cache) → dict`** — reads cash and all positions; computes market_value, unrealized_pnl, change_percent per position at live prices (falls back to avg_cost if cache has no price). Returns cash_balance, total_value, positions list.
- **`record_snapshot(cache) → None`** — inserts a portfolio_snapshots row with the current total_value (same formula as get_portfolio).
- **`get_history() → list[dict]`** — SELECT total_value, recorded_at ORDER BY recorded_at ASC.

### `backend/app/routes/portfolio.py`

- **`TradeRequest`** — Pydantic BaseModel with ticker (str), quantity (float), side (str)
- **`create_portfolio_router(cache) → APIRouter`** — factory pattern matching stream.py; prefix="/api/portfolio"
  - `GET ""` → `get_portfolio(cache)` — PORT-01
  - `POST /trade` → `execute_trade`; TradeError mapped to HTTP 400 — PORT-02
  - `GET /history` → `get_history()` — PORT-03

### `backend/tests/test_portfolio.py`

35 tests covering:
- Service: buy/sell happy paths, weighted avg cost, TradeError cases with DB invariant assertions, get_portfolio P&L fields, get_history ordering
- Router: 8 TestClient tests confirming HTTP 200/400 responses at all three endpoints

## Security / Threat Model Compliance

| Threat | Mitigation Applied |
|--------|-------------------|
| T-02-01 Tampering (SQL injection) | All queries use parameterised `?` placeholders — ticker/side never interpolated into SQL |
| T-02-02 Elevation (validation bypass) | quantity > 0, side whitelist, cash check (buy), shares check (sell) all raise TradeError → HTTP 400 |
| T-02-03 Concurrent double-spend | Read-validate-write in single aiosqlite transaction; committed atomically before any snapshot or response |
| T-02-04 Error detail leakage | TradeError messages are domain-level only (no secrets, no stack traces in HTTP response) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `backend/app/portfolio_service.py` | FOUND |
| `backend/app/routes/portfolio.py` | FOUND |
| `backend/tests/test_portfolio.py` | FOUND |
| `01-02-SUMMARY.md` | FOUND |
| Commit `011de83` (RED) | FOUND |
| Commit `58c0340` (GREEN) | FOUND |
| Commit `93baac6` (router) | FOUND |
| 35 tests pass | VERIFIED |
| ruff lint clean | VERIFIED |
