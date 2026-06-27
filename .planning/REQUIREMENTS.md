# Requirements: FinAlly — AI Trading Workstation

**Defined:** 2026-06-26
**Core Value:** A single `docker run` command launches a visually stunning, fully functional trading terminal with live prices, simulated portfolio management, and an AI assistant that can actually execute trades.

## v1 Requirements

### CORE — Application Infrastructure

- [ ] **CORE-01**: FastAPI app initializes with startup/shutdown lifecycle (creates PriceCache, starts MarketDataSource, initializes DB, registers all routers)
- [ ] **CORE-02**: `GET /api/health` returns 200 with service status
- [ ] **CORE-03**: SQLite database lazily initializes on first use — creates all 6 tables and seeds default user + 10 tickers if missing
- [ ] **CORE-04**: FastAPI serves Next.js static export from `static/` directory for all non-API routes

### PORT — Portfolio Management

- [ ] **PORT-01**: `GET /api/portfolio` returns positions list, cash balance, total value, and unrealized P&L per position at live prices
- [ ] **PORT-02**: `POST /api/portfolio/trade` executes a market order (buy or sell) at current price; validates sufficient cash (buy) or shares (sell); returns confirmation
- [ ] **PORT-03**: `GET /api/portfolio/history` returns portfolio value snapshots over time for the P&L chart
- [ ] **PORT-04**: Background task records portfolio snapshot to `portfolio_snapshots` table every 30 seconds
- [ ] **PORT-05**: Portfolio snapshot recorded immediately after every trade execution

### WTCH — Watchlist Management

- [ ] **WTCH-01**: `GET /api/watchlist` returns current watchlist tickers with latest prices from PriceCache
- [ ] **WTCH-02**: `POST /api/watchlist` adds a ticker; validates it and informs MarketDataSource to track it
- [ ] **WTCH-03**: `DELETE /api/watchlist/{ticker}` removes a ticker from the watchlist

### CHAT — AI Chat & LLM Integration

- [x] **CHAT-01**: `POST /api/chat` sends user message to LLM with full portfolio context (cash, positions, watchlist with prices) and recent conversation history
- [x] **CHAT-02**: LLM returns structured JSON: `{message, trades?, watchlist_changes?}` via LiteLLM → OpenRouter → Cerebras
- [x] **CHAT-03**: Trades in LLM response auto-execute through same validation as manual trades; errors reported back in chat
- [x] **CHAT-04**: Watchlist changes in LLM response auto-execute
- [x] **CHAT-05**: Message and executed actions stored in `chat_messages` table; returned to frontend
- [x] **CHAT-06**: `LLM_MOCK=true` returns deterministic mock responses without API calls (for E2E tests and development)

### UI — Frontend

- [ ] **UI-01**: Watchlist panel shows live prices per ticker, flashing green (uptick) or red (downtick) with 500ms CSS fade animation on each price update
- [ ] **UI-02**: Watchlist panel shows sparkline mini-charts accumulated from SSE stream since page load
- [ ] **UI-03**: Clicking a ticker in the watchlist opens a larger detailed chart in the main chart area
- [ ] **UI-04**: Portfolio heatmap (treemap) shows open positions sized by portfolio weight, colored by P&L (green profit, red loss)
- [ ] **UI-05**: P&L chart (line) shows total portfolio value over time using `portfolio_snapshots` data
- [ ] **UI-06**: Positions table shows ticker, quantity, average cost, current price, unrealized P&L, and % change
- [ ] **UI-07**: Trade bar has ticker input, quantity input, Buy button, and Sell button; market orders fill instantly at current price
- [ ] **UI-08**: AI chat panel shows message input, scrollable conversation history, loading indicator while waiting for LLM, and inline confirmations for executed trades/watchlist changes
- [ ] **UI-09**: Header shows live total portfolio value (updating from SSE), cash balance, and SSE connection status indicator (green/yellow/red dot)
- [ ] **UI-10**: User can add and remove tickers from the watchlist via the UI
- [ ] **UI-11**: Dark terminal aesthetic: background `#0d1117`/`#1a1a2e`, accent yellow `#ecad0a`, blue `#209dd7`, purple `#753991` for submit buttons; Tailwind CSS
- [ ] **UI-12**: EventSource SSE connection to `/api/stream/prices` with automatic reconnect on disconnect

### DOCK — Docker & Deployment

