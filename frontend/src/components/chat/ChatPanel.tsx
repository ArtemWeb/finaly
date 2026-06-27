'use client';

/**
 * ChatPanel — AI assistant panel (UI-08).
 *
 * Stub: full implementation lands in plan 03-03 Task 3. This stub exists so
 * AppShell compiles when we add it to the right column in Task 2 (same
 * file-modification coordination pattern used in plan 03-02 for
 * WatchlistPanel).
 */

import { EmptyState } from '@/components/ui/EmptyState';

export function ChatPanel() {
  return (
    <div className="bg-surface-panel border border-white/5 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        AI Assistant
      </div>
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          heading="Ask your AI trading assistant"
          body={'Try: "What\'s my biggest position?" or "Buy 5 shares of NVDA".'}
          minHeightClass="min-h-[200px]"
        />
      </div>
    </div>
  );
}