"""Portfolio service: trade execution, P&L valuation, and portfolio snapshot recording.

Public API:
    TradeError      - Domain exception raised on validation or business rule failures
    execute_trade   - Execute a buy or sell order at the current live fill price
    get_portfolio   - Return cash, per-position live P&L, and total portfolio value
    record_snapshot - Insert a portfolio_snapshots row with the current total value
    get_history     - Return portfolio value snapshots ordered by recorded_at ascending
"""

from __future__ import annotations

import logging
import uuid

from .db import DEFAULT_USER_ID, connect, utc_now
from .market.cache import PriceCache

__all__ = [
    "TradeError",
    "execute_trade",
    "get_portfolio",
    "record_snapshot",
    "get_history",
]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Domain exception
# ---------------------------------------------------------------------------


class TradeError(Exception):
    """Raised when a trade cannot be executed due to a validation or business rule failure.

    Examples: insufficient cash, insufficient shares, invalid quantity or side,
    no live price for the requested ticker.
    """


# ---------------------------------------------------------------------------
# Trade execution
# ---------------------------------------------------------------------------


async def execute_trade(
    cache: PriceCache,
    ticker: str,
    side: str,
    quantity: float,
) -> dict:
    """Execute a buy or sell order at the current live price.

    Validation (raises TradeError):
    - side must be 'buy' or 'sell'
    - quantity must be > 0
    - PriceCache must have a price for ticker
    - buy: total cost must not exceed cash_balance
    - sell: position must exist with sufficient shares

    On success:
    - All DB mutations (positions upsert, cash update, trades insert) run inside a
      single aiosqlite transaction for atomicity (T-02-03).
    - record_snapshot(cache) is called immediately after the committed transaction
      so portfolio_snapshots always has a point right after each trade (PORT-05).

    Returns:
        dict with ticker, side, quantity, price, cash_balance (post-trade).
    """
    ticker = ticker.upper()

    # --- Input validation (before touching the DB) ---
    if side not in {"buy", "sell"}:
        raise TradeError(f"Unknown side {side!r}; must be 'buy' or 'sell'")
    if quantity <= 0:
        raise TradeError(f"Quantity must be positive, got {quantity}")

    fill_price = cache.get_price(ticker)
    if fill_price is None:
        raise TradeError(f"No price available for ticker {ticker!r}")

    new_cash: float = 0.0  # set in buy or sell branch; initialised to satisfy linter

    async with connect() as db:
        # Read current cash balance
        cursor = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?",
            (DEFAULT_USER_ID,),
        )
        user_row = await cursor.fetchone()
        cash: float = user_row["cash_balance"]

        # Read existing position for this ticker (may be None)
        cursor = await db.execute(
            "SELECT id, quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, ticker),
        )
        pos_row = await cursor.fetchone()

        # --- Buy branch ---
        if side == "buy":
            cost = quantity * fill_price
            if cost > cash:
                raise TradeError(
                    f"Insufficient cash: need {cost:.2f}, available {cash:.2f}"
                )

            if pos_row is None:
                # First lot in this ticker — INSERT new position
                await db.execute(
                    "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (uuid.uuid4().hex, DEFAULT_USER_ID, ticker, quantity, fill_price, utc_now()),
                )
            else:
                # Add to existing position — weighted average cost
                old_qty: float = pos_row["quantity"]
                old_avg: float = pos_row["avg_cost"]
                new_qty = old_qty + quantity
                new_avg_cost = (old_qty * old_avg + quantity * fill_price) / new_qty
                await db.execute(
                    "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ?"
                    " WHERE user_id = ? AND ticker = ?",
                    (new_qty, new_avg_cost, utc_now(), DEFAULT_USER_ID, ticker),
                )

            new_cash = cash - cost

        # --- Sell branch ---
        elif side == "sell":
            owned: float = pos_row["quantity"] if pos_row is not None else 0.0
            if pos_row is None or owned < quantity:
                raise TradeError(
                    f"Insufficient shares of {ticker}: need {quantity}, have {owned}"
                )

            proceeds = quantity * fill_price
            remaining_qty = owned - quantity

            if remaining_qty == 0:
                # Full sell — remove the position row
                await db.execute(
                    "DELETE FROM positions WHERE user_id = ? AND ticker = ?",
                    (DEFAULT_USER_ID, ticker),
                )
            else:
                # Partial sell — update quantity only (avg_cost is unchanged)
                await db.execute(
                    "UPDATE positions SET quantity = ?, updated_at = ?"
                    " WHERE user_id = ? AND ticker = ?",
                    (remaining_qty, utc_now(), DEFAULT_USER_ID, ticker),
                )

            new_cash = cash + proceeds

        # Update cash balance
        await db.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (new_cash, DEFAULT_USER_ID),
        )

        # Record the trade (parameterised — no string interpolation of user input; T-02-01)
        await db.execute(
            "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, DEFAULT_USER_ID, ticker, side, quantity, fill_price, utc_now()),
        )

        await db.commit()

    logger.info("Trade: %s %s × %.4f @ %.4f → cash=%.2f", side, ticker, quantity, fill_price, new_cash)

    # Record portfolio snapshot immediately after the committed trade (PORT-05)
    await record_snapshot(cache)

    return {
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": fill_price,
        "cash_balance": new_cash,
    }


