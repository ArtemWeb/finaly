"""FastAPI application factory and entry point for the FinAlly backend.

Public API:
    create_app() -> FastAPI   - App factory; used by uvicorn, Docker, and tests
    app                       - Module-level app instance for ``uvicorn app.main:app``

Environment variables read by create_app():
    DB_PATH           - SQLite file path (default: db/finally.db)
    MASSIVE_API_KEY   - If set, MassiveDataSource is used; otherwise GBM simulator
    SNAPSHOT_INTERVAL - Seconds between periodic portfolio snapshots (default: 30)
    STATIC_DIR        - Path to the Next.js static export directory (default: static)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import portfolio_service
from .db import get_watchlist_tickers, init_db
from .market import PriceCache, create_market_data_source, create_stream_router
from .routes.chat import create_chat_router
from .routes.portfolio import create_portfolio_router
from .routes.watchlist import create_watchlist_router

__all__ = ["create_app", "app"]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Background task: periodic portfolio snapshot
# ---------------------------------------------------------------------------


async def _snapshot_loop(cache: PriceCache, interval: float) -> None:
    """Record a portfolio snapshot every ``interval`` seconds.

    Runs forever until the task is cancelled on app shutdown.
    Exceptions from record_snapshot are logged and swallowed so a transient
    DB error never kills the loop (T-04-02 mitigation).
    """
    while True:
        try:
            await portfolio_service.record_snapshot(cache)
        except Exception:
            logger.exception(
                "Snapshot loop: record_snapshot failed; will retry in %.1fs", interval
            )
        await asyncio.sleep(interval)


# ---------------------------------------------------------------------------
# Lifespan context manager
# ---------------------------------------------------------------------------


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    """Manage application startup and shutdown.

    Startup (in order):
    1. init_db()              — creates all 6 tables and seeds default data idempotently
    2. get_watchlist_tickers  — reads the seeded ticker list so the market source
                                streams exactly those symbols
    3. source.start(tickers)  — starts the GBM simulator or Massive client
    4. asyncio.create_task    — launches the periodic portfolio-snapshot background task

    Shutdown (reverse order):
    1. Cancel and await the snapshot task (CancelledError suppressed; T-04-03)
    2. source.stop()          — idempotent per MarketDataSource ABC contract
    """
    # --- Startup ---
    logger.info("FinAlly startup: initialising database")
    await init_db()

    tickers = await get_watchlist_tickers()
    logger.info("Starting market data source on %d ticker(s): %s", len(tickers), tickers)
    await app.state.source.start(tickers)

    snapshot_task = asyncio.create_task(
        _snapshot_loop(app.state.cache, app.state.snapshot_interval),
        name="snapshot-loop",
    )
    app.state.snapshot_task = snapshot_task
    logger.info("Snapshot loop started (interval=%.1fs)", app.state.snapshot_interval)

    yield

    # --- Shutdown ---
    logger.info("FinAlly shutdown: cancelling snapshot loop")
    snapshot_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await snapshot_task

    logger.info("FinAlly shutdown: stopping market data source")
    await app.state.source.stop()
    logger.info("FinAlly shutdown complete")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Construct and return the fully wired FastAPI application.

    Reads configuration from environment variables at call time so tests can
    override them with monkeypatch before calling create_app().

    Routers registered (in priority order, before the static mount):
    - /api/stream/*     — SSE price streaming
    - /api/portfolio/*  — portfolio valuation and trade execution
    - /api/watchlist/*  — watchlist management
    - /api/chat/*       — LLM chat (CHAT-01/03/04/05/06)
    - /api/health       — service liveness check (CORE-02)

    Static serving (CORE-04):
    - Mounts the Next.js static export at ``/`` if STATIC_DIR exists.
    - Silently skips the mount with a warning when the directory is absent,
      so the app starts cleanly during Phase 1 before the frontend is built.
    - Uses Starlette StaticFiles for path normalization — no hand-rolled joins (T-04-01).

    Returns:
        Configured FastAPI application ready for ``uvicorn`` or ``TestClient``.
    """
    snapshot_interval = float(os.environ.get("SNAPSHOT_INTERVAL", "30"))
    static_dir = os.environ.get("STATIC_DIR", "static")

    cache = PriceCache()
    source = create_market_data_source(cache)

    application = FastAPI(
        title="FinAlly",
        description="AI-powered trading workstation",
        lifespan=lifespan,
    )

    # Expose services on app.state for lifespan access and test introspection
    application.state.cache = cache
    application.state.source = source
    application.state.snapshot_interval = snapshot_interval

    # Register API routers before the static mount so /api/* always wins
    application.include_router(create_stream_router(cache))
    application.include_router(create_portfolio_router(cache))
    application.include_router(create_watchlist_router(cache, source))
    application.include_router(create_chat_router(cache, source))

    # Health endpoint — CORE-02
    @application.get("/api/health", tags=["health"])
    async def health() -> dict:
        """Service liveness check. Returns HTTP 200 with {"status": "ok"}."""
        return {"status": "ok"}

    # Static file serving — CORE-04
    # Mount only if the directory exists; skip with a warning otherwise.
    # Starlette StaticFiles normalises paths and confines serving to the
    # given directory — no manual path joining needed (T-04-01 mitigation).
    static_path = Path(static_dir)
    if static_path.is_dir():
        application.mount(
            "/",
            StaticFiles(directory=str(static_path), html=True),
            name="static",
        )
        logger.info("Serving Next.js static export from: %s", static_path.resolve())
    else:
        logger.warning(
            "Static directory %r not found — skipping static file mount"
            " (expected during Phase 1 before the frontend is built)",
            static_dir,
        )

    return application


# ---------------------------------------------------------------------------
# Module-level app instance — required for ``uvicorn app.main:app``
# Only created when not running under pytest to avoid import-time side effects
# (database initialisation, market data source creation) during test collection.
# ---------------------------------------------------------------------------

import os as _os

if _os.environ.get("PYTEST_CURRENT_TEST") is None:
    app = create_app()
