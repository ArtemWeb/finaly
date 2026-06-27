'use client';

/**
 * PortfolioContext — LOW-CHURN server-state context.
 *
 * Holds:
 *   - `portfolio`: cash_balance + positions from GET /api/portfolio
 *   - `watchlist`: tracked tickers from GET /api/watchlist
 *   - `history`: P&L snapshots from GET /api/portfolio/history (for PnLChart)
 *   - loading flags for each slice
 *   - `refreshPortfolio()` / `refreshWatchlist()` actions
 *   - `addTicker()` / `removeTicker()` mutators with optimistic update +
 *     revert on failure (UI-10)
 *
 * Cadence (D-05): poll /api/portfolio + /api/portfolio/history every 10s for
 * safety; do NOT poll for prices (those come via SSE). On any mutation
 * (add/remove/trade) we refetch immediately so the local cache converges to
 * the server's authoritative state.
 *
 * D-06: this context NEVER stores a `total_value` field derivable from the
 * combination of cash + positions + prices. The Header computes the live
 * total in a useMemo across BOTH contexts.
 *
 * Pitfall 3: when a ticker is removed from the watchlist, we also wipe its
 * ring buffer in PriceContext so the next re-add starts fresh.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiUrl } from '@/lib/api';
import type {
  HistoryPoint,
  Portfolio,
  WatchlistAddResponse,
  WatchlistEntry,
} from '@/lib/types';
import { usePrices } from './PriceContext';

const POLL_INTERVAL_MS = 10_000;

export interface PortfolioContextValue {
  portfolio: Portfolio | null;
  watchlist: WatchlistEntry[];
  history: HistoryPoint[];
  portfolioLoading: boolean;
  watchlistLoading: boolean;
  historyLoading: boolean;
  refreshPortfolio: () => Promise<void>;
  refreshWatchlist: () => Promise<void>;
  addTicker: (ticker: string) => Promise<boolean>;
  removeTicker: (ticker: string) => Promise<boolean>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { clearTicker } = usePrices();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Track mounted state so we don't setState after unmount on slow fetches.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshPortfolio = useCallback(async () => {
    try {
      const [portfolioRes, historyRes] = await Promise.all([
        fetch(apiUrl('/api/portfolio')),
        fetch(apiUrl('/api/portfolio/history')),
      ]);
      if (!mountedRef.current) return;
      if (portfolioRes.ok) {
        const data = await safeJson<Portfolio>(portfolioRes);
        if (data) setPortfolio(data);
      }
      if (historyRes.ok) {
        const data = await safeJson<HistoryPoint[]>(historyRes);
        if (data) setHistory(data);
      }
    } finally {
      if (mountedRef.current) {
        setPortfolioLoading(false);
        setHistoryLoading(false);
      }
    }
  }, []);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/watchlist'));
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await safeJson<WatchlistEntry[]>(res);
        if (data) setWatchlist(data);
      }
    } finally {
      if (mountedRef.current) {
        setWatchlistLoading(false);
      }
    }
  }, []);

  // Initial fetch + 10s safety poll (UI-09 / RESEARCH anti-pattern guard:
  // do NOT poll for prices — SSE handles that).
  useEffect(() => {
    void refreshPortfolio();
    void refreshWatchlist();
    const id = setInterval(() => {
      void refreshPortfolio();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshPortfolio, refreshWatchlist]);

  // ---- Mutations (UI-10) ----

  const addTicker = useCallback(
    async (rawTicker: string): Promise<boolean> => {
      const ticker = rawTicker.trim().toUpperCase();
      if (!ticker) return false;

      // Optimistic insert — no price/previous_price yet (SSE will populate).
      const optimisticEntry: WatchlistEntry = {
        ticker,
        added_at: new Date().toISOString(),
        price: null,
      };
      const previous = watchlist;
      setWatchlist((curr) =>
        curr.some((w) => w.ticker === ticker) ? curr : [...curr, optimisticEntry],
      );

      try {
        const res = await fetch(apiUrl('/api/watchlist'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        if (!res.ok) {
          // Revert optimistic insert on failure.
          setWatchlist(previous);
          return false;
        }
        // Reconcile to server's authoritative state.
        await refreshWatchlist();
        const body = await safeJson<WatchlistAddResponse>(res);
        return body?.status === 'ok';
      } catch {
        setWatchlist(previous);
        return false;
      }
    },
    [watchlist, refreshWatchlist],
  );

  const removeTicker = useCallback(
    async (ticker: string): Promise<boolean> => {
      const previous = watchlist;
      setWatchlist((curr) => curr.filter((w) => w.ticker !== ticker));
      // Pitfall 3: clear the ring buffer so a future re-add starts fresh.
      clearTicker(ticker);

      try {
        const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
          method: 'DELETE',
        });
        if (!res.ok) {
          setWatchlist(previous);
          // Also restore the ring buffer? No — leaving it cleared is fine;
          // SSE will repopulate on the optimistic insert above when the user
          // re-adds. We just revert the watchlist UI list.
          return false;
        }
        return true;
      } catch {
        setWatchlist(previous);
        return false;
      }
    },
    [watchlist, clearTicker],
  );

  const value = useMemo<PortfolioContextValue>(
    () => ({
      portfolio,
      watchlist,
      history,
      portfolioLoading,
      watchlistLoading,
      historyLoading,
      refreshPortfolio,
      refreshWatchlist,
      addTicker,
      removeTicker,
    }),
    [
      portfolio,
      watchlist,
      history,
      portfolioLoading,
      watchlistLoading,
      historyLoading,
      refreshPortfolio,
      refreshWatchlist,
      addTicker,
      removeTicker,
    ],
  );

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return ctx;
}
