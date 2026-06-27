'use client';

/**
 * useSse — opens a native EventSource to /api/stream/prices and exposes the
 * connection status. The hook itself does NOT hold price state — the consumer
 * (PriceContext) receives parsed payloads via onMessage and decides how to
 * apply them (rAF-debounced state, ring buffers, etc.).
 *
 * Behaviour (per UI-12 + RESEARCH Pattern 1):
 *   - URL is apiUrl('/api/stream/prices') (D-01 chokepoint)
 *   - onopen → status 'open' (green dot)
 *   - onerror → status 'error' (red dot); NO custom backoff — the browser
 *     auto-reconnects per the server's `retry: 1000` directive.
 *   - onmessage → JSON.parse the flat {ticker: PriceUpdate} map and call
 *     onMessage. Parse errors are swallowed (Pitfall 7 / T-03-07).
 *   - Closes the EventSource on unmount.
 *
 * Never gate UI rendering on status (Pitfall 2): the dot is decoration, not
 * a handshake gate.
 */

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/lib/api';
import type { SsePayload } from '@/lib/types';

export type ConnectionStatus = 'connecting' | 'open' | 'error';

export interface UseSseResult {
  status: ConnectionStatus;
}

export function useSse(onMessage: (payload: SsePayload) => void): UseSseResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  // Keep the latest onMessage in a ref so we don't re-open the connection
  // on every render (the upstream callback may not be memoised).
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const url = apiUrl('/api/stream/prices');
    const es = new EventSource(url);

    es.onopen = () => {
      setStatus('open');
    };

    es.onerror = () => {
      // Browser auto-reconnects per server `retry: 1000`. We just report
      // the visible state — no manual backoff (UI-12 / RESEARCH Pitfall 2).
      setStatus('error');
    };

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as SsePayload;
        // A successful message implies the connection is open, even if
        // onopen fired before we attached the handler (race-safe).
        setStatus('open');
        onMessageRef.current(payload);
      } catch {
        // T-03-07: parse errors are accepted-risk; logged via console only.
        // eslint-disable-next-line no-console
        console.error('SSE parse error');
      }
    };

    return () => {
      es.close();
    };
  }, []);

  return { status };
}
