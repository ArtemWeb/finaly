import { Page, Locator, expect } from '@playwright/test';
import { AppPage } from './AppPage';

/**
 * Page object for portfolio visualization interactions.
 *
 * NOTE FOR FRONTEND DEVS: Required data-testid attributes:
 * - data-testid="portfolio-heatmap"      — the treemap/heatmap container
 * - data-testid="heatmap-tile"           — each position tile in the heatmap (multiple)
 * - data-testid="heatmap-tile-AAPL"      — heatmap tile keyed by ticker
 * - data-testid="pnl-chart"             — the P&L line chart container
 * - data-testid="positions-table"        — the positions table container
 * - data-testid="position-row"           — each row in the positions table (multiple)
 * - data-testid="position-row-AAPL"      — position row keyed by ticker
 * - data-testid="position-pnl-AAPL"      — unrealized P&L cell for a ticker
 * - data-testid="position-avgcost-AAPL"  — avg cost cell for a ticker
 * - data-testid="position-current-AAPL"  — current price cell for a ticker
 */
export class PortfolioPage extends AppPage {
  readonly portfolioHeatmap: Locator;
  readonly pnlChart: Locator;
  readonly positionsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.portfolioHeatmap = page.getByTestId('portfolio-heatmap');
    this.pnlChart = page.getByTestId('pnl-chart');
    this.positionsTable = page.getByTestId('positions-table');
  }

  /** Returns all heatmap tiles currently rendered. */
  getHeatmapTiles(): Locator {
    return this.page.getByTestId('heatmap-tile');
  }

  /** Returns the heatmap tile for a specific ticker. */
  getHeatmapTile(ticker: string): Locator {
    return this.page.getByTestId(`heatmap-tile-${ticker}`);
  }

  /** Returns all position rows in the positions table. */
  getPositionRows(): Locator {
    return this.page.getByTestId('position-row');
  }

  /** Returns the position row for a specific ticker. */
  getPositionRow(ticker: string): Locator {
    return this.page.getByTestId(`position-row-${ticker}`);
  }

  /** Returns the P&L cell for a specific ticker in the positions table. */
  getPositionPnl(ticker: string): Locator {
    return this.page.getByTestId(`position-pnl-${ticker}`);
  }

  /** Returns the average cost cell for a specific ticker. */
  getPositionAvgCost(ticker: string): Locator {
    return this.page.getByTestId(`position-avgcost-${ticker}`);
  }

  /** Waits for the heatmap to render at least one tile. */
  async waitForHeatmapToRender(timeout = 10_000) {
    await expect(this.portfolioHeatmap).toBeVisible({ timeout });
    await expect(this.getHeatmapTiles().first()).toBeVisible({ timeout });
  }

  /** Waits for the P&L chart container to be visible. */
  async waitForPnlChart(timeout = 10_000) {
    await expect(this.pnlChart).toBeVisible({ timeout });
  }

  /**
   * Reads P&L text for a ticker and returns as number.
   * Handles both positive ("$12.50") and negative ("-$12.50") formats.
   */
  async getPositionPnlValue(ticker: string): Promise<number> {
    const text = await this.getPositionPnl(ticker).textContent();
    const sign = text!.includes('-') ? -1 : 1;
    const magnitude = parseFloat(text!.replace(/[^0-9.]/g, ''));
    return sign * magnitude;
  }
}
