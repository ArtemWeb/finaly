// test/e2e/01-fresh-start.spec.ts
//
// TEST-05: fresh app load shows $10,000 cash + total and exactly 10 watchlist
// rows, with the connection dot reaching streaming and at least one live price.
//
// This spec MUST tolerate the simulator first-batch delay (Pitfall 4): the SSE
// stream pushes the first batch of price updates only after the cache has been
// populated by the simulator task. An instant assertion on price text would
// flake on a cold start. We use expect.poll with a generous timeout (~10s)
// against the count of watchlist-row price cells containing a '$'.
//
// We deliberately use getByTestId only (no CSS-class or text selectors for
// load-bearing assertions) so copy/i18n changes cannot break the contract.

import { test, expect } from '@playwright/test';

test('fresh start shows $10k cash and 10 streaming tickers', async ({ page }) => {
  await page.goto('/');

  // Cash and total value are $10,000 on a fresh seeded portfolio.
  await expect(page.getByTestId('header-cash')).toContainText('$10,000');
  await expect(page.getByTestId('header-total')).toContainText('$10,000');

  // Exactly 10 seeded watchlist rows render.
  await expect(page.getByTestId('watchlist-row')).toHaveCount(10);

  // The SSE connection dot eventually reports streaming (aria-label is the
  // status encoder — left untouched by the testid-only plan).
  await expect(page.getByTestId('connection-dot')).toHaveAttribute(
    'aria-label',
    /streaming/i,
    { timeout: 10_000 },
  );

  // At least one price cell has a dollar value once the first SSE batch
  // arrives. We poll because the first batch can take a couple of seconds
  // on a cold simulator (Pitfall 4). Do NOT assert this instantly.
  await expect
    .poll(
      async () =>
        await page
          .locator('[data-testid=watchlist-row] [data-testid=price]')
          .filter({ hasText: /\$/ })
          .count(),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(1);
});