<!-- GSD:project-start source:PROJECT.md -->

## Project

**FinAlly — AI Trading Workstation**

FinAlly (Finance Ally) is an AI-powered trading workstation that streams live market data, lets users trade a simulated portfolio, and integrates an LLM chat assistant that can analyze positions and execute trades through natural language. It looks and feels like a modern Bloomberg terminal with an AI copilot — built as the capstone project for an agentic AI coding course, constructed entirely by coordinated AI agents.

**Core Value:** A single `docker run` command launches a visually stunning, fully functional trading terminal with live prices, simulated portfolio management, and an AI assistant that can actually execute trades — demonstrating that orchestrated AI agents can produce production-quality full-stack applications.

### Constraints

- **Single container**: One Docker image, one port (8000), no service orchestration — students run one command
- **Python runtime**: uv project management, Python 3.12, FastAPI + uvicorn
- **Static frontend**: Next.js `output: 'export'` — built at Docker image build time, served by FastAPI as static files
- **SQLite only**: No Postgres, no database server, volume-mounted at `db/finally.db`
- **aiosqlite**: All database access is async (FastAPI async handlers)
- **API key required**: `OPENROUTER_API_KEY` needed for LLM chat; app works without it (chat disabled), `LLM_MOCK=true` for testing
- **No confirmation dialogs**: Trades execute instantly — simulated environment, zero stakes, impressive demo

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Python 3.12+ - Backend server, market data processing, API endpoints
- TypeScript - Frontend (Next.js, not yet committed to repo)
- SQL - SQLite database queries and schema

## Runtime

- Python 3.12+ (specified in `backend/pyproject.toml` as `requires-python = ">=3.12"`)
- uv (modern Python package manager)
- Lockfile: `backend/uv.lock` (present and managed by uv)

## Frameworks

- FastAPI 0.115.0+ - REST API and SSE streaming server (`backend/pyproject.toml`)
- Uvicorn 0.32.0+ (with standard extras for production) - ASGI server (`backend/pyproject.toml`)
- Next.js - Static export with TypeScript (referenced in planning docs)
- Tailwind CSS - Styling with dark theme customization
- pytest 8.3.0+ - Test runner (`backend/pyproject.toml`)
- pytest-asyncio 0.24.0+ - Async test support
- pytest-cov 5.0.0+ - Coverage reporting
- ruff 0.7.0+ - Fast Python linter and formatter (`backend/pyproject.toml`)

## Key Dependencies

- fastapi 0.115.0+ - HTTP framework for REST endpoints and SSE streaming
- uvicorn[standard] 0.32.0+ - ASGI server (production deployment)
- massive 1.0.0 - SDK for Polygon.io market data API (optional, real-time prices)
- numpy 2.0.0 - Numerical calculations for GBM simulator and Cholesky correlation decomposition
- rich 13.0.0 - Terminal UI rendering library for demo (`backend/market_data_demo.py`)
- pydantic - Data validation (dependency of FastAPI, for request/response schemas)
- python-dotenv - Environment variable loading from `.env` file
- pyaml - YAML parsing support
- websockets - WebSocket support for Uvicorn (for potential future use)
- uvloop - Faster event loop implementation for async operations

## Configuration

- Configuration via environment variables in `.env` file (gitignored, `.env.example` committed)
- Key variables:
- `backend/pyproject.toml` - Python project configuration, dependencies, test/dev configuration
- `backend/uv.lock` - Dependency lockfile (reproducible installs)

## Platform Requirements

- Python 3.12+
- uv package manager
- Git for version control
- Docker (single container deployment)
- SQLite database (volume-mounted at `db/` in container)
- Network access to:

## Deployment

- Docker multi-stage build (Node 20 slim → Python 3.12 slim)
- Single port: 8000
- FastAPI serves both REST API and static frontend files
- SQLite file at `db/finally.db` (created on first run)
- Lazy initialization: schema and seed data created automatically if missing
- Volume-mounted for persistence across container restarts

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Lowercase with underscores: `models.py`, `market_data_demo.py`, `test_simulator.py`
- Test files: `test_*.py` (pytest naming convention)
- snake_case: `create_market_data_source()`, `get_price()`, `update_cache()`
- Private functions: Prefix with underscore: `_add_ticker_internal()`, `_rebuild_cholesky()`, `_poll_loop()`
- Static methods: Lowercase snake_case: `_pairwise_correlation()`
- snake_case for all variables: `api_key`, `cache`, `tickers`, `event_probability`
- Private attributes: Prefix with underscore: `self._prices`, `self._tickers`, `self._version`
- Constants: UPPERCASE: `TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600`, `DEFAULT_DT`, `SEED_PRICES`
- PascalCase for classes: `PriceUpdate`, `PriceCache`, `MarketDataSource`, `GBMSimulator`
- Abstract base classes use ABC: `class MarketDataSource(ABC)`

