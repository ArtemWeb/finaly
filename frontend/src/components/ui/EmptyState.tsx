/**
 * EmptyState — shared empty-state primitive.
 *
 * Panel fills with bg-surface-panel and a centered heading + body. An
 * optional CTA slot renders below for actions like "Add ticker above".
 *
 * Consumers pass the VERBATIM copy strings from the UI-SPEC copywriting
 * contract — no synonyms.
 */

import type { CSSProperties, ReactNode } from 'react';

export interface EmptyStateProps {
  heading: string;
  body: string;
  /** Optional CTA (button, link, etc.). */
  action?: ReactNode;
  /** Override the min height if a panel needs a shorter empty state. */
  minHeightClass?: string;
  /**
   * Inline style applied to the root. Use for RUNTIME-derived dimensions
   * (e.g. a min-height computed from a prop) that Tailwind's static JIT
   * scanner cannot see as a literal arbitrary-value class (CR-03).
   */
  style?: CSSProperties;
}

export function EmptyState({
  heading,
  body,
  action,
  minHeightClass = 'min-h-[200px]',
  style,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-4 py-6 ${minHeightClass}`}
      style={style}
    >
      <div className="text-sm font-semibold text-text-primary mb-1">{heading}</div>
      <div className="text-xs text-text-muted max-w-[240px]">{body}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
