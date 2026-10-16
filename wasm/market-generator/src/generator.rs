//! The market simulation: per-instrument state plus a batch generator.
//!
//! This module is plain, safe Rust with no knowledge of WebAssembly. The FFI
//! layer in `lib.rs` wraps it, and the tests at the bottom run natively with
//! `cargo test`.

use crate::rng::Rng;

/// Number of `i32` values per update record. Must match `RECORD_STRIDE` in
/// `src/app/core/models/market-update.ts`.
///
/// Record layout (offsets): 0 instrument index, 1 trade price (cents),
/// 2 trade quantity, 3 bid (cents), 4 ask (cents), 5 bid quantity, 6 ask quantity.
pub const STRIDE: usize = 7;
/// Largest allowed instrument count.
pub const MAX_INSTRUMENTS: u32 = 50;
/// Largest allowed number of updates per `generate` call.
pub const MAX_BATCH: u32 = 1000;
/// Lowest mid price: $1.00.
pub const MIN_MID_CENTS: i64 = 100;
/// Highest mid price: $100,000.00. Keeps every value well inside `i32`.
pub const MAX_MID_CENTS: i64 = 10_000_000;
/// Largest quantity resting on one side of the book.
pub const MAX_BOOK_QTY: i64 = 5_000;

/// Why a generator call was rejected.
///
/// Rust concept: an `enum` with no data is like a TypeScript string-literal
/// union. `#[derive(Debug, PartialEq)]` asks the compiler to generate code so
/// values can be printed and compared with `==` (needed by `assert_eq!`).
#[derive(Debug, PartialEq)]
pub enum GenError {
    InvalidInstrumentCount,
    InvalidBatchSize,
}

/// The simulated state of one instrument. It survives between batches, so
/// prices evolve instead of being reset.
struct InstrumentState {
    mid_cents: i64,
    bid_qty: i64,
    ask_qty: i64,
}

/// Generates batches of market updates into a fixed, reusable buffer.
///
/// Rust concept (ownership): the generator *owns* its `Vec`s. When a
/// `MarketGenerator` value is dropped (for example replaced by a new one in
/// `lib.rs`), Rust frees its memory automatically; there is no garbage
/// collector and no manual `free`.
pub struct MarketGenerator {
    rng: Rng,
    instruments: Vec<InstrumentState>,
    buffer: Vec<i32>,
}

impl MarketGenerator {
    /// Creates a generator for `instrument_count` instruments (1..=50).
    ///
    /// The record buffer is allocated once at its maximum size, so its address
    /// never changes for the lifetime of this generator.
    ///
    /// Rust concept: `Result<T, E>` is how Rust returns "either a value or an
    /// error" without exceptions. The caller must handle both cases.
    pub fn new(instrument_count: u32, seed: u64) -> Result<MarketGenerator, GenError> {
        if instrument_count < 1 || instrument_count > MAX_INSTRUMENTS {
            return Err(GenError::InvalidInstrumentCount);
        }

        let mut rng = Rng::new(seed);
        let mut instruments = Vec::with_capacity(instrument_count as usize);
        for _ in 0..instrument_count {
            let mid_cents = rng.range_i64(2_000, 50_000);
            let bid_qty = rng.range_i64(100, 2_000);
            let ask_qty = rng.range_i64(100, 2_000);
            instruments.push(InstrumentState {
                mid_cents,
                bid_qty,
                ask_qty,
            });
        }

        let buffer = vec![0i32; MAX_BATCH as usize * STRIDE];

        Ok(MarketGenerator {
            rng,
            instruments,
            buffer,
        })
    }

