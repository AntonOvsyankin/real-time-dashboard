import { INSTRUMENT_SYMBOLS } from '../instruments/symbols';
import { imbalance, spreadCents, vwapCents } from './metric-formulas';

describe('metric formulas', () => {
  it('spread is ask minus bid', () => {
    expect(spreadCents(9996, 10000)).toBe(4);
  });

  it('VWAP is notional / volume, and unavailable when volume is 0', () => {
    expect(vwapCents(10000 * 10 + 10200 * 30, 40)).toBe(10150);
    expect(vwapCents(0, 0)).toBeNull();
  });

  it('imbalance is (bid - ask) / (bid + ask), and unavailable when both are 0', () => {
    expect(imbalance(600, 400)).toBeCloseTo(0.2, 12);
    expect(imbalance(1000, 0)).toBe(1);
    expect(imbalance(0, 1000)).toBe(-1);
    expect(imbalance(0, 0)).toBeNull();
  });
});

describe('INSTRUMENT_SYMBOLS', () => {
  it('has 50 unique entries', () => {
    expect(INSTRUMENT_SYMBOLS.length).toBe(50);
    expect(new Set(INSTRUMENT_SYMBOLS).size).toBe(50);
  });
});
