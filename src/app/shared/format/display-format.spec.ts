import {
  formatCents,
  formatImbalance,
  formatNominalRate,
  formatRange,
  formatVolume,
  UNAVAILABLE,
} from './display-format';
import { CentsPipe, SignedRatioPipe, VolumePipe } from './format.pipes';

describe('display formatting', () => {
  it('formats cents as USD with 2 decimals', () => {
    expect(formatCents(10200)).toBe('$102.00');
    expect(formatCents(10150)).toBe('$101.50');
    expect(formatCents(4)).toBe('$0.04');
    expect(formatCents(1234567)).toBe('$12,345.67');
    expect(formatCents(null)).toBe('—');
  });

  it('rounds an unrounded VWAP for display only', () => {
    expect(formatCents(10150.666)).toBe('$101.51');
  });

  it('formats volume as an integer with thousands separators', () => {
    expect(formatVolume(0)).toBe('0');
    expect(formatVolume(40)).toBe('40');
    expect(formatVolume(12345)).toBe('12,345');
  });

  it('formats a settings range with thousands separators and an optional unit', () => {
    expect(formatRange({ min: 1, max: 1000 })).toBe('1–1,000');
    expect(formatRange({ min: 50, max: 2000 }, ' ms')).toBe('50–2,000 ms');
  });

  it('formats the nominal rate in updates per second with at most 1 decimal', () => {
    expect(
      formatNominalRate({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 }),
    ).toBe('200');
    expect(
      formatNominalRate({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 1500 }),
    ).toBe('66.7');
    expect(
      formatNominalRate({ instrumentCount: 50, updatesPerBatch: 1000, batchIntervalMs: 50 }),
    ).toBe('20,000');
  });

  it('formats imbalance with an explicit sign and 2 decimals', () => {
    expect(formatImbalance(0.2)).toBe('+0.20');
    expect(formatImbalance(-1)).toBe('-1.00');
    expect(formatImbalance(1)).toBe('+1.00');
    expect(formatImbalance(0)).toBe('0.00');
    expect(formatImbalance(-0.001)).toBe('0.00');
    expect(formatImbalance(0.004)).toBe('0.00');
    expect(formatImbalance(-0.35)).toBe('-0.35');
    expect(formatImbalance(null)).toBe('—');
  });

  it('exposes the same formatting through pure pipes', () => {
    expect(new CentsPipe().transform(10150)).toBe('$101.50');
    expect(new CentsPipe().transform(null)).toBe(UNAVAILABLE);
    expect(new VolumePipe().transform(12345)).toBe('12,345');
    expect(new SignedRatioPipe().transform(0.2)).toBe('+0.20');
  });
});
