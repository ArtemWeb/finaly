'use client';

/**
 * ChatMessage — one message bubble (user vs assistant) with inline chips.
 *
 * Renders:
 *   - User messages: right-aligned bubble with user styling.
 *   - Assistant messages: left-aligned bubble with the assistant's text,
 *     followed by inline confirmation CHIPS for any executed trades or
 *     watchlist changes. Chip copy is UI-SPEC verbatim:
 *       - "✓ Bought {qty} {ticker} @ \${price}"   (executed buy)
 *       - "✓ Sold {qty} {ticker} @ \${price}"     (executed sell)
 *       - "✓ Added {ticker} to watchlist"          (executed watchlist add)
 *       - "✓ Removed {ticker} from watchlist"      (executed watchlist remove)
 *       - "✗ Trade failed: {detail from API}"      (failed trade)
 *
 * Price derivation (RESEARCH Chat Actions Shape refinement): the chat
 * response's `actions.trades[].detail` is "Executed at \$190.50; ..." —
 * we extract the price with a regex so we don't need a redundant
 * /api/portfolio fetch just to render the chip.
 *
 * No dangerouslySetInnerHTML anywhere; all text via {value} JSX (React
 * auto-escapes — T-03-09 XSS mitigation).
 */

import { Check, X } from 'lucide-react';
import type {
  ChatResponse,
  ChatTradeAction,
  ChatWatchlistAction,
} from '@/lib/types';

const PRICE_RE = /Executed at \$([\d.]+)/;

function extractPrice(detail: string): string | null {
  const match = PRICE_RE.exec(detail);
  return match ? match[1] : null;
}

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatResponse['actions'];
}

export function ChatMessage({ role, content, actions }: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div data-testid="chat-message" className="flex justify-end">
        <div className="max-w-[85%] bg-accent-blue/20 border border-accent-blue/40 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chat-message" className="flex flex-col gap-2 items-start">
      <div className="max-w-[85%] bg-surface-raised border border-white/5 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap break-words">
        {content}
      </div>
      {actions ? <ActionChips actions={actions} /> : null}
    </div>
  );
}

function ActionChips({ actions }: { actions: ChatResponse['actions'] }) {
  const trades = actions.trades ?? [];
  const watchlist = actions.watchlist_changes ?? [];
  if (trades.length === 0 && watchlist.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 items-start max-w-[85%]">
      {trades.map((t, i) => (
        <TradeChip key={`trade-${i}`} trade={t} />
      ))}
      {watchlist.map((w, i) => (
        <WatchlistChip key={`watch-${i}`} watch={w} />
      ))}
    </div>
  );
}

function TradeChip({ trade }: { trade: ChatTradeAction }) {
  if (trade.status === 'executed') {
    const price = extractPrice(trade.detail);
    const priceLabel = price ?? '?';
    const verb = trade.side === 'buy' ? 'Bought' : 'Sold';
    return (
      <div data-testid="trade-chip" className="flex items-center gap-1 px-2 py-1 text-xs border border-profit/40 bg-profit/10 text-profit font-mono">
        <Check className="w-3 h-3" aria-hidden="true" />
        <span>{`${verb} ${trade.quantity} ${trade.ticker} @ $${priceLabel}`}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-xs border border-loss/40 bg-loss/10 text-loss font-mono">
      <X className="w-3 h-3" aria-hidden="true" />
      <span>{`Trade failed: ${trade.detail}`}</span>
    </div>
  );
}

function WatchlistChip({ watch }: { watch: ChatWatchlistAction }) {
  if (watch.status === 'ok') {
    const verb = watch.action === 'add' ? 'Added' : 'Removed';
    const target = watch.action === 'add' ? 'to watchlist' : 'from watchlist';
    return (
      <div className="flex items-center gap-1 px-2 py-1 text-xs border border-profit/40 bg-profit/10 text-profit font-mono">
        <Check className="w-3 h-3" aria-hidden="true" />
        <span>{`${verb} ${watch.ticker} ${target}`}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-xs border border-loss/40 bg-loss/10 text-loss font-mono">
      <X className="w-3 h-3" aria-hidden="true" />
      <span>{`Watchlist failed: ${watch.detail ?? 'unknown error'}`}</span>
    </div>
  );
}