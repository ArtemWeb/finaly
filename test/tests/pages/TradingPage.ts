import { Page, Locator, expect } from '@playwright/test';
import { AppPage } from './AppPage';

/**
 * Page object for trade execution interactions.
 *
 * NOTE FOR FRONTEND DEVS: Required data-testid attributes:
 * - data-testid="trade-ticker-input"     — ticker symbol input in the trade bar
 * - data-testid="trade-quantity-input"   — quantity input in the trade bar
 * - data-testid="trade-buy-button"       — Buy button
 * - data-testid="trade-sell-button"      — Sell button
 * - data-testid="trade-error"            — error message shown on failed trades (insufficient cash, etc.)
 * - data-testid="trade-success"          — success/confirmation message after a trade
 * - data-testid="positions-table"        — the positions table container
 * - data-testid="position-row"           — each row in the positions table (multiple)
 * - data-testid="position-row-AAPL"      — position row keyed by ticker
 * - data-testid="position-quantity-AAPL" — the quantity cell for a ticker position
 */
export class TradingPage extends AppPage {
  readonly tradeTickerInput: Locator;
  readonly tradeQuantityInput: Locator;
  readonly tradeBuyButton: Locator;
  readonly tradeSellButton: Locator;
  readonly tradeError: Locator;
  readonly tradeSuccess: Locator;
  readonly positionsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.tradeTickerInput = page.getByTestId('trade-ticker-input');
    this.tradeQuantityInput = page.getByTestId('trade-quantity-input');
    this.tradeBuyButton = page.getByTestId('trade-buy-button');
    this.tradeSellButton = page.getByTestId('trade-sell-button');
    this.tradeError = page.getByTestId('trade-error');
    this.tradeSuccess = page.getByTestId('trade-success');
    this.positionsTable = page.getByTestId('positions-table');
  }

  /** Fills in the trade bar and clicks Buy. */
  async buyShares(ticker: string, quantity: number) {
    await this.tradeTickerInput.fill(ticker);
    await this.tradeQuantityInput.fill(String(quantity));
    await this.tradeBuyButton.click();
  }

  /** Fills in the trade bar and clicks Sell. */
  async sellShares(ticker: string, quantity: number) {
    await this.tradeTickerInput.fill(ticker);
    await this.tradeQuantityInput.fill(String(quantity));
    await this.tradeSellButton.click();
  }

  /** Returns the position row for a specific ticker. */
  getPositionRow(ticker: string): Locator {
    return this.page.getByTestId(`position-row-${ticker}`);
  }

  /** Returns the quantity cell for a position row. */
  getPositionQuantity(ticker: string): Locator {
    return this.page.getByTestId(`position-quantity-${ticker}`);
  }

  /** Returns all position rows currently shown. */
  getPositionRows(): Locator {
    return this.page.getByTestId('position-row');
  }

  /** Waits until a trade error message appears. */
  async waitForTradeError(timeout = 10_000) {
    await expect(this.tradeError).toBeVisible({ timeout });
  }

  /** Waits until a trade success message appears. */
  async waitForTradeSuccess(timeout = 10_000) {
    await expect(this.tradeSuccess).toBeVisible({ timeout });
  }

  /** Reads the quantity for a position as a number. */
  async getPositionQuantityValue(ticker: string): Promise<number> {
    const text = await this.getPositionQuantity(ticker).textContent();
    return parseFloat(text!.replace(/[^0-9.]/g, ''));
  }
}
