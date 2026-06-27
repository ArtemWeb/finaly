'use client';

/**
 * MainChart — detailed per-ticker AreaChart (~600×400) shown in the center column.
 *
 * UI-03: Clicking a watchlist ticker sets `selectedTicker` in PriceContext (via
 * WatchlistRow). MainChart reads that and renders an AreaChart of the selected
 * ticker's ring-buffer history (PriceContext.history[ticker]).
 *
 * Empty state (no ticker selected): UI-SPEC verbatim "Select a ticker" /
 * "Click a ticker in the watchlist to view its detailed chart." — matches the
 * locked copywriting contract.
 *
 * Pitfall 1 (Recharts SSR): Recharts' ResponsiveContainer reads window.innerWidth
 * at mount, and `next build`'s prerender pass runs without window. So we guard
 * every chart component with `'use client'` + a mounted-flag fallback that
 * renders a pulse placeholder until the client takes over. Without this guard,
 * `next build` throws `ReferenceError: window is not defined`.
 *
 * No dangerouslySetInnerHTML anywhere; ticker/price values render via {value}.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePrices } from '@/context/PriceContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatPrice, formatTime } from '@/lib/format';

interface MainChartProps {
  /** Override height in px (default 400 per UI-SPEC). */
  height?: number;
}

export function MainChart({ height = 400 }: MainChartProps) {
  const { selectedTicker, history, prices } = usePrices();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Plot the ring buffer of the selected ticker. We do NOT poll /api/portfolio;
  // the history lives entirely in PriceContext. If < 2 points, fall back to a
  // single-point chart so the user still sees the line.
  const data = useMemo(() => {
    if (!selectedTicker) return [];
    const buf = history[selectedTicker] ?? [];
    return buf.map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
    }));
  }, [selectedTicker, history]);

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="w-full bg-surface-raised animate-pulse"
        style={{ height }}
      />
    );
  }

  if (!selectedTicker) {
    return (
      <div
        className="bg-surface-panel border border-white/5 p-4"
        style={{ height }}
      >
        <EmptyState
          heading="Select a ticker"
          body="Click a ticker in the watchlist to view its detailed chart."
          minHeightClass=""
          style={{ minHeight: height - 32 }}
        />
      </div>
    );
  }

  const latestPrice = prices[selectedTicker]?.price;

  return (
    <div className="bg-surface-panel border border-white/5 p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {selectedTicker}
        </div>
        {Number.isFinite(latestPrice) ? (
          <div className="text-xl font-semibold text-accent-yellow tabular-nums">
            {formatPrice(latestPrice as number)}
          </div>
        ) : null}
      </div>
      <ResponsiveContainer width="100%" height={height - 60}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
        >
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#209dd7" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#209dd7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#161b22" strokeDasharray="2 2" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(t: number) => formatTime(t)}
            stroke="#7d8590"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: '#ecad0a' }}
            minTickGap={32}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => formatPrice(v)}
            stroke="#7d8590"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            contentStyle={{
              background: '#161b22',
              border: '1px solid rgba(255,255,255,0.05)',
              color: '#e6edf3',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
            }}
            labelFormatter={(t: number) => formatTime(t)}
            formatter={(value: number) => [formatPrice(value), 'Price']}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#209dd7"
            strokeWidth={1.5}
            fill="url(#priceFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}