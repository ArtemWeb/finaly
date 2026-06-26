# External Integrations

**Analysis Date:** 2026-06-26

## APIs & External Services

**Market Data:**
- Massive API (Polygon.io wrapper)
  - What it's used for: Real-time stock price data via REST polling
  - SDK/Client: `massive` package (v1.0.0)
  - Auth: Environment variable `MASSIVE_API_KEY`
  - Implementation: `backend/app/market/massive_client.py` (`MassiveDataSource`)
  - Fallback: Built-in GBM simulator used if `MASSIVE_API_KEY` not set
  - Rate limits: Free tier 5 req/min (default 15s poll interval), paid tiers configurable

**LLM / AI Chat:**
- OpenRouter API
  - What it's used for: AI trading assistant for portfolio analysis and trade execution
  - SDK/Client: LiteLLM (planned integration, referenced in `planning/PLAN.md`)
  - Auth: Environment variable `OPENROUTER_API_KEY` (required)
  - Model: `openrouter/openai/gpt-oss-120b` with Cerebras inference
  - Structured outputs: JSON schema for trade execution and watchlist changes
  - Fallback: `LLM_MOCK=true` returns deterministic mock responses for testing

## Data Storage

**Databases:**
- SQLite
  - Connection: Local file at `db/finally.db` (volume-mounted in Docker)
  - Client: Built-in Python `sqlite3` module (via database layer in backend)
  - Lazy initialization: Schema and seed data created automatically on first request
  - User-specific data: All tables have `user_id` column (hardcoded to `"default"` for single-user, enables future multi-user)

**Tables:**
- `users_profile` - User state (cash balance, created_at)
- `watchlist` - Watched tickers with UNIQUE constraint on (user_id, ticker)
- `positions` - Current holdings (ticker, quantity, avg_cost, updated_at)
- `trades` - Trade history (append-only: ticker, side, quantity, price, executed_at)
- `portfolio_snapshots` - Portfolio value over time (recorded every 30s + after trades)
- `chat_messages` - Conversation history with LLM (role, content, actions as JSON)

**File Storage:**
- Local filesystem only (no cloud storage integrated)

**Caching:**
- In-memory price cache: `backend/app/market/cache.py` (`PriceCache`)
  - Thread-safe cache holding latest price, previous price, timestamp per ticker
  - Used by SSE streaming and portfolio valuation
  - Version counter increments on every update (for change detection)

## Authentication & Identity

**Auth Provider:**
- Custom (hardcoded)
- Single-user only: all operations use `user_id="default"`
- No login, signup, or user authentication
- Design allows future multi-user migration

## Real-Time Communication

**Server-Sent Events (SSE):**
- Endpoint: `GET /api/stream/prices`
- Content-Type: `text/event-stream`
- One-way push: server sends price updates to all connected clients
- No authentication required (single-user model)
- Events sent at ~500ms cadence with ticker, price, previous_price, timestamp, direction

## Monitoring & Observability

**Error Tracking:**
- None configured (built-in Python logging)

**Logs:**
- Python `logging` module with console output
- Log levels configured per module
- Specific loggers: market data poller, SSE streaming, API requests

## CI/CD & Deployment

**Hosting:**
- Docker container deployment
- Single container running Python FastAPI server on port 8000
- Volume mount for SQLite database persistence

**CI Pipeline:**
- GitHub Actions workflows in `.github/workflows/`
  - `claude.yml` - GSD workflow automation
  - `claude-code-review.yml` - Automated code review checks
- No dedicated test pipeline (tests run locally via `uv run pytest`)

**Build:**
- Multi-stage Docker build (Node 20 → Python 3.12)
- Frontend built as static export in first stage
- Python dependencies installed via uv with lockfile

## Environment Configuration

**Required env vars:**
- `OPENROUTER_API_KEY` - LLM chat endpoint authentication (no default)
- `.env` file in project root (gitignored, `.env.example` committed)

**Optional env vars:**
- `MASSIVE_API_KEY` - Real market data API key (empty/unset uses simulator)
- `LLM_MOCK` - Set to "true" for deterministic LLM responses in testing

**Secrets location:**
- `.env` file (mounted into Docker container via `--env-file`)
- Example: `.env.example` shows required/optional variables

## API Contracts

**REST Endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check for deployment monitoring |
| GET | `/api/stream/prices` | SSE stream of live price updates |
| GET | `/api/watchlist` | Get current watchlist with latest prices |
| POST | `/api/watchlist` | Add ticker to watchlist |
| DELETE | `/api/watchlist/{ticker}` | Remove ticker from watchlist |
| GET | `/api/portfolio` | Get positions, cash, P&L, total value |
| POST | `/api/portfolio/trade` | Execute trade (buy/sell market order) |
| GET | `/api/portfolio/history` | Get portfolio value snapshots (P&L chart) |
| POST | `/api/chat` | Send message to LLM, receive structured response |

**Frontend Serving:**
- `/` and static assets served by FastAPI (static export from Next.js)
- CORS not needed (single origin)

## Webhooks & Callbacks

**Incoming:**
- None implemented

**Outgoing:**
- None implemented (no external service notifications)

## Data Formats

**JSON:**
- REST API request/response bodies (Pydantic validation)
- Chat message actions stored as JSON in `chat_messages.actions` column
- LLM structured output parsed as JSON

**Streaming:**
- Server-Sent Events (SSE) format for price updates
- Event format: `data: {"ticker": "AAPL", "price": 190.50, ...}`

---

*Integration audit: 2026-06-26*
