/**
 * Shared formatters for the FinAlly terminal.
 *
 * Centralised so every panel renders consistent currency / percent / time
 * strings. formatPercent carries a leading + or - so colour is never the
 * sole signal (UI-SPEC accessibility / V7).
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return currencyFormatter.format(value);
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return priceFormatter.format(value);
}

/**
 * Signed percent with explicit + or - prefix. Zero renders as "0.00%".
 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${abs.toFixed(2)}%`;
}

/**
 * Format a timestamp as HH:MM (24-hour) for chart axes.
 * Accepts Unix seconds (number) or ISO 8601 string.
 */
export function formatTime(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}