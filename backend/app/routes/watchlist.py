"""Watchlist management endpoints for the FinAlly trading workstation.

Public API:
    WatchlistAddRequest     - Pydantic request body for POST /api/watchlist
    create_watchlist_router - FastAPI router factory for watchlist endpoints
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import DEFAULT_USER_ID, connect
from ..market import MarketDataSource, PriceCache

__all__ = ["WatchlistAddRequest", "create_watchlist_router"]

logger = logging.getLogger(__name__)


class WatchlistAddRequest(BaseModel):
    """Request body for POST /api/watchlist."""

    ticker: str


def create_watchlist_router(cache: PriceCache, market_source: MarketDataSource) -> APIRouter:
    """Create and return the watchlist APIRouter.

    Injects PriceCache for live price lookups and MarketDataSource for
    ticker tracking. Registers all endpoints under /api/watchlist.

    Args:
        cache:         Shared PriceCache for live price lookups.
        market_source: MarketDataSource for add/remove ticker tracking.

    Returns:
        Configured APIRouter with GET, POST, and DELETE endpoints.
    """
    router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

    @router.get("")
    async def get_watchlist() -> list[dict]:
        """GET /api/watchlist — list watchlist tickers annotated with live prices.

        Returns each ticker's symbol, added_at timestamp, and the latest
        price snapshot from PriceCache. If no price is cached, price is None.
        """
        async with connect() as db:
            cursor = await db.execute(
                "SELECT ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at",
                (DEFAULT_USER_ID,),
            )
            rows = await cursor.fetchall()

        result: list[dict] = []
        for row in rows:
            ticker: str = row["ticker"]
            entry: dict = {"ticker": ticker, "added_at": row["added_at"]}
            price_update = cache.get(ticker)
            if price_update is not None:
                entry.update(price_update.to_dict())
            else:
                entry["price"] = None
            result.append(entry)

        return result

    @router.post("")
    async def add_to_watchlist(body: WatchlistAddRequest) -> dict:
        """POST /api/watchlist — add a ticker to the watchlist and start tracking it.

        Normalizes ticker to uppercase. Validates non-empty alphanumeric (HTTP 400
        otherwise). INSERT OR IGNORE makes duplicate POSTs idempotent (no duplicate
        rows). Calls market_source.add_ticker() so the ticker streams live prices.
        """
        ticker = body.ticker.upper()

        if not ticker or not ticker.isalnum():
            raise HTTPException(
                status_code=400,
                detail="Ticker must be a non-empty alphanumeric string",
            )

        now = datetime.now(timezone.utc).isoformat()
        row_id = uuid.uuid4().hex

        async with connect() as db:
            await db.execute(
                "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
                (row_id, DEFAULT_USER_ID, ticker, now),
            )
            await db.commit()

        await market_source.add_ticker(ticker)
        logger.info("Added ticker %s to watchlist", ticker)

        return {"status": "ok", "ticker": ticker}

    @router.delete("/{ticker}")
    async def remove_from_watchlist(ticker: str) -> dict:
        """DELETE /api/watchlist/{ticker} — remove a ticker and stop tracking it.

        Normalizes ticker to uppercase. DELETE is a no-op if the ticker is not
        present. Calls market_source.remove_ticker() to stop live price streaming.
        """
        ticker = ticker.upper()

        async with connect() as db:
            await db.execute(
                "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
                (DEFAULT_USER_ID, ticker),
            )
            await db.commit()

        await market_source.remove_ticker(ticker)
        logger.info("Removed ticker %s from watchlist", ticker)

        return {"status": "ok", "ticker": ticker}

    return router
