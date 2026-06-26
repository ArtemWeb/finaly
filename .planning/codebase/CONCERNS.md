# Codebase Concerns

**Analysis Date:** 2026-06-26

## Critical Missing Components

**Frontend application:**
- Issue: Frontend directory does not exist; no Next.js project, no React components, no UI implementation
- Files: `frontend/` — completely missing
- Impact: Cannot run or demo the application; cannot build Docker container (multi-stage Dockerfile references frontend build)
- Fix approach: Create Next.js project with TypeScript, implement all components listed in PLAN.md section 10 (watchlist panel, charts, portfolio heatmap, positions table, trade bar, chat panel, header)
- Blocking: All UI-dependent phases; Docker build; E2E tests

**Main FastAPI application:**
- Issue: No app initialization, no route mounting, no request lifecycle setup
- Files: `backend/app/` has no `main.py` or `app.py` entry point
- Impact: Backend cannot start; no HTTP server exists despite FastAPI/uvicorn in dependencies
- Fix approach: Create `backend/app/main.py` with FastAPI app instance, mount routers (stream, portfolio, watchlist, chat, health), configure logging, setup SQLite initialization on startup
- Blocking: All backend API development; Docker container; manual testing

**Database layer:**
- Issue: No SQLite schema, no ORM model definitions, no migration/initialization logic
- Files: `backend/app/db/` directory missing entirely; no schema SQL files
- Impact: Portfolio state cannot be persisted; trades are lost on restart; multi-user features impossible
- Fix approach: Create schema definitions in `backend/app/db/schema.sql` or equivalent ORM models (SQLAlchemy), implement lazy initialization in main app startup (check if tables exist, create if missing, seed default data per PLAN.md section 7)
- Schema scope: users_profile, watchlist, positions, trades, portfolio_snapshots, chat_messages (6 tables with user_id for future multi-user support)

**API route implementations:**
- Issue: Stale .pyc files in `backend/app/routes/` (chat.cpython-314.pyc, portfolio.cpython-314.pyc, watchlist.cpython-314.pyc) but no source .py files
- Files: `backend/app/routes/*.py` — missing
- Impact: No endpoints exist for portfolio queries, trade execution, watchlist CRUD, LLM chat
- Fix approach: Implement all endpoints specified in PLAN.md section 8:
  - Portfolio: GET `/api/portfolio`, POST `/api/portfolio/trade`, GET `/api/portfolio/history`
  - Watchlist: GET `/api/watchlist`, POST `/api/watchlist`, DELETE `/api/watchlist/{ticker}`
  - Chat: POST `/api/chat` with LLM integration and structured output parsing
  - System: GET `/api/health`

**Docker & Deployment:**
- Issue: No Dockerfile, no docker-compose files, no deployment scripts
- Files: `Dockerfile`, `docker-compose.yml`, `scripts/start_*.sh`, `scripts/start_*.ps1` — all missing
- Impact: Cannot containerize or deploy application; single-port single-container design not achievable
- Fix approach: 
  - Create multi-stage Dockerfile (Node 20 → Next.js build, then Python 3.12 slim → FastAPI + serve static)
  - Create docker-compose.yml for convenience (optional, per PLAN.md)
  - Create start/stop scripts for macOS/Linux (bash) and Windows (PowerShell)

**E2E test suite:**
- Issue: `test/` directory missing completely
- Files: `test/`, `test/docker-compose.test.yml`, `test/e2e/` — all missing
- Impact: No Playwright E2E tests; no automated verification of user flows (prices streaming, watchlist ops, trades, AI chat)
- Fix approach: Set up Playwright E2E tests with docker-compose.test.yml (separate test infrastructure), test scenarios listed in PLAN.md section 12

---

## Architectural & Design Concerns

**Concurrency model mismatch — threading locks in asyncio code:**
- Issue: `PriceCache` uses `threading.Lock` while running in asyncio event loop (`SimulatorDataSource._run_loop` calls `await asyncio.sleep()`)
- Files: `backend/app/market/cache.py` (lines 20, 29-31, 45-47, etc. use `threading.Lock`)
- Impact: While unlikely to deadlock in single-threaded asyncio (GIL + quick lock release), this is an anti-pattern. If future code adds true multi-threading (worker pools, background tasks), contention could block the event loop.
- Fix approach: Replace `threading.Lock` with `asyncio.Lock` in `PriceCache`. Requires making cache methods async, or use `threading.Lock` only if proven necessary (profile first).
- Risk: Low in current single-threaded design; medium if concurrency model changes

