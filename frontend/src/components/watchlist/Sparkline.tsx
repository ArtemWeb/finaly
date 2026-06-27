'use client';

/**
 * Sparkline — 60×20 Recharts LineChart, no axes, no tooltip, single series.
 *
 * Reads the ticker's ring buffer from PriceContext.history[ticker] and plots
 * price over time. Stroke colour follows the latest direction:
 *   up   → text-profit
 *   down → text-loss
 *   flat → accent-blue
 *
 * Pitfall 1 (Recharts SSR): Recharts uses ResizeObserver and reads
 * window.innerWidth on mount. The next build prerender runs without
 * `window`, so we guard with a mounted flag and render a pulse placeholder
 * until the client takes over.
 *
 * No dangerouslySetInnerHTML anywhere; ticker is rendered via {ticker}.
 */

import { useEffect, useState } from 'react';
import { LineChart, Line, YAxis } from 'recharts';
import type { PriceDirection } from '@/lib/types';

export interface SparklineProps {
  ticker: string;
  history: { price: number }[];
  direction: PriceDirection;
}

const STROKE: Record<PriceDirection, string> = {
  up: '#22c55e',
  down: '#ef4444',
  flat: '#209dd7',
};

export function Sparkline({ history, direction }: SparklineProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="w-[60px] h-[20px] bg-surface-raised animate-pulse"
      />
    );
  }

  if (history.length < 2) {
    return (
      <div
        aria-hidden="true"
        className="w-[60px] h-[20px] bg-surface-raised"
      />
    );
  }

  const data = history.map((p) => ({ price: p.price }));
  const stroke = STROKE[direction];

  return (
    <LineChart
      width={60}
      height={20}
      data={data}
      margin={{ top: 2, right: 0, left: 0, bottom: 2 }}
    >
      <YAxis domain={['auto', 'auto']} hide />
      <Line
        type="monotone"
        dataKey="price"
        stroke={stroke}
        strokeWidth={1.25}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}
