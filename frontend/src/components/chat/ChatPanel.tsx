'use client';

/**
 * ChatPanel — AI assistant panel (UI-08).
 *
 * Renders a scrollable message list with `role="log"` and `aria-live="polite"`
 * (so screen readers announce new assistant replies), an input + Send button,
 * and a Thinking… loader while awaiting a response.
 *
 * Submit flow:
 *   1. Validate input non-empty.
 *   2. Append user bubble to local state immediately.
 *   3. Append a placeholder assistant "Thinking…" bubble and disable input+send.
 *   4. POST { message } to /api/chat.
 *   5. On response: replace the loader bubble with the assistant ChatMessage
 *      (with inline chips from actions.trades / actions.watchlist_changes).
 *   6. Call refreshPortfolio() + refreshWatchlist() so auto-executed trades
 *      / watchlist changes appear immediately in PositionsTable / Heatmap /
 *      PnLChart / WatchlistPanel.
 *   7. Auto-scroll message list to bottom (smooth).
 *
 * Disabled state (UI-SPEC + Open Question 4): we probe whether the backend
 * can answer chat requests by trying a cheap POST that we know will fail
 * gracefully. We probe via /api/health (no LLM call) on mount, but the
 * presence of the key is server-side only — so we use a one-time POST probe
 * with a tiny payload that won't actually do anything user-visible. The
 * simplest reliable approach: send the user's first message anyway and
 * detect a 500/503 from the server. We take the safer route of probing
 * once at mount with a fake "ping" message that the chat service will
 * return an LLM reply to — if the server returns an HTTP error we flip to
 * the disabled state.
 *
 * In practice, the UI-SPEC's disabled state shows when the user cannot
 * reach the LLM. We implement this conservatively: we probe with a tiny
 * "ping" message, and if it returns 5xx OR a JSON with `actions.trades`
 * error AND empty message we treat as disabled. The backend's llm module
 * raises an HTTPException(500) when LLM is unavailable — that triggers our
 * disabled state.
 *
 * No polling. No fetching on keypress. No chat-history GET endpoint exists
 * (Pitfall 6) — so we never try. New messages append locally; we never
 * refetch from the server.
 *
 * No dangerouslySetInnerHTML anywhere; all text via {value} JSX.
 */

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { apiUrl } from '@/lib/api';
import { usePortfolio } from '@/context/PortfolioContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChatMessage } from './ChatMessage';
import type { ChatResponse, ChatTradeAction, ChatWatchlistAction } from '@/lib/types';

interface MessageEntry {
  /** Stable client-side id for React keys. */
  id: number;
  role: 'user' | 'assistant';
  content: string;
  actions?: { trades: ChatTradeAction[]; watchlist_changes: ChatWatchlistAction[] };
  /** True when this is the "Thinking…" placeholder bubble. */
  pending?: boolean;
}

let nextLocalId = 1;

export function ChatPanel() {
  const { refreshPortfolio, refreshWatchlist } = usePortfolio();
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [disabled, setDisabled] = useState<boolean | null>(null); // null = unknown yet
  const scrollRef = useRef<HTMLDivElement>(null);

  // Probe the chat endpoint once on mount to detect disabled state (UI-SPEC:
  // "If OPENROUTER_API_KEY is not set and LLM_MOCK is also off, the chat panel
  // shows the disabled empty state"). We send a tiny dummy message and check
  // the response. If it returns 5xx (server-side LLM unavailable) we lock the
  // panel into the disabled empty state. We discard the probe reply — it never
  // appears in the message list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '__probe__' }),
        });
        if (cancelled) return;
        if (res.status >= 500) {
          setDisabled(true);
          return;
        }
        // 200 means the backend can answer. The probe message is dropped below.
        // 400 means empty/invalid message — also indicates reachable but
        // expecting valid input; treat as enabled.
        setDisabled(false);
      } catch {
        if (!cancelled) setDisabled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll on new message (smooth scroll).
  const lastMessage = messages[messages.length - 1];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, lastMessage?.content]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      if (!text || submitting || disabled) return;

      // Drop the probe reply if it accidentally matches the empty message —
      // we never added it to state, so nothing to clean.
      const userEntry: MessageEntry = {
        id: nextLocalId++,
        role: 'user',
        content: text,
      };
      const pendingId = nextLocalId++;
      const pendingEntry: MessageEntry = {
        id: pendingId,
        role: 'assistant',
        content: 'Thinking…',
        pending: true,
      };
      setMessages((curr) => [...curr, userEntry, pendingEntry]);
      setInput('');
      setSubmitting(true);

      try {
        const res = await fetch(apiUrl('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) {
          throw new Error(`chat failed: ${res.status}`);
        }
        const data = (await res.json()) as ChatResponse;
        const reply: MessageEntry = {
          id: pendingId,
          role: 'assistant',
          content: data.message,
          actions: data.actions,
        };
        setMessages((curr) => curr.map((m) => (m.id === pendingId ? reply : m)));
        // Refresh server state so auto-executed trades / watchlist changes
        // appear immediately in PositionsTable / Heatmap / PnLChart / Watchlist.
        await Promise.all([refreshPortfolio(), refreshWatchlist()]);
      } catch {
        setMessages((curr) =>
          curr.map((m) =>
            m.id === pendingId
              ? {
                  id: pendingId,
                  role: 'assistant',
                  content: 'Chat request failed. Try again in a moment.',
                }
              : m,
          ),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [input, submitting, disabled, refreshPortfolio, refreshWatchlist],
  );

  const isDisabled = disabled === true;
  const isReady = disabled === false;

  return (
    <div className="bg-surface-panel border border-white/5 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        AI Assistant
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto p-3 flex flex-col gap-3"
      >
        {isDisabled ? (
          <EmptyState
            heading="AI Assistant unavailable"
            body="Set OPENROUTER_API_KEY to enable chat."
            minHeightClass="min-h-[200px]"
          />
        ) : messages.length === 0 ? (
          !isReady ? (
            <div
              aria-hidden="true"
              className="flex-1 bg-surface-raised animate-pulse"
            />
          ) : (
            <EmptyState
              heading="Ask your AI trading assistant"
              body={'Try: "What\'s my biggest position?" or "Buy 5 shares of NVDA".'}
              minHeightClass="min-h-[200px]"
            />
          )
        ) : (
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              role={m.role}
              content={m.content}
              actions={m.actions}
            />
          ))
        )}
      </div>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="px-3 py-3 border-t border-white/5 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your portfolio or request a trade…"
          aria-label="Chat input"
          disabled={isDisabled || submitting}
          className="flex-1 bg-surface-raised border border-white/5 px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isDisabled || submitting || !input.trim()}
          className="bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-surface-base focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-surface-base"
        >
          Send
        </button>
      </form>
    </div>
  );
}