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
} from "recharts";
import type { SparklineMap } from "@/app/hooks/usePriceStream";
import type { PriceMap } from "@/app/hooks/usePriceStream";

interface MainChartProps {
  ticker: string | null;
  prices: PriceMap;
  sparklines: SparklineMap;
}

function formatTime(index: number, total: number): string {
  const now = new Date();
  const secondsAgo = (total - 1 - index) * 0.5;
  const t = new Date(now.getTime() - secondsAgo * 1000);
  return t.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface ChartDataPoint {
  time: string;
  price: number;
  index: number;
}

export default function MainChart({ ticker, prices, sparklines }: MainChartProps) {
  const data = useMemo<ChartDataPoint[]>(() => {
    if (!ticker) return [];
    const priceData = sparklines[ticker] || [];
    if (priceData.length === 0) {
      const livePrice = prices[ticker]?.price;
      if (livePrice) {
        return [{ time: "NOW", price: livePrice, index: 0 }];
      }
      return [];
    }
    return priceData.map((price, i) => ({
      time: formatTime(i, priceData.length),
      price,
      index: i,
    }));
  }, [ticker, sparklines, prices]);

  const currentPrice = ticker ? prices[ticker]?.price : null;
  const firstPrice = data.length > 0 ? data[0].price : null;
  const priceChange =
    currentPrice && firstPrice ? currentPrice - firstPrice : 0;
  const priceChangePct =
    currentPrice && firstPrice ? (priceChange / firstPrice) * 100 : 0;
  const isPositive = priceChange >= 0;
  const lineColor = isPositive ? "#16c784" : "#ea3943";

  const minPrice = data.length > 0 ? Math.min(...data.map((d) => d.price)) : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map((d) => d.price)) : 0;
  const padding = (maxPrice - minPrice) * 0.1 || 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: any) => {
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
          <div style={{ color: "#e6edf3", fontWeight: "bold" }}>
            ${typeof val === "number" ? val.toFixed(2) : val}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-header-title">
          {ticker ? ticker : "SELECT A TICKER"}
        </span>
        {ticker && currentPrice && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: "#e6edf3", fontWeight: "bold", fontSize: "13px" }}>
              ${currentPrice.toFixed(2)}
            </span>
            <span
              style={{
                color: isPositive ? "#16c784" : "#ea3943",
                fontSize: "11px",
              }}
            >
              {isPositive ? "+" : ""}
              {priceChange.toFixed(2)} ({isPositive ? "+" : ""}
              {priceChangePct.toFixed(2)}%) TODAY
            </span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: "8px 0", minHeight: 0 }}>
        {!ticker ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8b949e",
              fontSize: "12px",
            }}
          >
            Click a ticker in the watchlist to view its chart
          </div>
        ) : data.length < 2 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8b949e",
              fontSize: "12px",
            }}
          >
            Accumulating data for {ticker}...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
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
                domain={[minPrice - padding, maxPrice + padding]}
                tick={{ fill: "#8b949e", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={50}
              />
              <Tooltip content={CustomTooltip} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={1.5}
                fill="url(#chartGradient)"
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
