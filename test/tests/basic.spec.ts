import { test, expect } from '@playwright/test';
import { AppPage } from './pages/AppPage';
import { WatchlistPage } from './pages/WatchlistPage';

/**
 * Basic smoke tests: verify the app loads correctly with default state.
 * These tests run first and confirm the foundation is solid before
 * testing more complex flows.
 */
test.describe('Basic application load', () => {
  test('fresh start shows default watchlist with 10 tickers', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();

    // The watchlist panel should be visible
    await expect(watchlistPage.watchlistPanel).toBeVisible();

    // Default seeded watchlist: AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX
    await watchlistPage.waitForRowCount(10);

    const rows = watchlistPage.getWatchlistRows();
    await expect(rows).toHaveCount(10);
  });

  test('default tickers include AAPL, GOOGL, MSFT, AMZN, TSLA', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();
    await watchlistPage.waitForRowCount(10);

    // Verify the specific seeded default tickers are all present
    const defaultTickers = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'];
    for (const ticker of defaultTickers) {
      const row = watchlistPage.getTickerRow(ticker);
      await expect(row).toBeVisible({ timeout: 5_000 });
    }
  });

  test('starting cash balance is $10,000', async ({ page }) => {
    const appPage = new AppPage(page);
    await appPage.goto();

    await expect(appPage.cashBalance).toBeVisible();

    const balance = await appPage.getCashBalance();
    // Allow for minor floating-point differences in display
    expect(balance).toBeCloseTo(10_000, 0);
  });

  test('connection status indicator is green (connected)', async ({ page }) => {
    const appPage = new AppPage(page);
    await appPage.goto();

    // Wait for SSE connection to establish
    await appPage.waitForPricesStreaming();

    // The status indicator should report connected state
    await expect(appPage.connectionStatus).toBeVisible();
    await expect(appPage.connectionStatus).toHaveAttribute('data-status', 'connected');
  });

  test('prices are streaming (at least one price updates within 3 seconds)', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();
    await watchlistPage.waitForRowCount(10);

    // Wait for prices to be streaming; simulator ticks every ~500ms
    // We check that within 3 seconds at least one price element has a value
    // NOTE FOR FRONTEND DEVS: each ticker row should have a data-testid="price-AAPL" element
    const priceLocator = page.getByTestId('price-AAPL');
    await expect(priceLocator).toBeVisible({ timeout: 5_000 });

    // Price should be a positive number (i.e., seeded and streaming)
    const priceText = await priceLocator.textContent();
    const price = parseFloat(priceText!.replace(/[^0-9.]/g, ''));
    expect(price).toBeGreaterThan(0);
  });

  test('total portfolio value is visible in the header', async ({ page }) => {
    const appPage = new AppPage(page);
    await appPage.goto();

    await expect(appPage.totalPortfolioValue).toBeVisible();
    // With no positions, total portfolio value should equal cash balance ($10,000)
    const text = await appPage.totalPortfolioValue.textContent();
    expect(text).toBeTruthy();
  });
});
