"""Chat API route.

Endpoint:
    POST /api/chat  — Send a user message, get an LLM response with optional
                      auto-executed trades and watchlist changes.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_connection
from app.llm import LLMResponse, build_portfolio_context, call_llm
from app.price_cache import price_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

_USER = "default"
_HISTORY_LIMIT = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_portfolio_context() -> str:
    """Build a portfolio context string from the current DB state + live prices."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (_USER,)
        ).fetchone()
        cash = row["cash_balance"] if row else 0.0

        positions_rows = conn.execute(
            "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?",
            (_USER,),
        ).fetchall()
    finally:
        conn.close()

    positions = []
    total_value = cash
    for p in positions_rows:
        ticker = p["ticker"]
        quantity = p["quantity"]
        avg_cost = p["avg_cost"]
        update = price_cache.get(ticker)
        current_price = update.price if update else 0.0
        unrealized_pnl = round((current_price - avg_cost) * quantity, 4)
        pnl_pct = round((current_price - avg_cost) / avg_cost * 100, 4) if avg_cost else 0.0
        total_value += quantity * current_price
        positions.append(
            {
                "ticker": ticker,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "current_price": current_price,
                "unrealized_pnl": unrealized_pnl,
                "pnl_pct": pnl_pct,
            }
        )

    portfolio = {
        "cash_balance": cash,
        "total_value": round(total_value, 4),
        "positions": positions,
    }
    return build_portfolio_context(portfolio)


def _load_conversation_history() -> list[dict]:
    """Load the last N messages from chat_messages as a plain list of dicts."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT role, content FROM chat_messages "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (_USER, _HISTORY_LIMIT),
        ).fetchall()
    finally:
        conn.close()

    # Rows are newest-first; reverse so history is chronological.
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    return history


def _save_message(role: str, content: str, actions: dict | None = None) -> None:
    """Persist a chat message to the database."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                _USER,
                role,
                content,
                json.dumps(actions) if actions else None,
                _now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _execute_trade(ticker: str, side: str, quantity: float) -> dict:
    """Execute a single trade (same logic as portfolio route).

    Returns a result dict with 'status', 'ticker', 'side', 'quantity', 'price',
    and either 'cash_balance' (success) or 'error' (failure).
    """
    import uuid as _uuid  # noqa: PLC0415

    ticker = ticker.upper()

    conn = get_connection()
    try:
        update = price_cache.get(ticker)
        if update is None:
            return {
                "status": "error",
                "ticker": ticker,
                "side": side,
                "quantity": quantity,
                "error": f"No price data for {ticker}. Add it to the watchlist first.",
            }
        price = update.price

        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (_USER,)
        ).fetchone()
        cash = row["cash_balance"] if row else 0.0

        if side == "buy":
            cost = price * quantity
            if cash < cost:
                return {
                    "status": "error",
                    "ticker": ticker,
                    "side": side,
                    "quantity": quantity,
                    "error": f"Insufficient cash. Need ${cost:.2f}, have ${cash:.2f}.",
                }
            conn.execute(
                "UPDATE users_profile SET cash_balance = cash_balance - ? WHERE id = ?",
                (cost, _USER),
            )
            existing = conn.execute(
                "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
                (_USER, ticker),
            ).fetchone()
            if existing:
                old_qty = existing["quantity"]
                old_cost = existing["avg_cost"]
                new_qty = old_qty + quantity
                new_avg = (old_qty * old_cost + quantity * price) / new_qty
                conn.execute(
                    "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ? "
                    "WHERE user_id = ? AND ticker = ?",
                    (new_qty, new_avg, _now_iso(), _USER, ticker),
                )
            else:
                conn.execute(
                    "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (str(_uuid.uuid4()), _USER, ticker, quantity, price, _now_iso()),
                )

        else:  # sell
            existing = conn.execute(
                "SELECT quantity FROM positions WHERE user_id = ? AND ticker = ?",
                (_USER, ticker),
            ).fetchone()
            owned = existing["quantity"] if existing else 0.0
            if owned < quantity:
                return {
                    "status": "error",
                    "ticker": ticker,
                    "side": side,
                    "quantity": quantity,
                    "error": f"Insufficient shares. Have {owned}, tried to sell {quantity}.",
                }
            proceeds = price * quantity
            conn.execute(
                "UPDATE users_profile SET cash_balance = cash_balance + ? WHERE id = ?",
                (proceeds, _USER),
            )
            new_qty = owned - quantity
            if new_qty < 1e-9:
                conn.execute(
                    "DELETE FROM positions WHERE user_id = ? AND ticker = ?",
                    (_USER, ticker),
                )
            else:
                conn.execute(
                    "UPDATE positions SET quantity = ?, updated_at = ? "
                    "WHERE user_id = ? AND ticker = ?",
                    (new_qty, _now_iso(), _USER, ticker),
                )

        # Record the trade
        conn.execute(
            "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(_uuid.uuid4()), _USER, ticker, side, quantity, price, _now_iso()),
        )

        # Portfolio snapshot after the trade
        _record_portfolio_snapshot(conn)

        conn.commit()

        new_cash_row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (_USER,)
        ).fetchone()
        new_cash = new_cash_row["cash_balance"] if new_cash_row else 0.0

    finally:
        conn.close()

    return {
        "status": "ok",
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "cash_balance": new_cash,
    }


