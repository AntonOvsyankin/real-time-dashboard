# Architecture and decisions

How the dashboard works, which rules must not break, and why things are the way they are.

## What the app does

Two routes:
- **`/dashboard`** — a live table, one row per instrument (symbols `ALFA`, `BETA`, … from a fixed list of 50, assigned by index). Columns: last price, bid–ask spread, volume, VWAP, order-book imbalance. Plus a Pause/Resume button and a producer status panel.
- **`/settings`** — a Signal Forms form with three integers: instrument count (1–50, default 5), updates per batch (1–1000, default 100), batch interval (50–2000 ms, default 500). Changes take effect only on **Apply**, which starts a new run and clears all values and totals.

Metrics (cumulative since the start of the current run):
- spread = ask − bid
- volume = sum of trade quantities (book quantities never count)
- VWAP = sum(price × qty) / volume
- imbalance = (bidQty − askQty) / (bidQty + askQty)
- A value shows `—` before data arrives or when a denominator is 0.

Worked example from the spec, covered by tests: trades 10 @ $100 and 30 @ $102 give last $102.00, volume 40, VWAP $101.50; bid $101.96 / ask $102.00 gives spread $0.04; bidQty 600 / askQty 400 gives imbalance +0.20.

## Data flow

```
Angular main thread                     Web Worker                          Wasm (Rust)
ProducerService (signals)  --cmd-->     ProducerEngine                      MarketGenerator
  state, runId, settings,               - timer per run (setTimeout chain)  - SplitMix64 PRNG
  metrics, totalUpdates,                - MetricsAccumulator (running        - per-instrument mid,
  errorMessage                            totals, no history)                 spread, book qty
                           <--event--   - posts one snapshot per batch      - fixed i32 buffer
```

1. The Wasm generator writes a batch of updates into a fixed buffer inside Wasm memory: **7 `i32` values per update** (instrument index, price, trade qty, bid, ask, bid qty, ask qty). All prices are integer cents.
2. The worker reads that buffer through an `Int32Array` view (no copy) and adds each update to per-instrument running totals in `MetricsAccumulator`.
3. After each batch the worker posts one snapshot (one row per instrument) tagged with the `runId`.
4. `ProducerService` puts it in signals, and the OnPush table re-renders once per batch.

Main-thread work therefore depends on the number of instruments, not on the update rate. That is why metrics are calculated in the worker (D3).

## Rules that must not break

- **At most one worker alive at a time.** `ProducerService.init()` is idempotent and runs once from `provideAppInitializer`. Components never create workers, so navigating between pages never creates a producer. The only other place that creates a worker is `retry()`, and it terminates the old one first.
- **Run isolation through `runId`.** The service owns an increasing `runId`. Every `start`/`pause`/`resume` command carries it, every `snapshot`/`status`/`run-error` event carries it, and the service **drops any event whose `runId` is not the current one**. Results from an old run can never overwrite a new one.
- **Apply** increments `runId`, immediately shows empty rows for the new instrument count, and sends `start`. The worker replaces the generator (the old one is dropped in Rust), creates a fresh accumulator, cancels the old timer and starts running, even if the previous run was paused.
- **Pause** cancels the worker timer and keeps the totals. **Resume** generates the next batch immediately, with no catch-up for the paused time.
- **No event history.** Only running totals per instrument are kept; every trade still counts toward volume and VWAP.
- **Cleanup.** On destroy, the service detaches the worker's handlers, posts `dispose`, and calls `terminate()`. The worker calls `gen_destroy()` and clears its timer.

## Error handling (D12)

`ProducerState = 'initializing' | 'running' | 'paused' | 'run-error' | 'init-error'`

- **`run-error`** — the worker and Wasm are fine, but a run failed. The panel shows the message and a link to Settings; **Apply** starts a new run in the same worker.
- **`init-error`** — the worker could not be created, the Wasm failed to load or validate, or the worker crashed. The panel shows a **Retry** button. `retry()` detaches the old worker's handlers *first* (so late events from it are ignored), terminates it, creates a new worker and starts the next run with the applied settings. Apply is disabled in this state.

## Worker protocol (`src/app/core/models/worker-protocol.ts`)

- Commands: `init { wasmUrl }`, `start { runId, settings, seed }`, `pause { runId }`, `resume { runId }`, `dispose`.
- Events: `ready`, `init-error { message }`, `snapshot { runId, metrics, totalUpdates, batchCount }`, `status { runId, state }`, `run-error { runId, message }`.
- Commands that arrive before the Wasm is ready are queued and replayed after `ready`. Commands after `dispose` are ignored.