**Rate limit handling in Massive API client:**
- Issue: `MassiveDataSource._poll_once()` catches all exceptions and silently retries, but HTTP 429 (rate limit) responses may need backoff strategy
- Files: `backend/app/market/massive_client.py` (lines 118-121 log error but don't implement backoff)
- Impact: Rapid retries on rate limit could worsen the problem; no exponential backoff, no adaptive polling interval
- Fix approach: Detect 429 responses specifically, implement exponential backoff or dynamic poll interval adjustment
- Priority: Medium (only affects users with Massive API key and poor rate limit planning)

**No input validation in planned API endpoints:**
- Issue: When portfolio/watchlist/chat endpoints are implemented, there's no validation framework yet
- Files: Will affect `backend/app/routes/portfolio.py`, `watchlist.py`, `chat.py` (not yet created)
- Impact: Invalid trade quantities (negative, non-numeric), invalid tickers, malformed chat requests could cause crashes
- Fix approach: Use Pydantic v2 models for request bodies (already in FastAPI ecosystem), implement validators in route handlers
- Priority: High (must be done before routes are merged)

---

## Code Quality & Testing Concerns

**Incomplete test coverage for Massive API client:**
- Issue: `backend/tests/market/test_massive.py` coverage is 56% for `massive_client.py` because REST API methods are mocked
- Files: `backend/app/market/massive_client.py`, `backend/tests/market/test_massive.py`
- Impact: Real Massive API failures (network errors, malformed responses, missing fields) aren't tested
- Fix approach: Add integration tests with a test API endpoint or mock more comprehensively (test parsing edge cases, missing fields, rate limit responses)
- Priority: Medium (market data is stable; more important after API layer exists)

**Stale Python cache files without source:**
- Issue: `.pyc` files exist in `backend/app/routes/__pycache__/` (chat, portfolio, watchlist modules) but no `.py` sources
- Files: `backend/app/routes/__pycache__/*.pyc`
- Impact: Can cause confusion; cache may reference deleted or modified code
- Fix approach: Delete `backend/app/routes/__pycache__/`, recreate sources as needed, ensure `.gitignore` prevents pycache commits (already configured)
- Priority: Low (cosmetic, doesn't affect runtime)

---

## Configuration & Deployment Concerns

**Missing .env.example file:**
- Issue: README.md references `.env.example` in quick start, but file doesn't exist
- Files: `.env.example` — missing
- Impact: New developers can't bootstrap environment setup; no documentation of required vs optional env vars
- Fix approach: Create `.env.example` with template values:
  ```
  OPENROUTER_API_KEY=your-openrouter-api-key-here
  MASSIVE_API_KEY=
  LLM_MOCK=false
  ```
- Priority: High (blocker for onboarding new developers)

**No centralized logging configuration:**
- Issue: Code uses `logging.getLogger(__name__)` in multiple modules but no root logger setup in main app
- Files: Will affect `backend/app/main.py` (not yet created)
- Impact: Log level, format, and handlers undefined; logs may not appear or may be chaotic in production
- Fix approach: Configure logging in app startup (see PLAN.md for guidance), set level (INFO for prod, DEBUG for dev), format with timestamp and level
- Priority: Medium (backend works without it, but observability suffers)

---

## Known Risks & Assumptions

**Single-user hardcoded in database schema:**
- Issue: All tables have `user_id` column defaulting to `"default"` (per PLAN.md section 7), but multi-user is not yet tested or validated
- Files: Future `backend/app/db/schema.sql` (not yet created)
- Impact: Schema assumes single-user; scaling to multi-user later requires careful index/constraint additions
- Mitigation: Schema is designed with user_id in mind; future work can enable per-user filtering without migration
- Priority: Low (acceptable for MVP)

**Market data simulator reproducibility:**
- Issue: `GBMSimulator.step()` uses `np.random` and `random.random()` without seed control; results are non-deterministic
- Files: `backend/app/market/simulator.py` (lines 84-108)
- Impact: Simulated prices differ on each run; E2E tests with price expectations will flake unless mocked
- Mitigation: Existing LLM_MOCK mode disables LLM calls for E2E; market data randomness is acceptable for manual testing
- Fix approach: Add optional seed parameter to `GBMSimulator.__init__()` for reproducible testing
- Priority: Medium (low for manual testing, important for deterministic E2E tests)

**Correlation matrix Cholesky decomposition on every ticker add/remove:**
- Issue: `GBMSimulator._rebuild_cholesky()` is O(n²) and called every time a ticker is added or removed
- Files: `backend/app/market/simulator.py` (lines 154-172)
- Impact: With ~10 default tickers, cost is negligible; but if watchlist grows to 100+ tickers, rebuilds become expensive
- Mitigation: Maximum watchlist size isn't specified; current design assumes < 50 tickers (noted in code)
- Fix approach: Lazy rebuild (mark dirty flag, rebuild only on next step) if watchlist operations become hot path
- Priority: Low (acceptable for current scope)

---

## Scaling & Performance Concerns

**Single SQLite database file as bottleneck:**
- Issue: All data stored in one `db/finally.db` SQLite file; single-threaded write access; no connection pooling
- Files: Will affect `backend/app/db/` when created
- Impact: With thousands of concurrent users or high-frequency trade logging, SQLite will become write-contended
- Mitigation: Current design is single-user (hardcoded user_id="default"); acceptable for MVP
- Future fix: Migrate to PostgreSQL with connection pooling if multi-user support is added
- Priority: Low for MVP; High if scaling to real multi-user platform

**SSE change detection relies on version counter:**
- Issue: `PriceCache.version` is a monotonically increasing integer; SSE stream checks if version changed to decide if there's new data
- Files: `backend/app/market/cache.py` (line 21, property at line 65-67), `backend/app/market/stream.py` (lines 75-77)
- Impact: With millions of price updates, version counter could theoretically overflow, but in practice (2^31 updates at 2/sec = ~34 years) this is not a concern
- Priority: Very low (not a practical concern)

---

## Security Considerations

**No API authentication:**
- Issue: All endpoints (`/api/portfolio`, `/api/chat`, etc.) will be unauthenticated when created; no session/token validation
- Files: Future `backend/app/routes/` (not yet created)
- Impact: In single-user mode (hardcoded "default" user), no authentication is needed; but if multi-user is added, anyone can trade for anyone else
- Mitigation: PLAN.md is explicit that this is single-user demo; authentication is out of scope for MVP
- Future fix: Add JWT/session middleware before multi-user support
- Priority: Low for current scope; Critical before production multi-user

**Environment variables in .env are gitignored but sensitive:**
- Issue: `.env` file contains OPENROUTER_API_KEY and possibly MASSIVE_API_KEY; correctly gitignored but not documented
- Files: `.env` (correctly in `.gitignore` at line 138), no `.env.example` for reference
- Impact: No exposure risk if .gitignore is working; but new developers won't know which env vars are secrets
- Fix approach: Create `.env.example` with placeholder comments indicating which vars are secrets
- Priority: Medium (documentation/UX issue, not a bug)

**Massive API key handling:**
- Issue: `MassiveDataSource` stores API key in instance variable; if instance is logged or serialized, key could leak
- Files: `backend/app/market/massive_client.py` (line 34)
- Impact: Low risk (API key only passed to `RESTClient`, not logged); but best practice is to pass only at API call time
- Fix approach: Don't store api_key in self; pass directly to client methods (if massive library allows)
- Priority: Low (current code is safe; nice-to-have hardening)

---

## Testing Coverage Gaps

**No tests for error conditions in API layer:**
- Issue: Once portfolio/chat endpoints are created, need tests for insufficient cash, invalid quantities, malformed requests
- Files: Future test files in `backend/tests/routes/`
- Impact: Error handling untested; edge cases could cause crashes in production
- Fix approach: Write parametrized tests for each endpoint covering happy path + 5-10 error scenarios
- Priority: High (required before merging any routes)

**No concurrency tests for PriceCache:**
- Issue: Cache has threading.Lock but tests are single-threaded; no concurrent read/write testing
- Files: `backend/tests/market/test_cache.py` (all tests are sequential)
- Impact: Race conditions unlikely (fast operations, GIL), but not proven
- Fix approach: Add async concurrency tests with multiple readers + single writer; use pytest-asyncio
- Priority: Medium (low risk in practice, good validation)

---

## Missing Critical Features for Full Functionality

**LLM integration not yet implemented:**
- Issue: Structured output parsing, trade auto-execution from LLM, chat history storage not yet coded
- Files: `backend/app/routes/chat.py` — missing entirely
- Impact: Cannot demo AI capabilities (core feature of project); chat endpoint will fail if stub exists
- Fix approach: Implement per PLAN.md section 9 using LiteLLM → OpenRouter → Cerebras inference; use cerebras-inference skill; handle structured output JSON parsing
- Priority: Critical (demo feature)

**Portfolio valuation calculations not implemented:**
- Issue: No code for computing P&L, average cost tracking, portfolio snapshots
- Files: Future `backend/app/services/portfolio.py` or equivalent
- Impact: Cannot display portfolio state, P&L, or P&L charts to frontend
- Fix approach: Implement calculations: total_value = sum(qty * current_price for each position) + cash_balance; unrealized_PnL per position; track snapshots every 30s and after trades
- Priority: Critical (core feature)

**Trade execution validation not implemented:**
- Issue: No checks for sufficient cash (buy), sufficient shares (sell)
- Files: Future `backend/app/services/portfolio.py` or equivalent
- Impact: Invalid trades could corrupt portfolio state
- Fix approach: Validate trade before execution; raise meaningful errors for insufficient resources; log all trades to audit trail
- Priority: Critical (data integrity)

---

## Summary by Priority

| Priority | Count | Key Issues |
|----------|-------|-----------|
| Critical | 5 | Missing frontend, main app, database layer, API routes, Docker setup |
| High | 4 | Missing .env.example, deployment scripts, input validation, error test coverage |
| Medium | 6 | Threading/asyncio mismatch, rate limiting strategy, Massive test coverage, LLM integration, portfolio math, logging setup |
| Low | 8 | Stale pycache, simulator seed reproducibility, correlation rebuild cost, SSE version overflow, API auth (scoped to MVP), Massive key storage, concurrency tests, single-user assumptions |

---

*Concerns audit: 2026-06-26*