def _record_portfolio_snapshot(conn) -> None:
    """Insert a portfolio value snapshot (called within an open connection)."""
    row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (_USER,)
    ).fetchone()
    total = row["cash_balance"] if row else 0.0

    positions = conn.execute(
        "SELECT ticker, quantity FROM positions WHERE user_id = ?", (_USER,)
    ).fetchall()
    for pos in positions:
        update = price_cache.get(pos["ticker"])
        total += pos["quantity"] * (update.price if update else 0.0)

    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), _USER, total, _now_iso()),
    )


def _execute_watchlist_change(ticker: str, action: str) -> dict:
    """Add or remove a ticker from the watchlist.

    Returns a result dict with 'status' and either success data or 'error'.
    """
    ticker = ticker.upper().strip()
    if not ticker:
        return {"status": "error", "ticker": ticker, "action": action, "error": "Empty ticker."}

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM watchlist WHERE user_id = ? AND ticker = ?",
            (_USER, ticker),
        ).fetchone()

        if action == "add":
            if existing:
                return {
                    "status": "skipped",
                    "ticker": ticker,
                    "action": action,
                    "note": f"{ticker} is already on the watchlist.",
                }
            conn.execute(
                "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), _USER, ticker, _now_iso()),
            )
            conn.commit()
            # Notify market data source
            _notify_market_source("add", ticker)
            return {"status": "ok", "ticker": ticker, "action": "add"}

        elif action == "remove":
            if not existing:
                return {
                    "status": "skipped",
                    "ticker": ticker,
                    "action": action,
                    "note": f"{ticker} is not on the watchlist.",
                }
            conn.execute(
                "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
                (_USER, ticker),
            )
            conn.commit()
            price_cache.remove(ticker)
            _notify_market_source("remove", ticker)
            return {"status": "ok", "ticker": ticker, "action": "remove"}

        else:
            return {
                "status": "error",
                "ticker": ticker,
                "action": action,
                "error": f"Unknown watchlist action: {action!r}",
            }
    finally:
        conn.close()


def _notify_market_source(action: str, ticker: str) -> None:
    """Best-effort notification to the market data source (non-fatal if unavailable)."""
    try:
        from app.background import _market_source  # noqa: PLC0415
        import asyncio  # noqa: PLC0415

        if _market_source is not None:
            if action == "add":
                asyncio.get_event_loop().create_task(_market_source.add_ticker(ticker))
            else:
                asyncio.get_event_loop().create_task(_market_source.remove_ticker(ticker))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("")
async def chat(req: ChatRequest) -> dict:
    """Send a user message and receive an LLM response.

    Side effects:
    - Persists user message and assistant response in chat_messages.
    - Auto-executes any trades specified by the LLM.
    - Auto-executes any watchlist changes specified by the LLM.

    Returns:
        {message, trades, watchlist_changes}
    """
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    # 1. Load context
    portfolio_context = _load_portfolio_context()
    history = _load_conversation_history()

    # 2. Call LLM
    llm_response: LLMResponse = call_llm(req.message, portfolio_context, history)

    # 3. Auto-execute trades
    trade_results = []
    for trade in (llm_response.trades or []):
        result = _execute_trade(trade.ticker, trade.side, trade.quantity)
        trade_results.append(result)
        if result["status"] == "error":
            logger.warning("Trade failed: %s", result["error"])

    # 4. Auto-execute watchlist changes
    watchlist_results = []
    for change in (llm_response.watchlist_changes or []):
        result = _execute_watchlist_change(change.ticker, change.action)
        watchlist_results.append(result)
        if result.get("status") == "error":
            logger.warning("Watchlist change failed: %s", result.get("error"))

    # 5. Save messages
    _save_message("user", req.message)
    actions = None
    if trade_results or watchlist_results:
        actions = {"trades": trade_results, "watchlist_changes": watchlist_results}
    _save_message("assistant", llm_response.message, actions)

    # 6. Return response
    return {
        "message": llm_response.message,
        "trades": [t.model_dump() for t in (llm_response.trades or [])],
        "watchlist_changes": [w.model_dump() for w in (llm_response.watchlist_changes or [])],
    }
