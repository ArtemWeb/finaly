"use client";

import React, { useState } from "react";
import type { PriceMap } from "@/app/hooks/usePriceStream";

interface TradeBarProps {
  prices: PriceMap;
  cashBalance: number;
  selectedTicker: string | null;
  onTrade: (
    ticker: string,
    quantity: number,
    side: "buy" | "sell"
  ) => Promise<{ success: boolean; message?: string }>;
}

export default function TradeBar({
  prices,
  cashBalance,
  selectedTicker,
  onTrade,
}: TradeBarProps) {
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const activeTicker = (ticker || selectedTicker || "").toUpperCase();
  const currentPrice = activeTicker ? prices[activeTicker]?.price : null;
  const tradeValue = currentPrice && quantity ? currentPrice * parseFloat(quantity) : null;

  const showMessage = (text: string, ok: boolean) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleTrade = async (side: "buy" | "sell") => {
    const t = activeTicker;
    const q = parseFloat(quantity.replace(/,/g, "").trim());
    if (!t) {
      showMessage("Enter a ticker symbol", false);
      return;
    }
    if (isNaN(q) || q <= 0) {
      showMessage("Enter a valid quantity", false);
      return;
    }
    setLoading(true);
    try {
      const result = await onTrade(t, q, side);
      if (result.success) {
        showMessage(
          `${side.toUpperCase()} ${q} ${t} @ ${currentPrice?.toFixed(2) ?? "market"}`,
          true
        );
        setQuantity("");
      } else {
        showMessage(result.message || "Trade failed", false);
      }
    } catch (err) {
      showMessage(String(err), false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="panel"
      style={{
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: "#ecad0a",
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          whiteSpace: "nowrap",
        }}
      >
        TRADE
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          className="terminal-input"
          style={{ width: "80px", textTransform: "uppercase" }}
          placeholder="TICKER"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          maxLength={10}
        />
        <input
          className="terminal-input"
          style={{ width: "80px" }}
          placeholder="QTY"
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.,]/g, ""))}
        />
      </div>

      {currentPrice && (
        <span style={{ color: "#8b949e", fontSize: "11px", whiteSpace: "nowrap" }}>
          @ <span style={{ color: "#e6edf3" }}>${currentPrice.toFixed(2)}</span>
          {tradeValue && (
            <span style={{ marginLeft: "8px" }}>
              = <span style={{ color: "#ecad0a" }}>${tradeValue.toFixed(2)}</span>
            </span>
          )}
        </span>
      )}

      <div style={{ display: "flex", gap: "6px" }}>
        <button
          className="btn btn-buy"
          onClick={() => handleTrade("buy")}
          disabled={loading}
        >
          BUY
        </button>
        <button
          className="btn btn-sell"
          onClick={() => handleTrade("sell")}
          disabled={loading}
        >
          SELL
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginLeft: "auto" }}>
        <span style={{ fontSize: "10px", color: "#8b949e" }}>
          CASH:{" "}
          <span style={{ color: "#e6edf3", fontWeight: "bold" }}>
            ${cashBalance.toFixed(2)}
          </span>
        </span>

        {message && (
          <span
            style={{
              fontSize: "11px",
              color: message.ok ? "#16c784" : "#ea3943",
              animation: "fadeIn 0.2s",
            }}
          >
            {message.ok ? "✓ " : "✗ "}
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
