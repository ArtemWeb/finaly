"""Chat service for FinAlly: orchestrates a full chat turn end-to-end.

Public API:
    SYSTEM_PROMPT       - System prompt constant positioning the LLM as "FinAlly"
    HISTORY_LIMIT       - Number of recent conversation turns to include in the prompt
    build_portfolio_context(portfolio, watchlist) -> str
                        - Renders cash, positions with P&L, and watchlist prices as a
                          compact text block for inclusion in the system prompt
    handle_chat(cache, market_source, user_message) -> dict
                        - Full chat turn: loads context + history, calls LLM, auto-executes
                          trades and watchlist changes, persists messages, returns result
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from .db import DEFAULT_USER_ID, connect
from .llm import ChatResponse, complete_chat
from .market.cache import PriceCache
from .market.interface import MarketDataSource
from .portfolio_service import TradeError, execute_trade, get_portfolio

__all__ = [
    "SYSTEM_PROMPT",
    "HISTORY_LIMIT",
    "build_portfolio_context",
    "handle_chat",
]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SYSTEM_PROMPT: str = (
    "You are FinAlly, an AI trading assistant embedded in a simulated trading workstation.\n"
    "\n"
    "Your capabilities and responsibilities:\n"
    "- Analyze portfolio composition, risk concentration, and P&L based on the context provided\n"
    "- Suggest trades with clear reasoning grounded in the live portfolio data\n"
    "- Execute trades automatically when the user asks or agrees — no confirmation needed\n"
    "- Manage the watchlist proactively by adding or removing tickers as appropriate\n"
    "- Be concise and data-driven in your responses; reference specific numbers from the context\n"
    "\n"
    "IMPORTANT: You MUST always respond with valid structured JSON matching exactly this schema:\n"
    '{"message": "<your response>", "trades": [], "watchlist_changes": []}\n'
    "Where:\n"
    '- "message" (required): Your conversational response shown to the user\n'
    '- "trades" (optional): Array of {"ticker": "AAPL", "side": "buy", "quantity": 10}\n'
    '- "watchlist_changes" (optional): Array of {"ticker": "PYPL", "action": "add"}\n'
    "\n"
    "Side must be 'buy' or 'sell'. Action must be 'add' or 'remove'.\n"
    "Trades go through the same validation as manual trades; if a trade would fail due to\n"
    "insufficient funds or shares, include it anyway and the system will capture the error.\n"
)

# Number of recent conversation turns to include as history (each turn = 2 messages)
HISTORY_LIMIT: int = 10


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------


def build_portfolio_context(portfolio: dict, watchlist: list[dict]) -> str:
    """Render portfolio + watchlist data as a compact text block for the system prompt.

    Args:
        portfolio:  Dict from get_portfolio() with cash_balance, total_value, positions[].
        watchlist:  List of dicts with ticker and price keys (price may be None).

    Returns:
        Multi-line string containing cash, position P&L, and watchlist prices.
        This text is appended to SYSTEM_PROMPT so the LLM has full portfolio context (CHAT-01).
    """
    lines: list[str] = ["=== PORTFOLIO CONTEXT ==="]

    cash: float = portfolio.get("cash_balance", 0.0)
    total: float = portfolio.get("total_value", 0.0)
    lines.append(f"Cash balance: ${cash:,.2f}")
    lines.append(f"Total portfolio value: ${total:,.2f}")

    positions: list[dict] = portfolio.get("positions", [])
    if positions:
        lines.append("\nPositions:")
        for pos in positions:
            ticker = pos["ticker"]
            qty = pos["quantity"]
            avg_cost = pos["avg_cost"]
            current_price = pos["current_price"]
            unrealized_pnl = pos["unrealized_pnl"]
            change_pct = pos["change_percent"]
            lines.append(
                f"  {ticker}: {qty:.2f} shares @ avg ${avg_cost:.2f}"
                f" | current ${current_price:.2f}"
                f" | P&L ${unrealized_pnl:+.2f} ({change_pct:+.2f}%)"
            )
    else:
        lines.append("\nPositions: none")

    if watchlist:
        lines.append("\nWatchlist:")
        for item in watchlist:
            ticker = item["ticker"]
            price = item.get("price")
            if price is not None:
                lines.append(f"  {ticker}: ${price:.2f}")
            else:
                lines.append(f"  {ticker}: (price unavailable)")
    else:
        lines.append("\nWatchlist: empty")

    return "\n".join(lines)


async def _load_watchlist(cache: PriceCache) -> list[dict]:
    """Load watchlist rows for the default user, annotating each with live price from cache.

    Mirrors the GET /api/watchlist read logic without importing the router.
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
        price_update = cache.get(ticker)
        entry: dict = {"ticker": ticker, "added_at": row["added_at"]}
        if price_update is not None:
            entry["price"] = price_update.price
        else:
            entry["price"] = None
        result.append(entry)

    return result


async def _load_history() -> list[dict]:
    """Load recent chat_messages for the default user, oldest-first, capped at HISTORY_LIMIT turns.

    Returns a list of {"role": ..., "content": ...} dicts suitable for injection into
    the LLM messages list. The actions column is intentionally omitted (not needed for prompt).
    """
    limit = HISTORY_LIMIT * 2  # each turn = 2 rows (user + assistant)

    async with connect() as db:
        # Fetch recent rows descending (most recent first), then reverse for oldest-first order
        cursor = await db.execute(
            "SELECT role, content FROM chat_messages"
            " WHERE user_id = ?"
            " ORDER BY created_at DESC"
            " LIMIT ?",
            (DEFAULT_USER_ID, limit),
        )
        rows = await cursor.fetchall()

    # Reverse so oldest appears first in the messages list
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def _utc_now() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Core chat handler
# ---------------------------------------------------------------------------


