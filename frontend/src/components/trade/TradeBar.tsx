'use client';

/**
 * TradeBar — instant-fill Buy/Sell bar (UI-07).
 *
 * Inputs: ticker (uppercase-alphanumeric, 1..10 chars) and qty (positive
 * integer). Two equal-weight buttons: Buy = accent-blue, Sell = accent-purple.
 *
 * Submit flow:
 *   1. Client-validate inputs (UX layer).
 *   2. POST { ticker, quantity, side } to /api/portfolio/trade.
 *   3. On 200: server returns { ticker, side, quantity, price, cash_balance }.
 *      Fire success toast "Bought {qty} {ticker} @ \${price}" (or Sell mirror),
 *      then `await Promise.all([refreshPortfolio(), refreshHistory()])` so
 *      PositionsTable / PortfolioHeatmap / PnLChart / Header reconcile from
 *      the server's authoritative state. No page reload (CLAUDE.md constraint).
 *   4. On 400: read { detail }, map to UI-SPEC verbatim copy via the substring
 *      table; NEVER render raw `detail` (V7 error-leak prevention).
 *   5. On network throw: generic network toast.
 *
 * There is NO confirmation dialog by design (CLAUDE.md: simulated environment,
 * zero stakes, instant fill).
 *
 * No dangerouslySetInnerHTML anywhere; ticker/price/error toast text render via
 * {value} JSX (React auto-escapes).
 */

import { FormEvent, useState } from 'react';
import { apiUrl } from '@/lib/api';
import { usePortfolio } from '@/context/PortfolioContext';
import { toast } from '@/components/ui/Toast';
import type {
  TradeErrorResponse,
  TradeResponse,
  TradeSide,
} from '@/lib/types';

const TICKER_RE = /^[A-Z0-9]{1,10}$/;

function mapTradeError(detail: string, ticker: string): string {
  // Substring match against verified backend TradeError messages
  // (backend/app/portfolio_service.py).
  if (detail.startsWith('Insufficient cash')) {
    return 'Insufficient cash for this order.';
  }
  if (detail.startsWith('Insufficient shares of')) {
    return `You don't own that many shares of ${ticker}.`;
  }
  if (detail.startsWith('No price available for ticker')) {
    return `No live price for ${ticker}. Try again in a moment.`;
  }
  if (detail.startsWith('Quantity must be positive')) {
    return 'Quantity must be positive.';
  }
  if (detail.startsWith('Unknown side')) {
    return 'Invalid trade side.';
  }
  // Generic fallback — never render raw `detail` (V7).
  return 'Trade request failed. Check your connection.';
}

export function TradeBar() {
  const { refreshPortfolio } = usePortfolio();
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(side: TradeSide) {
    const t = ticker.trim().toUpperCase();
    const qty = Number.parseInt(quantity, 10);
    if (!TICKER_RE.test(t)) {
      toast('error', 'Trade request failed. Check your connection.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast('error', 'Quantity must be positive.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl('/api/portfolio/trade'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, quantity: qty, side }),
      });

      if (res.ok) {
        const data = (await res.json()) as TradeResponse;
        const verb = side === 'buy' ? 'Bought' : 'Sold';
        toast('success', `${verb} ${data.quantity} ${data.ticker} @ $${data.price}`);
        // Reconcile: refreshPortfolio fetches BOTH /api/portfolio and
        // /api/portfolio/history, so PositionsTable + PortfolioHeatmap +
        // PnLChart + Header all re-render from the server's authoritative state.
        await refreshPortfolio();
        // Reset form on success.
        setTicker('');
        setQuantity('');
        return;
      }

      // 4xx — map {detail} to UI-SPEC verbatim copy. NEVER render raw detail.
      const errBody = (await res.json().catch(() => null)) as TradeErrorResponse | null;
      const detail = errBody?.detail ?? '';
      toast('error', mapTradeError(detail, t));
    } catch {
      toast('error', 'Trade request failed. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit('buy');
  }

  return (
    <form
      onSubmit={handleFormSubmit}
      className="bg-surface-panel border border-white/5 p-4 flex flex-col gap-3"
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Trade
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Ticker"
          aria-label="Ticker"
          maxLength={10}
          data-testid="trade-ticker-input"
          className="flex-1 bg-surface-raised border border-white/5 px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          aria-label="Quantity"
          min={1}
          step={1}
          data-testid="trade-qty-input"
          className="w-24 bg-surface-raised border border-white/5 px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue tabular-nums"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={submitting}
          data-testid="trade-buy-button"
          className="bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-surface-base focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-surface-base"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit('sell')}
          disabled={submitting}
          data-testid="trade-sell-button"
          className="bg-accent-purple hover:bg-accent-purple/90 disabled:opacity-50 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-purple focus:ring-offset-2 focus:ring-offset-surface-base"
        >
          Sell
        </button>
      </div>
    </form>
  );
}