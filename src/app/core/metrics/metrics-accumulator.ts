import { symbolsFor } from '../instruments/symbols';
import { InstrumentMetrics } from '../models/instrument-metrics';
import { F, RECORD_STRIDE } from '../models/market-update';
import { imbalance, spreadCents, vwapCents } from './metric-formulas';

/**
 * Folds market update records into cumulative per-instrument totals.
 * Records are never stored; only running totals and latest values are kept.
 */
export class MetricsAccumulator {
  private readonly symbols: string[];
  private readonly last: Float64Array;
  private readonly volume: Float64Array;
  private readonly notional: Float64Array;
  private readonly bid: Float64Array;
  private readonly ask: Float64Array;
  private readonly bidQty: Float64Array;
  private readonly askQty: Float64Array;
  private readonly hasData: Uint8Array;
  private updates = 0;
  private batches = 0;

  constructor(private readonly instrumentCount: number) {
    this.symbols = symbolsFor(instrumentCount);
    this.last = new Float64Array(instrumentCount);
    this.volume = new Float64Array(instrumentCount);
    this.notional = new Float64Array(instrumentCount);
    this.bid = new Float64Array(instrumentCount);
    this.ask = new Float64Array(instrumentCount);
    this.bidQty = new Float64Array(instrumentCount);
    this.askQty = new Float64Array(instrumentCount);
    this.hasData = new Uint8Array(instrumentCount);
  }

  get totalUpdates(): number {
    return this.updates;
  }

  get batchCount(): number {
    return this.batches;
  }

  applyBatch(records: Int32Array, count: number): void {
    for (let i = 0; i < count; i++) {
      const o = i * RECORD_STRIDE;
      const k = records[o + F.Instrument];
      if (!(k >= 0 && k < this.instrumentCount)) {
        throw new RangeError(`Instrument index out of range: ${k}`);
      }
      const price = records[o + F.Price];
      const qty = records[o + F.TradeQty];
      this.last[k] = price;
      this.volume[k] += qty;
      this.notional[k] += price * qty;
      this.bid[k] = records[o + F.Bid];
      this.ask[k] = records[o + F.Ask];
      this.bidQty[k] = records[o + F.BidQty];
      this.askQty[k] = records[o + F.AskQty];
      this.hasData[k] = 1;
      this.updates++;
    }
    this.batches++;
  }

  snapshot(): InstrumentMetrics[] {
    const rows: InstrumentMetrics[] = new Array(this.instrumentCount);
    for (let k = 0; k < this.instrumentCount; k++) {
      if (this.hasData[k] === 0) {
        rows[k] = emptyRow(this.symbols[k]);
        continue;
      }
      rows[k] = {
        symbol: this.symbols[k],
        lastPriceCents: this.last[k],
        spreadCents: spreadCents(this.bid[k], this.ask[k]),
        volume: this.volume[k],
        vwapCents: vwapCents(this.notional[k], this.volume[k]),
        imbalance: imbalance(this.bidQty[k], this.askQty[k]),
      };
    }
    return rows;
  }
}

function emptyRow(symbol: string): InstrumentMetrics {
  return {
    symbol,
    lastPriceCents: null,
    spreadCents: null,
    volume: 0,
    vwapCents: null,
    imbalance: null,
  };
}

export function createEmptyMetrics(instrumentCount: number): InstrumentMetrics[] {
  return symbolsFor(instrumentCount).map(emptyRow);
}
