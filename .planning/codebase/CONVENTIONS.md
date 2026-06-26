# Coding Conventions

**Analysis Date:** 2026-06-26

## Naming Patterns

**Files:**
- Lowercase with underscores: `models.py`, `market_data_demo.py`, `test_simulator.py`
- Test files: `test_*.py` (pytest naming convention)

**Functions:**
- snake_case: `create_market_data_source()`, `get_price()`, `update_cache()`
- Private functions: Prefix with underscore: `_add_ticker_internal()`, `_rebuild_cholesky()`, `_poll_loop()`
- Static methods: Lowercase snake_case: `_pairwise_correlation()`

**Variables:**
- snake_case for all variables: `api_key`, `cache`, `tickers`, `event_probability`
- Private attributes: Prefix with underscore: `self._prices`, `self._tickers`, `self._version`
- Constants: UPPERCASE: `TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600`, `DEFAULT_DT`, `SEED_PRICES`

**Types:**
- PascalCase for classes: `PriceUpdate`, `PriceCache`, `MarketDataSource`, `GBMSimulator`
- Abstract base classes use ABC: `class MarketDataSource(ABC)`

## Code Style

**Formatting:**
- Tool: ruff (built-in formatter)
- Line length: 100 characters (`tool.ruff.line-length = 100`)
- Import sorting: Handled by ruff linter

**Linting:**
- Tool: ruff (check and lint)
- Selected rules: `E`, `F`, `I`, `N`, `W` (errors, pyflakes, isort, naming, warnings)
- Ignored: `E501` (line too long, handled by formatter)
- Target version: Python 3.12+ (`target-version = "py312"`)

## Import Organization

**Order:**
1. Future imports: `from __future__ import annotations`
2. Standard library: `import time`, `from threading import Lock`, `import asyncio`
3. Third-party: `import numpy as np`, `from fastapi import APIRouter`, `from massive import RESTClient`
4. Local/relative: `from .models import PriceUpdate`, `from .cache import PriceCache`

**Path Aliases:**
- Not used; relative imports preferred for same-package imports

**Import style:**
- Use relative imports within modules: `from .cache import PriceCache`
- Import classes/functions by name, not modules: `from app.market import PriceUpdate` (not `from app import market`)
- Sorted alphabetically within each group

## Type Hints

**Pattern:** Use modern Python 3.12+ syntax throughout

```python
# Good: modern syntax
def get_price(self, ticker: str) -> float | None:
    return self._prices.get(ticker)

# Parameters with defaults
def __init__(self, dt: float = DEFAULT_DT, event_probability: float = 0.001) -> None:
    pass

# Generic types with modern syntax
self._prices: dict[str, PriceUpdate] = {}
self._tickers: list[str] = []
snapshots: list[...] | None = None
```

**Required for:**
- All function parameters and return types
- Class attributes in `__init__`
- Property return types

## Module Structure

**Module docstrings:** Required, in triple-quote format with public API description

```python
"""Market data subsystem for FinAlly.

Public API:
    PriceUpdate         - Immutable price snapshot dataclass
    PriceCache          - Thread-safe in-memory price store
"""
```

**Exports:**
- Use `__all__` list to define public API: `__all__ = ["PriceUpdate", "PriceCache", ...]`
- Barrel files export only public classes/functions

**Organization:**
- Module docstring at top
- Imports
- Constants (UPPERCASE)
- Classes
- Functions
- Private helpers

## Class Design

**Dataclasses:**
- Use `@dataclass(frozen=True, slots=True)` for immutable value objects like `PriceUpdate`
- Provides frozen semantics (immutability) and memory efficiency via slots

**Interfaces:**
- Use `ABC` (Abstract Base Class) for defining contracts
- Use `@abstractmethod` decorator for required methods
- Detailed docstrings explaining lifecycle and contracts

```python
class MarketDataSource(ABC):
    """Contract for market data providers."""
    
    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Begin producing price updates..."""
```

**Dunder methods:**
- Implement `__len__()`, `__contains__()`, `__repr__()` as needed
- Used for standard Python behavior: `len(cache)`, `"AAPL" in cache`

**Properties:**
- Use `@property` for computed read-only values
- Example: `change_percent` calculated from `price` and `previous_price`
- Include docstrings for properties

## Docstrings

