/// <reference lib="webworker" />

import { WorkerCommand } from '../models/worker-protocol';
import { ProducerEngine } from './producer-engine';
import { loadWasmMarketGenerator } from './wasm-market-generator';

const engine = new ProducerEngine(
  (e) => postMessage(e),
  {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as number),
    now: () => performance.now(),
  },
  loadWasmMarketGenerator,
);

addEventListener('message', ({ data }: MessageEvent<WorkerCommand>) => engine.handle(data));
