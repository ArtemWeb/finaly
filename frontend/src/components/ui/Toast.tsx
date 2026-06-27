'use client';

/**
 * Toast — bottom-right ephemeral notification.
 *
 * Provides a small event-bus-style dispatch so any component (TradeBar in
 * 03-03, WatchlistRow's remove handler, etc.) can fire a toast without
 * coupling to the visual component itself. The bus is a module-level
 * singleton with a subscription list — minimal surface area, no extra
 * dependency on a toast library.
 *
 * Behaviour (per UI-SPEC):
 *   - Bottom-right, 3s auto-dismiss
 *   - success → profit-coloured left border + icon
 *   - error → loss-coloured left border + icon
 *   - Multiple toasts stack vertically
 *
 * No dangerouslySetInnerHTML: messages are rendered via {message} so any
 * HTML special chars in backend `detail` strings are auto-escaped.
 */

import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export type ToastVariant = 'success' | 'error';

export interface ToastMessage {
  id: number;
  variant: ToastVariant;
  message: string;
}

const TOAST_TTL_MS = 3000;

type Listener = (toasts: ToastMessage[]) => void;
const listeners = new Set<Listener>();
let toastStore: ToastMessage[] = [];
let nextId = 1;

function notify(): void {
  for (const l of listeners) l(toastStore);
}

export function toast(variant: ToastVariant, message: string): void {
  const id = nextId++;
  toastStore = [...toastStore, { id, variant, message }];
  notify();
  setTimeout(() => {
    toastStore = toastStore.filter((t) => t.id !== id);
    notify();
  }, TOAST_TTL_MS);
}

function ToastViewport() {
  const [toasts, setToasts] = useState<ToastMessage[]>(toastStore);
  useEffect(() => {
    const listener: Listener = (next) => setToasts(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((t) => {
        const isError = t.variant === 'error';
        const borderClass = isError ? 'border-loss' : 'border-profit';
        const textClass = isError ? 'text-loss' : 'text-profit';
        const Icon = isError ? XCircle : CheckCircle2;
        return (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-2 bg-surface-raised border-l-4 ${borderClass} ${textClass} px-3 py-2 text-sm shadow-lg`}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span className="text-text-primary break-words">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

export { ToastViewport as Toast };
