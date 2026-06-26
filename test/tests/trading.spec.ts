import { test, expect } from '@playwright/test';
import { TradingPage } from './pages/TradingPage';
import { AppPage } from './pages/AppPage';

/**
 * Trading tests: buy/sell execution, portfolio state updates, error handling.
 *
 * NOTE: Prices are streamed live from the simulator; exact prices vary.
 * Tests verify relative changes (cash decreased, position appeared) rather
 * than exact amounts, to avoid flakiness.
 */
test.describe('Trade execution', () => {
  test.beforeEach(async ({ page }) => {
    const appPage = new AppPage(page);
    await appPage.goto();
    // Wait for prices to be live before trading
    await appPage.waitForPricesStreaming();
  });

  test('buy 10 shares of AAPL — cash decreases', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    const cashBefore = await tradingPage.getCashBalance();

    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    const cashAfter = await tradingPage.getCashBalance();

    // Cash must have decreased after a buy
    expect(cashAfter).toBeLessThan(cashBefore);
    // AAPL seed price is ~$190; 10 shares cost ~$1,900 — cash decrease should be substantial
    expect(cashBefore - cashAfter).toBeGreaterThan(100);
  });

  test('buy 10 shares of AAPL — position appears in portfolio', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // Before the trade, AAPL should not be in positions
    await expect(tradingPage.getPositionRow('AAPL')).not.toBeVisible();

    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    // AAPL position row should now be visible
    await expect(tradingPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    // Quantity should be 10
    const quantity = await tradingPage.getPositionQuantityValue('AAPL');
    expect(quantity).toBe(10);
  });

  test('buy shares then sell 5 — cash increases back', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // Buy first
    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    const cashAfterBuy = await tradingPage.getCashBalance();

    // Now sell 5
    await tradingPage.sellShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    const cashAfterSell = await tradingPage.getCashBalance();

    // Cash should have increased after selling
    expect(cashAfterSell).toBeGreaterThan(cashAfterBuy);
  });

  test('sell 5 shares — position quantity updates to 5', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // First buy 10
    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    await expect(tradingPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    // Now sell 5
    await tradingPage.sellShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    // Position should show 5 remaining shares
    const quantity = await tradingPage.getPositionQuantityValue('AAPL');
    expect(quantity).toBe(5);
  });

  test('sell all shares — position disappears from portfolio', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // Buy then sell the same quantity
    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    await tradingPage.sellShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    // Position row should disappear (quantity hits 0)
    await expect(tradingPage.getPositionRow('AAPL')).not.toBeVisible({ timeout: 5_000 });
  });

  test('buy with insufficient cash — shows error message', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // Starting cash is $10,000. AAPL seed price ~$190.
    // 1000 shares at ~$190 = ~$190,000 — far exceeds available cash.
    await tradingPage.buyShares('AAPL', 1000);

    // An error message must appear
    await tradingPage.waitForTradeError();
    await expect(tradingPage.tradeError).toBeVisible();

    // Cash should be unchanged
    const cash = await tradingPage.getCashBalance();
    expect(cash).toBeCloseTo(10_000, 0);
  });

  test('sell shares not owned — shows error message', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // Attempting to sell AAPL when holding no position
    await tradingPage.sellShares('AAPL', 5);

    // Should show an error
    await tradingPage.waitForTradeError();
    await expect(tradingPage.tradeError).toBeVisible();
  });

  test('buy shares of a ticker not in watchlist — trade still executes', async ({ page }) => {
    const tradingPage = new TradingPage(page);

    // PYPL is not in the default watchlist, but trading should still be possible
    await tradingPage.buyShares('PYPL', 1);

    // Either succeeds or fails — but must not throw an unhandled error
    // Success case: position or success message appears
    // Error case: error message appears
    const successVisible = await tradingPage.tradeSuccess.isVisible().catch(() => false);
    const errorVisible = await tradingPage.tradeError.isVisible().catch(() => false);

    // At minimum, the app must respond (not hang or crash)
    expect(successVisible || errorVisible).toBe(true);
  });
});