- [ ] **DOCK-01**: Multi-stage Dockerfile — Node 20 build stage produces static frontend export; Python 3.12 runtime stage serves FastAPI + static files on port 8000
- [ ] **DOCK-02**: SQLite database persists via Docker named volume mounted at `/app/db`
- [ ] **DOCK-03**: `scripts/start_mac.sh` and `scripts/stop_mac.sh` for macOS/Linux (idempotent, opens browser)
- [ ] **DOCK-04**: `scripts/start_windows.ps1` and `scripts/stop_windows.ps1` for Windows PowerShell
- [ ] **DOCK-05**: `.env.example` committed with all variable names and descriptions; `.env` gitignored

### TEST — Testing

- [ ] **TEST-01**: Backend unit tests for portfolio logic (trade execution, P&L calculations, insufficient cash/shares edge cases)
- [ ] **TEST-02**: Backend unit tests for all API routes (correct status codes, response shapes, error handling)
- [ ] **TEST-03**: Backend unit tests for LLM structured output parsing, graceful handling of malformed responses, mock mode
- [ ] **TEST-04**: `test/docker-compose.test.yml` infrastructure spinning up app + Playwright containers
- [ ] **TEST-05**: E2E test: fresh start shows default watchlist ($10k balance, 10 tickers, prices streaming)
- [ ] **TEST-06**: E2E test: buy shares → cash decreases, position appears, portfolio heatmap updates
- [ ] **TEST-07**: E2E test: sell shares → cash increases, position updates or disappears
- [ ] **TEST-08**: E2E test: AI chat with mock LLM → response received, trade execution shown inline

## v2 Requirements

### INFRA — Future Enhancements

- **INFRA-01**: Cloud deployment — Terraform configuration for AWS App Runner or similar
- **INFRA-02**: WebSocket support for bi-directional real-time communication
- **INFRA-03**: Multi-user authentication and per-user data isolation

### FEAT — Future Features

- **FEAT-01**: Limit orders and order book
- **FEAT-02**: Mobile-responsive layout
- **FEAT-03**: Ticker symbol validation against a curated whitelist

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud deployment / Terraform | Stretch goal per PLAN.md — not part of core build |
| Multi-user auth / login | Single-user by design; hardcoded `user_id="default"`; no friction on first launch |
| Limit orders / order book | Market orders only — eliminates order book complexity; deliberate design decision |
| WebSockets | SSE sufficient for one-way push; simpler, universal browser support |
| Mobile-first layout | Desktop-first trading terminal; functional on tablet but not optimized for mobile |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| PORT-01 | Phase 1 | Pending |
| PORT-02 | Phase 1 | Pending |
| PORT-03 | Phase 1 | Pending |
| PORT-04 | Phase 1 | Pending |
| PORT-05 | Phase 1 | Pending |
| WTCH-01 | Phase 1 | Pending |
| WTCH-02 | Phase 1 | Pending |
| WTCH-03 | Phase 1 | Pending |
| CHAT-01 | Phase 2 | Complete |
| CHAT-02 | Phase 2 | Complete |
| CHAT-03 | Phase 2 | Complete |
| CHAT-04 | Phase 2 | Complete |
| CHAT-05 | Phase 2 | Complete |
| CHAT-06 | Phase 2 | Complete |
| UI-01 | Phase 3 | Pending |
| UI-02 | Phase 3 | Pending |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 3 | Pending |
| UI-05 | Phase 3 | Pending |
| UI-06 | Phase 3 | Pending |
| UI-07 | Phase 3 | Pending |
| UI-08 | Phase 3 | Pending |
| UI-09 | Phase 3 | Pending |
| UI-10 | Phase 3 | Pending |
| UI-11 | Phase 3 | Pending |
| UI-12 | Phase 3 | Pending |
| DOCK-01 | Phase 4 | Pending |
| DOCK-02 | Phase 4 | Pending |
| DOCK-03 | Phase 4 | Pending |
| DOCK-04 | Phase 4 | Pending |
| DOCK-05 | Phase 4 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 4 | Pending |
| TEST-06 | Phase 4 | Pending |
| TEST-07 | Phase 4 | Pending |
| TEST-08 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 43 total
- Mapped to phases: 43 (Phase 1: 12, Phase 2: 6, Phase 3: 12, Phase 4: 13)
- Unmapped: 0 ✓

*(Phase assignments finalized by roadmapper 2026-06-26)*

---
*Requirements defined: 2026-06-26*
*Last updated: 2026-06-26 — traceability finalized by roadmapper*
