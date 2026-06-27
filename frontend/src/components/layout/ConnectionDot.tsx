'use client';

/**
 * ConnectionDot — reflects the SSE connection status (UI-12, D-03).
 *
 *   - connecting → yellow
 *   - open       → green
 *   - error      → red
 *
 * The dot starts YELLOW on first render (before onopen fires), then flips
 * green when the EventSource connects. Per UI-SPEC Accessibility, this
 * carries role="status" + aria-label set to the VERBATIM tooltip copy.
 */

import { usePrices } from '@/context/PriceContext';
import type { ConnectionStatus } from '@/hooks/useSse';

const TOOLTIP: Record<ConnectionStatus, string> = {
  open: 'Live — streaming prices',
  connecting: 'Reconnecting…',
  error: 'Connection lost — retrying',
};

const DOT_CLASS: Record<ConnectionStatus, string> = {
  open: 'bg-accent-blue',
  connecting: 'bg-accent-yellow',
  error: 'bg-loss',
};

export function ConnectionDot() {
  const { sseStatus } = usePrices();
  const label = TOOLTIP[sseStatus];
  const colorClass = DOT_CLASS[sseStatus];

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`inline-block w-2.5 h-2.5 rounded-full ${colorClass}`}
    />
  );
}
