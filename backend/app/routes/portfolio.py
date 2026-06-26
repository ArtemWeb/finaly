"""FastAPI router for portfolio endpoints.

Exposes three endpoints:
    GET  /api/portfolio          - Live portfolio valuation with P&L (PORT-01)
    POST /api/portfolio/trade    - Execute a buy or sell order (PORT-02)
    GET  /api/portfolio/history  - Portfolio value snapshots over time (PORT-03)

Use the factory pattern (matching app/market/stream.py) so PriceCache is injected
rather than accessed as a global.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..market.cache import PriceCache
from ..portfolio_service import TradeError, execute_trade, get_history, get_portfolio

__all__ = ["create_portfolio_router", "TradeRequest"]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class TradeRequest(BaseModel):
    """Body for POST /api/portfolio/trade.

    Fields:
        ticker   - Ticker symbol (e.g. "AAPL").  Normalised to uppercase.
        quantity - Number of shares to buy or sell.  Must be > 0.
        side     - Direction: "buy" or "sell".
    """

    ticker: str
    quantity: float
    side: str


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_portfolio_router(cache: PriceCache) -> APIRouter:
    """Create the portfolio APIRouter with a reference to the live PriceCache.

    Using the factory pattern lets us inject the PriceCache (and by extension the
    DB_PATH / market data source) without relying on module-level globals.

    Returns:
        APIRouter with prefix="/api/portfolio" and tag "portfolio".
    """
    router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

    @router.get("")
    async def get_portfolio_endpoint() -> dict:
        """Return cash balance, open positions with live P&L, and total value."""
        return await get_portfolio(cache)

    @router.post("/trade")
    async def trade(body: TradeRequest) -> dict:
        """Execute a buy or sell order at the current live price.

        Returns a confirmation dict on success.
        Returns HTTP 400 with an error detail on any TradeError (insufficient
        cash, insufficient shares, invalid quantity/side, missing price).
        """
        try:
            return await execute_trade(cache, body.ticker, body.side, body.quantity)
        except TradeError as err:
            logger.warning("Trade rejected: %s", err)
            raise HTTPException(status_code=400, detail=str(err))

    @router.get("/history")
    async def history() -> list[dict]:
        """Return portfolio value snapshots in ascending time order."""
        return await get_history()

    return router
