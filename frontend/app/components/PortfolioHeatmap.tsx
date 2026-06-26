"use client";

import React, { useMemo } from "react";
import type { Position } from "@/app/types";
import type { PriceMap } from "@/app/hooks/usePriceStream";

interface HeatmapRect {
  ticker: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pnlPct: number;
  marketValue: number;
}

interface PortfolioHeatmapProps {
  positions: Position[];
  prices: PriceMap;
}

function getHeatmapColor(pnlPct: number): string {
  const clamp = Math.max(-10, Math.min(10, pnlPct));
  if (clamp >= 0) {
    const intensity = clamp / 10;
    const r = Math.round(22 + (0 - 22) * intensity);
    const g = Math.round(199 + (200 - 199) * intensity);
    const b = Math.round(132 + (100 - 132) * intensity);
    return `rgba(${r},${g},${b},${0.3 + intensity * 0.5})`;
  } else {
    const intensity = Math.abs(clamp) / 10;
    const r = Math.round(234);
    const g = Math.round(57 * (1 - intensity));
    const b = Math.round(67 * (1 - intensity));
    return `rgba(${r},${g},${b},${0.3 + intensity * 0.5})`;
  }
}

// Simple treemap layout (squarified)
function computeTreemap(
  items: { ticker: string; value: number; pnlPct: number }[],
  containerWidth: number,
  containerHeight: number
): HeatmapRect[] {
  if (items.length === 0) return [];

  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return [];

  const rects: HeatmapRect[] = [];
  const sorted = [...items].sort((a, b) => b.value - a.value);

  // Simple row-based layout
  let currentX = 0;
  let currentY = 0;
  const totalArea = containerWidth * containerHeight;

  let rowItems: typeof sorted = [];
  let rowTotal = 0;
  const remainingWidth = containerWidth;

  function flushRow(rowY: number, rowH: number) {
    let rx = 0;
    for (const item of rowItems) {
      const w = (item.value / rowTotal) * remainingWidth;
      rects.push({
        ticker: item.ticker,
        x: rx,
        y: rowY,
        width: w,
        height: rowH,
        pnlPct: item.pnlPct,
        marketValue: item.value,
      });
      rx += w;
    }
  }

  // Calculate ideal row height based on aspect ratio
  let remainingY = 0;
  let remainingH = containerHeight;
  let i = 0;

  while (i < sorted.length) {
    const item = sorted[i];
    const itemFraction = item.value / total;
    const targetRowH = Math.max(
      20,
      (totalArea * (rowTotal + item.value) / total) / containerWidth
    );

    rowItems.push(item);
    rowTotal += item.value;
    i++;

    // Check if next item would change aspect ratio poorly, or we're at end
    const nextFraction =
      i < sorted.length ? sorted[i].value / total : 0;
    const rowFraction = rowTotal / total;
    const rowH = rowFraction * containerHeight;

    if (
      i >= sorted.length ||
      rowFraction > 0.3 ||
      rowItems.length >= 4
    ) {
      flushRow(remainingY, rowH);
      remainingY += rowH;
      rowItems = [];
      rowTotal = 0;
    }
  }

  // Flush any remaining
  if (rowItems.length > 0) {
    const rowFraction = rowTotal / total;
    const rowH = rowFraction * containerHeight;
    flushRow(remainingY, rowH);
  }

  return rects;
}

export default function PortfolioHeatmap({ positions, prices }: PortfolioHeatmapProps) {
  const containerWidth = 320;
  const containerHeight = 180;

  const items = useMemo(() => {
    return positions
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const currentPrice = prices[p.ticker]?.price ?? p.current_price;
        const marketValue = p.quantity * currentPrice;
        const pnlPct = ((currentPrice - p.avg_cost) / p.avg_cost) * 100;
        return { ticker: p.ticker, value: marketValue, pnlPct };
      });
  }, [positions, prices]);

  const rects = useMemo(
    () => computeTreemap(items, containerWidth, containerHeight),
    [items]
  );

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-header-title">PORTFOLIO HEATMAP</span>
        <span style={{ color: "#8b949e" }}>
          {positions.filter((p) => p.quantity > 0).length} positions
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px",
          minHeight: 0,
        }}
      >
        {positions.filter((p) => p.quantity > 0).length === 0 ? (
          <div style={{ color: "#8b949e", fontSize: "11px", textAlign: "center" }}>
            No open positions
          </div>
        ) : (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${containerWidth} ${containerHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ display: "block" }}
          >
            {rects.map((rect) => {
              const color = getHeatmapColor(rect.pnlPct);
              const textColor = rect.pnlPct >= 0 ? "#16c784" : "#ea3943";
              const showPct = rect.width > 50 && rect.height > 30;
              const showLabel = rect.width > 30 && rect.height > 20;

              return (
                <g key={rect.ticker}>
                  <rect
                    x={rect.x + 1}
                    y={rect.y + 1}
                    width={Math.max(0, rect.width - 2)}
                    height={Math.max(0, rect.height - 2)}
                    fill={color}
                    stroke="#30363d"
                    strokeWidth={1}
                    rx={2}
                  />
                  {showLabel && (
                    <text
                      x={rect.x + rect.width / 2}
                      y={rect.y + rect.height / 2 + (showPct ? -6 : 4)}
                      textAnchor="middle"
                      fill="#ecad0a"
                      fontSize={Math.min(12, Math.max(8, rect.width / 5))}
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {rect.ticker}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={rect.x + rect.width / 2}
                      y={rect.y + rect.height / 2 + 8}
                      textAnchor="middle"
                      fill={textColor}
                      fontSize={Math.min(10, Math.max(7, rect.width / 7))}
                      fontFamily="monospace"
                    >
                      {rect.pnlPct >= 0 ? "+" : ""}
                      {rect.pnlPct.toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          padding: "4px 10px",
          borderTop: "1px solid #30363d",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "9px",
          color: "#8b949e",
        }}
      >
        <span>■ <span style={{ color: "#ea3943" }}>Loss</span></span>
        <span>■ <span style={{ color: "#16c784" }}>Profit</span></span>
        <span style={{ marginLeft: "auto" }}>Size = weight</span>
      </div>
    </div>
  );
}
