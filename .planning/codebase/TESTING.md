# Testing Patterns

**Analysis Date:** 2026-06-26

## Test Framework

**Runner:**
- pytest 8.3.0+
- Config: `backend/pyproject.toml` ([tool.pytest.ini_options])

**Async Support:**
- pytest-asyncio 0.24.0+
- Config: `asyncio_mode = "auto"`, `asyncio_default_fixture_loop_scope = "function"`

**Assertion Library:**
- pytest's built-in assertions

**Run Commands:**
```bash
uv run --extra dev pytest -v              # All tests
uv run --extra dev pytest --cov=app       # With coverage report
uv run --extra dev pytest -v tests/       # Specific directory
uv run --extra dev pytest -v tests/market/test_cache.py  # Specific file
uv run --extra dev ruff check app/ tests/ # Lint check
```

**Coverage:**
- Target: Source in `app/` directory
- Exclude: `tests/*` directory
- Exclude patterns in report: pragma comments, __repr__, __main__, TYPE_CHECKING
- Tool: pytest-cov

## Test File Organization

**Location:**
- Test files mirror source structure in `backend/tests/` directory
- `backend/app/market/cache.py` → `backend/tests/market/test_cache.py`
- Co-located by feature, not by test type

**Naming:**
- Files: `test_*.py`
- Classes: `Test*` (e.g., `TestPriceCache`)
- Methods: `test_*` (e.g., `test_update_and_get`)

**Structure:**
```
backend/tests/
├── conftest.py                  # Shared fixtures
├── market/
│   ├── __init__.py
│   ├── test_cache.py
│   ├── test_models.py
│   ├── test_simulator.py
│   ├── test_simulator_source.py  # Async integration tests
│   ├── test_factory.py
│   └── test_massive.py
```

## Test Class Organization

**Pattern:** One test class per component
```python
class TestPriceUpdate:
    """Unit tests for the PriceUpdate model."""
    
    def test_price_update_creation(self):
        """Test basic PriceUpdate creation."""
        update = PriceUpdate(...)
        assert update.ticker == "AAPL"

    def test_change_calculation(self):
        """Test price change calculation."""
        # Arrange
        update = PriceUpdate(...)
        # Act & Assert
        assert update.change == 0.50
```

**Fixture setup:**
- Minimal per-method setup (preferred for isolation)
- Example: `cache = PriceCache()` at method start
- No class-level fixtures (pytest re-creates per test for isolation)

**Docstrings:**
- Describe the specific behavior being tested, not just the test name
- Use present tense: "Test that X does Y"

## Unit Test Patterns

**Basic unit test structure:**

```python
def test_update_and_get(self):
    """Test updating and getting a price."""
    # Arrange
    cache = PriceCache()
    
    # Act
    update = cache.update("AAPL", 190.50)
    result = cache.get("AAPL")
    
    # Assert
    assert result == update
    assert result.ticker == "AAPL"
    assert result.price == 190.50
```

**Edge case testing:**
- Test boundary values: zero, negative, max, min
- Test first/last operations: "Test that the first update has flat direction"
- Test empty/null cases: "Test removing a ticker that doesn't exist"
- Test immutability: `with pytest.raises(AttributeError): update.price = 200`

**Testing computed properties:**
```python
def test_direction_up(self):
    """Test direction calculation (up)."""
    update = PriceUpdate(ticker="AAPL", price=191.00, previous_price=190.00, ...)
    assert update.direction == "up"

def test_direction_down(self):
    """Test direction calculation (down)."""
    update = PriceUpdate(ticker="AAPL", price=189.00, previous_price=190.00, ...)
    assert update.direction == "down"

def test_direction_flat(self):
    """Test direction calculation (flat)."""
    update = PriceUpdate(ticker="AAPL", price=190.00, previous_price=190.00, ...)
    assert update.direction == "flat"
```