## Code Style

- Tool: ruff (built-in formatter)
- Line length: 100 characters (`tool.ruff.line-length = 100`)
- Import sorting: Handled by ruff linter
- Tool: ruff (check and lint)
- Selected rules: `E`, `F`, `I`, `N`, `W` (errors, pyflakes, isort, naming, warnings)
- Ignored: `E501` (line too long, handled by formatter)
- Target version: Python 3.12+ (`target-version = "py312"`)

## Import Organization

- Not used; relative imports preferred for same-package imports
- Use relative imports within modules: `from .cache import PriceCache`
- Import classes/functions by name, not modules: `from app.market import PriceUpdate` (not `from app import market`)
- Sorted alphabetically within each group

## Type Hints

- All function parameters and return types
- Class attributes in `__init__`
- Property return types

## Module Structure

- Use `__all__` list to define public API: `__all__ = ["PriceUpdate", "PriceCache", ...]`
- Barrel files export only public classes/functions
- Module docstring at top
- Imports
- Constants (UPPERCASE)
- Classes
- Functions
- Private helpers

## Class Design

- Use `@dataclass(frozen=True, slots=True)` for immutable value objects like `PriceUpdate`
- Provides frozen semantics (immutability) and memory efficiency via slots
- Use `ABC` (Abstract Base Class) for defining contracts
- Use `@abstractmethod` decorator for required methods
- Detailed docstrings explaining lifecycle and contracts
- Implement `__len__()`, `__contains__()`, `__repr__()` as needed
- Used for standard Python behavior: `len(cache)`, `"AAPL" in cache`
- Use `@property` for computed read-only values
- Example: `change_percent` calculated from `price` and `previous_price`
- Include docstrings for properties

## Docstrings

- Include in docstrings for complex classes:

## Error Handling

## Logging

- `logger.info()` - Lifecycle events (start, stop, add/remove ticker)
- `logger.debug()` - Detailed step-by-step information (simulator events, poll counts)
- `logger.warning()` - Recoverable issues (skipped snapshot, malformed data)
- `logger.error()` - Significant failures (API errors)
- `logger.exception()` - Exceptions with stacktrace in catch blocks

## Async Patterns

## Thread Safety

## Comments

- Complex algorithms: GBM math explanation, Cholesky decomposition
- Non-obvious implementation details: Why asyncio.to_thread() is used, correlation structure
- Workarounds and gotchas: "Massive timestamps are Unix milliseconds → convert to seconds"
- Avoid: Obvious comments like "increment i" or "return the result"
- Use `#` for inline comments on same line or preceding line
- Use docstrings for function/class documentation, not comments
- Comments above the code they explain

## Serialization

## Example Module Structure

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- **Separation of Concerns:** Market data abstraction decoupled from streaming/caching/business logic
- **Dependency Injection:** Router factories accept services as parameters (PriceCache, MarketDataSource) rather than using globals
- **Strategy Pattern:** MarketDataSource interface allows swapping Simulator ↔ Massive at runtime via environment variable
- **Immutability:** PriceUpdate is a frozen dataclass; cache returns copies to prevent accidental mutations
- **Thread Safety:** PriceCache uses locks for concurrent access; all writers update a single shared cache
- **Async/Await:** FastAPI routes and data sources use async/await for non-blocking I/O

## Layers

