"""FinAlly FastAPI application entry point.

Startup sequence:
1. Load .env from project root
2. Configure logging
3. Create FastAPI app
4. Include all API routers
5. On startup: init DB, start market data background task, start snapshot task
6. Mount static files (Next.js build output) at /
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Load .env from project root before anything else reads env-vars
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).parent.parent.parent  # backend/  →  project root
load_dotenv(_PROJECT_ROOT / ".env", override=False)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise resources on startup, clean up on shutdown."""
    from app.background import start_market_data_task, start_snapshot_task, stop_market_data
    from app.db import init_db

    # 1. Database — creates tables and seeds defaults if needed
    init_db()
    logger.info("Database ready")

    # 2. Market data background task
    market_task = start_market_data_task()

    # 3. Portfolio snapshot background task
    snapshot_task = start_snapshot_task()

    yield  # Application runs here

    # Shutdown — cancel background tasks
    logger.info("Shutting down background tasks…")
    await stop_market_data()

    for task in (market_task, snapshot_task):
        task.cancel()
        try:
            await task
        except Exception:
            pass


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="FinAlly API",
    description="AI Trading Workstation — REST API and SSE streaming",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

from app.routes.portfolio import router as portfolio_router  # noqa: E402
from app.routes.watchlist import router as watchlist_router  # noqa: E402
from app.routes.chat import router as chat_router  # noqa: E402

# SSE stream router is built by the market module factory (injected with the cache)
from app.market import create_stream_router  # noqa: E402
from app.price_cache import price_cache  # noqa: E402

stream_router = create_stream_router(price_cache)

app.include_router(portfolio_router)
app.include_router(watchlist_router)
app.include_router(chat_router)
app.include_router(stream_router)

# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    """Health check for Docker and deployment orchestrators."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Static file serving (Next.js export — mounted last so /api/* routes win)
# ---------------------------------------------------------------------------

_STATIC_DIR = Path(__file__).parent.parent / "static"

if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
    logger.info("Serving static files from %s", _STATIC_DIR)
else:
    logger.warning(
        "Static directory not found at %s — frontend not served. "
        "Run the frontend build first.",
        _STATIC_DIR,
    )
