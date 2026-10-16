import { formatCurrency, formatNumber } from '@angular/common';
import { NumberRange, ProducerSettings } from '../../core/models/producer-settings';

export const UNAVAILABLE = '—';

/** Formats integer cents as USD with 2 decimals; rounding happens for display only. */
export function formatCents(cents: number | null): string {
  if (cents === null) {
    return UNAVAILABLE;
  }
  return formatCurrency(cents / 100, 'en-US', '$', 'USD', '1.2-2');
}

export function formatVolume(v: number): string {
  return formatNumber(v, 'en-US', '1.0-0');
}

/** Signed ratio with 2 decimals: `+0.20`, `-1.00`, `0.00` (never `-0.00`). */
export function formatImbalance(x: number | null): string {
  if (x === null) {
    return UNAVAILABLE;
  }
  const fixed = x.toFixed(2);
  const rounded = Number(fixed);
  if (rounded === 0) {
    return '0.00';
  }
  return rounded > 0 ? '+' + fixed : fixed;
}

/** Allowed range for a setting, e.g. `1–1,000` or `50–2,000 ms`. */
export function formatRange(range: NumberRange, unit = ''): string {
  return `${formatVolume(range.min)}–${formatVolume(range.max)}${unit}`;
}

/** Nominal throughput across all instruments in updates per second, e.g. `200` or `66.7`. */
export function formatNominalRate(settings: ProducerSettings): string {
  return formatNumber(
    (settings.updatesPerBatch * 1000) / settings.batchIntervalMs,
    'en-US',
    '1.0-1',
  );
}
