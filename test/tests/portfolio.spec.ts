import { test, expect } from '@playwright/test';
import { PortfolioPage } from './pages/PortfolioPage';
import { TradingPage } from './pages/TradingPage';

/**
 * Portfolio visualization tests: heatmap, P&L chart, positions table.
 *
 * Most tests require at least one open position, so they buy shares first.
 */
test.describe('Portfolio heatmap', () => {
  test('heatmap is not visible (or empty) when no positions exist', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    await portfolioPage.goto();

    // With no positions, the heatmap either:
    // a) Is hidden entirely
    // b) Shows an empty state message
    // Either is acceptable; it must NOT render tiles for non-existent positions.
    const tileCount = await portfolioPage.getHeatmapTiles().count();
    expect(tileCount).toBe(0);
  });

  test('heatmap renders a tile after buying a position', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    // Buy AAPL shares to create a position
    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    // Heatmap should now have at least one tile
    await portfolioPage.waitForHeatmapToRender();
    await expect(portfolioPage.getHeatmapTile('AAPL')).toBeVisible({ timeout: 5_000 });
  });

  test('heatmap shows tiles for all positions', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    // Buy two different positions
    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await tradingPage.buyShares('MSFT', 3);
    await tradingPage.waitForTradeSuccess();

    // Both should appear in the heatmap
    await expect(portfolioPage.getHeatmapTile('AAPL')).toBeVisible({ timeout: 5_000 });
    await expect(portfolioPage.getHeatmapTile('MSFT')).toBeVisible({ timeout: 5_000 });
  });

  test('heatmap tile has a color attribute indicating P&L direction', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getHeatmapTile('AAPL')).toBeVisible({ timeout: 5_000 });

    // NOTE FOR FRONTEND DEVS: heatmap tiles should have data-pnl="positive"|"negative"|"neutral"
    // to enable CSS coloring and this assertion
    const tile = portfolioPage.getHeatmapTile('AAPL');
    const pnlAttr = await tile.getAttribute('data-pnl');
    // The attribute should be present and one of the valid values
    expect(['positive', 'negative', 'neutral']).toContain(pnlAttr);
  });
});

test.describe('P&L chart', () => {
  test('P&L chart container is visible on page load', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    await portfolioPage.goto();

    await portfolioPage.waitForPnlChart();
    await expect(portfolioPage.pnlChart).toBeVisible();
  });

  test('P&L chart has data points after app has been running', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    await portfolioPage.goto();

    await portfolioPage.waitForPnlChart();

    // NOTE FOR FRONTEND DEVS: the P&L chart canvas or SVG element should have
    // data-testid="pnl-chart-canvas" when it has rendered chart data (not just the empty container)
    // Alternatively, data-has-data="true" attribute when snapshot data is available
    const chartCanvas = page.getByTestId('pnl-chart-canvas');
    // The chart canvas/SVG should be present once the component has mounted
    await expect(chartCanvas).toBeVisible({ timeout: 10_000 });
  });

  test('P&L chart updates after executing a trade', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();
    await portfolioPage.waitForPnlChart();

    // Execute a trade — this should immediately record a portfolio snapshot
    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    // Chart container should still be visible and showing updated data
    await expect(portfolioPage.pnlChart).toBeVisible();
  });
});

test.describe('Positions table', () => {
  test('positions table is empty when no trades have been made', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    await portfolioPage.goto();

    // Table should be present but contain no position rows
    const rows = portfolioPage.getPositionRows();
    await expect(rows).toHaveCount(0, { timeout: 5_000 });
  });

  test('positions table shows a row after buying shares', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 10);
    await tradingPage.waitForTradeSuccess();

    // AAPL row should appear
    await expect(portfolioPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });
  });

  test('positions table shows correct quantity', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 7);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    // NOTE FOR FRONTEND DEVS: data-testid="position-quantity-AAPL" should show the share count
    const quantityLocator = page.getByTestId('position-quantity-AAPL');
    await expect(quantityLocator).toContainText('7');
  });

  test('positions table shows avg cost per share', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    const avgCost = portfolioPage.getPositionAvgCost('AAPL');
    await expect(avgCost).toBeVisible();

    // Avg cost should be a positive dollar value
    const text = await avgCost.textContent();
    const value = parseFloat(text!.replace(/[^0-9.]/g, ''));
    expect(value).toBeGreaterThan(0);
  });

  test('positions table shows unrealized P&L', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    // P&L element should be visible and have a numeric value
    const pnlLocator = portfolioPage.getPositionPnl('AAPL');
    await expect(pnlLocator).toBeVisible();

    const text = await pnlLocator.textContent();
    // Should contain a number (positive or negative, with $ sign)
    expect(text).toMatch(/[\d.]+/);
  });

  test('positions table row is removed after selling all shares', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getPositionRow('AAPL')).toBeVisible({ timeout: 5_000 });

    await tradingPage.sellShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await expect(portfolioPage.getPositionRow('AAPL')).not.toBeVisible({ timeout: 5_000 });
  });

  test('positions table shows multiple positions', async ({ page }) => {
    const tradingPage = new TradingPage(page);
    const portfolioPage = new PortfolioPage(page);

    await portfolioPage.goto();
    await portfolioPage.waitForPricesStreaming();

    await tradingPage.buyShares('AAPL', 5);
    await tradingPage.waitForTradeSuccess();

    await tradingPage.buyShares('GOOGL', 2);
    await tradingPage.waitForTradeSuccess();

    const rows = portfolioPage.getPositionRows();
    await expect(rows).toHaveCount(2, { timeout: 5_000 });
  });
});