    /// Writes `count` updates (1..=1000) into the buffer and returns the used
    /// part of it.
    ///
    /// Each update picks a random instrument (repeats are allowed), moves its
    /// mid price by a small random step, derives a bid/ask around the mid,
    /// trades at either the bid or the ask, and nudges the book quantities.
    ///
    /// Rust concept: the returned slice `&[i32]` *borrows* the buffer. The
    /// borrow checker forbids calling `generate` again while that slice is
    /// still in use, which is the Rust version of "valid until the next call".
    pub fn generate(&mut self, count: u32) -> Result<&[i32], GenError> {
        if count < 1 || count > MAX_BATCH {
            return Err(GenError::InvalidBatchSize);
        }

        let instrument_count = self.instruments.len() as u32;

        for n in 0..count as usize {
            let i = self.rng.below(instrument_count) as usize;

            let mut mid = self.instruments[i].mid_cents;
            let mut bid_qty = self.instruments[i].bid_qty;
            let mut ask_qty = self.instruments[i].ask_qty;

            let max_step = (mid / 1000).max(1);
            mid =
                (mid + self.rng.range_i64(-max_step, max_step)).clamp(MIN_MID_CENTS, MAX_MID_CENTS);

            let max_spread = (mid / 2_500).max(1);
            let spread = self.rng.range_i64(1, max_spread);
            let bid = mid - spread / 2;
            let ask = bid + spread;

            let price = if self.rng.coin() { ask } else { bid };
            let trade_qty = self.rng.range_i64(1, 100);

            bid_qty = (bid_qty + self.rng.range_i64(-150, 150)).clamp(0, MAX_BOOK_QTY);
            ask_qty = (ask_qty + self.rng.range_i64(-150, 150)).clamp(0, MAX_BOOK_QTY);

            self.instruments[i].mid_cents = mid;
            self.instruments[i].bid_qty = bid_qty;
            self.instruments[i].ask_qty = ask_qty;

            // `as i32` is safe here: every value is bounded by MAX_MID_CENTS,
            // MAX_BOOK_QTY or the instrument count, all far below i32::MAX.
            let o = n * STRIDE;
            self.buffer[o] = i as i32;
            self.buffer[o + 1] = price as i32;
            self.buffer[o + 2] = trade_qty as i32;
            self.buffer[o + 3] = bid as i32;
            self.buffer[o + 4] = ask as i32;
            self.buffer[o + 5] = bid_qty as i32;
            self.buffer[o + 6] = ask_qty as i32;
        }

        let used = count as usize * STRIDE;
        Ok(&self.buffer[..used])
    }

    /// Address of the record buffer. `lib.rs` hands this to JavaScript, which
    /// reads the records directly out of Wasm memory (no copying).
    ///
    /// Rust concept: `*const i32` is a raw pointer. Creating one is safe; only
    /// reading through it would need `unsafe`, and Rust code never does that here.
    pub fn buffer_ptr(&self) -> *const i32 {
        self.buffer.as_ptr()
    }

    /// Number of instruments this generator simulates.
    pub fn instrument_count(&self) -> u32 {
        self.instruments.len() as u32
    }

    /// Current mid price of instrument `index`, in cents. Used by tests.
    pub fn mid_cents(&self, index: usize) -> i64 {
        self.instruments[index].mid_cents
    }

