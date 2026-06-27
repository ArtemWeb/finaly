'use client';

/**
 * Header — full-width 56px bar.
 *
 * Subscribes to BOTH PriceContext (live currentPrice map) and PortfolioContext
 * (cash + positions) and DERIVES the live Total Value in a useMemo
 * (cash + Σ qty × currentPrice, falling back to position.current_price when
 * SSE has not yet emitted a price for a held ticker).
 *
 * D-06: do NOT read a stored total_value field. The live total is a derived
 * computation only. This is what keeps PriceContext high-churn and
 * PortfolioContext low-churn decoupled — storing the total in PortfolioContext
 * would force PositionsTable to re-render on every tick.
 *
 * Visual (UI-SPEC):
 *   - Total Value in Display size (28px) text-accent-yellow with tabular-nums
 *   - "Cash" balance rendered with text-text-primary
 *   - ConnectionDot reflects SSE readyState (D-03)
 *   - App title "FinAlly" on the left
 */

import { useMemo } from 'react';
import { formatCurrency } from '@/lib/format';
import { usePrices } from '@/context/PriceContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { ConnectionDot } from './ConnectionDot';

export function Header() {
  const { prices } = usePrices();
  const { portfolio } = usePortfolio();

  const total = useMemo<number>(() => {
    if (!portfolio) return 0;
    const positionsValue = portfolio.positions.reduce<number>((acc, pos) => {
      const live = prices[pos.ticker]?.price;
      const px = typeof live === 'number' && Number.isFinite(live) ? live : pos.current_price;
      return acc + pos.quantity * px;
    }, 0);
    return portfolio.cash_balance + positionsValue;
  }, [portfolio, prices]);

  return (
    <header className="h-14 shrink-0 border-b border-white/5 bg-surface-panel px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold tracking-wider text-text-primary">FinAlly</span>
      </div>

      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-text-muted">Total Value</span>
          <span className="text-3xl font-semibold leading-none tabular-nums text-accent-yellow">
            {formatCurrency(total)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-text-muted">Cash</span>
          <span className="text-base font-semibold tabular-nums text-text-primary">
            {portfolio ? formatCurrency(portfolio.cash_balance) : '$0.00'}
          </span>
        </div>

        <ConnectionDot />
      </div>
    </header>
  );
}
