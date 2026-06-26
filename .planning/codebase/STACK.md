# Technology Stack

**Analysis Date:** 2026-06-26

## Languages

**Primary:**
- Python 3.12+ - Backend server, market data processing, API endpoints
- TypeScript - Frontend (Next.js, not yet committed to repo)

**Secondary:**
- SQL - SQLite database queries and schema

## Runtime

**Environment:**
- Python 3.12+ (specified in `backend/pyproject.toml` as `requires-python = ">=3.12"`)

**Package Manager:**
- uv (modern Python package manager)
- Lockfile: `backend/uv.lock` (present and managed by uv)

## Frameworks

**Core:**
- FastAPI 0.115.0+ - REST API and SSE streaming server (`backend/pyproject.toml`)
- Uvicorn 0.32.0+ (with standard extras for production) - ASGI server (`backend/pyproject.toml`)

**Frontend (Planned):**
- Next.js - Static export with TypeScript (referenced in planning docs)
- Tailwind CSS - Styling with dark theme customization

**Testing:**
- pytest 8.3.0+ - Test runner (`backend/pyproject.toml`)
- pytest-asyncio 0.24.0+ - Async test support
- pytest-cov 5.0.0+ - Coverage reporting

**Build/Dev:**
- ruff 0.7.0+ - Fast Python linter and formatter (`backend/pyproject.toml`)

## Key Dependencies

**Critical:**
- fastapi 0.115.0+ - HTTP framework for REST endpoints and SSE streaming
- uvicorn[standard] 0.32.0+ - ASGI server (production deployment)
- massive 1.0.0 - SDK for Polygon.io market data API (optional, real-time prices)
- numpy 2.0.0 - Numerical calculations for GBM simulator and Cholesky correlation decomposition
- rich 13.0.0 - Terminal UI rendering library for demo (`backend/market_data_demo.py`)
- pydantic - Data validation (dependency of FastAPI, for request/response schemas)

**Infrastructure:**
- python-dotenv - Environment variable loading from `.env` file
- pyaml - YAML parsing support
- websockets - WebSocket support for Uvicorn (for potential future use)
- uvloop - Faster event loop implementation for async operations

## Configuration

**Environment:**
- Configuration via environment variables in `.env` file (gitignored, `.env.example` committed)
- Key variables:
  - `OPENROUTER_API_KEY` - Required for LLM chat functionality
  - `MASSIVE_API_KEY` - Optional for real market data (falls back to simulator if unset)
  - `LLM_MOCK` - Set to "true" for deterministic testing responses

**Build:**
- `backend/pyproject.toml` - Python project configuration, dependencies, test/dev configuration
- `backend/uv.lock` - Dependency lockfile (reproducible installs)

## Platform Requirements

**Development:**
- Python 3.12+
- uv package manager
- Git for version control

**Production:**
- Docker (single container deployment)
- SQLite database (volume-mounted at `db/` in container)
- Network access to:
  - Polygon.io/Massive API (if `MASSIVE_API_KEY` configured)
  - OpenRouter API (for LLM chat)

## Deployment

**Container:**
- Docker multi-stage build (Node 20 slim → Python 3.12 slim)
- Single port: 8000
- FastAPI serves both REST API and static frontend files

**Database:**
- SQLite file at `db/finally.db` (created on first run)
- Lazy initialization: schema and seed data created automatically if missing
- Volume-mounted for persistence across container restarts

---

*Stack analysis: 2026-06-26*
