//! WebAssembly entry points (the FFI layer).
//!
//! JavaScript calls the `gen_*` functions below. They hold one global
//! `MarketGenerator` and translate between Rust types (`Result`, `Option`)
//! and plain integers that can cross the Wasm boundary. All market logic lives
//! in `generator.rs`; this file only adapts it.
//!
//! Rust concept: `#[no_mangle] pub extern "C" fn` exports a function under its
//! exact name with the C calling convention, so it shows up as a Wasm export
//! that JavaScript can call. Only numbers (`u32`, `i32`) cross the boundary.

pub mod generator;
mod rng;

use std::cell::RefCell;

use generator::{GenError, MarketGenerator, STRIDE};

/// Version of the export contract. The worker refuses a module with a different one.
const ABI_VERSION: u32 = 1;

/// Mixed into the seed so that small seeds (0, 1, 2, ...) still start from
/// very different PRNG states.
const SEED_MIX: u64 = 0x9E37_79B9_7F4A_7C15;

thread_local! {
    /// The single generator instance, or `None` before `gen_create` / after `gen_destroy`.
    ///
    /// Rust concept: Rust does not allow plain mutable globals without
    /// `unsafe`. `thread_local!` gives one value per thread (Wasm has exactly
    /// one), and `RefCell` allows mutation through a shared reference by
    /// checking borrows at run time (`borrow()` / `borrow_mut()`).
    static GEN: RefCell<Option<MarketGenerator>> = RefCell::new(None);
}

/// Returns the ABI version (1).
#[no_mangle]
pub extern "C" fn gen_abi_version() -> u32 {
    ABI_VERSION
}

/// Returns the number of `i32` values per record (7).
///
/// Rust concept: `as u32` converts the `usize` constant to the 32-bit type
/// used across the Wasm boundary.
#[no_mangle]
pub extern "C" fn gen_record_stride() -> u32 {
    STRIDE as u32
}

/// Creates a new generator, replacing (and freeing) any existing one.
/// Returns 0 on success or -1 if `instrument_count` is outside 1..=50.
///
/// Rust concept: assigning `Some(new)` into the cell *drops* the old value, so
/// the previous generator and its buffer are freed right here.
#[no_mangle]
pub extern "C" fn gen_create(instrument_count: u32, seed: u32) -> i32 {
    let mixed_seed = (seed as u64) ^ SEED_MIX;
    match MarketGenerator::new(instrument_count, mixed_seed) {
        Ok(new_generator) => {
            GEN.with(|cell| {
                *cell.borrow_mut() = Some(new_generator);
            });
            0
        }
        Err(_) => -1,
    }
}

/// Generates `count` records into the generator's buffer.
/// Returns `count` on success, -2 if `count` is outside 1..=1000, or -3 if
/// there is no generator.
///
/// Rust concept: `match` on `Option` / `Result` forces every case to be
/// handled; here each case maps to one return code.
#[no_mangle]
pub extern "C" fn gen_generate(count: u32) -> i32 {
    GEN.with(|cell| {
        let mut slot = cell.borrow_mut();
        match slot.as_mut() {
            None => -3,
            Some(generator) => match generator.generate(count) {
                Ok(_) => count as i32,
                Err(GenError::InvalidBatchSize) => -2,
                Err(GenError::InvalidInstrumentCount) => -1,
            },
        }
    })
}

/// Byte offset of the record buffer inside Wasm `memory`, or 0 if there is
/// no generator. JavaScript must re-read it after every `gen_generate`.
///
/// Rust concept: on wasm32 a pointer is a 32-bit offset into linear memory,
/// so `ptr as usize as u32` turns it into a number JavaScript can use as a
/// byte offset. No `unsafe` is needed because the pointer is never dereferenced here.
#[no_mangle]
pub extern "C" fn gen_buffer_ptr() -> u32 {
    GEN.with(|cell| match cell.borrow().as_ref() {
        None => 0,
        Some(generator) => generator.buffer_ptr() as usize as u32,
    })
}

/// Drops the generator and frees its memory. Safe to call when none exists.
#[no_mangle]
pub extern "C" fn gen_destroy() {
    GEN.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_smoke_test() {
        assert_eq!(gen_abi_version(), 1);
        assert_eq!(gen_record_stride(), 7);
        assert_eq!(gen_create(5, 1), 0);
        assert_eq!(gen_generate(10), 10);
        assert_ne!(gen_buffer_ptr(), 0);
        assert_eq!(gen_generate(0), -2);
        assert_eq!(gen_generate(1001), -2);
        gen_destroy();
        assert_eq!(gen_generate(1), -3);
        assert_eq!(gen_buffer_ptr(), 0);
        assert_eq!(gen_create(51, 1), -1);
        assert_eq!(gen_create(0, 1), -1);
    }
}
