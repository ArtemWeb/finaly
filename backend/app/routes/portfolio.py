"""Portfolio API routes.

Endpoints:
    GET  /api/portfolio          - Current portfolio state
    POST /api/portfolio/trade    - Execute a buy or sell order
    GET  /api/portfolio/history  - Portfolio value snapshots (last 500)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import get_connection
from app.price_cache import price_cache

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

_USER = "default"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_cash(conn) -> float:
    row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (_USER,)
    ).fetchone()
    return row["cash_balance"] if row else 0.0


def _compute_total_value(conn) -> float:
    """Cash plus market value of all open positions."""
    total = _get_cash(conn)
    positions = conn.execute(
        "SELECT ticker, quantity FROM positions WHERE user_id = ?", (_USER,)
    ).fetchall()
    for pos in positions:
        update = price_cache.get(pos["ticker"])
        price = update.price if update else 0.0
        total += pos["quantity"] * price
    return total


def _record_snapshot(conn) -> None:
    total = _compute_total_value(conn)
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), _USER, total, _now_iso()),
    )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class TradeRequest(BaseModel):
    ticker: str
    quantity: float = Field(..., gt=0)
    side: Literal["buy", "sell"]


class PositionOut(BaseModel):
    ticker: str
    quantity: float
    avg_cost: float
    current_price: float
    unrealized_pnl: float
    pnl_pct: float


class PortfolioOut(BaseModel):
    cash_balance: float
    positions: list[PositionOut]
    total_value: float
    total_pnl: float
    total_pnl_pct: float


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=PortfolioOut)
async def get_portfolio() -> PortfolioOut:
    """Return the current portfolio: cash, positions with live P&L, total value."""
    conn = get_connection()
    try:
        cash = _get_cash(conn)
        rows = conn.execute(
            "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?", (_USER,)
        ).fetchall()
    finally:
        conn.close()

    positions = []
    total_value = cash
    for row in rows:
        ticker = row["ticker"]
        quantity = row["quantity"]
        avg_cost = row["avg_cost"]
        update = price_cache.get(ticker)
        current_price = update.price if update else 0.0
        unrealized_pnl = round((current_price - avg_cost) * quantity, 4)
        pnl_pct = round((current_price - avg_cost) / avg_cost * 100, 4) if avg_cost else 0.0
        total_value += quantity * current_price
        positions.append(
            PositionOut(
                ticker=ticker,
                quantity=quantity,
                avg_cost=avg_cost,
                current_price=current_price,
                unrealized_pnl=unrealized_pnl,
                pnl_pct=pnl_pct,
            )
        )

    initial_value = 10000.0
    total_pnl = round(total_value - initial_value, 4)
    total_pnl_pct = round((total_pnl / initial_value) * 100, 4)

    return PortfolioOut(
        cash_balance=cash,
        positions=positions,
        total_value=round(total_value, 4),
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl_pct,
    )


@router.post("/trade")
async def execute_trade(req: TradeRequest) -> dict:
    """Execute a market order (buy or sell).

    Buy:  deducts cash, upserts position with new weighted-average cost.
    Sell: adds cash, reduces or removes the position.
    Both: appends a trades row and records a portfolio snapshot.
    """
    ticker = req.ticker.upper()
    quantity = req.quantity
    side = req.side

    conn = get_connection()
    try:
        # Get live price — required to execute
        update = price_cache.get(ticker)
        if update is None:
            raise HTTPException(
                status_code=400,
                detail=f"No price data available for {ticker}. "
                       "Add the ticker to your watchlist first.",
            )
        price = update.price

        cash = _get_cash(conn)

        if side == "buy":
            cost = price * quantity
            if cash < cost:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient cash. Need ${cost:.2f}, have ${cash:.2f}.",
                )
            # Deduct cash
            conn.execute(
                "UPDATE users_profile SET cash_balance = cash_balance - ? WHERE id = ?",
                (cost, _USER),
            )
            # Upsert position with new weighted-average cost
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
                    (str(uuid.uuid4()), _USER, ticker, quantity, price, _now_iso()),
                )

        else:  # sell
            existing = conn.execute(
                "SELECT quantity FROM positions WHERE user_id = ? AND ticker = ?",
                (_USER, ticker),
            ).fetchone()
            owned = existing["quantity"] if existing else 0.0
            if owned < quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient shares. Have {owned}, tried to sell {quantity}.",
                )
            proceeds = price * quantity
            conn.execute(
                "UPDATE users_profile SET cash_balance = cash_balance + ? WHERE id = ?",
                (proceeds, _USER),
            )
            new_qty = owned - quantity
            if new_qty < 1e-9:  # effectively zero — remove the position
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
            (str(uuid.uuid4()), _USER, ticker, side, quantity, price, _now_iso()),
        )

        # Snapshot the portfolio after the trade
        _record_snapshot(conn)

        conn.commit()

        # Return updated cash balance
        new_cash = _get_cash(conn)

    finally:
        conn.close()

    return {
        "success": True,
        "status": "ok",
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "cash_balance": new_cash,
    }


@router.get("/history")
async def get_portfolio_history() -> list[dict]:
    """Return the last 500 portfolio value snapshots (oldest first)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT total_value, recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 500",
            (_USER,),
        ).fetchall()
    finally:
        conn.close()

    # Return oldest-first for charting
    result = [{"total_value": r["total_value"], "recorded_at": r["recorded_at"]} for r in rows]
    result.reverse()
    return result
