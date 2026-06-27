'use client';

/**
 * WatchlistRow — one ticker row in the left watchlist column.
 *
 * Layout:
 *   [ticker  price(flash)  %change  sparkline  ×]
 *
 * - Ticker symbol rendered in text-accent-yellow (per UI-SPEC Color).
 * - Price wrapped in <PriceFlash/> — flashes bg-profit/20 on uptick,
 *   bg-loss/20 on downtick for 500ms then fades (UI-01).
 * - % change with leading + or - via formatPercent; coloured by sign.
 * - Sparkline reads from PriceContext.history[ticker].
 * - Row click → setSelectedTicker (UI-03 selection hook; MainChart consumes).
 * - × remove button → aria-label `Remove {ticker} from watchlist` (verbatim),
 *   min 32px hit target, calls removeTicker (optimistic, revert on failure).
 *
 * Selected row shows a 4px solid accent-yellow left border.
 */

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { usePrices } from '@/context/PriceContext';
import { usePortfolio } from '@/context/PortfolioContext';
import { formatPercent, formatPrice } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { PriceFlash } from './PriceFlash';
import { Sparkline } from './Sparkline';

export interface WatchlistRowProps {
  ticker: string;
}

export function WatchlistRow({ ticker }: WatchlistRowProps) {
  const { prices, history, selectedTicker, setSelectedTicker, clearTicker } = usePrices();
  const { removeTicker, refreshWatchlist } = usePortfolio();

  const [pendingRemove, setPendingRemove] = useState(false);

  const price = prices[ticker]?.price;
  const previousPrice = prices[ticker]?.previous_price;
  const changePercent = prices[ticker]?.change_percent;
  const direction = prices[ticker]?.direction ?? 'flat';
  const isSelected = selectedTicker === ticker;

  // Memoize sparkline data shape so we don't re-allocate each render.
  const sparkData = useMemo(
    () => (history[ticker] ?? []).map((p) => ({ price: p.price })),
    [history, ticker],
  );

  async function handleRemove(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pendingRemove) return;
    setPendingRemove(true);
    // Pitfall 3: clear ring buffer immediately so any re-add starts fresh.
    clearTicker(ticker);
    const ok = await removeTicker(ticker);
    setPendingRemove(false);
    if (!ok) {
      toast('error', `Couldn't remove ${ticker}. Please try again.`);
      // Reconcile so the row reappears with the server's authoritative list.
      void refreshWatchlist();
    }
  }

  return (
    <button
      type="button"
      onClick={() => setSelectedTicker(ticker)}
      className={`group flex items-center gap-2 w-full text-left px-3 py-2 border-l-4 ${
        isSelected ? 'border-accent-yellow bg-surface-raised' : 'border-transparent hover:bg-surface-raised'
      } focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-surface-panel`}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-semibold tracking-wider text-accent-yellow truncate">
          {ticker}
        </span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <PriceFlash
            price={typeof price === 'number' ? price : 0}
            previousPrice={typeof previousPrice === 'number' ? previousPrice : undefined}
            className="text-sm tabular-nums"
          >
            {typeof price === 'number' ? formatPrice(price) : '—'}
          </PriceFlash>
          {typeof changePercent === 'number' ? (
            <span
              className={`text-xs tabular-nums ${
                changePercent > 0 ? 'text-profit' : changePercent < 0 ? 'text-loss' : 'text-text-muted'
              }`}
            >
              {formatPercent(changePercent)}
            </span>
          ) : null}
        </div>
      </div>

      <Sparkline ticker={ticker} history={sparkData} direction={direction} />

      <span
        role="button"
        aria-label={`Remove ${ticker} from watchlist`}
        onClick={handleRemove}
        className="w-8 h-8 shrink-0 flex items-center justify-center rounded text-text-muted hover:text-loss hover:bg-loss/10 cursor-pointer"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void handleRemove(e as unknown as React.MouseEvent<HTMLButtonElement>);
          }
        }}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </span>
    </button>
  );
}
