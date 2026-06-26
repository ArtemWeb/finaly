# FinAlly — AI Trading Workstation

## What This Is

FinAlly (Finance Ally) is an AI-powered trading workstation that streams live market data, lets users trade a simulated portfolio, and integrates an LLM chat assistant that can analyze positions and execute trades through natural language. It looks and feels like a modern Bloomberg terminal with an AI copilot — built as the capstone project for an agentic AI coding course, constructed entirely by coordinated AI agents.

## Core Value

A single `docker run` command launches a visually stunning, fully functional trading terminal with live prices, simulated portfolio management, and an AI assistant that can actually execute trades — demonstrating that orchestrated AI agents can produce production-quality full-stack applications.

## Business Context

- **Customer**: Students in the agentic AI coding course; course instructors as demonstrators
- **Revenue model**: Educational showcase (non-commercial)
- **Success metric**: Single Docker command → live browser trading session with AI chat working
- **Strategy notes**: Impressive demo experience is paramount — instant fill, no confirmation dialogs, fast LLM responses

## Requirements

### Validated

- ✓ Market data subsystem (`backend/app/market/`) — GBM simulator, Massive API client, PriceCache, SSE stream, factory pattern — Phase 0
- ✓ 73 passing tests across 6 modules (models, cache, simulator, simulator_source, factory, massive)
- ✓ Market data demo (`backend/market_data_demo.py`) — Rich terminal dashboard

### Active

- [ ] FastAPI application entry point (`backend/app/main.py`) with lifecycle management
- [ ] SQLite database layer — lazy initialization, schema, seed data (6 tables)
- [ ] Portfolio API routes (`/api/portfolio`, `/api/portfolio/trade`, `/api/portfolio/history`)
- [ ] Watchlist API routes (`/api/watchlist` CRUD)
- [ ] Chat API route (`/api/chat`) with LLM integration
- [ ] Health check route (`/api/health`)
- [ ] LLM integration — LiteLLM → OpenRouter → Cerebras, structured JSON output, auto-execution of trades/watchlist changes
- [ ] Frontend — Next.js TypeScript static export, dark terminal aesthetic
- [ ] Watchlist panel — live price flashing, sparklines accumulated from SSE
- [ ] Main chart area — larger chart for selected ticker
- [ ] Portfolio heatmap (treemap) — positions sized by weight, colored by P&L
- [ ] P&L chart — portfolio value over time from snapshots
- [ ] Positions table — ticker, qty, avg cost, current price, unrealized P&L, % change
- [ ] Trade bar — ticker + quantity input, buy/sell buttons, market orders
- [ ] AI chat panel — message input, conversation history, loading indicator, inline trade confirmations
- [ ] Header — live portfolio total, cash balance, SSE connection status indicator
- [ ] Multi-stage Dockerfile — Node build stage → Python runtime stage
- [ ] Docker Compose file and start/stop scripts (macOS + Windows)
- [ ] Playwright E2E tests with LLM mock mode

### Out of Scope

- Cloud deployment / Terraform (AWS App Runner) — mentioned as stretch goal, not core build
- Multi-user auth — hardcoded `user_id="default"`, single-user by design
- Limit orders / order book — market orders only, eliminates complexity
- WebSockets — SSE is sufficient for one-way push
- Login / signup — no friction on first launch by design

## Context

- **Course project**: Built entirely by coordinated AI agents to demonstrate agentic AI capabilities. Agents communicate through files in `planning/`.
- **Market data complete**: The `backend/app/market/` subsystem is fully built, tested, and reviewed. All downstream code integrates via `PriceCache` and `create_market_data_source()`.
- **No FastAPI app yet**: `backend/app/routes/` is empty. No `main.py` exists. The data layer is ready; the application shell and all routes are the next priority.
- **Stack locked**: FastAPI + uv (Python), Next.js TypeScript static export (frontend), SQLite + aiosqlite (database), LiteLLM → OpenRouter → Cerebras (LLM), Tailwind CSS.
- **LLM mock mode**: `LLM_MOCK=true` returns deterministic responses for E2E tests and development without an API key.
- **Color scheme**: Accent Yellow `#ecad0a`, Blue Primary `#209dd7`, Purple Secondary `#753991`, Background `#0d1117`/`#1a1a2e`.

## Constraints

- **Single container**: One Docker image, one port (8000), no service orchestration — students run one command
- **Python runtime**: uv project management, Python 3.12, FastAPI + uvicorn
- **Static frontend**: Next.js `output: 'export'` — built at Docker image build time, served by FastAPI as static files
- **SQLite only**: No Postgres, no database server, volume-mounted at `db/finally.db`
- **aiosqlite**: All database access is async (FastAPI async handlers)
- **API key required**: `OPENROUTER_API_KEY` needed for LLM chat; app works without it (chat disabled), `LLM_MOCK=true` for testing
- **No confirmation dialogs**: Trades execute instantly — simulated environment, zero stakes, impressive demo

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SSE over WebSockets | One-way push is all we need; simpler, no bidirectional complexity, universal browser support | — Pending |
| Static Next.js export | Single origin, no CORS issues, one port, one container, simple deployment | — Pending |
| SQLite over Postgres | No auth = no multi-user = no database server needed; self-contained, zero config | — Pending |
| Single Docker container | Students run one command; no docker-compose for production | — Pending |
| uv for Python | Fast, modern Python project management; reproducible lockfile | — Pending |
| Market orders only | Eliminates order book, limit order logic, partial fills — dramatically simpler portfolio math | — Pending |
| LiteLLM → OpenRouter → Cerebras | Fast inference, structured outputs, OpenRouter key already in .env | — Pending |
| Auto-execute LLM trades | Simulated money = zero stakes; creates impressive, fluid demo; demonstrates agentic AI | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-26 after initialization*
