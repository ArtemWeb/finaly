# Architecture

**Analysis Date:** 2026-06-26

## System Overview

FinAlly is an AI-powered trading workstation built on a single Docker container serving both frontend and backend on port 8000. The system architecture follows a layered pattern with clear separation between real-time market data, portfolio management, and AI integration.

```text
┌──────────────────────────────────────────────────────────────────┐
│                    Presentation Layer                             │
│  Next.js Frontend (Static Export) + Tailwind CSS                  │
│  `frontend/` (not yet implemented)                                │
├──────────────────────────────┬──────────────────────────────────┤
│  REST API Routes             │  SSE Streaming                    │
│  `/api/portfolio/*`          │  `/api/stream/prices`             │
│  `/api/watchlist/*`          │  (Server → Browser)               │
│  `/api/chat`                 │                                   │
│  `/api/health`               │                                   │
└──────────────────────────────┴──────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│              Application Layer (FastAPI)                          │
│  `backend/app/` — Route handlers, business logic                 │
├──────────────────────────────┬──────────────────────────────────┤
│  Market Data Subsystem       │  Portfolio/Chat Handlers         │
│  `backend/app/market/`       │  (To be implemented)             │
│                              │  `backend/app/routes/`           │
└──────────────────────────────┴──────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│            Data & Service Layer                                   │
│                                                                   │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐  │
│  │  Market Data Source  │  │  Database Layer (SQLite)        │  │
│  │  (Pluggable)         │  │  `backend/db/`                  │  │
│  ├──────────────────────┤  │                                 │  │
│  │ - Simulator (GBM)    │  │  - users_profile                │  │
│  │   `simulator.py`     │  │  - watchlist                    │  │
│  │ - Massive API        │  │  - positions                    │  │
│  │   `massive_client.py`│  │  - trades                       │  │
│  │ - Price Cache        │  │  - portfolio_snapshots          │  │
│  │   `cache.py`         │  │  - chat_messages                │  │
│  └──────────────────────┘  └─────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Persistence Layer                                                │
│  SQLite Database: `db/finally.db` (volume-mounted)               │
└──────────────────────────────────────────────────────────────────┘

External Services:
  - OpenRouter (LiteLLM) → Cerebras inference for AI chat
  - Massive API (optional) → Real market data
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **PriceUpdate** | Immutable dataclass holding ticker price, previous price, timestamp, and computed properties (change, change_percent, direction) | `backend/app/market/models.py` |
| **PriceCache** | Thread-safe in-memory store of latest prices per ticker; supports concurrent reads/writes; version counter for change detection | `backend/app/market/cache.py` |
| **MarketDataSource** | Abstract interface defining lifecycle (start, stop, add_ticker, remove_ticker) for pluggable market data implementations | `backend/app/market/interface.py` |
| **SimulatorDataSource** | GBM-based market price simulator; generates correlated price movements with configurable drift/volatility per ticker; runs as background task | `backend/app/market/simulator.py` |
| **MassiveDataSource** | REST API client for Polygon.io/Massive real market data; polls at rate-limited intervals; implements MarketDataSource interface | `backend/app/market/massive_client.py` |
| **create_market_data_source** | Factory function selecting Simulator or Massive based on MASSIVE_API_KEY environment variable | `backend/app/market/factory.py` |
| **create_stream_router** | FastAPI router factory that injects PriceCache and creates `/api/stream/prices` SSE endpoint | `backend/app/market/stream.py` |
| **SSE Streaming** | Async generator pushing price updates to connected browsers every ~500ms via Server-Sent Events | `backend/app/market/stream.py` |

## Pattern Overview

**Overall:** Layered Architecture with Pluggable Data Sources

**Key Characteristics:**
- **Separation of Concerns:** Market data abstraction decoupled from streaming/caching/business logic
- **Dependency Injection:** Router factories accept services as parameters (PriceCache, MarketDataSource) rather than using globals
- **Strategy Pattern:** MarketDataSource interface allows swapping Simulator ↔ Massive at runtime via environment variable
- **Immutability:** PriceUpdate is a frozen dataclass; cache returns copies to prevent accidental mutations
- **Thread Safety:** PriceCache uses locks for concurrent access; all writers update a single shared cache
- **Async/Await:** FastAPI routes and data sources use async/await for non-blocking I/O

## Layers

**Presentation Layer (Frontend):**
- Purpose: Render trading UI, display live prices, handle user interactions
- Location: `frontend/` (not yet implemented)
- Contains: Next.js TypeScript components, Tailwind CSS, SSE client connection via native EventSource API
- Depends on: `/api/*` REST endpoints, `/api/stream/prices` SSE stream
- Used by: End users (traders)

**API Layer (FastAPI):**
- Purpose: Handle HTTP requests, coordinate business logic, stream real-time data
- Location: `backend/app/routes/` (planned but not yet implemented for portfolio/chat); `backend/app/market/stream.py` for streaming
- Contains: Route handlers for `/api/portfolio/*`, `/api/watchlist/*`, `/api/chat`, `/api/stream/*`
- Depends on: PriceCache, MarketDataSource, SQLite database
- Used by: Frontend via HTTP/SSE

**Market Data Layer:**
- Purpose: Provide abstraction for price data from any source
- Location: `backend/app/market/`
- Contains: PriceUpdate model, PriceCache, MarketDataSource interface, implementations (Simulator, Massive)
- Depends on: numpy (for GBM calculations), Massive API client (if used)
- Used by: SSE streaming, portfolio valuation, trade execution

**Data/Cache Layer:**
- Purpose: In-memory store of latest prices; thread-safe concurrent access
- Location: `backend/app/market/cache.py`
- Contains: PriceCache class with per-ticker PriceUpdate storage
- Depends on: threading.Lock (stdlib), PriceUpdate model
- Used by: Market data sources (write), SSE endpoint (read), portfolio queries (read)

**Persistence Layer:**
- Purpose: Durable storage of user state, portfolio, trades, chat history
- Location: `backend/db/` (schema definitions, seed data, future migration logic)
- Contains: SQLite schema, default seed data, initialization logic
- Depends on: SQLite3 (stdlib or via sqlite3 module)
- Used by: All business logic layers

## Data Flow

### Primary Request Path: Price Update → SSE Stream → Browser

1. **Market Data Source** produces price update (Simulator every 500ms or Massive on poll) → `backend/app/market/simulator.py:SimulatorDataSource.step()` or `backend/app/market/massive_client.py:MassiveDataSource._poll()`
2. **Update to Cache** — source calls `cache.update(ticker, price)` → `backend/app/market/cache.py:PriceCache.update()`, increments version counter
3. **SSE Server Detects Change** — async generator in `backend/app/market/stream.py:_generate_events()` wakes every 500ms, checks version counter
4. **JSON Serialization** — for each ticker in cache, calls `PriceUpdate.to_dict()` → `backend/app/market/models.py:PriceUpdate.to_dict()`
5. **Broadcast to Browser** — yields SSE event with JSON payload to all connected EventSource clients
6. **Frontend Receives** — browser receives `data: {...}` event, parses JSON, updates DOM with price flash animation

**State Management:**
- **In-Memory:** PriceCache is singleton-like, accessed by all concurrent readers/writers; thread-safe via locks
- **Durable:** Portfolio positions, trades, cash balance stored in SQLite
- **Session:** Chat history and portfolio snapshots accumulated in SQLite during session

### Secondary Flows (Planned)

**Trade Execution:**
1. Frontend POSTs to `/api/portfolio/trade` with ticker, quantity, side
2. Validator checks cash (for buy) or shares (for sell) against latest portfolio
3. On success: update positions table, record in trades table, record portfolio snapshot
4. Return confirmation to frontend

**Watchlist Management:**
1. Frontend POSTs to `/api/watchlist` with ticker
2. Backend validates ticker exists in market data cache
3. Insert into watchlist table
4. Inform market data source to start tracking this ticker (if not already)
5. Return success to frontend

**AI Chat:**
1. Frontend POSTs message to `/api/chat`
2. Backend loads user's portfolio context + recent chat history
3. Constructs prompt; calls OpenRouter LLM
4. LLM returns structured JSON (message + optional trades/watchlist_changes)
5. Auto-execute any trades/watchlist changes specified
6. Store message + actions in chat_messages table
7. Return JSON to frontend

## Key Abstractions

**MarketDataSource Interface:**
- Purpose: Defines contract for any price data provider
- Examples: `SimulatorDataSource` (`backend/app/market/simulator.py`), `MassiveDataSource` (`backend/app/market/massive_client.py`)
- Pattern: Abstract base class with `start()`, `stop()`, `add_ticker()`, `remove_ticker()`, `get_tickers()` methods
- Motivation: Allows swapping Simulator ↔ Massive without changing streaming/portfolio code

**PriceUpdate Model:**
- Purpose: Immutable snapshot of a single ticker's price at a moment in time
- Examples: Created every time `cache.update()` is called
- Pattern: Frozen dataclass with computed properties for change, direction, serialization
- Motivation: Prevents accidental mutation; JSON serialization is central (SSE transmission)

**PriceCache:**
- Purpose: Single source of truth for latest prices; thread-safe concurrent access
- Examples: Instantiated once, passed to market data sources and SSE router
- Pattern: Lock-based synchronization; version counter for change detection; snapshot on read
- Motivation: Supports multiple concurrent readers (SSE clients, portfolio queries) and one writer (market data source)

## Entry Points

**Market Data Demo (Development):**
- Location: `backend/market_data_demo.py`
- Triggers: `uv run market_data_demo.py`
- Responsibilities: Runs market simulator with Rich terminal UI; shows live prices and sparklines
- Usage: Development, demonstration, testing market data generation

**FastAPI Application Server (Production) [Not Yet Implemented]:**
- Location: `backend/app/main.py` (planned)
- Triggers: Docker container startup; `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Responsibilities: Initialize FastAPI, register routes, start market data source, serve static frontend, handle all HTTP/SSE requests
- Will coordinate: PriceCache creation, MarketDataSource initialization, database setup, route registration

**Tests:**
- Location: `backend/tests/`
- Triggers: `uv run --extra dev pytest -v`
- Responsibilities: Unit tests for market data components
- Coverage: PriceUpdate model, PriceCache concurrency, SimulatorDataSource, MassiveDataSource, factory selection

## Architectural Constraints

- **Threading:** FastAPI runs on async event loop (uvicorn default); market data simulator runs background task; price cache uses locks for thread-safe concurrent access
- **Global State:** PriceCache will be application singleton; MarketDataSource instance is singleton per app lifecycle
- **Circular Imports:** None currently; market modules form a clean import hierarchy (models → interface → cache → factory/implementations)
- **Async Boundary:** All FastAPI handlers are async; market data sources are async; database access will be async (aiosqlite recommended)
- **Real-Time Constraint:** SSE cadence is fixed at ~500ms; price updates occur at same frequency

## Anti-Patterns

### Absence of App Factory / Main Entry Point

**What happens:** Market data components are well-designed but isolated; no FastAPI app initialization code exists yet. Routes directory is empty (`backend/app/routes/`).

**Why it's wrong:** Incomplete system — data layer can't be reached by clients; no way to aggregate services and coordinate lifecycle.

**Do this instead:** Create `backend/app/main.py` with FastAPI app initialization. Use dependency injection (FastAPI Depends) or a single startup event to:
- Create PriceCache instance
- Create MarketDataSource via factory
- Start market data source on app startup
- Register market stream router
- Initialize database (lazy on first query or on startup)
- Register portfolio/chat/watchlist routers (when implemented)

### Massive API Error Handling Not Visible

**What happens:** `backend/app/market/massive_client.py` makes REST calls to Polygon.io with limited error handling documentation.

**Why it's wrong:** Rate limits, API downtime, authentication failures will surface at runtime; no graceful degradation strategy evident.

**Do this instead:** Add retry logic with exponential backoff. Document fallback behavior (queue updates, use stale cache, alert user). Implement circuit breaker pattern if Massive API becomes unavailable for extended period.

### No Validation of Ticker Symbols

**What happens:** Any string can be added to watchlist or used in trades; no validation against known tickers.

**Why it's wrong:** User could add "FAKE" and get no price updates; trades on non-existent tickers could be accepted silently.

**Do this instead:** Maintain whitelist of known tickers (10 defaults + any from Massive API). Validate on watchlist add and before trade execution. Return 400 Bad Request with helpful message if invalid.

## Error Handling

**Strategy:** Explicit exceptions for domain errors; async generator cancellation for SSE cleanup

**Patterns:**
- PriceCache: No exceptions; all operations succeed (add/update/remove are idempotent)
- MarketDataSource: May raise `asyncio.TimeoutError`, `aiohttp.ClientError` if external API fails (not caught; propagates to app startup)
- SSE Streaming: Catches `asyncio.CancelledError` for clean disconnect; logs client IP for debugging
- Database (planned): Will use explicit transaction rollback on constraint violations (e.g., insufficient cash)

## Cross-Cutting Concerns

**Logging:** Standard Python logging via `logging.getLogger(__name__)` in each module; configured at app startup; info-level logging for market data source selection and SSE connections

**Validation:** Input validation on API boundaries (planned in route handlers); data model validation via dataclass frozen=True (PriceUpdate); cache operations are all-or-nothing (atomicity via lock)

**Authentication:** Not implemented; hardcoded `user_id="default"` for all operations (single-user app). Future multi-user support requires adding auth middleware and per-user data filtering in queries.

**Concurrency:** PriceCache is the only shared mutable state; protected by threading.Lock; all other components are thread-isolated or immutable

---

*Architecture analysis: 2026-06-26*
