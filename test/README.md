# FinAlly E2E Tests

Playwright end-to-end test suite for the FinAlly AI trading workstation.
All tests run against the app with `LLM_MOCK=true` — no real LLM calls are made.

## Prerequisites

- Docker and Docker Compose (for running via docker-compose)
- Node.js 18+ and npm (for running locally against a running app)

## Running with Docker Compose (recommended)

This is the canonical way to run the full test suite. It builds the app and
runs the Playwright tests in isolated containers on the same network.

```bash
cd test/
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
```

The `playwright` container exits with the test result code, so
`--abort-on-container-exit` causes the whole compose to stop when tests finish.

To clean up volumes between runs:

```bash
docker compose -f docker-compose.test.yml down -v
```

## Running locally (against a running app)

If the app is already running locally (e.g. `docker run -p 8000:8000 ...`):

```bash
cd test/
npm install
npx playwright install chromium
npm test
```

By default, tests target `http://localhost:8000`. Override with:

```bash
BASE_URL=http://localhost:8000 npm test
```

## Running in CI

The `playwright.config.ts` sets `retries: 2` when `CI=true`, which helps
absorb transient timing issues in CI environments.

Example GitHub Actions step:

```yaml
- name: Run E2E tests
  run: |
    cd test
    docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
  env:
    CI: true
```

## Test structure

```
test/
  docker-compose.test.yml   # Compose file: app + playwright containers
  package.json              # Playwright dependency
  playwright.config.ts      # Config: baseURL, timeout, retries
  tests/
    pages/                  # Page Object Model classes
      AppPage.ts            # Base page (header elements)
      WatchlistPage.ts      # Watchlist CRUD interactions
      TradingPage.ts        # Buy/sell trade interactions
      ChatPage.ts           # AI chat panel interactions
      PortfolioPage.ts      # Heatmap, P&L chart, positions table
    basic.spec.ts           # Smoke tests: app loads, default state
    watchlist.spec.ts       # Add/remove/duplicate ticker tests
    trading.spec.ts         # Buy/sell execution, error handling
    chat.spec.ts            # Chat message flow, loading indicator
    portfolio.spec.ts       # Heatmap, P&L chart, positions table
```

## Frontend data-testid requirements

The tests rely on `data-testid` attributes on frontend elements. All required
attributes are documented as comments at the top of each Page Object file in
`tests/pages/`. The frontend must add these attributes for tests to pass.

Key attributes include:

| Attribute | Element |
|---|---|
| `data-testid="connection-status"` | Connection status dot in header |
| `data-testid="cash-balance"` | Cash balance display in header |
| `data-testid="total-portfolio-value"` | Total portfolio value in header |
| `data-testid="watchlist-panel"` | Watchlist container |
| `data-testid="watchlist-row"` | Each watchlist row |
| `data-testid="watchlist-ticker-{TICKER}"` | Individual ticker row |
| `data-testid="add-ticker-input"` | Ticker add input field |
| `data-testid="add-ticker-button"` | Ticker add submit button |
| `data-testid="remove-ticker-{TICKER}"` | Per-ticker remove button |
| `data-testid="trade-ticker-input"` | Trade bar ticker input |
| `data-testid="trade-quantity-input"` | Trade bar quantity input |
| `data-testid="trade-buy-button"` | Buy button |
| `data-testid="trade-sell-button"` | Sell button |
| `data-testid="trade-error"` | Trade error message |
| `data-testid="trade-success"` | Trade success message |
| `data-testid="position-row"` | Each positions table row |
| `data-testid="position-row-{TICKER}"` | Per-ticker position row |
| `data-testid="position-quantity-{TICKER}"` | Quantity cell |
| `data-testid="position-pnl-{TICKER}"` | Unrealized P&L cell |
| `data-testid="position-avgcost-{TICKER}"` | Avg cost cell |
| `data-testid="portfolio-heatmap"` | Heatmap container |
| `data-testid="heatmap-tile"` | Each heatmap tile |
| `data-testid="heatmap-tile-{TICKER}"` | Per-ticker heatmap tile |
| `data-testid="pnl-chart"` | P&L chart container |
| `data-testid="pnl-chart-canvas"` | Chart canvas/SVG when data is present |
| `data-testid="chat-panel"` | Chat panel container |
| `data-testid="chat-message-input"` | Chat text input |
| `data-testid="chat-send-button"` | Chat send button |
| `data-testid="chat-message"` | Each message bubble |
| `data-testid="chat-message-user"` | User message bubble |
| `data-testid="chat-message-assistant"` | Assistant message bubble |
| `data-testid="chat-loading"` | Loading indicator |
| `data-testid="chat-action"` | Inline trade/watchlist confirmation |
| `data-testid="price-{TICKER}"` | Live price display per ticker |

Heatmap tiles should also have a `data-pnl="positive|negative|neutral"` attribute
for the color tests, and the connection status dot should have `data-status="connected|reconnecting|disconnected"`.
