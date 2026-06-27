"""FastAPI router for the AI chat endpoint.

Exposes one endpoint:
    POST /api/chat  — receive a user message, delegate to handle_chat, return structured reply

Uses the factory pattern (matching routes/portfolio.py and routes/watchlist.py) so PriceCache
and MarketDataSource are injected rather than accessed as globals.

Security mitigations (02-03 threat model):
    T-02-08: ChatRequest validated by Pydantic (message: str required); empty/whitespace
             message rejected with HTTP 400; malformed bodies return FastAPI 422 before
             reaching handle_chat.
    T-02-09: handle_chat calls complete_chat via asyncio.to_thread — slow LLM calls
             never block the event loop.
    T-02-10: Trades auto-executed via execute_trade which enforces balance/share checks.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..chat_service import handle_chat
from ..market.cache import PriceCache
from ..market.interface import MarketDataSource

__all__ = ["create_chat_router", "ChatRequest"]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    """Body for POST /api/chat.

    Fields:
        message - The user's chat message. Must be a non-empty, non-whitespace string.
    """

    message: str


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_chat_router(cache: PriceCache, market_source: MarketDataSource) -> APIRouter:
    """Create the chat APIRouter with references to the live PriceCache and MarketDataSource.

    Using the factory pattern allows PriceCache and MarketDataSource to be injected
    without relying on module-level globals, matching the portfolio and watchlist router
    factory patterns exactly.

    Args:
        cache:         Shared PriceCache for live price lookups passed to handle_chat.
        market_source: MarketDataSource for watchlist add/remove operations in handle_chat.

    Returns:
        APIRouter with prefix="/api/chat" and tag "chat".
    """
    router = APIRouter(prefix="/api/chat", tags=["chat"])

    @router.post("")
    async def chat(body: ChatRequest) -> dict:
        """POST /api/chat — receive a message and return the AI assistant's structured reply.

        Validates that the message is non-empty and non-whitespace (HTTP 400 otherwise).
        Delegates to handle_chat() which loads portfolio context, calls the LLM, auto-executes
        any trade/watchlist actions, persists messages, and returns the structured result.

        Returns a dict with:
            message (str): The assistant's conversational reply.
            actions (dict): {"trades": [...], "watchlist_changes": [...]} with execution outcomes.

        Raises:
            HTTPException(400): If message is empty or contains only whitespace (T-02-08).
        """
        if not body.message.strip():
            raise HTTPException(status_code=400, detail="message must not be empty")

        # handle_chat never raises on LLM/trade failures — errors are captured in actions
        return await handle_chat(cache, market_source, body.message)

    return router