**Testing serialization:**
```python
def test_to_dict(self):
    """Test serialization to dictionary."""
    update = PriceUpdate(ticker="AAPL", price=190.50, previous_price=190.00, ...)
    result = update.to_dict()

    assert result["ticker"] == "AAPL"
    assert result["price"] == 190.50
    assert result["change"] == 0.50
    assert "direction" in result
```

## Async Test Patterns

**Marking async tests:**
```python
@pytest.mark.asyncio
class TestSimulatorDataSource:
    """Integration tests for the SimulatorDataSource."""

    async def test_start_populates_cache(self):
        """Test that start() immediately populates the cache."""
        cache = PriceCache()
        source = SimulatorDataSource(price_cache=cache, update_interval=0.1)
        await source.start(["AAPL", "GOOGL"])

        assert cache.get("AAPL") is not None
        assert cache.get("GOOGL") is not None

        await source.stop()
```

**Async cleanup pattern:**
- Always call `await source.stop()` at end of test
- Handles cleanup of background tasks and resources
- Prevents resource leaks between tests

**Async timing tests:**
```python
async def test_prices_update_over_time(self):
    """Test that prices are updated periodically."""
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)
    await source.start(["AAPL"])

    initial_version = cache.version
    await asyncio.sleep(0.3)  # Several update cycles

    # Version should have incremented (prices updated)
    assert cache.version > initial_version

    await source.stop()
```

**Pattern:**
- Record state before operation (initial_version)
- Allow time for async operations with `await asyncio.sleep(interval)`
- Verify state changed after operation

**Idempotency testing:**
```python
async def test_stop_is_clean(self):
    """Test that stop() is clean and idempotent."""
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.1)
    await source.start(["AAPL"])
    await source.stop()
    # Double stop should not raise
    await source.stop()
```

## Mocking

**Framework:** `unittest.mock` (Python standard library)

**Mocking environment variables:**
```python
from unittest.mock import patch

def test_creates_simulator_when_no_api_key(self):
    """Test that simulator is created when MASSIVE_API_KEY is not set."""
    cache = PriceCache()

    with patch.dict(os.environ, {}, clear=True):
        source = create_market_data_source(cache)

    assert isinstance(source, SimulatorDataSource)
```

**Pattern:** `patch.dict(os.environ, {...}, clear=True)`
- `clear=True` removes all other env vars (test isolation)
- Set specific vars needed for test

**Testing dependency injection:**
```python
def test_simulator_receives_cache(self):
    """Test that simulator receives the cache reference."""
    cache = PriceCache()

    with patch.dict(os.environ, {}, clear=True):
        source = create_market_data_source(cache)

    assert isinstance(source, SimulatorDataSource)
    assert source._cache is cache  # Verify dependency passed correctly
```

**What to mock:**
- Environment variables for configuration
- External APIs (Massive client in factory pattern)
- Singletons or shared state

**What NOT to mock:**
- The code being tested
- Pure functions without side effects
- Data structures (use real instances)

## Fixtures

**Shared fixtures:** In `backend/tests/conftest.py`

```python
@pytest.fixture
def event_loop_policy():
    """Use the default event loop policy for all async tests."""
    import asyncio
    return asyncio.DefaultEventLoopPolicy()
```

**Creating fixtures for reuse:**
- Currently minimal; tests create objects locally for isolation
- Add to conftest.py if multiple tests need same setup
- Example: `@pytest.fixture def price_cache(): return PriceCache()`

**Fixture scope:**
- Default: `function` scope (new instance per test)
- Ensures test isolation and no state sharing

## Test Coverage

**Target:** 80%+ of application code

**Run coverage:**
```bash
uv run --extra dev pytest --cov=app --cov-report=html
```

**Exclude from coverage:**
- `pragma: no cover` comments for untestable code
- `__repr__()` methods (display-only)
- `if __name__ == '__main__':` blocks
- `if TYPE_CHECKING:` type-only imports

