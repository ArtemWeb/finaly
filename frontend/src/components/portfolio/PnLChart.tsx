'use client';

/**
 * PnLChart — Recharts <LineChart> of total portfolio value over time (UI-05).
 *
 * Plots `total_value` from /api/portfolio/history (PortfolioContext.history),
 * X = `recorded_at` (HH:MM, 24h), Y = `total_value` (compact `$10.2k`).
 * Tooltip shows the full currency + the time, per UI-SPEC interaction contract.
 *
 * Pitfall 1 (Recharts SSR): `'use client'` + mounted-flag guard before
 * mounting the chart. Without this, `next build` throws `window is not defined`.
 *
 * Refresh: PortfolioContext.refreshPortfolio() (called after every trade +
 * 10s safety poll) updates the `history` state and the chart re-renders
 * automatically. We don't subscribe to SSE for history (RESEARCH decision —
 * SSE is for live prices only).
 *
 * No dangerouslySetInnerHTML; all values render via {value}.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePortfolio } from '@/context/PortfolioContext';
import { formatCurrency, formatTime } from '@/lib/format';
import type { HistoryPoint } from '@/lib/types';

const HEIGHT = 200;

interface ChartPoint {
  timestamp: number;
  total_value: number;
}

/**
 * Compact currency formatter for Y-axis ticks: `$10.2k`, `$1.5M`, etc.
 * Used to keep tick labels short and aligned.
 */
function compactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function PnLChart() {
  const { history } = usePortfolio();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const data = useMemo<ChartPoint[]>(() => {
    return (history as HistoryPoint[]).map((p) => ({
      timestamp: new Date(p.recorded_at).getTime() / 1000,
      total_value: p.total_value,
    }));
  }, [history]);

  return (
    <div className="bg-surface-panel border border-white/5 p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        P&amp;L Over Time
      </div>
      {!mounted ? (
        <div
          aria-hidden="true"
          className="w-full bg-surface-raised animate-pulse"
          style={{ height: HEIGHT }}
        />
      ) : data.length < 2 ? (
        <div
          className="flex items-center justify-center text-xs text-text-muted"
          style={{ height: HEIGHT }}
        >
          No history yet — make a trade to start tracking P&amp;L.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
          >
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
              tickFormatter={(v: number) => compactCurrency(v)}
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
              formatter={(value: number) => [formatCurrency(value), 'Total value']}
            />
            <Line
              type="monotone"
              dataKey="total_value"
              stroke="#22c55e"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}