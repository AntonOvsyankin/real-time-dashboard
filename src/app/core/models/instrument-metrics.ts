export interface InstrumentMetrics {
  symbol: string;
  /** null before the first trade */
  lastPriceCents: number | null;
  /** askCents - bidCents of the latest snapshot; null before data */
  spreadCents: number | null;
  /** cumulative trade quantity in this run; 0 before data */
  volume: number;
  /** notional / volume, unrounded; null when volume is 0 */
  vwapCents: number | null;
  /** (bidQ - askQ) / (bidQ + askQ); null before data or when the denominator is 0 */
  imbalance: number | null;
}
