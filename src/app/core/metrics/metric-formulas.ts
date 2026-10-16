export function spreadCents(bidCents: number, askCents: number): number {
  return askCents - bidCents;
}

export function vwapCents(notionalCents: number, volume: number): number | null {
  return volume === 0 ? null : notionalCents / volume;
}

export function imbalance(bidQty: number, askQty: number): number | null {
  const total = bidQty + askQty;
  return total === 0 ? null : (bidQty - askQty) / total;
}
