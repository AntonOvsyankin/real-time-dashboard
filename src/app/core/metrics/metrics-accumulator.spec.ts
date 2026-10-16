import { encodeUpdates, MarketUpdate } from '../models/market-update';
import { createEmptyMetrics, MetricsAccumulator } from './metrics-accumulator';

function update(partial: Partial<MarketUpdate> & { instrumentIndex: number }): MarketUpdate {
  return {
    priceCents: 10000,
    tradeQuantity: 1,
    bidCents: 9999,
    askCents: 10000,
    bidQuantity: 10,
    askQuantity: 10,
    ...partial,
  };
}

const WORKED_EXAMPLE: MarketUpdate[] = [
  {
    instrumentIndex: 0,
    priceCents: 10000,
    tradeQuantity: 10,
    bidCents: 9996,
    askCents: 10000,
    bidQuantity: 500,
    askQuantity: 500,
  },
  {
    instrumentIndex: 0,
    priceCents: 10200,
    tradeQuantity: 30,
    bidCents: 10196,
    askCents: 10200,
    bidQuantity: 600,
    askQuantity: 400,
  },
];

function apply(acc: MetricsAccumulator, updates: MarketUpdate[]): void {
  acc.applyBatch(encodeUpdates(updates), updates.length);
}

describe('MetricsAccumulator', () => {
  it('computes the worked example from the spec', () => {
    const acc = new MetricsAccumulator(5);
    apply(acc, WORKED_EXAMPLE);
    const row = acc.snapshot()[0];
    expect(row.symbol).toBe('ALFA');
    expect(row.lastPriceCents).toBe(10200);
    expect(row.volume).toBe(40);
    expect(row.vwapCents).toBe(10150);
    expect(row.spreadCents).toBe(4);
    expect(row.imbalance).toBeCloseTo(0.2, 12);
  });

  it('accumulates across batches (cumulative, not windowed)', () => {
    const acc = new MetricsAccumulator(5);
    apply(acc, [WORKED_EXAMPLE[0]]);
    apply(acc, [WORKED_EXAMPLE[1]]);
    const single = new MetricsAccumulator(5);
    apply(single, WORKED_EXAMPLE);
    expect(acc.snapshot()).toEqual(single.snapshot());
  });

  it('reports unavailable values before any data', () => {
    const rows = new MetricsAccumulator(5).snapshot();
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row).toEqual({
        symbol: row.symbol,
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      });
    }
  });

  it('createEmptyMetrics matches a fresh snapshot and uses the first symbols', () => {
    const empty = createEmptyMetrics(5);
    expect(empty.map((r) => r.symbol)).toEqual(['ALFA', 'BETA', 'GAMA', 'DLTA', 'EPSI']);
    expect(empty).toEqual(new MetricsAccumulator(5).snapshot());
  });

  it('gives null imbalance when both book quantities are 0, keeping other metrics', () => {
    const acc = new MetricsAccumulator(1);
    apply(acc, [update({ instrumentIndex: 0, bidQuantity: 0, askQuantity: 0, tradeQuantity: 5 })]);
    const row = acc.snapshot()[0];
    expect(row.imbalance).toBeNull();
    expect(row.lastPriceCents).toBe(10000);
    expect(row.spreadCents).toBe(1);
    expect(row.volume).toBe(5);
    expect(row.vwapCents).toBe(10000);
  });

  it('keeps instruments isolated', () => {
    const acc = new MetricsAccumulator(2);
    apply(acc, [update({ instrumentIndex: 0, tradeQuantity: 3 })]);
    expect(acc.snapshot()[1]).toEqual(createEmptyMetrics(2)[1]);

    apply(acc, [
      update({ instrumentIndex: 1, priceCents: 2000, tradeQuantity: 2, bidCents: 1999, askCents: 2000 }),
      update({ instrumentIndex: 0, priceCents: 12000, tradeQuantity: 1, bidCents: 11999, askCents: 12000 }),
      update({ instrumentIndex: 1, priceCents: 3000, tradeQuantity: 2, bidCents: 2999, askCents: 3000 }),
    ]);
    const [a, b] = acc.snapshot();
    expect(a.volume).toBe(4);
    expect(a.vwapCents).toBe((10000 * 3 + 12000) / 4);
    expect(b.volume).toBe(4);
    expect(b.vwapCents).toBe(2500);
    expect(b.lastPriceCents).toBe(3000);
  });

  it('never adds book quantities to volume', () => {
    const acc = new MetricsAccumulator(1);
    apply(acc, [
      update({ instrumentIndex: 0, tradeQuantity: 1, bidQuantity: 5000, askQuantity: 4000 }),
      update({ instrumentIndex: 0, tradeQuantity: 1, bidQuantity: 3000, askQuantity: 5000 }),
    ]);
    expect(acc.snapshot()[0].volume).toBe(2);
  });

  it('counts updates and batches', () => {
    const acc = new MetricsAccumulator(2);
    expect(acc.totalUpdates).toBe(0);
    expect(acc.batchCount).toBe(0);
    apply(acc, [update({ instrumentIndex: 0 }), update({ instrumentIndex: 1 })]);
    apply(acc, [update({ instrumentIndex: 1 })]);
    expect(acc.totalUpdates).toBe(3);
    expect(acc.batchCount).toBe(2);
  });

  it('only reads the first `count` records of the view', () => {
    const acc = new MetricsAccumulator(1);
    const records = encodeUpdates([update({ instrumentIndex: 0 }), update({ instrumentIndex: 0 })]);
    acc.applyBatch(records, 1);
    expect(acc.totalUpdates).toBe(1);
    expect(acc.snapshot()[0].volume).toBe(1);
  });

  it('throws RangeError for an out-of-range instrument index', () => {
    const acc = new MetricsAccumulator(2);
    expect(() => apply(acc, [update({ instrumentIndex: 2 })])).toThrow(RangeError);
    expect(() => apply(acc, [update({ instrumentIndex: -1 })])).toThrow(RangeError);
  });
});
