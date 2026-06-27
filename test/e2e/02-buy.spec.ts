// test/e2e/02-buy.spec.ts
//
// TEST-06: buying 1 AAPL via the trade bar decreases cash and adds an AAPL
// position row.
//
// The trade flow is: fill ticker + qty, click Buy, the trade-bar handler POSTs
// to /api/portfolio/trade and then PortfolioContext refreshes /api/portfolio.
// The position row appears once the context has re-fetched. We poll for the
// position row's appearance (the optimistic UI may not show it instantly) and
// poll for the cash update against the captured pre-trade value.

import { test, expect } from '@playwright/test';

test('buy 1 AAPL decreases cash and adds the position', async ({ page }) => {
  await page.goto('/');

  // Capture the pre-trade cash display so we can assert it strictly decreased.
  const cashLocator = page.getByTestId('header-cash');
  const preCashText = (await cashLocator.textContent()) ?? '';

  // Fill the trade bar.
  await page.getByTestId('trade-ticker-input').fill('AAPL');
  await page.getByTestId('trade-qty-input').fill('1');
  await page.getByTestId('trade-buy-button').click();

  // The AAPL position row eventually appears once the portfolio refreshes.
  await expect(page.getByTestId('position-row-AAPL')).toBeVisible({ timeout: 10_000 });

  // Cash display strictly decreased from its pre-trade value.
  // Use expect.poll because the optimistic update follows the network round-trip.
  await expect
    .poll(async () => (await cashLocator.textContent()) ?? '', { timeout: 10_000 })
    .not.toBe(preCashText);
});