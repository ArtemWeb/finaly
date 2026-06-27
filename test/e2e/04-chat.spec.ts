// test/e2e/04-chat.spec.ts
//
// TEST-08: AI chat returns a response with an inline executed-trade confirmation,
// proven deterministically via a page.route stub that matches the backend
// /api/chat response contract.
//
// The default LLM_MOCK returns empty trades, so it cannot render a trade chip
// (Pitfall 6). We MUST stub /api/chat with a deterministic executed trade to
// exercise the frontend's TradeChip render path.
//
// IMPORTANT: the stub injects the response the frontend renders, but it does
// NOT execute trades against the database — the chat stub never hits
// /api/portfolio/trade. To prove the position-row-AAPL assertion truthfully,
// the spec first drives a real buy through the trade bar (which DOES mutate
// the DB), THEN stubs chat and asserts the chip + the (now-existing) position.
// This satisfies TEST-08's intent (chat renders an inline trade confirmation
// AND the position is visible) without requiring the chat stub to drive a
// portfolio mutation that page.route cannot perform.
//
// Stub body shape matches backend/app/routes/chat.py + chat_service.handle_chat:
//   { message: string, actions: { trades: [...], watchlist_changes: [] } }
// Each trade record: { ticker, side, quantity, status: 'executed', detail: 'Executed at $X.YY; ...' }
// The frontend TradeChip extracts the price from detail via the
// /Executed at \$([\d.]+)/ regex and renders: "{verb} {quantity} {ticker} @ ${price}".

import { test, expect } from '@playwright/test';

test('AI chat returns a response with inline executed-trade confirmation', async ({ page }) => {
  // Step 1: own 1 AAPL via the real trade bar so the position-row-AAPL
  // assertion is truthful regardless of cross-spec DB state (workers=1,
  // shared finally-test-data volume). Buying first means the chat stub's
  // chip and the existing position row line up at assertion time.
  await page.goto('/');
  await page.getByTestId('trade-ticker-input').fill('AAPL');
  await page.getByTestId('trade-qty-input').fill('1');
  await page.getByTestId('trade-buy-button').click();
  await expect(page.getByTestId('position-row-AAPL')).toBeVisible({ timeout: 10_000 });

  // Step 2: stub /api/chat to return a deterministic executed trade.
  // The stub body shape MUST match the backend handle_chat contract or the
  // frontend will not render the chip.
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: '[MOCK] Buying 1 share of AAPL',
        actions: {
          trades: [
            {
              ticker: 'AAPL',
              side: 'buy',
              quantity: 1,
              status: 'executed',
              detail: 'Executed at $150.00; cash_balance=9850.00',
            },
          ],
          watchlist_changes: [],
        },
      }),
    });
  });

  // Step 3: drive the chat and assert the render path.
  // Wait for chat to be enabled (the input is disabled until the app
  // resolves /api/health and confirms chat_enabled — under LLM_MOCK it is true).
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('chat-input').fill('buy 1 AAPL');
  await page.getByTestId('chat-send').click();

  // The assistant bubble is the most recent chat-message (user -> pending ->
  // resolved assistant). Assert it contains the [MOCK] sentinel text from
  // the stubbed message.
  await expect(page.locator('[data-testid=chat-message]').last()).toContainText('[MOCK]', {
    timeout: 10_000,
  });

  // The trade chip rendered from the stubbed actions.trades entry.
  await expect(page.getByTestId('trade-chip').last()).toContainText('Bought 1 AAPL @ $150.00', {
    timeout: 10_000,
  });

  // The AAPL position row is visible — created by the real buy in Step 1.
  await expect(page.getByTestId('position-row-AAPL')).toBeVisible();
});