"use client";

import React from "react";
import type { ConnectionStatus, Portfolio } from "@/app/types";

interface HeaderProps {
  portfolio: Portfolio | null;
  connectionStatus: ConnectionStatus;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function Header({ portfolio, connectionStatus }: HeaderProps) {
  const totalValue = portfolio?.total_value ?? 0;
  const cashBalance = portfolio?.cash_balance ?? 0;
  const totalPnl = portfolio?.total_pnl ?? 0;
  const totalPnlPct = portfolio?.total_pnl_pct ?? 0;

  const pnlClass =
    totalPnl > 0 ? "pnl-positive" : totalPnl < 0 ? "pnl-negative" : "pnl-neutral";

  const statusLabels: Record<ConnectionStatus, string> = {
    connected: "LIVE",
    reconnecting: "RECONNECTING",
    disconnected: "OFFLINE",
  };

  return (
    <header
      style={{
        background: "#161b22",
        borderBottom: "1px solid #30363d",
        padding: "0 16px",
        height: "40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <span
          style={{
            fontWeight: "bold",
            fontSize: "16px",
            color: "#ecad0a",
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          FIN<span style={{ color: "#209dd7" }}>ALLY</span>
        </span>
        <span
          style={{
            fontSize: "9px",
            color: "#8b949e",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          AI Trading Workstation
        </span>
      </div>

      {/* Portfolio stats */}
      <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "9px",
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Portfolio Value
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              color: "#e6edf3",
            }}
          >
            {formatCurrency(totalValue)}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "9px",
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Cash
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              color: "#e6edf3",
            }}
          >
            {formatCurrency(cashBalance)}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "9px",
              color: "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Total P&L
          </div>
          <div
            style={{ fontSize: "14px", fontWeight: "bold" }}
            className={pnlClass}
          >
            {totalPnl >= 0 ? "+" : ""}
            {formatCurrency(totalPnl)}{" "}
            <span style={{ fontSize: "11px" }}>
              ({totalPnlPct >= 0 ? "+" : ""}
              {totalPnlPct.toFixed(2)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span className={`status-dot ${connectionStatus}`} />
        <span
          style={{
            fontSize: "9px",
            color:
              connectionStatus === "connected"
                ? "#16c784"
                : connectionStatus === "reconnecting"
                ? "#ecad0a"
                : "#ea3943",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {statusLabels[connectionStatus]}
        </span>
      </div>
    </header>
  );
}
