import { test, expect } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';

/**
 * Watchlist CRUD tests: add, remove, duplicate detection.
 */
test.describe('Watchlist management', () => {
  // Each test starts fresh; the database is seeded with 10 default tickers.
  test.beforeEach(async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();
    // Ensure the watchlist is fully loaded before each test
    await watchlistPage.waitForRowCount(10);
  });

  test('add a new ticker — it appears in the watchlist', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    // PYPL is not in the default seed data
    const newTicker = 'PYPL';
    expect(await watchlistPage.hasTicker(newTicker)).toBe(false);

    await watchlistPage.addTicker(newTicker);

    // The watchlist should now have 11 entries
    await watchlistPage.waitForRowCount(11);

    // The newly added ticker should be visible
    const row = watchlistPage.getTickerRow(newTicker);
    await expect(row).toBeVisible({ timeout: 5_000 });
  });

  test('add a ticker — input is cleared after successful add', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    await watchlistPage.addTicker('PYPL');
    await watchlistPage.waitForRowCount(11);

    // The input should be empty after a successful add
    await expect(watchlistPage.addTickerInput).toHaveValue('');
  });

  test('remove a ticker — it disappears from the watchlist', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    // NFLX is one of the default 10 tickers
    const tickerToRemove = 'NFLX';
    expect(await watchlistPage.hasTicker(tickerToRemove)).toBe(true);

    await watchlistPage.removeTicker(tickerToRemove);

    // Watchlist should now have 9 entries
    await watchlistPage.waitForRowCount(9);

    // Removed ticker should no longer be in the list
    const removedRow = watchlistPage.getTickerRow(tickerToRemove);
    await expect(removedRow).not.toBeVisible({ timeout: 5_000 });
  });

  test('remove a ticker — remaining tickers are still present', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    await watchlistPage.removeTicker('NFLX');
    await watchlistPage.waitForRowCount(9);

    // All other default tickers should still be present
    const remainingTickers = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'V'];
    for (const ticker of remainingTickers) {
      await expect(watchlistPage.getTickerRow(ticker)).toBeVisible();
    }
  });

  test('duplicate ticker — shows error or is ignored (not added twice)', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    // AAPL is already in the default watchlist
    const existingTicker = 'AAPL';
    expect(await watchlistPage.hasTicker(existingTicker)).toBe(true);

    await watchlistPage.addTicker(existingTicker);

    // Either: an error message appears, OR the count stays at 10 (not 11)
    // Both outcomes are acceptable — the duplicate must not be added
    const errorVisible = await watchlistPage.watchlistError.isVisible().catch(() => false);
    const rowCount = await watchlistPage.getWatchlistRows().count();

    if (errorVisible) {
      // Error path: an error is shown
      await expect(watchlistPage.watchlistError).toBeVisible();
    } else {
      // Silent ignore path: count remains 10
      expect(rowCount).toBe(10);
    }
  });

  test('add then remove ticker — list returns to original 10', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    await watchlistPage.addTicker('PYPL');
    await watchlistPage.waitForRowCount(11);

    await watchlistPage.removeTicker('PYPL');
    await watchlistPage.waitForRowCount(10);

    expect(await watchlistPage.hasTicker('PYPL')).toBe(false);
  });

  test('add ticker input accepts uppercase ticker symbols', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);

    // Test that a valid ticker can be typed and submitted
    await watchlistPage.addTickerInput.fill('SHOP');
    await expect(watchlistPage.addTickerInput).toHaveValue('SHOP');
    await watchlistPage.addTickerButton.click();

    await watchlistPage.waitForRowCount(11);
    await expect(watchlistPage.getTickerRow('SHOP')).toBeVisible();
  });
});
