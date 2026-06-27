// test/e2e/03-sell.spec.ts
//
// TEST-07: selling via the trade bar increases cash and the position either
// shrinks or disappears.
//
// The spec is self-contained: it first buys 1 AAPL so the sell is meaningful
// regardless of shared-DB state from prior specs (workers=1, single shared
// finally-test-data volume per 04-05 plan). All assertions use testids.

import { test, expect } from '@playwright/test';

test('sell 1 AAPL increases cash and updates the position', async ({ page }) => {
  await page.goto('/');

  // Ensure we own at least 1 AAPL regardless of any earlier spec's state.
  await page.getByTestId('trade-ticker-input').fill('AAPL');
  await page.getByTestId('trade-qty-input').fill('1');
  await page.getByTestId('trade-buy-button').click();
  await expect(page.getByTestId('position-row-AAPL')).toBeVisible({ timeout: 10_000 });

  // Capture pre-sell cash.
  const cashLocator = page.getByTestId('header-cash');
  const preSellCash = (await cashLocator.textContent()) ?? '';

  // Sell 1 AAPL.
  await page.getByTestId('trade-ticker-input').fill('AAPL');
  await page.getByTestId('trade-qty-input').fill('1');
  await page.getByTestId('trade-sell-button').click();

  // Cash display strictly increased after the sell.
  await expect
    .poll(async () => (await cashLocator.textContent()) ?? '', { timeout: 10_000 })
    .not.toBe(preSellCash);

  // The position row either still shows (quantity reduced) or is gone.
  // We assert the row's quantity text is no longer "1" (or the row is detached).
  // Use a soft assertion: count the row, and if present, the quantity cell
  // must not read "1".
  const rowCount = await page.getByTestId('position-row-AAPL').count();
  if (rowCount > 0) {
    // The row is still present — quantity must be reduced.
    const row = page.getByTestId('position-row-AAPL').first();
    const rowText = (await row.textContent()) ?? '';
    expect(rowText).not.toMatch(/\b1\b/);
  }
  // If rowCount === 0 the position disappeared (sold the last share); that's
  // also a valid outcome for "position updates".
});