async def handle_chat(
    cache: PriceCache,
    market_source: MarketDataSource,
    user_message: str,
) -> dict:
    """Execute a complete chat turn and return the structured result.

    Steps:
    1. Load portfolio context (get_portfolio) and watchlist with live prices (_load_watchlist).
    2. Load recent conversation history (_load_history) — capped at HISTORY_LIMIT turns.
    3. Build the LLM messages list:
       [{"role":"system","content": SYSTEM_PROMPT + context}] + history + [user_message]
    4. Call complete_chat(messages) to get a ChatResponse.
    5. Auto-execute trades (execute_trade); capture TradeError without propagating (CHAT-03).
    6. Auto-execute watchlist changes via the same DB + market_source path as manual edits (CHAT-04).
    7. Persist user + assistant chat_messages rows; assistant.actions = JSON of outcomes (CHAT-05).
    8. Return {"message": ..., "actions": {"trades": [...], "watchlist_changes": [...]}} (CHAT-05).

    Args:
        cache:         Shared PriceCache for live price lookups and trade fill prices.
        market_source: MarketDataSource for add/remove ticker operations.
        user_message:  The raw user input string.

    Returns:
        dict with "message" (str) and "actions" (dict with "trades" and "watchlist_changes" lists).
    """
    # Step 1: Load portfolio + watchlist context
    portfolio = await get_portfolio(cache)
    watchlist = await _load_watchlist(cache)

    # Step 2: Load conversation history (oldest-first, capped)
    history = await _load_history()

    # Step 3: Build LLM messages list
    system_content = SYSTEM_PROMPT + "\n\n" + build_portfolio_context(portfolio, watchlist)
    messages: list[dict] = (
        [{"role": "system", "content": system_content}]
        + history
        + [{"role": "user", "content": user_message}]
    )

    # Step 4: Call LLM
    response: ChatResponse = await complete_chat(messages)

    # Step 5: Auto-execute trades
    trade_records: list[dict] = []
    for trade in response.trades:
        ticker = trade.ticker.upper()
        try:
            result = await execute_trade(cache, ticker, trade.side, trade.quantity)
            trade_records.append(
                {
                    "ticker": ticker,
                    "side": trade.side,
                    "quantity": trade.quantity,
                    "status": "executed",
                    "detail": (
                        f"Executed at ${result['price']:.2f}; "
                        f"cash_balance=${result['cash_balance']:.2f}"
                    ),
                }
            )
            logger.info(
                "Chat-executed trade: %s %s x %.4f (cash=%.2f)",
                trade.side,
                ticker,
                trade.quantity,
                result["cash_balance"],
            )
        except TradeError as exc:
            trade_records.append(
                {
                    "ticker": ticker,
                    "side": trade.side,
                    "quantity": trade.quantity,
                    "status": "error",
                    "detail": str(exc),
                }
            )
            logger.warning("Chat trade failed for %s: %s", ticker, exc)

    # Step 6: Auto-execute watchlist changes
    watchlist_records: list[dict] = []
    for change in response.watchlist_changes:
        ticker = change.ticker.upper()
        action = change.action.lower()

        if action == "add":
            now = _utc_now()
            row_id = uuid.uuid4().hex
            async with connect() as db:
                await db.execute(
                    "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at)"
                    " VALUES (?, ?, ?, ?)",
                    (row_id, DEFAULT_USER_ID, ticker, now),
                )
                await db.commit()
            await market_source.add_ticker(ticker)
            watchlist_records.append({"ticker": ticker, "action": "add", "status": "ok"})
            logger.info("Chat added ticker %s to watchlist", ticker)

        elif action == "remove":
            async with connect() as db:
                await db.execute(
                    "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
                    (DEFAULT_USER_ID, ticker),
                )
                await db.commit()
            await market_source.remove_ticker(ticker)
            watchlist_records.append({"ticker": ticker, "action": "remove", "status": "ok"})
            logger.info("Chat removed ticker %s from watchlist", ticker)

        else:
            watchlist_records.append(
                {
                    "ticker": ticker,
                    "action": action,
                    "status": "error",
                    "detail": f"Unknown watchlist action {action!r}; must be 'add' or 'remove'",
                }
            )
            logger.warning("Unknown watchlist action %r for ticker %s", action, ticker)

    # Step 7: Persist chat_messages rows
    actions_payload = {"trades": trade_records, "watchlist_changes": watchlist_records}
    now = _utc_now()

    async with connect() as db:
        # User message row (actions column is NULL for user turns)
        await db.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
            " VALUES (?, ?, ?, ?, NULL, ?)",
            (uuid.uuid4().hex, DEFAULT_USER_ID, "user", user_message, now),
        )
        # Assistant message row (actions column = JSON of executed outcomes)
        await db.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                uuid.uuid4().hex,
                DEFAULT_USER_ID,
                "assistant",
                response.message,
                json.dumps(actions_payload),
                now,
            ),
        )
        await db.commit()

    # Step 8: Return structured result
    return {"message": response.message, "actions": actions_payload}
