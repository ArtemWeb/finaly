import { Page, Locator, expect } from '@playwright/test';
import { AppPage } from './AppPage';

/**
 * Page object for watchlist interactions.
 *
 * NOTE FOR FRONTEND DEVS: Required data-testid attributes:
 * - data-testid="watchlist-panel"        — the watchlist container
 * - data-testid="watchlist-row"          — each ticker row in the watchlist (multiple)
 * - data-testid="watchlist-ticker-AAPL"  — individual row keyed by ticker symbol
 * - data-testid="add-ticker-input"       — the text input for adding a new ticker
 * - data-testid="add-ticker-button"      — the button to submit adding a ticker
 * - data-testid="remove-ticker-AAPL"     — the remove button on each row (keyed by ticker)
 * - data-testid="watchlist-error"        — error message shown on duplicate/invalid ticker
 */
export class WatchlistPage extends AppPage {
  readonly watchlistPanel: Locator;
  readonly addTickerInput: Locator;
  readonly addTickerButton: Locator;
  readonly watchlistError: Locator;

  constructor(page: Page) {
    super(page);
    this.watchlistPanel = page.getByTestId('watchlist-panel');
    this.addTickerInput = page.getByTestId('add-ticker-input');
    this.addTickerButton = page.getByTestId('add-ticker-button');
    this.watchlistError = page.getByTestId('watchlist-error');
  }

  /** Returns all watchlist rows currently visible. */
  getWatchlistRows(): Locator {
    return this.page.getByTestId('watchlist-row');
  }

  /** Returns the row for a specific ticker (e.g. 'AAPL'). */
  getTickerRow(ticker: string): Locator {
    return this.page.getByTestId(`watchlist-ticker-${ticker}`);
  }

  /** Returns the remove button for a specific ticker. */
  getRemoveButton(ticker: string): Locator {
    return this.page.getByTestId(`remove-ticker-${ticker}`);
  }

  /** Adds a ticker via the add-ticker input + button. */
  async addTicker(ticker: string) {
    await this.addTickerInput.fill(ticker);
    await this.addTickerButton.click();
  }

  /** Removes a ticker by clicking its remove button. */
  async removeTicker(ticker: string) {
    await this.getRemoveButton(ticker).click();
  }

  /** Waits until the watchlist shows at least `count` rows. */
  async waitForRowCount(count: number) {
    await expect(this.getWatchlistRows()).toHaveCount(count, { timeout: 10_000 });
  }

  /** Returns true if the given ticker is currently in the watchlist. */
  async hasTicker(ticker: string): Promise<boolean> {
    const row = this.getTickerRow(ticker);
    return (await row.count()) > 0;
  }
}
