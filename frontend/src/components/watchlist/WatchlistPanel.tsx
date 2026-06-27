'use client';

/**
 * WatchlistPanel — left-column panel.
 *
 * Stub: Task 2 only needs the panel to exist so AppShell compiles and the
 * 3-column layout renders. Task 3 expands this to the full UI: add-ticker
 * input, row list, EmptyState, optimistic add/remove.
 *
 * Per UI-SPEC the panel title is "Watchlist" (verbatim) and lives in a
 * bg-surface-panel container with a border-white/5 border.
 */

export function WatchlistPanel() {
  return (
    <section className="bg-surface-panel border border-white/5 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <span className="text-xs font-semibold tracking-wider text-text-muted uppercase">Watchlist</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs px-4 text-center">
        Watchlist rows load in 03-02 Task 3.
      </div>
    </section>
  );
}
