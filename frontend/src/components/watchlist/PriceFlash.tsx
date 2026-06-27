'use client';

/**
 * PriceFlash — wrapper that flashes the cell background green/red for 500ms
 * when the price changes, then transitions back to transparent via Tailwind's
 * `transition-colors duration-500`.
 *
 * UI-01 + RESEARCH "Don't Hand-Roll": drive the flash class declaratively via
 * a `useEffect` timer that tracks `price` vs `previousPrice`. Avoids the
 * setTimeout-class-toggle race against React's render cycle.
 *
 *   - price > previousPrice → bg-profit/20 (uptick)
 *   - price < previousPrice → bg-loss/20   (downtick)
 *   - price === previousPrice OR first render → no flash
 *
 * Renders an inline <span> with a key so React knows to re-evaluate the
 * effect when the price value changes.
 */

import { useEffect, useState, type ReactNode } from 'react';

export interface PriceFlashProps {
  price: number;
  previousPrice?: number;
  className?: string;
  children?: ReactNode;
}

type FlashState = 'none' | 'up' | 'down';

export function PriceFlash({ price, previousPrice, className, children }: PriceFlashProps) {
  const [flash, setFlash] = useState<FlashState>('none');

  useEffect(() => {
    if (previousPrice === undefined) return;
    if (price > previousPrice) {
      setFlash('up');
    } else if (price < previousPrice) {
      setFlash('down');
    } else {
      return;
    }
    const id = window.setTimeout(() => setFlash('none'), 500);
    return () => window.clearTimeout(id);
  }, [price, previousPrice]);

  const flashClass =
    flash === 'up'
      ? 'bg-profit/20'
      : flash === 'down'
        ? 'bg-loss/20'
        : '';

  return (
    <span
      className={`inline-block px-1 -mx-1 rounded-sm transition-colors duration-500 ${flashClass} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
