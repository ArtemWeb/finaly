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

      // Whether this call is the one that actually inserted the ticker — only
      // then should a revert remove it (avoids dropping a concurrent insert).
      let inserted = false;

      // Optimistic insert — no price/previous_price yet (SSE will populate).
      const optimisticEntry: WatchlistEntry = {
        ticker,
        added_at: new Date().toISOString(),
        price: null,
      };
      setWatchlist((curr) => {
        if (curr.some((w) => w.ticker === ticker)) return curr;
        inserted = true;
        return [...curr, optimisticEntry];
      });

      // WR-03: revert surgically with a functional updater so concurrent
      // in-flight mutations (e.g. a remove of a different ticker) are not
      // clobbered by replacing the whole array with a stale render-time snapshot.
      const revert = () => {
        if (inserted) {
          setWatchlist((curr) => curr.filter((w) => w.ticker !== ticker));
        }
      };

      try {
        const res = await fetch(apiUrl('/api/watchlist'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        // WR-07: read the body once (before refresh consumes nothing else) and
        // treat any 2xx as success regardless of body parseability — an empty
        // 200 body must not produce a misleading "Couldn't add" toast.
        if (!res.ok) {
          revert();
          return false;
        }
        await safeJson<WatchlistAddResponse>(res);
        // Reconcile to server's authoritative state.
        await refreshWatchlist();
        return true;
      } catch {
        revert();
        return false;
      }
    },
    [refreshWatchlist],
  );

  const removeTicker = useCallback(
    async (ticker: string): Promise<boolean> => {
      // Capture the entry being removed so a revert can re-insert exactly it
      // (functional updater — does not clobber concurrent in-flight changes; WR-03).
      let removedEntry: WatchlistEntry | undefined;
      setWatchlist((curr) => {
        removedEntry = curr.find((w) => w.ticker === ticker);
        return curr.filter((w) => w.ticker !== ticker);
      });

      try {
        const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
          method: 'DELETE',
        });
        if (!res.ok) {
          // WR-03: surgically re-insert only this entry if it isn't already back.
          setWatchlist((curr) =>
            curr.some((w) => w.ticker === ticker) || !removedEntry
              ? curr
              : [...curr, removedEntry],
          );
          return false;
        }
        // WR-02: clear the ring buffer ONLY after a confirmed-successful DELETE,
        // not optimistically. This avoids wiping the buffer twice (WatchlistRow no
        // longer clears too) and prevents a phantom empty-sparkline time gap when
        // a failed remove reverts the row.
        clearTicker(ticker);
        return true;
      } catch {
        setWatchlist((curr) =>
          curr.some((w) => w.ticker === ticker) || !removedEntry
            ? curr
            : [...curr, removedEntry],
        );
        return false;
      }
    },
    [clearTicker],
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
