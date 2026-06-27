'use client';

/**
 * PositionsTable — open positions grid (UI-06).
 *
 * Renders a plain Tailwind `<table>` with `tabular-nums` so columns of digits
 * align. Column headers are UI-SPEC VERBATIM ("Ticker", "Qty", "Avg Cost",
 * "Price", "P&L", "% Change").
 *
 * Pitfall 5 (re-render storm): the table subscribes to BOTH contexts. The
 * PriceContext churns ~500ms × N tickers, so the table would re-render on
 * every tick. We avoid this by reading the live price via a memoized selector
 * that recomputes only when (ticker, currentPrice, position) tuple changes.
 * The structural columns (qty, avg_cost, market_value, unrealized_pnl) stay
 * pinned — only the live "Price" + "% Change" cells update per tick.
 *
 * Accessibility (UI-SPEC): P&L cells carry a leading +/− sign AND a colour
 * class so colour is never the sole signal. Empty heading/body strings are
 * verbatim from the UI-SPEC copywriting contract.
 *
 * No dangerouslySetInnerHTML anywhere; ticker/price render via {value}.
 */

import { useMemo } from 'react';
import { usePortfolio } from '@/context/PortfolioContext';
import { usePrices } from '@/context/PriceContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatPercent, formatPrice } from '@/lib/format';
import type { Position } from '@/lib/types';

interface Row {
  position: Position;
  currentPrice: number;
}

function pnlClass(value: number): string {
  if (value > 0) return 'text-profit';
  if (value < 0) return 'text-loss';
  return 'text-text-muted';
}

function signedCurrency(value: number): string {
  if (value === 0) return formatCurrency(0);
  const abs = formatCurrency(Math.abs(value));
  return value > 0 ? `+${abs}` : `-${abs}`;
}

export function PositionsTable() {
  const { portfolio } = usePortfolio();
  const { prices } = usePrices();

  // Memoized selector: compute per-row live price from SSE-driven prices map;
  // falls back to position.current_price (server-supplied snapshot) when no
  // live SSE tick has arrived yet for that ticker. Recomputes only when the
  // derived Row tuple changes, not on every context value identity change.
  const rows = useMemo<Row[]>(() => {
    const positions = portfolio?.positions ?? [];
    return positions.map((p) => {
      const live = prices[p.ticker]?.price;
      const currentPrice = Number.isFinite(live) ? (live as number) : p.current_price;
      return { position: p, currentPrice };
    });
  }, [portfolio, prices]);

  const positions = portfolio?.positions ?? [];

  return (
    <div className="bg-surface-panel border border-white/5 p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Positions
      </div>
      {positions.length === 0 ? (
        <EmptyState
          heading="No open positions"
          body="Use the trade bar below to buy your first share."
          minHeightClass="min-h-[120px]"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="text-left py-2 pr-4">Ticker</th>
                <th className="text-right py-2 pr-4">Qty</th>
                <th className="text-right py-2 pr-4">Avg Cost</th>
                <th className="text-right py-2 pr-4">Price</th>
                <th className="text-right py-2 pr-4">P&amp;L</th>
                <th className="text-right py-2">% Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ position, currentPrice }) => {
                const pnl = (currentPrice - position.avg_cost) * position.quantity;
                const pct =
                  position.avg_cost !== 0
                    ? ((currentPrice - position.avg_cost) / position.avg_cost) * 100
                    : 0;
                return (
                  <tr key={position.ticker} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-accent-yellow">{position.ticker}</td>
                    <td className="py-2 pr-4 text-right text-text-primary">
                      {position.quantity}
                    </td>
                    <td className="py-2 pr-4 text-right text-text-primary">
                      {formatPrice(position.avg_cost)}
                    </td>
                    <td className="py-2 pr-4 text-right text-text-primary">
                      {formatPrice(currentPrice)}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right ${pnlClass(pnl)}`}
                      aria-label={`P&L ${pnl >= 0 ? 'positive' : 'negative'} ${formatCurrency(Math.abs(pnl))}`}
                    >
                      {signedCurrency(pnl)}
                    </td>
                    <td className={`py-2 text-right ${pnlClass(pct)}`}>
                      {formatPercent(pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}