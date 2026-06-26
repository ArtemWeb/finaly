import { Page, Locator, expect } from '@playwright/test';

/**
 * Base page object for the FinAlly trading workstation.
 * All page objects extend this class.
 *
 * NOTE FOR FRONTEND DEVS: This file documents the data-testid attributes
 * required on the frontend. Each selector comment indicates where the
 * attribute must be placed.
 */
export class AppPage {
  readonly page: Page;

  // Header elements
  // data-testid="connection-status" on the connection status dot in the header
  readonly connectionStatus: Locator;
  // data-testid="cash-balance" on the element showing "$X,XXX.XX" cash
  readonly cashBalance: Locator;
  // data-testid="total-portfolio-value" on the element showing total portfolio value
  readonly totalPortfolioValue: Locator;

  constructor(page: Page) {
    this.page = page;
    this.connectionStatus = page.getByTestId('connection-status');
    this.cashBalance = page.getByTestId('cash-balance');
    this.totalPortfolioValue = page.getByTestId('total-portfolio-value');
  }

  async goto() {
    await this.page.goto('/');
    // Wait for the app shell to be visible
    await this.page.waitForLoadState('networkidle');
  }

  async waitForPricesStreaming() {
    // Prices are streaming when the connection status is green (connected)
    await expect(this.connectionStatus).toHaveAttribute('data-status', 'connected', {
      timeout: 15_000,
    });
  }

  async getCashBalance(): Promise<number> {
    const text = await this.cashBalance.textContent();
    // Strip currency symbols and commas, parse as float
    return parseFloat(text!.replace(/[^0-9.]/g, ''));
  }
}