- Purpose: Render trading UI, display live prices, handle user interactions
- Location: `frontend/` (not yet implemented)
- Contains: Next.js TypeScript components, Tailwind CSS, SSE client connection via native EventSource API
- Depends on: `/api/*` REST endpoints, `/api/stream/prices` SSE stream
- Used by: End users (traders)
- Purpose: Handle HTTP requests, coordinate business logic, stream real-time data
- Location: `backend/app/routes/` (planned but not yet implemented for portfolio/chat); `backend/app/market/stream.py` for streaming
- Contains: Route handlers for `/api/portfolio/*`, `/api/watchlist/*`, `/api/chat`, `/api/stream/*`
- Depends on: PriceCache, MarketDataSource, SQLite database
- Used by: Frontend via HTTP/SSE
- Purpose: Provide abstraction for price data from any source
- Location: `backend/app/market/`
- Contains: PriceUpdate model, PriceCache, MarketDataSource interface, implementations (Simulator, Massive)
- Depends on: numpy (for GBM calculations), Massive API client (if used)
- Used by: SSE streaming, portfolio valuation, trade execution
- Purpose: In-memory store of latest prices; thread-safe concurrent access
- Location: `backend/app/market/cache.py`
- Contains: PriceCache class with per-ticker PriceUpdate storage
- Depends on: threading.Lock (stdlib), PriceUpdate model
- Used by: Market data sources (write), SSE endpoint (read), portfolio queries (read)
- Purpose: Durable storage of user state, portfolio, trades, chat history
- Location: `backend/db/` (schema definitions, seed data, future migration logic)
- Contains: SQLite schema, default seed data, initialization logic
- Depends on: SQLite3 (stdlib or via sqlite3 module)
- Used by: All business logic layers

## Data Flow

### Primary Request Path: Price Update → SSE Stream → Browser

- **In-Memory:** PriceCache is singleton-like, accessed by all concurrent readers/writers; thread-safe via locks
- **Durable:** Portfolio positions, trades, cash balance stored in SQLite
- **Session:** Chat history and portfolio snapshots accumulated in SQLite during session

### Secondary Flows (Planned)

## Key Abstractions

- Purpose: Defines contract for any price data provider
- Examples: `SimulatorDataSource` (`backend/app/market/simulator.py`), `MassiveDataSource` (`backend/app/market/massive_client.py`)
- Pattern: Abstract base class with `start()`, `stop()`, `add_ticker()`, `remove_ticker()`, `get_tickers()` methods
- Motivation: Allows swapping Simulator ↔ Massive without changing streaming/portfolio code
- Purpose: Immutable snapshot of a single ticker's price at a moment in time
- Examples: Created every time `cache.update()` is called
- Pattern: Frozen dataclass with computed properties for change, direction, serialization
- Motivation: Prevents accidental mutation; JSON serialization is central (SSE transmission)
- Purpose: Single source of truth for latest prices; thread-safe concurrent access
- Examples: Instantiated once, passed to market data sources and SSE router
- Pattern: Lock-based synchronization; version counter for change detection; snapshot on read
- Motivation: Supports multiple concurrent readers (SSE clients, portfolio queries) and one writer (market data source)

## Entry Points

- Location: `backend/market_data_demo.py`
- Triggers: `uv run market_data_demo.py`
- Responsibilities: Runs market simulator with Rich terminal UI; shows live prices and sparklines
- Usage: Development, demonstration, testing market data generation
- Location: `backend/app/main.py` (planned)
- Triggers: Docker container startup; `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Responsibilities: Initialize FastAPI, register routes, start market data source, serve static frontend, handle all HTTP/SSE requests
- Will coordinate: PriceCache creation, MarketDataSource initialization, database setup, route registration
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

- Create PriceCache instance
- Create MarketDataSource via factory
- Start market data source on app startup
- Register market stream router
- Initialize database (lazy on first query or on startup)
- Register portfolio/chat/watchlist routers (when implemented)

### Massive API Error Handling Not Visible

### No Validation of Ticker Symbols

## Error Handling

- PriceCache: No exceptions; all operations succeed (add/update/remove are idempotent)
- MarketDataSource: May raise `asyncio.TimeoutError`, `aiohttp.ClientError` if external API fails (not caught; propagates to app startup)
- SSE Streaming: Catches `asyncio.CancelledError` for clean disconnect; logs client IP for debugging
- Database (planned): Will use explicit transaction rollback on constraint violations (e.g., insufficient cash)

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| cerebras-inference | Use this to write code to call an LLM using LiteLLM and OpenRouter with the Cerebras inference provider | `.claude/skills/cerebras/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
