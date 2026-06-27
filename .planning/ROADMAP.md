# Roadmap: FinAlly — AI Trading Workstation

## Overview

FinAlly is built in four sequential phases. Phase 1 establishes the backend API shell — FastAPI lifecycle, SQLite database, portfolio routes, and watchlist routes. Phase 2 adds LLM intelligence on top of that foundation — the `/api/chat` route, LiteLLM integration, auto-trade execution, and mock mode. Phase 3 builds the complete Next.js frontend: the dark terminal UI with live price flashing, sparklines, portfolio heatmap, P&L chart, trade bar, and AI chat panel. Phase 4 ships the product: a multi-stage Dockerfile, start/stop scripts, backend unit tests, and Playwright E2E tests. After Phase 4, a single `docker run` command launches a fully functional, tested, AI-powered trading terminal.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Backend Foundation** - FastAPI app shell, SQLite database, portfolio and watchlist REST API (completed 2026-06-26)
- [x] **Phase 2: AI Chat Integration** - LLM chat route, structured output, auto-trade execution, mock mode (completed 2026-06-27)
- [ ] **Phase 3: Frontend** - Complete Next.js dark terminal UI with all panels and live data
- [ ] **Phase 4: Docker & Testing** - Multi-stage Dockerfile, start/stop scripts, unit tests, Playwright E2E tests

## Phase Details

### Phase 1: Backend Foundation

**Goal**: The backend API is fully operational — serving live portfolio data, executing trades, managing watchlists, and persisting all state in SQLite
**Depends on**: Nothing (market data subsystem already complete in `backend/app/market/`)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, PORT-01, PORT-02, PORT-03, PORT-04, PORT-05, WTCH-01, WTCH-02, WTCH-03
**Success Criteria** (what must be TRUE):

  1. `GET /api/health` returns 200 with service status; a fresh cold-start auto-creates all 6 database tables and seeds 10 default tickers and $10,000 cash with no manual setup
  2. `GET /api/watchlist` returns the 10 default tickers with live prices pulled from PriceCache
  3. `POST /api/portfolio/trade` with a buy order deducts cash and creates a position; posting with insufficient cash returns a 400 error
  4. `GET /api/portfolio` reflects current positions, live P&L at current prices, and remaining cash balance
  5. `GET /api/portfolio/history` returns portfolio value snapshots that include a point recorded immediately after every trade

**Plans**: 4/4 plans complete
**Wave 1**

- [x] 01-01-PLAN.md — Database layer: aiosqlite dependency, 6-table schema, lazy init + seed (CORE-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Portfolio service + routes: valuation, trade execution, history, per-trade snapshots (PORT-01, PORT-02, PORT-03, PORT-05)
- [x] 01-03-PLAN.md — Watchlist routes: list with live prices, add+track, remove+untrack (WTCH-01, WTCH-02, WTCH-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — App assembly: FastAPI lifecycle, health, static serving, 30s snapshot task, router registration (CORE-01, CORE-02, CORE-04, PORT-04)

### Phase 2: AI Chat Integration

**Goal**: Users can converse with an AI assistant that has full portfolio context and can auto-execute trades and watchlist changes through natural language
**Depends on**: Phase 1
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
**Success Criteria** (what must be TRUE):

  1. `POST /api/chat` with a user message returns a structured JSON response containing a conversational reply and the full portfolio context was included in the LLM prompt
  2. When the LLM response includes trades, they execute automatically through the same validation as manual trades and any errors are reported back in the chat response
  3. When the LLM response includes watchlist changes, the watchlist updates immediately and is reflected in subsequent `/api/watchlist` calls
  4. Chat history from `chat_messages` is included in each subsequent LLM request so the conversation has memory
  5. With `LLM_MOCK=true`, deterministic responses are returned without any OpenRouter API call, enabling development and testing without a key

**Plans**: 3/3 plans complete

**Wave 1**

- [x] 02-01-PLAN.md — LLM client core: ChatResponse schemas, mock mode, LiteLLM→OpenRouter→Cerebras call, defensive parsing (CHAT-02, CHAT-06)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Chat service: portfolio/watchlist context, history memory, trade + watchlist auto-execution, persistence (CHAT-01, CHAT-03, CHAT-04, CHAT-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Chat route + app wiring: POST /api/chat router factory, create_app() registration, end-to-end mock-mode test (CHAT-01, CHAT-03, CHAT-04, CHAT-05, CHAT-06)

### Phase 3: Frontend

**Goal**: Users have a complete dark trading terminal in their browser with live price streaming, portfolio visualization, and an integrated AI chat panel
**Depends on**: Phase 1 (backend API must be operational; Phase 2 for AI chat panel to be functional)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, UI-12
**Success Criteria** (what must be TRUE):

  1. Watchlist panel shows live prices that flash green on uptick and red on downtick with a 500ms CSS fade, plus an accumulating sparkline mini-chart per ticker built from the SSE stream
  2. Clicking a ticker in the watchlist opens a larger detailed chart in the main chart area
  3. Portfolio heatmap (treemap) shows all open positions sized by portfolio weight and colored green (profit) or red (loss); positions table shows ticker, quantity, avg cost, current price, unrealized P&L, and % change
  4. Trade bar executes instant market orders — cash balance and positions update immediately in the UI without a page reload
  5. Header displays live total portfolio value (updating from SSE), cash balance, and a connection status dot; the dark terminal aesthetic (`#0d1117`/`#1a1a2e` backgrounds, yellow `#ecad0a`, blue `#209dd7`, purple `#753991` buttons) is consistent across all panels

**Plans**: TBD
**UI hint**: yes

### Phase 4: Docker & Testing

**Goal**: The full application ships as a single Docker container and all critical behaviors are verified by automated tests
**Depends on**: Phase 3 (complete app needed for E2E tests)
**Requirements**: DOCK-01, DOCK-02, DOCK-03, DOCK-04, DOCK-05, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08
**Success Criteria** (what must be TRUE):

  1. Running `scripts/start_mac.sh` (or `start_windows.ps1`) builds the Docker image, starts the container, and a browser opens to a working trading terminal at `http://localhost:8000`
  2. Portfolio data (trades, cash balance, watchlist) persists across container restarts via the named Docker volume; `scripts/stop_mac.sh` stops the container without deleting the volume
  3. Backend unit tests pass for trade execution edge cases (insufficient cash, selling more than owned), P&L calculations, and LLM structured output parsing including malformed response handling
  4. Playwright E2E tests (with `LLM_MOCK=true`) pass for: fresh start shows $10k + 10 tickers streaming; buy decreases cash and adds position; sell increases cash; AI chat returns a response with inline trade confirmation

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Backend Foundation | 4/4 | Complete   | 2026-06-26 |
| 2. AI Chat Integration | 3/3 | Complete    | 2026-06-27 |
| 3. Frontend | 0/TBD | Not started | - |
| 4. Docker & Testing | 0/TBD | Not started | - |
