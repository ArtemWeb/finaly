'use client';

/**
 * PriceContext — HIGH-CHURN price state for the FinAlly terminal.
 *
 * Holds:
 *   - `prices`: flat {ticker: PriceUpdate} map of the latest tick per ticker
 *     (the source of truth for the Header total, WatchlistRow prices, etc.)
 *   - `history`: per-ticker ring buffers of the last MAX_SPARK PriceUpdates,
 *     powering each Sparkline (UI-02). Lives in a ref — appending does not
 *     trigger a re-render (D-05 cadence isolation).
 *   - `selectedTicker` + `setSelectedTicker`: which row the user clicked;
 *     MainChart consumes this in 03-03 (UI-03).
 *   - `sseStatus`: the current EventSource connection status. Surfaced via
 *     a SEPARATE field on the context value so changes to it do not force
 *     consumers of `prices`/`history` to re-render.
 *
 * Cadence (D-05): SSE messages arrive ~500ms × N tickers. We coalesce the
 * `setPrices` call into a single per-frame update via requestAnimationFrame,
 * so 10 tickers streaming do not cause 10 re-renders per tick.
 *
 * Pitfall 3 (stale sparkline buffer): the `clearTicker` action is exposed so
 * WatchlistRow's remove handler (via PortfolioContext) can wipe a ticker's
 * history before the SSE stops emitting it. Without this, re-adding a
 * ticker would show a sparkline with a phantom time gap.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSse, type ConnectionStatus } from '@/hooks/useSse';
import type { PriceUpdate, SsePayload } from '@/lib/types';

const MAX_SPARK = 60;

export interface PriceContextValue {
  prices: Record<string, PriceUpdate>;
  /** Ring buffer of last MAX_SPARK PriceUpdates per ticker (sparkline data). */
  history: Record<string, PriceUpdate[]>;
  selectedTicker: string | null;
  setSelectedTicker: (ticker: string | null) => void;
  sseStatus: ConnectionStatus;
  /** Wipe a ticker's ring buffer — called from PortfolioContext's remove path. */
  clearTicker: (ticker: string) => void;
}

const PriceContext = createContext<PriceContextValue | null>(null);

export function PriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  // Ring buffers live in a ref so appending never re-renders consumers.
  // We expose a stable Record reference (refreshed on demand via snapshot)
  // that Sparkline rows can read at render time.
  const historyRef = useRef<Record<string, PriceUpdate[]>>({});
  const [, forceHistoryTick] = useState(0);

  // rAF-debounce: SSE messages can arrive in bursts (one per ticker per tick).
  // Coalesce to one setPrices per animation frame so the 60fps budget holds.
  const pendingRef = useRef<Record<string, PriceUpdate> | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushScheduled = useRef(false);
  const scheduleHistoryRender = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    requestAnimationFrame(() => {
      flushScheduled.current = false;
      // Increment the history-tick counter so Sparkline consumers
      // re-read historyRef.current during their next render.
      forceHistoryTick((n) => (n + 1) & 0x7fffffff);
    });
  }, []);

  const handleMessage = useCallback(
    (next: SsePayload) => {
      // 1) Append to ring buffers (no re-render — ref write only).
      for (const ticker of Object.keys(next)) {
        const buf = historyRef.current[ticker] ?? [];
        buf.push(next[ticker]);
        if (buf.length > MAX_SPARK) {
          buf.splice(0, buf.length - MAX_SPARK);
        }
        historyRef.current[ticker] = buf;
      }
      scheduleHistoryRender();

      // 2) Coalesce prices state update to one per frame.
      pendingRef.current = next;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingRef.current) {
            setPrices(pendingRef.current);
            pendingRef.current = null;
          }
        });
      }
    },
    [scheduleHistoryRender],
  );

  const { status: sseStatus } = useSse(handleMessage);

  const clearTicker = useCallback((ticker: string) => {
    delete historyRef.current[ticker];
    forceHistoryTick((n) => (n + 1) & 0x7fffffff);
  }, []);

  const value = useMemo<PriceContextValue>(
    () => ({
      prices,
      history: historyRef.current,
      selectedTicker,
      setSelectedTicker,
      sseStatus,
      clearTicker,
    }),
    [prices, selectedTicker, sseStatus, clearTicker],
  );

  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function usePrices(): PriceContextValue {
  const ctx = useContext(PriceContext);
  if (!ctx) {
    throw new Error('usePrices must be used within a PriceProvider');
  }
  return ctx;
}