**Coverage gaps:**
- Exception handling in background tasks (tested via logs, hard to verify exception paths)
- Network failures (would need mock of async networking, more complex)

## Testing Patterns by Type

### Synchronous Unit Tests

**Example:** `test_cache.py` - Testing PriceCache operations
```python
def test_version_increments(self):
    """Test that version counter increments."""
    cache = PriceCache()
    v0 = cache.version
    cache.update("AAPL", 190.00)
    assert cache.version == v0 + 1
    cache.update("AAPL", 191.00)
    assert cache.version == v0 + 2
```

### Stateful Unit Tests

**Example:** `test_simulator.py` - Testing GBMSimulator state changes
```python
def test_add_ticker(self):
    """Test adding a ticker dynamically."""
    sim = GBMSimulator(tickers=["AAPL"])
    sim.add_ticker("TSLA")
    result = sim.step()
    assert "TSLA" in result

def test_prices_change_over_time(self):
    """After many steps, prices should have drifted from their seeds."""
    sim = GBMSimulator(tickers=["AAPL"])
    initial_price = sim.get_price("AAPL")

    for _ in range(1000):
        sim.step()

    final_price = sim.get_price("AAPL")
    assert final_price != initial_price
```

**Pattern:** Run 1000+ iterations for probabilistic code to detect invariant violations

### Integration Tests (Async)

**Example:** `test_simulator_source.py` - Testing SimulatorDataSource with background task
```python
@pytest.mark.asyncio
async def test_prices_update_over_time(self):
    """Test that prices are updated periodically."""
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)
    await source.start(["AAPL"])

    initial_version = cache.version
    await asyncio.sleep(0.3)  # Several update cycles
    assert cache.version > initial_version

    await source.stop()
```

### Factory Tests (with Mocking)

**Example:** `test_factory.py` - Testing create_market_data_source()
```python
def test_creates_simulator_when_api_key_empty(self):
    """Test that simulator is created when MASSIVE_API_KEY is empty."""
    cache = PriceCache()

    with patch.dict(os.environ, {"MASSIVE_API_KEY": ""}, clear=True):
        source = create_market_data_source(cache)

    assert isinstance(source, SimulatorDataSource)
```

## Testing Strategy by Component

**Data Models (`models.py`):**
- Test all properties (change, change_percent, direction)
- Test serialization (to_dict())
- Test immutability constraints
- Edge cases: zero values, boundary conditions

**State Managers (`cache.py`):**
- Test get/set operations
- Test concurrent access doesn't corrupt state
- Test helper methods (__len__, __contains__)
- Test edge cases: first update, remove nonexistent, etc.

**Algorithms (`simulator.py`):**
- Test invariants (prices always positive for GBM)
- Test statistical properties over many iterations
- Test state transitions (add/remove ticker)
- Test special cases (single ticker, empty set)

**Async Data Sources (`simulator_source.py`):**
- Test lifecycle (start → wait → stop)
- Test background task produces updates
- Test idempotency (double stop should be safe)
- Test dynamic modification (add/remove ticker)

**Factories (`factory.py`):**
- Test all branches (each env var combination)
- Test dependencies are passed correctly
- Mock external dependencies

## Assertion Patterns

**Equality testing:**
```python
assert result == expected
assert cache.get("AAPL") == update
```

**Type testing:**
```python
assert isinstance(source, SimulatorDataSource)
```

**Membership testing:**
```python
assert "AAPL" in cache
assert set(result.keys()) == {"AAPL", "GOOGL"}
```

**Exception testing:**
```python
with pytest.raises(AttributeError):
    update.price = 200.00  # Should raise error
```

**Truthiness testing:**
```python
assert cache.get("UNKNOWN") is None
assert len(cache) == 0
```

**Comparison testing:**
```python
assert cache.version > initial_version
assert 0 < GBMSimulator.DEFAULT_DT < 0.0001
assert price > 0  # GBM prices always positive
```

---

*Testing analysis: 2026-06-26*