## Wasm interface (`wasm/market-generator/src/lib.rs`)

The module has **no imports** and is instantiated with `{}`. Only numbers cross the boundary.

| Export | Returns |
|---|---|
| `gen_abi_version()` | `1`; the loader rejects any other value |
| `gen_record_stride()` | `7`; must equal `RECORD_STRIDE` in TypeScript |
| `gen_create(instrument_count, seed)` | `0`, or `-1` if the count is outside 1..=50. Replaces (drops) any existing generator |
| `gen_generate(count)` | `count`, `-2` if outside 1..=1000, `-3` if there is no generator |
| `gen_buffer_ptr()` | byte offset of the record buffer in `memory` |
| `gen_destroy()` | drops the generator |

Gotcha: when Wasm memory grows, the old `memory.buffer` is detached. The loader (`wasm-market-generator.ts`) therefore creates a **new `Int32Array` view on every `generate` call** and re-reads `gen_buffer_ptr()`. Keep it that way.

If you change the record layout or an export, change both sides together, bump `gen_abi_version`, and update the tests.

## Generator model (Rust)

- `rng.rs` — SplitMix64 with wrapping arithmetic; seeded from JS (`crypto.getRandomValues`), because `wasm32-unknown-unknown` has no OS randomness.
- `generator.rs` — `MarketGenerator` keeps per-instrument state between calls: mid price (random walk, clamped between `MIN_MID_CENTS` = 100 and `MAX_MID_CENTS`), spread, and book quantities (up to `MAX_BOOK_QTY`). Each update picks an instrument, moves its state, and trades at either the bid or the ask. Invariants (tested): price > 0, bid < ask, price is bid or ask, trade qty ≥ 1.
- `lib.rs` — keeps the single generator in `thread_local!` + `RefCell<Option<MarketGenerator>>` and maps `Result`s to the error codes above.

## Testing

- Rust: `cargo test` (17 tests) — RNG, batch sizes, invariants, determinism for the same seed, price evolution, clamping, FFI smoke test.
- Angular: Vitest (90 tests) — metric formulas and accumulator (including the worked example), settings schema, `ProducerEngine` with a fake scheduler and fake generator, `ProducerService` with `FakeWorker` (`fake-worker.testing.ts`), components, a navigation test proving only one worker is created, formatting.
- No real timers anywhere; no end-to-end tests (not required by the spec).

## Decisions (all confirmed with the user)

| # | Decision | Chosen | Why |
|---|---|---|---|
| D1 | Angular version | 22 | Latest; Signal Forms are stable. Needed Node ≥ 22.22.3, so local Node was upgraded to 24 LTS |
| D2 | Wasm toolchain | Rust, hand-written `extern "C"`, no wasm-bindgen | Only numbers cross the boundary, so bindgen adds tooling without value. The user is learning Rust and chose it as practice |
| D3 | Where metrics live | In the worker | Main-thread cost does not grow with the update rate |
| D4 | State management | Signals in a root service | Small state; no NgRx needed |
| D5 | Forms | Signal Forms | Whole app on signals; stable in v22 |
| D6 | Styling | Plain SCSS, native `<table>` | Five columns don't justify a UI library |
| D7 | Tests | Vitest + `cargo test` | Angular default; headless in CI |
| D8 | Hosting | GitHub Pages via Actions | No secrets or third-party accounts |
| D9 | Routing | Path URLs; CI copies `index.html` to `404.html` | Clean URLs; deep links work on Pages |
| D11 | Unapplied Settings edits | Discarded when leaving the page | The spec only requires keeping the run |
| D12 | Failures | `run-error` → Apply; `init-error` → Retry | Recover without a page reload |
| D13 | First batch | Immediately on start/resume | Instant feedback; the spec forbids only catch-up |
| D14 | Totals precision | JS `number` | Exact up to 2^53, far beyond realistic sessions |

## Angular specifics worth knowing

- Signal Forms as installed (`@angular/forms` 22.2): `form`, `schema`, `required`, `min`, `max`, `validate`; inputs bind with `[formField]`; an empty number input writes `null`; `required` treats `NaN` as empty.
- The worker must be created with the literal `new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' })` so the Angular builder bundles it.
- `*.worker.ts` is excluded from `tsconfig.app.json` and compiled with `tsconfig.worker.json`.
- "Total updates this run" sits outside the `aria-live` region on purpose: it changes up to 20 times a second.
