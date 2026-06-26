"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { PriceUpdate, ConnectionStatus } from "@/app/types";

export interface PriceMap {
  [ticker: string]: PriceUpdate;
}

export interface SparklineMap {
  [ticker: string]: number[];
}

const MAX_SPARKLINE_POINTS = 60;

export function usePriceStream() {
  const [prices, setPrices] = useState<PriceMap>({});
  const [sparklines, setSparklines] = useState<SparklineMap>({});
  const [flashMap, setFlashMap] = useState<{ [ticker: string]: "up" | "down" | null }>({});
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    setConnectionStatus("reconnecting");

    const es = new EventSource("/api/stream/prices");
    esRef.current = es;

    es.onopen = () => {
      setConnectionStatus("connected");
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    es.onmessage = (event) => {
      try {
        // Backend sends a dict of all tickers: { "AAPL": {ticker, price, ...}, ... }
        const batch = JSON.parse(event.data) as Record<string, PriceUpdate>;

        const updates = Object.values(batch);
        if (updates.length === 0) return;

        setPrices((prev) => {
          const next = { ...prev };
          for (const update of updates) next[update.ticker] = update;
          return next;
        });

        setSparklines((prev) => {
          const next = { ...prev };
          for (const update of updates) {
            const existing = next[update.ticker] || [];
            next[update.ticker] = [...existing, update.price].slice(-MAX_SPARKLINE_POINTS);
          }
          return next;
        });

        for (const update of updates) {
          if (update.direction === "up" || update.direction === "down") {
            setFlashMap((prev) => ({ ...prev, [update.ticker]: update.direction as "up" | "down" }));
            setTimeout(() => {
              setFlashMap((prev) => ({ ...prev, [update.ticker]: null }));
            }, 500);
          }
        }
      } catch (err) {
        console.error("Failed to parse price update:", err);
      }
    };

    es.onerror = () => {
      setConnectionStatus("disconnected");
      es.close();
      esRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimer.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connect]);

  return { prices, sparklines, flashMap, connectionStatus };
}
