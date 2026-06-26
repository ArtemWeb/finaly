# Market Data Backend — Detailed Design

Complete implementation reference for the FinAlly market data subsystem. All code
lives in `backend/app/market/` (8 modules, ~500 lines). This document covers every
module with full code snippets, explains the math and concurrency model, and shows
how downstream code consumes the public API.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Data Model — `models.py`](#2-data-model--modelspy)
3. [Abstract Interface — `interface.py`](#3-abstract-interface--interfacepy)
4. [Price Cache — `cache.py`](#4-price-cache--cachepy)
5. [Seed Prices & Ticker Parameters — `seed_prices.py`](#5-seed-prices--ticker-parameters--seed_pricespy)
6. [GBM Simulator — `simulator.py`](#6-gbm-simulator--simulatorpy)
7. [Massive API Client — `massive_client.py`](#7-massive-api-client--massive_clientpy)
8. [Factory — `factory.py`](#8-factory--factorypy)
9. [SSE Streaming Endpoint — `stream.py`](#9-sse-streaming-endpoint--streampy)
10. [Public Package API — `__init__.py`](#10-public-package-api--initpy)
11. [FastAPI Lifecycle Integration](#11-fastapi-lifecycle-integration)
12. [Watchlist Coordination](#12-watchlist-coordination)
13. [SSE Client (Frontend)](#13-sse-client-frontend)
14. [Testing Strategy](#14-testing-strategy)
15. [Error Handling & Edge Cases](#15-error-handling--edge-cases)
16. [Configuration Reference](#16-configuration-reference)

---

## 1. Overview & Architecture

### Data Flow

```
┌──────────────────────┐         ┌─────────────┐        ┌─────────────────────┐
│  SimulatorDataSource │──write──▶             │──read──▶  SSE /stream/prices  │
│  (GBM background     │         │  PriceCache │        └─────────────────────┘
│   asyncio task)      │         │  (in-memory │        ┌─────────────────────┐
├──────────────────────┤         │   thread-   │──read──▶  Portfolio valuation │
│  MassiveDataSource   │──write──▶   safe)     │        └─────────────────────┘
│  (REST poller        │         │             │        ┌─────────────────────┐
│   asyncio task)      │         └─────────────┘──read──▶  Trade execution    │
└──────────────────────┘                                └─────────────────────┘
         ▲
         │  selected by
┌────────┴──────────┐
│  create_market_   │
│  data_source()    │  ← reads MASSIVE_API_KEY env var
└───────────────────┘
```

### Strategy Pattern

Both data sources implement the `MarketDataSource` ABC. All downstream code
(SSE, portfolio, trades) reads only from `PriceCache` — it never touches the
data source directly. Swapping simulator for real data (or vice versa) requires
zero changes to any consumer.

### Concurrency Model

- The simulator runs as an `asyncio.Task` (no threads needed — pure CPU math)
- The Massive client runs as an `asyncio.Task` but offloads the synchronous
  REST call to a thread pool via `asyncio.to_thread()`
- `PriceCache` uses a `threading.Lock` so it's safe to write from a thread
  (Massive) and read from async coroutines simultaneously

---

## 2. Data Model — `models.py`

`PriceUpdate` is the single immutable unit of price information that flows
through the entire system.

```python
# backend/app/market/models.py

from __future__ import annotations
import time
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class PriceUpdate:
    """Immutable snapshot of a single ticker's price at a point in time."""

    ticker: str
    price: float
    previous_price: float
    timestamp: float = field(default_factory=time.time)  # Unix seconds

    @property
    def change(self) -> float:
        """Absolute price change from previous update."""
        return round(self.price - self.previous_price, 4)

    @property
    def change_percent(self) -> float:
        """Percentage change from previous update."""
        if self.previous_price == 0:
            return 0.0
        return round((self.price - self.previous_price) / self.previous_price * 100, 4)

    @property
    def direction(self) -> str:
        """'up', 'down', or 'flat'."""
        if self.price > self.previous_price:
            return "up"
        elif self.price < self.previous_price:
            return "down"
        return "flat"

    def to_dict(self) -> dict:
        """Serialize for JSON / SSE transmission."""
        return {
            "ticker": self.ticker,
            "price": self.price,
            "previous_price": self.previous_price,
            "timestamp": self.timestamp,
            "change": self.change,
            "change_percent": self.change_percent,
            "direction": self.direction,
        }
```

**Design notes:**
- `frozen=True` makes instances hashable and immutable — safe to share across threads
- `slots=True` reduces memory overhead (no `__dict__` per instance)
- Computed properties (`change`, `direction`) are derived on read — no stale data possible
- `to_dict()` produces the exact JSON shape sent over SSE and returned by watchlist API

**Example SSE payload for one ticker:**
```json
{
  "ticker": "AAPL",
  "price": 191.34,
  "previous_price": 191.12,
  "timestamp": 1735000000.123,
  "change": 0.22,
  "change_percent": 0.1152,
  "direction": "up"
}
```

---

## 3. Abstract Interface — `interface.py`

The `MarketDataSource` ABC defines the contract every data source must fulfill.

```python
# backend/app/market/interface.py

from __future__ import annotations
from abc import ABC, abstractmethod


class MarketDataSource(ABC):
    """Contract for market data providers.

    Lifecycle:
        source = create_market_data_source(cache)
        await source.start(["AAPL", "GOOGL", ...])   # begin producing prices
        await source.add_ticker("TSLA")               # dynamic addition
        await source.remove_ticker("GOOGL")           # dynamic removal
        await source.stop()                            # clean shutdown
    """

    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Begin producing price updates for the given tickers.
        Starts a background task. Call exactly once."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background task. Safe to call multiple times."""

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        """Add a ticker to the active set. No-op if already present."""

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker. Also removes it from PriceCache."""

    @abstractmethod
    def get_tickers(self) -> list[str]:
        """Return the current list of actively tracked tickers."""
```

**Why a synchronous `get_tickers()`?** The list of active tickers is an in-memory
list — no I/O needed. Making it async would force unnecessary `await` syntax at
every call site.

---

## 4. Price Cache — `cache.py`

The single source of truth for current prices. All producers write here;
all consumers read from here.

```python
# backend/app/market/cache.py

from __future__ import annotations
import time
from threading import Lock
from .models import PriceUpdate


class PriceCache:
    """Thread-safe in-memory cache of the latest price for each ticker."""

    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()
        self._version: int = 0  # Bumped on every update — used by SSE for change detection

    def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
        """Record a new price. Returns the created PriceUpdate.

        First update for a ticker: previous_price == price, direction == 'flat'.
        """
        with self._lock:
            ts = timestamp or time.time()
            prev = self._prices.get(ticker)
            previous_price = prev.price if prev else price
            update = PriceUpdate(
                ticker=ticker,
                price=round(price, 2),
                previous_price=round(previous_price, 2),
                timestamp=ts,
            )
            self._prices[ticker] = update
            self._version += 1
            return update

    def get(self, ticker: str) -> PriceUpdate | None:
        with self._lock:
            return self._prices.get(ticker)

    def get_all(self) -> dict[str, PriceUpdate]:
        """Snapshot of all current prices (shallow copy)."""
        with self._lock:
            return dict(self._prices)

    def get_price(self, ticker: str) -> float | None:
        """Convenience: returns just the float price, or None."""
        update = self.get(ticker)
        return update.price if update else None

    def remove(self, ticker: str) -> None:
        with self._lock:
            self._prices.pop(ticker, None)

    @property
    def version(self) -> int:
        """Monotonically increasing counter. SSE uses this to detect changes."""
        return self._version
```

### Version Counter for Efficient SSE

The SSE generator compares `price_cache.version` against `last_version` on
every iteration. It only serializes and sends data when something changed:

```python
# In _generate_events (stream.py):
last_version = -1
while True:
    current_version = price_cache.version
    if current_version != last_version:
        last_version = current_version
        data = {ticker: update.to_dict() for ticker, update in price_cache.get_all().items()}
        yield f"data: {json.dumps(data)}\n\n"
    await asyncio.sleep(0.5)
```

With 2 ticks/sec from the simulator and a 0.5s SSE interval, the version
check almost always fires — but it's still the right pattern for future cases
where the poll interval might be longer than the SSE interval.

---

## 5. Seed Prices & Ticker Parameters — `seed_prices.py`

Constants that configure the simulator's starting state and per-ticker behavior.

```python
# backend/app/market/seed_prices.py

# Realistic starting prices for the default watchlist
SEED_PRICES: dict[str, float] = {
    "AAPL": 190.00,
    "GOOGL": 175.00,
    "MSFT": 420.00,
    "AMZN": 185.00,
    "TSLA": 250.00,
    "NVDA": 800.00,
    "META": 500.00,
    "JPM":  195.00,
    "V":    280.00,
    "NFLX": 600.00,
}

# Per-ticker GBM parameters
# sigma: annualized volatility  (higher = wilder swings)
# mu:    annualized drift        (expected return per year)
TICKER_PARAMS: dict[str, dict[str, float]] = {
    "AAPL": {"sigma": 0.22, "mu": 0.05},
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "MSFT": {"sigma": 0.20, "mu": 0.05},
    "AMZN": {"sigma": 0.28, "mu": 0.05},
    "TSLA": {"sigma": 0.50, "mu": 0.03},  # Highly volatile
    "NVDA": {"sigma": 0.40, "mu": 0.08},  # High vol, strong drift
    "META": {"sigma": 0.30, "mu": 0.05},
    "JPM":  {"sigma": 0.18, "mu": 0.04},  # Stable (bank)
    "V":    {"sigma": 0.17, "mu": 0.04},  # Stable (payments)
    "NFLX": {"sigma": 0.35, "mu": 0.05},
}

# Fallback for dynamically added tickers not in the list above
DEFAULT_PARAMS: dict[str, float] = {"sigma": 0.25, "mu": 0.05}

# Sector groupings for correlated moves
CORRELATION_GROUPS: dict[str, set[str]] = {
    "tech":    {"AAPL", "GOOGL", "MSFT", "AMZN", "META", "NVDA", "NFLX"},
    "finance": {"JPM", "V"},
}

INTRA_TECH_CORR    = 0.6   # Tech stocks co-move strongly
INTRA_FINANCE_CORR = 0.5   # Finance stocks co-move moderately
CROSS_GROUP_CORR   = 0.3   # Cross-sector or unknown tickers
TSLA_CORR          = 0.3   # TSLA does its own thing (even within tech)
```

**Adding a new ticker dynamically** (e.g., `PYPL`): the simulator assigns it
`DEFAULT_PARAMS` and starts it at a random price between $50–$300, since we
don't know the real price. With the Massive client the real price appears on
the next poll.

---

## 6. GBM Simulator — `simulator.py`

### The Math

Geometric Brownian Motion is the standard model for stock prices. For each tick:

```
S(t+dt) = S(t) × exp((μ - σ²/2) × dt + σ × √dt × Z)
```

Where:
- `S(t)` = current price
- `μ` (mu) = annualized drift (expected return)
- `σ` (sigma) = annualized volatility
- `dt` = time step as a fraction of a trading year
- `Z` = standard normal random variable (correlated across tickers)

**Why the `μ - σ²/2` correction?** In Itô calculus, the expected log return
is `μ - σ²/2`, not `μ`. Without the correction, the expected price would drift
upward faster than intended (Itô's lemma).

**Time step calculation:**
```python
TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600  # = 5,896,800
dt = 0.5 / TRADING_SECONDS_PER_YEAR            # ≈ 8.48e-8
```
This makes 500ms of simulated time equal 500ms of real trading time,
scaled to the appropriate fraction of an annualized volatility.

### Correlated Moves via Cholesky Decomposition

To make tech stocks move together, the simulator builds a correlation matrix
and decomposes it with Cholesky. Each tick:

1. Draw `n` independent standard normals `z ~ N(0,1)`
2. Multiply by the Cholesky factor `L`: `z_corr = L @ z_independent`
3. Use `z_corr[i]` as the `Z` for ticker `i`

The result: if AAPL moves up on a tick, GOOGL and MSFT will likely also move up.

```python
# Building the correlation matrix (called on every add/remove):
def _rebuild_cholesky(self) -> None:
    n = len(self._tickers)
    if n <= 1:
        self._cholesky = None
        return
    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            rho = self._pairwise_correlation(self._tickers[i], self._tickers[j])
            corr[i, j] = rho
            corr[j, i] = rho
    self._cholesky = np.linalg.cholesky(corr)

# Correlation lookup:
@staticmethod
def _pairwise_correlation(t1: str, t2: str) -> float:
    tech = CORRELATION_GROUPS["tech"]
    finance = CORRELATION_GROUPS["finance"]
    if t1 == "TSLA" or t2 == "TSLA":
        return TSLA_CORR           # 0.3 — TSLA independent
    if t1 in tech and t2 in tech:
        return INTRA_TECH_CORR     # 0.6
    if t1 in finance and t2 in finance:
        return INTRA_FINANCE_CORR  # 0.5
    return CROSS_GROUP_CORR        # 0.3
```

### Random Shock Events

To create visual drama, each ticker has a ~0.1% chance per tick of a sudden
2-5% move:

```python
if random.random() < self._event_prob:   # 0.001 default
    shock_magnitude = random.uniform(0.02, 0.05)
    shock_sign = random.choice([-1, 1])
    self._prices[ticker] *= 1 + shock_magnitude * shock_sign
```

With 10 tickers at 2 ticks/sec, expect roughly one dramatic event every ~50 seconds.

### Full `step()` Method

```python
def step(self) -> dict[str, float]:
    """Advance all tickers by one time step. Returns {ticker: new_price}."""
    n = len(self._tickers)
    if n == 0:
        return {}

    z_independent = np.random.standard_normal(n)
    z_correlated = self._cholesky @ z_independent if self._cholesky is not None else z_independent

    result: dict[str, float] = {}
    for i, ticker in enumerate(self._tickers):
        params = self._params[ticker]
        mu, sigma = params["mu"], params["sigma"]

        drift     = (mu - 0.5 * sigma**2) * self._dt
        diffusion = sigma * math.sqrt(self._dt) * z_correlated[i]
        self._prices[ticker] *= math.exp(drift + diffusion)

        # Shock event
        if random.random() < self._event_prob:
            shock = random.uniform(0.02, 0.05) * random.choice([-1, 1])
            self._prices[ticker] *= 1 + shock

        result[ticker] = round(self._prices[ticker], 2)
    return result
```

### `SimulatorDataSource` — Background Task

```python
class SimulatorDataSource(MarketDataSource):
    def __init__(self, price_cache: PriceCache, update_interval: float = 0.5,
                 event_probability: float = 0.001) -> None:
        self._cache = price_cache
        self._interval = update_interval
        self._event_prob = event_probability
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers, event_probability=self._event_prob)
        # Seed the cache so SSE has data immediately on first connection
        for ticker in tickers:
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)
        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def add_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.add_ticker(ticker)
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)

    async def remove_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.remove_ticker(ticker)
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return self._sim.get_tickers() if self._sim else []

    async def _run_loop(self) -> None:
        while True:
            try:
                if self._sim:
                    for ticker, price in self._sim.step().items():
                        self._cache.update(ticker=ticker, price=price)
            except Exception:
                logger.exception("Simulator step failed")
            await asyncio.sleep(self._interval)
```

---

## 7. Massive API Client — `massive_client.py`

When `MASSIVE_API_KEY` is set, the app uses the `massive` package (a Polygon.io
wrapper) to fetch real market data via REST polling.

### Why REST Polling Instead of WebSocket?

- Works on all Polygon.io tiers (including free)
- Simpler implementation — no connection state to manage
- The Massive package's REST client is battle-tested
- 15-second polls on the free tier are acceptable for a demo

### Rate Limit Table

| Tier   | Requests/min | Recommended Poll Interval |
|--------|-------------|---------------------------|
| Free   | 5           | 15s                       |
| Starter| 100         | 2–5s                      |
| Developer | unlimited | 1–2s                    |

### Implementation

```python
class MassiveDataSource(MarketDataSource):
    def __init__(self, api_key: str, price_cache: PriceCache,
                 poll_interval: float = 15.0) -> None:
        self._api_key = api_key
        self._cache = price_cache
        self._interval = poll_interval
        self._tickers: list[str] = []
        self._task: asyncio.Task | None = None
        self._client: RESTClient | None = None

    async def start(self, tickers: list[str]) -> None:
        self._client = RESTClient(api_key=self._api_key)
        self._tickers = list(tickers)
        await self._poll_once()   # Immediate first poll — don't wait 15s
        self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self._poll_once()

    async def _poll_once(self) -> None:
        if not self._tickers or not self._client:
            return
        try:
            # Synchronous REST call → run in thread to avoid blocking the event loop
            snapshots = await asyncio.to_thread(self._fetch_snapshots)
            for snap in snapshots:
                try:
                    price = snap.last_trade.price
                    timestamp = snap.last_trade.timestamp / 1000.0  # ms → seconds
                    self._cache.update(ticker=snap.ticker, price=price, timestamp=timestamp)
                except (AttributeError, TypeError) as e:
                    logger.warning("Skipping snapshot for %s: %s",
                                   getattr(snap, "ticker", "???"), e)
        except Exception as e:
            logger.error("Massive poll failed: %s", e)
            # Don't re-raise — the loop retries on next interval

    def _fetch_snapshots(self) -> list:
        """Synchronous Polygon.io call. Runs in thread pool."""
        return self._client.get_snapshot_all(
            market_type=SnapshotMarketType.STOCKS,
            tickers=self._tickers,
        )
```

### Handling Market Hours

Polygon.io returns stale data outside market hours (9:30–16:00 ET, Mon–Fri).
The cache simply holds the last seen price — `direction` will be `"flat"` until
the market reopens and new trades come in. This is acceptable for a demo app.

---

## 8. Factory — `factory.py`

Single function that reads the environment and returns the right implementation:

```python
# backend/app/market/factory.py

import os
from .cache import PriceCache
from .interface import MarketDataSource
from .massive_client import MassiveDataSource
from .simulator import SimulatorDataSource


def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    """Select data source based on MASSIVE_API_KEY env var.

    Returns an UNSTARTED source. Caller must: await source.start(tickers)
    """
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if api_key:
        logger.info("Market data source: Massive API (real data)")
        return MassiveDataSource(api_key=api_key, price_cache=price_cache)
    else:
        logger.info("Market data source: GBM Simulator")
        return SimulatorDataSource(price_cache=price_cache)
```

**Usage:**
```python
cache = PriceCache()
source = create_market_data_source(cache)
await source.start(["AAPL", "GOOGL", "MSFT"])
```

---

## 9. SSE Streaming Endpoint — `stream.py`

### Why SSE?

Server-Sent Events (SSE) are a perfect fit:
- One-way push (server → client) is all we need
- Native browser `EventSource` API handles reconnection automatically
- No WebSocket handshake complexity
- Works through HTTP proxies and CDNs

### Endpoint: `GET /api/stream/prices`

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no   ← disables nginx output buffering
```

**Response format — one SSE event every ~500ms:**
```
retry: 1000

data: {"AAPL": {"ticker": "AAPL", "price": 191.34, "previous_price": 191.12,
       "timestamp": 1735000000.123, "change": 0.22, "change_percent": 0.1152,
       "direction": "up"}, "GOOGL": {...}, ...}

data: {"AAPL": {...}, ...}
```

The `retry: 1000` directive tells the browser to wait 1 second before
reconnecting after a dropped connection.

### Implementation

```python
# backend/app/market/stream.py

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from collections.abc import AsyncGenerator
import asyncio, json, logging

router = APIRouter(prefix="/api/stream", tags=["streaming"])


def create_stream_router(price_cache: PriceCache) -> APIRouter:
    """Factory: injects price_cache without globals."""

    @router.get("/prices")
    async def stream_prices(request: Request) -> StreamingResponse:
        return StreamingResponse(
            _generate_events(price_cache, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router


async def _generate_events(
    price_cache: PriceCache,
    request: Request,
    interval: float = 0.5,
) -> AsyncGenerator[str, None]:
    yield "retry: 1000\n\n"

    last_version = -1
    while True:
        if await request.is_disconnected():
            break

        current_version = price_cache.version
        if current_version != last_version:
            last_version = current_version
            prices = price_cache.get_all()
            if prices:
                data = {ticker: update.to_dict() for ticker, update in prices.items()}
                yield f"data: {json.dumps(data)}\n\n"

        await asyncio.sleep(interval)
```

---

## 10. Public Package API — `__init__.py`

```python
# backend/app/market/__init__.py

from .cache import PriceCache
from .factory import create_market_data_source
from .interface import MarketDataSource
from .models import PriceUpdate
from .stream import create_stream_router

__all__ = [
    "PriceUpdate",
    "PriceCache",
    "MarketDataSource",
    "create_market_data_source",
    "create_stream_router",
]
```

Downstream code imports only from `app.market` — internal module names are
an implementation detail:

```python
from app.market import PriceCache, create_market_data_source, create_stream_router
```

---

## 11. FastAPI Lifecycle Integration

The market data source must start when the app starts and stop cleanly on
shutdown. Use FastAPI's `lifespan` context manager:

```python
# backend/app/main.py

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.market import PriceCache, create_market_data_source, create_stream_router
from app.db import init_db, get_watchlist_tickers

# Module-level singletons — shared across all requests
price_cache = PriceCache()
market_source = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    global market_source

    # 1. Initialize database (creates tables + seeds if missing)
    await init_db()

    # 2. Load watchlist from DB
    tickers = await get_watchlist_tickers(user_id="default")

    # 3. Start market data source
    market_source = create_market_data_source(price_cache)
    await market_source.start(tickers)

    yield  # App is running

    # 4. Clean shutdown
    if market_source:
        await market_source.stop()


app = FastAPI(lifespan=lifespan)

# Register SSE router
app.include_router(create_stream_router(price_cache))

# Serve static frontend (Next.js export)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
```

**Why singletons at module level?** FastAPI doesn't have a built-in DI
container. Module-level globals are the idiomatic pattern for shared state
in single-process FastAPI apps. A future multi-process deployment would use
Redis for the price cache instead.

---

## 12. Watchlist Coordination

When the user adds or removes a ticker via the watchlist API, the market data
source must be notified synchronously (within the same request handler):

```python
# backend/app/routes/watchlist.py

from fastapi import APIRouter
from app.market import PriceCache
from app.db import add_watchlist_ticker, remove_watchlist_ticker
import main  # to access the module-level market_source and price_cache

router = APIRouter(prefix="/api/watchlist")


@router.post("")
async def add_ticker(body: AddTickerRequest):
    ticker = body.ticker.upper().strip()
    # 1. Persist to DB
    await add_watchlist_ticker(ticker, user_id="default")
    # 2. Tell the data source to start tracking it
    await main.market_source.add_ticker(ticker)
    return {"ticker": ticker, "status": "added"}


@router.delete("/{ticker}")
async def remove_ticker(ticker: str):
    ticker = ticker.upper().strip()
    # 1. Remove from DB
    await remove_watchlist_ticker(ticker, user_id="default")
    # 2. Tell the data source to stop tracking it (also clears cache)
    await main.market_source.remove_ticker(ticker)
    return {"ticker": ticker, "status": "removed"}


@router.get("")
async def get_watchlist():
    tickers = main.market_source.get_tickers()
    prices = {t: main.price_cache.get(t) for t in tickers}
    return [
        {
            "ticker": t,
            "price": prices[t].price if prices[t] else None,
            "change_percent": prices[t].change_percent if prices[t] else None,
            "direction": prices[t].direction if prices[t] else "flat",
        }
        for t in tickers
    ]
```

---

## 13. SSE Client (Frontend)

The frontend connects to the SSE endpoint using the native `EventSource` API.
No libraries needed.

```typescript
// frontend/src/hooks/usePriceStream.ts

import { useEffect, useRef, useState } from "react";

export type PriceData = {
  ticker: string;
  price: number;
  previous_price: number;
  change: number;
  change_percent: number;
  direction: "up" | "down" | "flat";
  timestamp: number;
};

export type PriceMap = Record<string, PriceData>;

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export function usePriceStream() {
  const [prices, setPrices] = useState<PriceMap>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource("/api/stream/prices");
      esRef.current = es;

      es.onopen = () => setStatus("connected");

      es.onmessage = (event) => {
        const data: PriceMap = JSON.parse(event.data);
        setPrices((prev) => ({ ...prev, ...data }));
      };

      es.onerror = () => {
        setStatus("reconnecting");
        es.close();
        // EventSource auto-reconnects after the retry: 1000 directive
        // But we recreate it here for explicit status tracking
        setTimeout(connect, 1000);
      };
    }

    connect();
    return () => esRef.current?.close();
  }, []);

  return { prices, status };
}
```

**Price flash animation** — apply a CSS class when a new price arrives and
remove it after the transition duration:

```typescript
// On each new price event, briefly apply .flash-up or .flash-down
useEffect(() => {
  const el = document.getElementById(`price-${ticker}`);
  const cls = direction === "up" ? "flash-up" : "flash-down";
  el?.classList.add(cls);
  setTimeout(() => el?.classList.remove(cls), 600);
}, [price]);
```

```css
/* globals.css */
.flash-up {
  animation: flashGreen 0.6s ease-out;
}
.flash-down {
  animation: flashRed 0.6s ease-out;
}
@keyframes flashGreen {
  0%   { background-color: rgba(34, 197, 94, 0.4); }
  100% { background-color: transparent; }
}
@keyframes flashRed {
  0%   { background-color: rgba(239, 68, 68, 0.4); }
  100% { background-color: transparent; }
}
```

---

## 14. Testing Strategy

73 tests, all passing. Located in `backend/tests/market/`.

### Test Coverage by Module

| Module | Tests | Key Scenarios |
|--------|-------|---------------|
| `test_models.py` | 11 | Properties, direction logic, serialization, zero previous_price |
| `test_cache.py` | 13 | Thread safety, version counter, first update, remove |
| `test_simulator.py` | 17 | GBM math, Cholesky, price positivity, shock events |
| `test_simulator_source.py` | 10 | start/stop lifecycle, add/remove ticker |
| `test_factory.py` | 7 | Env var selection, returns correct type |
| `test_massive.py` | 13 | Polling, timestamp conversion, error handling, add/remove |

### Example Tests

```python
# test_cache.py — version counter
def test_version_increments_on_update():
    cache = PriceCache()
    assert cache.version == 0
    cache.update("AAPL", 190.0)
    assert cache.version == 1
    cache.update("AAPL", 191.0)
    assert cache.version == 2

# test_simulator.py — GBM price positivity
def test_prices_always_positive():
    sim = GBMSimulator(["TSLA"])
    for _ in range(1000):
        prices = sim.step()
        assert prices["TSLA"] > 0

# test_factory.py — env var selection
def test_selects_simulator_without_key(monkeypatch):
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    source = create_market_data_source(PriceCache())
    assert isinstance(source, SimulatorDataSource)

def test_selects_massive_with_key(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key-123")
    source = create_market_data_source(PriceCache())
    assert isinstance(source, MassiveDataSource)
```

### Running Tests

```bash
cd backend
uv run pytest tests/market/ -v
uv run pytest tests/market/ --cov=app/market --cov-report=term-missing
```

---

## 15. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Simulator step raises exception | Logged, loop continues — one bad tick is skipped |
| Massive poll fails (network, 401, 429) | Logged as error, loop retries on next interval |
| Malformed Massive snapshot (missing fields) | Logged as warning, that ticker skipped this poll |
| `add_ticker` called before `start()` | No-op (both sources check `self._sim is None` / `self._client is None`) |
| `remove_ticker` for unknown ticker | No-op in both implementations |
| SSE client disconnects | `_generate_events` detects via `request.is_disconnected()`, generator exits cleanly |
| Cholesky failure (bad correlation matrix) | Would raise `numpy.linalg.LinAlgError` — prevented by always using `np.eye(n)` as base (positive-definite) |
| First price for a ticker | `previous_price == price`, `direction == "flat"`, `change == 0` |
| `get_price()` for unknown ticker | Returns `None` — callers must handle |

---

## 16. Configuration Reference

| Environment Variable | Default | Effect |
|---------------------|---------|--------|
| `MASSIVE_API_KEY`   | _(empty)_ | If set and non-empty: use Massive/Polygon.io REST API. Otherwise: GBM simulator |
| `LLM_MOCK`          | `false` | If `true`: return deterministic mock LLM responses (no API call) |
| `OPENROUTER_API_KEY`| _(required)_ | API key for LiteLLM → OpenRouter for chat |

**Simulator tunables** (constants in `simulator.py`, not env vars):

| Parameter | Default | Effect |
|-----------|---------|--------|
| `update_interval` | `0.5s` | Tick rate |
| `event_probability` | `0.001` | Chance of shock event per ticker per tick |
| `DEFAULT_DT` | `~8.48e-8` | GBM time step (= 0.5s / trading seconds per year) |

**Massive tunables** (constructor params):

| Parameter | Default | Effect |
|-----------|---------|--------|
| `poll_interval` | `15.0s` | How often to call Polygon.io (set lower on paid tiers) |
