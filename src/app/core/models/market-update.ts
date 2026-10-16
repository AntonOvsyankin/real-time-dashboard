/** Number of i32 values per update record in the Wasm buffer. Must match `STRIDE` in the Rust crate. */
export const RECORD_STRIDE = 7;

export const enum F {
  Instrument = 0,
  Price = 1,
  TradeQty = 2,
  Bid = 3,
  Ask = 4,
  BidQty = 5,
  AskQty = 6,
}

/** Object form of one record; used in tests and docs only. */
export interface MarketUpdate {
  instrumentIndex: number;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}

export function encodeUpdates(updates: readonly MarketUpdate[]): Int32Array {
  const view = new Int32Array(updates.length * RECORD_STRIDE);
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const o = i * RECORD_STRIDE;
    view[o + F.Instrument] = u.instrumentIndex;
    view[o + F.Price] = u.priceCents;
    view[o + F.TradeQty] = u.tradeQuantity;
    view[o + F.Bid] = u.bidCents;
    view[o + F.Ask] = u.askCents;
    view[o + F.BidQty] = u.bidQuantity;
    view[o + F.AskQty] = u.askQuantity;
  }
  return view;
}

export function decodeUpdate(view: Int32Array, i: number): MarketUpdate {
  const o = i * RECORD_STRIDE;
  return {
    instrumentIndex: view[o + F.Instrument],
    priceCents: view[o + F.Price],
    tradeQuantity: view[o + F.TradeQty],
    bidCents: view[o + F.Bid],
    askCents: view[o + F.Ask],
    bidQuantity: view[o + F.BidQty],
    askQuantity: view[o + F.AskQty],
  };
}
