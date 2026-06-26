"""Background tasks for the FinAlly backend.

Two tasks run for the lifetime of the application:
1. Market data task  — drives the simulator or Massive API poller, writing
                        prices into the shared PriceCache.
2. Snapshot task     — records a portfolio_snapshot every 30 seconds so the
                        P&L chart has data even when no trades are executed.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from app.db import get_connection
from app.market import create_market_data_source
from app.price_cache import price_cache

logger = logging.getLogger(__name__)

_market_source = None  # Holds the running MarketDataSource (for clean shutdown)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_portfolio_value(user_id: str = "default") -> float:
    """Compute the current total portfolio value (cash + positions at live prices)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return 0.0
        total = row["cash_balance"]

        positions = conn.execute(
            "SELECT ticker, quantity FROM positions WHERE user_id = ?", (user_id,)
        ).fetchall()

    for pos in positions:
        update = price_cache.get(pos["ticker"])
        price = update.price if update else 0.0
        total += pos["quantity"] * price

    return total


def _record_snapshot(user_id: str = "default") -> None:
    """Write a portfolio_snapshot row to the database."""
    total_value = _compute_portfolio_value(user_id)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
            "VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, total_value, _now_iso()),
        )
        conn.commit()


async def _snapshot_loop(interval: float = 30.0) -> None:
    """Async loop that records a portfolio snapshot every `interval` seconds."""
    while True:
        await asyncio.sleep(interval)
        try:
            _record_snapshot()
        except Exception:
            logger.exception("Snapshot task error")


async def _run_market_data() -> None:
    """Start the market data source with the default watchlist tickers."""
    global _market_source

    from app.market.seed_prices import SEED_PRICES

    _market_source = create_market_data_source(price_cache)
    tickers = list(SEED_PRICES.keys())

    try:
        await _market_source.start(tickers)
    except Exception:
        logger.exception("Market data task crashed")


def start_market_data_task() -> asyncio.Task:
    """Schedule the market data background task and return the Task object."""
    loop = asyncio.get_event_loop()
    task = loop.create_task(_run_market_data(), name="market_data")
    logger.info("Market data background task started")
    return task


def start_snapshot_task(interval: float = 30.0) -> asyncio.Task:
    """Schedule the portfolio snapshot background task and return the Task object."""
    loop = asyncio.get_event_loop()
    task = loop.create_task(_snapshot_loop(interval), name="snapshot")
    logger.info("Portfolio snapshot background task started (interval=%ss)", interval)
    return task


async def stop_market_data() -> None:
    """Gracefully stop the market data source (called on app shutdown)."""
    global _market_source
    if _market_source is not None:
        try:
            await _market_source.stop()
        except Exception:
            logger.exception("Error stopping market data source")
        _market_source = None
