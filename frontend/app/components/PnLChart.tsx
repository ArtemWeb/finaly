"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { PortfolioHistoryPoint } from "@/app/types";

interface PnLChartProps {
  history: PortfolioHistoryPoint[];
  initialValue?: number;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const val = payload[0].value;
    return (
      <div
        style={{
          background: "#21262d",
          border: "1px solid #30363d",
          padding: "6px 10px",
          borderRadius: "3px",
          fontSize: "11px",
        }}
      >
        <div style={{ color: "#8b949e", marginBottom: "2px" }}>{label}</div>
        <div style={{ color: "#e6edf3", fontWeight: "bold" }}>
          {typeof val === "number" ? formatCurrency(val) : val}
        </div>
      </div>
    );
  }
  return null;
};

export default function PnLChart({ history, initialValue = 10000 }: PnLChartProps) {
  const data = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history.map((h) => ({
      time: formatTime(h.recorded_at),
      value: h.total_value,
    }));
  }, [history]);

  const currentValue = data.length > 0 ? data[data.length - 1].value : initialValue;
  const pnl = currentValue - initialValue;
  const pnlPct = (pnl / initialValue) * 100;
  const isPositive = pnl >= 0;
  const lineColor = isPositive ? "#16c784" : "#ea3943";

  const minVal = data.length > 0 ? Math.min(...data.map((d) => d.value)) : initialValue;
  const maxVal = data.length > 0 ? Math.max(...data.map((d) => d.value)) : initialValue;
  const padding = (maxVal - minVal) * 0.1 || 100;

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-header-title">P&L CHART</span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: "#e6edf3", fontWeight: "bold" }}>
            {formatCurrency(currentValue)}
          </span>
          <span style={{ color: isPositive ? "#16c784" : "#ea3943", fontSize: "11px" }}>
            {isPositive ? "+" : ""}
            {formatCurrency(pnl)} ({isPositive ? "+" : ""}
            {pnlPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      <div style={{ flex: 1, padding: "4px 0", minHeight: 0 }}>
        {data.length < 2 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8b949e",
              fontSize: "11px",
            }}
          >
            Accumulating portfolio history...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "#8b949e", fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: "#30363d" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[minVal - padding, maxVal + padding]}
                tick={{ fill: "#8b949e", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatCurrency(v)}
                width={60}
              />
              <Tooltip content={CustomTooltip} />
              <ReferenceLine
                y={initialValue}
                stroke="#30363d"
                strokeDasharray="4 4"
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={1.5}
                fill="url(#pnlGradient)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
