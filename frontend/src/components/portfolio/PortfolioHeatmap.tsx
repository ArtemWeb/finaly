'use client';

/**
 * PortfolioHeatmap — Recharts <Treemap> sized by market value, colored by P&L (UI-04).
 *
 * UI-SPEC: heading "Allocation" verbatim. Cells sized by `market_value` so
 * larger positions take more visual real-estate; filled green when
 * `unrealized_pnl >= 0`, red when `< 0`. Stroke is `#0d1117` (surface-base)
 * so cells have a thin separator against the panel background.
 *
 * Pitfall 1 (Recharts SSR): `'use client'` + mounted-flag guard before
 * mounting the <ResponsiveContainer>. Without this guard, `next build` throws
 * `window is not defined`.
 *
 * Open Question 3 (treemap with 0 positions): when positions.length === 0,
 * the treemap renders an empty SVG. UI-SPEC's positions EmptyState
 * ("No open positions" / "Use the trade bar below to buy your first share.")
 * is reused here so the visual is consistent with PositionsTable.
 *
 * No dangerouslySetInnerHTML; ticker/PnL rendered via {value} JSX.
 */

import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';
import { usePortfolio } from '@/context/PortfolioContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { Position } from '@/lib/types';

const HEIGHT = 240;

interface HeatNode {
  name: string;
  ticker: string;
  size: number;
  pnl: number;
  pct: number;
  [key: string]: string | number;
}

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ticker?: string;
  pnl?: number;
}

// Custom <rect> + label renderer: cell fill green/red by P&L sign, dark stroke
// matching surface-base for the separator effect. Renders ticker + pct when
// the cell is large enough to fit text (>40×30).
function TreemapContent(props: TreemapContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, ticker, pnl = 0 } = props;
  const fill = pnl >= 0 ? '#22c55e' : '#ef4444';
  const showLabel = width > 56 && height > 30;
  const showPnl = width > 80 && height > 44;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="#0d1117"
        strokeWidth={2}
      />
      {showLabel ? (
        <text
          x={x + 6}
          y={y + 14}
          fill="#0d1117"
          fontSize={11}
          fontWeight={600}
          fontFamily="ui-monospace, monospace"
        >
          {ticker}
        </text>
      ) : null}
      {showPnl ? (
        <text
          x={x + 6}
          y={y + 28}
          fill="#0d1117"
          fontSize={10}
          fontFamily="ui-monospace, monospace"
        >
          {pnl >= 0 ? '+' : '-'}
          {Math.abs(pnl).toFixed(1)}%
        </text>
      ) : null}
    </g>
  );
}

export function PortfolioHeatmap() {
  const { portfolio } = usePortfolio();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const positions = portfolio?.positions ?? [];

  const data = useMemo<HeatNode[]>(() => {
    return positions.map((p: Position) => {
      const pnl = p.unrealized_pnl;
      const pct = p.change_percent;
      return {
        name: p.ticker,
        ticker: p.ticker,
        size: Math.max(p.market_value, 1),
        pnl,
        pct,
      };
    });
  }, [positions]);

  return (
    <div className="bg-surface-panel border border-white/5 p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Allocation
      </div>
      {positions.length === 0 ? (
        <EmptyState
          heading="No open positions"
          body="Use the trade bar below to buy your first share."
          minHeightClass={`min-h-[${HEIGHT}px]`}
        />
      ) : !mounted ? (
        <div
          aria-hidden="true"
          className="w-full bg-surface-raised animate-pulse"
          style={{ height: HEIGHT }}
        />
      ) : (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <Treemap
            data={data}
            dataKey="size"
            isAnimationActive={false}
            stroke="#0d1117"
            content={<TreemapContent />}
          >
            <Tooltip
              contentStyle={{
                background: '#161b22',
                border: '1px solid rgba(255,255,255,0.05)',
                color: '#e6edf3',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
              }}
              formatter={(value: number, _name: string, item: { payload?: HeatNode }) => {
                const node = item?.payload;
                if (!node) return [formatCurrency(value), 'Market value'];
                return [
                  `${formatCurrency(value)} · ${formatPercent(node.pct)}`,
                  'Market value',
                ];
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      )}
    </div>
  );
}