**Format:** Triple-quote docstrings ("""), no raw strings

**Class docstrings:**
```python
class PriceCache:
    """Thread-safe in-memory cache of the latest price for each ticker.

    Writers: SimulatorDataSource or MassiveDataSource (one at a time).
    Readers: SSE streaming endpoint, portfolio valuation, trade execution.
    """
```

**Function/method docstrings:**
```python
def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
    """Record a new price for a ticker. Returns the created PriceUpdate.

    Automatically computes direction and change from the previous price.
    If this is the first update for the ticker, previous_price == price (direction='flat').
    """
```

**Lifecycle documentation:**
- Include in docstrings for complex classes:
  ```
  Lifecycle:
      source = create_market_data_source(cache)
      await source.start(["AAPL", "GOOGL", ...])
      # ... app runs ...
      await source.stop()
  ```

## Error Handling

**Patterns:**

1. **Specific exception types:** Catch specific exceptions, not broad Exception
```python
try:
    price = snap.last_trade.price
except (AttributeError, TypeError) as e:
    logger.warning("Skipping snapshot: %s", e)
```

2. **Exception resilience in background tasks:** Don't re-raise from loops
```python
async def _run_loop(self) -> None:
    while True:
        try:
            # Do work
        except Exception:
            logger.exception("Step failed")  # Log with stacktrace
        await asyncio.sleep(self._interval)  # Continue despite errors
```

3. **Asyncio cancellation:** Handle CancelledError explicitly
```python
async def stop(self) -> None:
    if self._task and not self._task.done():
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
```

4. **Optional attribute access:** Use getattr() with fallback for external data
```python
logger.warning("Error for %s", getattr(snap, "ticker", "???"))
```

## Logging

**Framework:** Python's built-in `logging` module

**Pattern:**
```python
import logging
logger = logging.getLogger(__name__)
```

**Levels by use:**
- `logger.info()` - Lifecycle events (start, stop, add/remove ticker)
- `logger.debug()` - Detailed step-by-step information (simulator events, poll counts)
- `logger.warning()` - Recoverable issues (skipped snapshot, malformed data)
- `logger.error()` - Significant failures (API errors)
- `logger.exception()` - Exceptions with stacktrace in catch blocks

**Examples:**
```python
logger.info("Simulator started with %d tickers", len(tickers))
logger.debug("GBM event on %s: %.1f%% %s", ticker, magnitude * 100, direction)
logger.warning("Skipping snapshot for %s: %s", snap.ticker, e)
logger.error("Massive poll failed: %s", e)
logger.exception("Simulator step failed")  # In except block
```

## Async Patterns

**I/O operations:** Use `async def` and `await`
```python
async def start(self, tickers: list[str]) -> None:
    self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")

async def stop(self) -> None:
    await self._task
```

**Background tasks:** Create with `asyncio.create_task()`, name for debugging
```python
self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")
```

**Synchronous calls in async context:** Use `asyncio.to_thread()` to avoid blocking
```python
snapshots = await asyncio.to_thread(self._fetch_snapshots)
```

## Thread Safety

**Pattern:** Use `Lock` for synchronizing access to mutable shared state
```python
from threading import Lock

class PriceCache:
    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()

    def update(self, ticker: str, price: float) -> PriceUpdate:
        with self._lock:
            # Safe access to _prices
            self._prices[ticker] = update
            return update
```

## Comments

**When to comment:**
- Complex algorithms: GBM math explanation, Cholesky decomposition
- Non-obvious implementation details: Why asyncio.to_thread() is used, correlation structure
- Workarounds and gotchas: "Massive timestamps are Unix milliseconds → convert to seconds"
- Avoid: Obvious comments like "increment i" or "return the result"

**Style:**
- Use `#` for inline comments on same line or preceding line
- Use docstrings for function/class documentation, not comments
- Comments above the code they explain

## Serialization

**Pattern:** Implement `to_dict()` method for JSON serialization
```python
def to_dict(self) -> dict:
    """Serialize for JSON / SSE transmission."""
    return {
        "ticker": self.ticker,
        "price": self.price,
        "change": self.change,
        "direction": self.direction,
    }
```

## Example Module Structure

`app/market/cache.py` shows the canonical structure:

1. Module docstring
2. Future annotations import
3. Standard library imports (sorted)
4. Third-party imports
5. Local imports
6. Module-level logger
7. Class definitions with full docstrings
8. Methods organized: public API, then private helpers

---

*Convention analysis: 2026-06-26*
