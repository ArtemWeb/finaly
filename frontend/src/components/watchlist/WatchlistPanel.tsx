'use client';

/**
 * WatchlistPanel — left-column watchlist panel.
 *
 * Layout:
 *   ┌─ "Watchlist" title ─────────────────────────────┐
 *   │ [Add ticker input ........] [Add]               │
 *   ├──────────────────────────────────────────────────┤
 *   │ WatchlistRow[]                                   │
 *   │ (or EmptyState when watchlist is empty)          │
 *   └──────────────────────────────────────────────────┘
 *
 * UI-10: Add-ticker input posts to /api/watchlist via PortfolioContext.addTicker
 * (optimistic insert + revert). Validates uppercase-alphanumeric client-side as
 * UX; backend re-validates (watchlist.py isalnum) as the security boundary.
 *
 * UI-SPEC Copywriting (verbatim):
 *   - Title: "Watchlist"
 *   - Input placeholder: "Add ticker (e.g. PYPL)"
 *   - Add button: "Add"
 *   - Empty heading: "No tickers yet"
 *   - Empty body: "Add a ticker above to start tracking live prices."
 *
 * All ticker strings are rendered via {ticker} — no dangerouslySetInnerHTML.
 */

import { useState, type FormEvent } from 'react';
import { usePortfolio } from '@/context/PortfolioContext';
import { toast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { WatchlistRow } from './WatchlistRow';

const TICKER_RE = /^[A-Z0-9]{1,10}$/;

export function WatchlistPanel() {
  const { watchlist, addTicker } = usePortfolio();
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const ticker = draft.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      toast('error', 'Ticker must be 1-10 uppercase letters or digits.');
      return;
    }
    if (watchlist.some((w) => w.ticker === ticker)) {
      toast('error', `${ticker} is already in your watchlist.`);
      return;
    }
    setSubmitting(true);
    const ok = await addTicker(ticker);
    setSubmitting(false);
    if (ok) {
      setDraft('');
    } else {
      toast('error', `Couldn't add ${ticker}. Please try again.`);
    }
  }

  return (
    <section className="bg-surface-panel border border-white/5 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <span className="text-xs font-semibold tracking-wider text-text-muted uppercase">
          Watchlist
        </span>
      </div>

      <form onSubmit={handleSubmit} className="px-3 py-3 border-b border-white/5 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add ticker (e.g. PYPL)"
          maxLength={10}
          aria-label="Ticker symbol to add"
          className="flex-1 min-w-0 bg-surface-raised border border-white/5 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
        <button
          type="submit"
          disabled={submitting || draft.trim().length === 0}
          className="px-3 py-1 text-xs font-semibold tracking-wider uppercase bg-accent-blue text-surface-base disabled:bg-surface-raised disabled:text-text-muted hover:bg-accent-blue/90 focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-surface-panel"
        >
          Add
        </button>
      </form>

      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {watchlist.length === 0 ? (
          <EmptyState
            heading="No tickers yet"
            body="Add a ticker above to start tracking live prices."
          />
        ) : (
          watchlist.map((entry) => <WatchlistRow key={entry.ticker} ticker={entry.ticker} />)
        )}
      </div>
    </section>
  );
}
