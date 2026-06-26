"use client";

import React from "react";
import type { Position } from "@/app/types";
import type { PriceMap } from "@/app/hooks/usePriceStream";

interface PositionsTableProps {
  positions: Position[];
  prices: PriceMap;
  onSelectTicker: (ticker: string) => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function PositionsTable({
  positions,
  prices,
  onSelectTicker,
}: PositionsTableProps) {
  const openPositions = positions.filter((p) => p.quantity > 0);

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-header-title">POSITIONS</span>
        <span style={{ color: "#8b949e" }}>{openPositions.length} open</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <table className="terminal-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>TICKER</th>
              <th style={{ textAlign: "right" }}>QTY</th>
              <th style={{ textAlign: "right" }}>AVG COST</th>
              <th style={{ textAlign: "right" }}>PRICE</th>
              <th style={{ textAlign: "right" }}>MKT VAL</th>
              <th style={{ textAlign: "right" }}>UNRLZD P&L</th>
              <th style={{ textAlign: "right" }}>P&L%</th>
            </tr>
          </thead>
          <tbody>
            {openPositions.map((pos) => {
              const livePrice = prices[pos.ticker]?.price ?? pos.current_price;
              const marketValue = pos.quantity * livePrice;
              const unrealizedPnl = (livePrice - pos.avg_cost) * pos.quantity;
              const pnlPct = ((livePrice - pos.avg_cost) / pos.avg_cost) * 100;

              const pnlClass =
                unrealizedPnl > 0
                  ? "pnl-positive"
                  : unrealizedPnl < 0
                  ? "pnl-negative"
                  : "pnl-neutral";

              return (
                <tr key={pos.ticker}>
                  <td>
                    <span
                      className="ticker-chip"
                      onClick={() => onSelectTicker(pos.ticker)}
                    >
                      {pos.ticker}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "#e6edf3" }}>
                    {pos.quantity % 1 === 0
                      ? pos.quantity.toFixed(0)
                      : pos.quantity.toFixed(3)}
                  </td>
                  <td style={{ textAlign: "right", color: "#8b949e" }}>
                    {formatCurrency(pos.avg_cost)}
                  </td>
                  <td style={{ textAlign: "right", color: "#e6edf3", fontWeight: "bold" }}>
                    {formatCurrency(livePrice)}
                  </td>
                  <td style={{ textAlign: "right", color: "#e6edf3" }}>
                    {formatCurrency(marketValue)}
                  </td>
                  <td style={{ textAlign: "right" }} className={pnlClass}>
                    {unrealizedPnl >= 0 ? "+" : ""}
                    {formatCurrency(unrealizedPnl)}
                  </td>
                  <td style={{ textAlign: "right" }} className={pnlClass}>
                    {pnlPct >= 0 ? "+" : ""}
                    {pnlPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {openPositions.length === 0 && (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "#8b949e",
              fontSize: "11px",
            }}
          >
            No open positions — buy some stocks!
          </div>
        )}
      </div>
    </div>
  );
}
