"use client";

import React, { useState } from "react";
import type { WatchlistItem } from "@/app/types";
import type { PriceMap, SparklineMap } from "@/app/hooks/usePriceStream";
import Sparkline from "./Sparkline";

interface WatchlistPanelProps {
  watchlist: WatchlistItem[];
  prices: PriceMap;
  sparklines: SparklineMap;
  flashMap: { [ticker: string]: "up" | "down" | null };
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  onRemoveTicker: (ticker: string) => void;
  onAddTicker: (ticker: string) => void;
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default function WatchlistPanel({
  watchlist,
  prices,
  sparklines,
  flashMap,
  selectedTicker,
  onSelectTicker,
  onRemoveTicker,
  onAddTicker,
}: WatchlistPanelProps) {
  const [newTicker, setNewTicker] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) return;
    setIsAdding(true);
    try {
      await onAddTicker(ticker);
      setNewTicker("");
    } finally {
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-header-title">WATCHLIST</span>
        <span style={{ color: "#8b949e" }}>{watchlist.length} tickers</span>
      </div>

      {/* Add ticker input */}
      <div
        style={{
          padding: "6px 8px",
          borderBottom: "1px solid #30363d",
          display: "flex",
          gap: "4px",
        }}
      >
        <input
          className="terminal-input"
          style={{ flex: 1, textTransform: "uppercase" }}
          placeholder="Add ticker..."
          value={newTicker}
          onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          maxLength={10}
        />
        <button
          className="btn btn-secondary"
          onClick={handleAdd}
          disabled={isAdding || !newTicker.trim()}
          style={{ padding: "4px 8px" }}
        >
          +
        </button>
      </div>

      {/* Watchlist table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table className="terminal-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: "20%" }}>SYMBOL</th>
              <th style={{ width: "22%", textAlign: "right" }}>PRICE</th>
              <th style={{ width: "20%", textAlign: "right" }}>CHG%</th>
              <th style={{ width: "30%" }}>CHART</th>
              <th style={{ width: "8%" }}></th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((item) => {
              const livePrice = prices[item.ticker];
              const price = livePrice?.price ?? item.price;
              const prevPrice = livePrice?.prev_price ?? item.prev_price;
              const changePct = prevPrice && prevPrice !== 0
                ? ((price - prevPrice) / prevPrice) * 100
                : 0;
              const flash = flashMap[item.ticker];
              const sparkData = sparklines[item.ticker] || [];

              const isSelected = selectedTicker === item.ticker;

              return (
                <tr
                  key={item.ticker}
                  onClick={() => onSelectTicker(item.ticker)}
                  style={{
                    cursor: "pointer",
                    background: isSelected ? "rgba(32, 157, 215, 0.1)" : undefined,
                  }}
                >
                  <td>
                    <span
                      className="ticker-chip"
                      style={isSelected ? { color: "#209dd7" } : undefined}
                    >
                      {item.ticker}
                    </span>
                  </td>
                  <td
                    style={{ textAlign: "right" }}
                    className={
                      flash === "up"
                        ? "price-flash-up"
                        : flash === "down"
                        ? "price-flash-down"
                        : undefined
                    }
                  >
                    <span
                      style={{
                        fontWeight: "bold",
                        color: "#e6edf3",
                        display: "inline-block",
                        padding: "1px 4px",
                        borderRadius: "2px",
                      }}
                    >
                      ${formatPrice(price)}
                    </span>
                  </td>
                  <td
                    style={{ textAlign: "right" }}
                    className={
                      changePct > 0
                        ? "pnl-positive"
                        : changePct < 0
                        ? "pnl-negative"
                        : "pnl-neutral"
                    }
                  >
                    {formatChange(changePct)}
                  </td>
                  <td style={{ padding: "2px 8px" }}>
                    <Sparkline
                      data={sparkData.length >= 2 ? sparkData : [price, price]}
                      width={70}
                      height={20}
                    />
                  </td>
                  <td style={{ padding: "2px 4px", textAlign: "center" }}>
                    <button
                      className="btn btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveTicker(item.ticker);
                      }}
                      style={{
                        padding: "1px 4px",
                        fontSize: "10px",
                        lineHeight: 1,
                      }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {watchlist.length === 0 && (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "#8b949e",
              fontSize: "11px",
            }}
          >
            No tickers in watchlist
          </div>
        )}
      </div>
    </div>
  );
}
