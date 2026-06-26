"""Module-level price cache for the application.

The market data background task writes to this cache.
API routes and the SSE stream read from it.

This module re-exports the PriceCache class from app.market and provides
a single application-wide instance.
"""

from __future__ import annotations

from app.market import PriceCache, PriceUpdate  # noqa: F401 — re-export

# Single shared cache instance used by all parts of the application.
price_cache: PriceCache = PriceCache()


def update_price(ticker: str, price: float) -> PriceUpdate:
    """Update the price for a ticker in the shared cache."""
    return price_cache.update(ticker, price)


def get_price(ticker: str) -> PriceUpdate | None:
    """Get the latest PriceUpdate for a ticker, or None."""
    return price_cache.get(ticker)


def get_all_prices() -> dict[str, PriceUpdate]:
    """Return a snapshot of all current prices."""
    return price_cache.get_all()
