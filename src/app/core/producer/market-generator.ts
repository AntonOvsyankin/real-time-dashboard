export interface MarketGenerator {
  /** Replace generator state. Throws Error with a readable message on failure. */
  configure(instrumentCount: number, seed: number): void;
  /** Returns a view of exactly count*RECORD_STRIDE i32 values, valid only until the next call. Throws on failure. */
  generate(count: number): Int32Array;
  dispose(): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export type GeneratorLoader = (wasmUrl: string) => Promise<MarketGenerator>;
