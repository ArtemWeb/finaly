"""Watchlist API routes.

Endpoints:
    GET    /api/watchlist          - All watchlist entries with live prices
    POST   /api/watchlist          - Add a ticker
    DELETE /api/watchlist/{ticker} - Remove a ticker
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_connection
from app.price_cache import price_cache

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

_USER = "default"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class AddTickerRequest(BaseModel):
    ticker: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("")
async def get_watchlist() -> list[dict]:
    """Return all watchlist entries with the latest price data."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at",
            (_USER,),
        ).fetchall()
    finally:
        conn.close()

    result = []
    for row in rows:
        ticker = row["ticker"]
        update = price_cache.get(ticker)
        result.append(
            {
                "ticker": ticker,
                "price": update.price if update else None,
                "prev_price": update.previous_price if update else None,
                "direction": update.direction if update else "flat",
            }
        )
    return result


@router.post("", status_code=201)
async def add_to_watchlist(req: AddTickerRequest) -> dict:
    """Add a ticker to the watchlist. Returns 409 if already present."""
    ticker = req.ticker.upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker must not be empty.")

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM watchlist WHERE user_id = ? AND ticker = ?",
            (_USER, ticker),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"{ticker} is already on the watchlist."
            )

        conn.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), _USER, ticker, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()

    # Tell the market data source to start tracking this ticker
    try:
        from app.background import _market_source  # noqa: PLC0415

        if _market_source is not None:
            import asyncio

            asyncio.get_event_loop().create_task(_market_source.add_ticker(ticker))
    except Exception:
        pass  # Non-fatal — simulator will add it on next cycle

    return {"ticker": ticker}


@router.delete("/{ticker}", status_code=200)
async def remove_from_watchlist(ticker: str) -> dict:
    """Remove a ticker from the watchlist."""
    ticker = ticker.upper()

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM watchlist WHERE user_id = ? AND ticker = ?",
            (_USER, ticker),
        ).fetchone()
        if not existing:
            raise HTTPException(
                status_code=404, detail=f"{ticker} is not on the watchlist."
            )

        conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
            (_USER, ticker),
        )
        conn.commit()
    finally:
        conn.close()

    # Tell the market data source to stop tracking this ticker
    try:
        from app.background import _market_source  # noqa: PLC0415

        if _market_source is not None:
            import asyncio

            asyncio.get_event_loop().create_task(_market_source.remove_ticker(ticker))
    except Exception:
        pass

    price_cache.remove(ticker)
    return {"ticker": ticker}