# ---------------------------------------------------------------------------
# Portfolio valuation
# ---------------------------------------------------------------------------


async def get_portfolio(cache: PriceCache) -> dict:
    """Return cash balance, per-position live P&L, and total portfolio value.

    For each position the current_price comes from cache.get_price(ticker);
    falls back to avg_cost if the ticker has no live price (e.g. market closed).

    Returns:
        dict with:
            cash_balance  (float)
            total_value   (float) — cash + sum(market_value)
            positions     (list[dict]) — one entry per open position with fields:
                ticker, quantity, avg_cost, current_price, market_value,
                unrealized_pnl, change_percent
    """
    async with connect() as db:
        cursor = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?",
            (DEFAULT_USER_ID,),
        )
        user_row = await cursor.fetchone()
        cash: float = user_row["cash_balance"]

        cursor = await db.execute(
            "SELECT ticker, quantity, avg_cost FROM positions"
            " WHERE user_id = ? ORDER BY ticker",
            (DEFAULT_USER_ID,),
        )
        pos_rows = await cursor.fetchall()

    positions = []
    total_value = cash

    for pos in pos_rows:
        ticker: str = pos["ticker"]
        quantity: float = pos["quantity"]
        avg_cost: float = pos["avg_cost"]

        current_price = cache.get_price(ticker)
        if current_price is None:
            current_price = avg_cost  # Fall back to cost basis when no live price

        market_value = quantity * current_price
        unrealized_pnl = (current_price - avg_cost) * quantity
        change_percent = (
            (current_price - avg_cost) / avg_cost * 100.0 if avg_cost != 0.0 else 0.0
        )

        total_value += market_value
        positions.append(
            {
                "ticker": ticker,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "current_price": current_price,
                "market_value": market_value,
                "unrealized_pnl": unrealized_pnl,
                "change_percent": change_percent,
            }
        )

    return {
        "cash_balance": cash,
        "total_value": total_value,
        "positions": positions,
    }


# ---------------------------------------------------------------------------
# Snapshot recording
# ---------------------------------------------------------------------------


async def record_snapshot(cache: PriceCache) -> None:
    """Insert a portfolio_snapshots row with the current total value.

    Computes total_value identically to get_portfolio: cash + sum of position
    market values at live prices (falling back to avg_cost when no live price).

    Called automatically by execute_trade after every successful trade (PORT-05).
    """
    async with connect() as db:
        cursor = await db.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?",
            (DEFAULT_USER_ID,),
        )
        user_row = await cursor.fetchone()
        cash: float = user_row["cash_balance"]

        cursor = await db.execute(
            "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?",
            (DEFAULT_USER_ID,),
        )
        pos_rows = await cursor.fetchall()

        total_value = cash
        for pos in pos_rows:
            price = cache.get_price(pos["ticker"])
            if price is None:
                price = pos["avg_cost"]
            total_value += pos["quantity"] * price

        await db.execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at)"
            " VALUES (?, ?, ?, ?)",
            (uuid.uuid4().hex, DEFAULT_USER_ID, total_value, utc_now()),
        )
        await db.commit()

    logger.debug("Snapshot recorded: total_value=%.2f", total_value)


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


async def get_history() -> list[dict]:
    """Return portfolio value snapshots ordered by recorded_at ascending.

    Returns:
        list of dicts with total_value (float) and recorded_at (ISO str).
    """
    async with connect() as db:
        cursor = await db.execute(
            "SELECT total_value, recorded_at FROM portfolio_snapshots"
            " WHERE user_id = ? ORDER BY recorded_at ASC",
            (DEFAULT_USER_ID,),
        )
        rows = await cursor.fetchall()

    return [{"total_value": row["total_value"], "recorded_at": row["recorded_at"]} for row in rows]
