//! A tiny pseudo-random number generator (SplitMix64).
//!
//! We write our own instead of using the `rand` crate so the Wasm module has
//! zero dependencies and the sequence is fully reproducible from a seed.

/// SplitMix64 PRNG. All of its state is one `u64`.
///
/// Rust concept: integer arithmetic in Rust panics on overflow in debug
/// builds. A PRNG *wants* overflow (it works modulo 2^64), so every step uses
/// the explicit `wrapping_add` / `wrapping_mul` methods instead of `+` / `*`.
pub struct Rng {
    state: u64,
}

impl Rng {
    /// Creates a generator from a seed. The same seed always gives the same sequence.
    pub fn new(seed: u64) -> Rng {
        Rng { state: seed }
    }

    /// Returns the next 64 random bits.
    ///
    /// Rust concept: `&mut self` means this method borrows the generator
    /// mutably, because it changes `state`.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Returns a number in `0..n` (excluding `n`). `n` must be greater than 0.
    ///
    /// Uses the top 32 random bits scaled by `n` (multiply-shift), which avoids
    /// the slow `%` operator. Rust concept: `n as u64` is an explicit, lossless
    /// widening cast; Rust never converts integer types implicitly.
    pub fn below(&mut self, n: u32) -> u32 {
        let high_bits = self.next_u64() >> 32;
        ((high_bits * n as u64) >> 32) as u32
    }

    /// Returns a number in `lo..=hi` (both ends included). Requires `lo <= hi`
    /// and a span that fits in `u32`.
    ///
    /// Rust concept: `assert!` stops the program (here: aborts the Wasm module)
    /// if a programming error breaks the precondition.
    pub fn range_i64(&mut self, lo: i64, hi: i64) -> i64 {
        assert!(lo <= hi, "range_i64: lo must be <= hi");
        let span = hi - lo + 1;
        assert!(span <= u32::MAX as i64, "range_i64: span must fit in u32");
        lo + self.below(span as u32) as i64
    }

    /// Returns `true` or `false` with equal probability (the top random bit).
    pub fn coin(&mut self) -> bool {
        (self.next_u64() >> 63) == 1
    }
}

/// Rust concept: `#[cfg(test)]` compiles this module only for `cargo test`,
/// so tests never end up in the Wasm file.
#[cfg(test)]
mod tests {
    use super::Rng;

    #[test]
    fn same_seed_gives_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_give_different_first_values() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        assert_ne!(a.next_u64(), b.next_u64());
    }

    #[test]
    fn below_stays_under_n() {
        let mut rng = Rng::new(7);
        for n in [1u32, 2, 3, 50, 1000] {
            for _ in 0..10_000 {
                assert!(rng.below(n) < n);
            }
        }
    }

    #[test]
    fn range_i64_is_inclusive_and_hits_both_ends() {
        let mut rng = Rng::new(123);
        let mut saw_lo = false;
        let mut saw_hi = false;
        for _ in 0..10_000 {
            let x = rng.range_i64(-3, 3);
            assert!(x >= -3 && x <= 3);
            if x == -3 {
                saw_lo = true;
            }
            if x == 3 {
                saw_hi = true;
            }
        }
        assert!(saw_lo, "never produced the lower bound");
        assert!(saw_hi, "never produced the upper bound");
    }

    #[test]
    fn range_i64_with_equal_bounds_returns_that_value() {
        let mut rng = Rng::new(9);
        for _ in 0..100 {
            assert_eq!(rng.range_i64(5, 5), 5);
        }
    }

    #[test]
    fn coin_produces_both_values() {
        let mut rng = Rng::new(5);
        let mut heads = 0;
        for _ in 0..1000 {
            if rng.coin() {
                heads += 1;
            }
        }
        assert!(heads > 0 && heads < 1000);
    }
}