    /// Test-only helper that forces an instrument's mid price.
    #[cfg(test)]
    fn set_mid(&mut self, index: usize, mid_cents: i64) {
        self.instruments[index].mid_cents = mid_cents;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: u64 = 0xDEAD_BEEF;

    #[test]
    fn generate_returns_exactly_count_records() {
        let mut g = MarketGenerator::new(5, SEED).unwrap();
        for n in [1u32, 100, 1000] {
            let records = g.generate(n).unwrap();
            assert_eq!(records.len(), n as usize * STRIDE);
        }
    }

    #[test]
    fn rejects_invalid_batch_sizes() {
        let mut g = MarketGenerator::new(5, SEED).unwrap();
        assert_eq!(g.generate(0), Err(GenError::InvalidBatchSize));
        assert_eq!(g.generate(1001), Err(GenError::InvalidBatchSize));
    }

    #[test]
    fn validates_instrument_count() {
        assert_eq!(
            MarketGenerator::new(0, SEED).err(),
            Some(GenError::InvalidInstrumentCount)
        );
        assert_eq!(
            MarketGenerator::new(51, SEED).err(),
            Some(GenError::InvalidInstrumentCount)
        );
        assert_eq!(MarketGenerator::new(1, SEED).unwrap().instrument_count(), 1);
        assert_eq!(
            MarketGenerator::new(50, SEED).unwrap().instrument_count(),
            50
        );
    }

    #[test]
    fn records_satisfy_market_invariants() {
        let count: i32 = 50;
        let mut g = MarketGenerator::new(count as u32, SEED).unwrap();
        for _ in 0..200 {
            let records = g.generate(1000).unwrap();
            for r in records.chunks(STRIDE) {
                let (instrument, price, qty, bid, ask, bid_qty, ask_qty) =
                    (r[0], r[1], r[2], r[3], r[4], r[5], r[6]);
                assert!(instrument >= 0 && instrument < count);
                assert!(price > 0);
                assert!(bid > 0);
                assert!(bid < ask);
                assert!(price == bid || price == ask);
                assert!(qty >= 1 && qty <= 100);
                assert!(bid_qty >= 0 && (bid_qty as i64) <= MAX_BOOK_QTY);
                assert!(ask_qty >= 0 && (ask_qty as i64) <= MAX_BOOK_QTY);
                assert!((ask as i64) <= MAX_MID_CENTS * 2);
            }
        }
        for i in 0..count as usize {
            let mid = g.mid_cents(i);
            assert!(mid >= MIN_MID_CENTS && mid <= MAX_MID_CENTS);
        }
    }

    #[test]
    fn same_seed_is_deterministic_and_different_seeds_differ() {
        let mut a = MarketGenerator::new(10, 7).unwrap();
        let mut b = MarketGenerator::new(10, 7).unwrap();
        let mut c = MarketGenerator::new(10, 8).unwrap();
        for _ in 0..5 {
            let batch_a = a.generate(500).unwrap().to_vec();
            let batch_b = b.generate(500).unwrap().to_vec();
            assert_eq!(batch_a, batch_b);
        }
        let mut a2 = MarketGenerator::new(10, 7).unwrap();
        let first_a = a2.generate(100).unwrap().to_vec();
        let first_c = c.generate(100).unwrap().to_vec();
        assert_ne!(first_a, first_c);
    }

    #[test]
    fn state_is_retained_and_moves_in_small_steps() {
        let count = 5;
        let mut g = MarketGenerator::new(count as u32, SEED).unwrap();
        for _ in 0..5_000 {
            let mut before = Vec::new();
            for i in 0..count {
                before.push(g.mid_cents(i));
            }

            let touched = g.generate(1).unwrap()[0] as usize;

            for i in 0..count {
                let prev = before[i];
                let now = g.mid_cents(i);
                if i == touched {
                    let max_step = (prev / 1000).max(1);
                    assert!(
                        (now - prev).abs() <= max_step,
                        "mid jumped from {} to {}",
                        prev,
                        now
                    );
                } else {
                    assert_eq!(now, prev, "untouched instrument changed");
                }
            }
        }
    }

    #[test]
    fn every_instrument_appears_and_duplicates_happen() {
        let mut g = MarketGenerator::new(5, SEED).unwrap();
        let records = g.generate(1000).unwrap();
        let mut seen = [0u32; 5];
        for r in records.chunks(STRIDE) {
            seen[r[0] as usize] += 1;
        }
        let mut has_duplicates = false;
        for i in 0..5 {
            assert!(seen[i] > 0, "instrument {} never appeared", i);
            if seen[i] > 1 {
                has_duplicates = true;
            }
        }
        assert!(has_duplicates, "expected duplicates within a batch");
    }

    #[test]
    fn mid_never_goes_below_minimum() {
        let mut g = MarketGenerator::new(1, SEED).unwrap();
        g.set_mid(0, MIN_MID_CENTS);
        for _ in 0..1000 {
            let records = g.generate(1000).unwrap();
            for r in records.chunks(STRIDE) {
                assert!(r[3] > 0);
            }
            assert!(g.mid_cents(0) >= MIN_MID_CENTS);
        }
    }

    #[test]
    fn mid_never_goes_above_maximum() {
        let mut g = MarketGenerator::new(1, SEED).unwrap();
        g.set_mid(0, MAX_MID_CENTS);
        for _ in 0..100 {
            g.generate(1000).unwrap();
            assert!(g.mid_cents(0) <= MAX_MID_CENTS);
        }
    }

    #[test]
    fn buffer_pointer_is_stable_between_batches() {
        let mut g = MarketGenerator::new(3, SEED).unwrap();
        let p1 = g.buffer_ptr();
        g.generate(1000).unwrap();
        g.generate(1).unwrap();
        assert_eq!(p1, g.buffer_ptr());
    }
}
