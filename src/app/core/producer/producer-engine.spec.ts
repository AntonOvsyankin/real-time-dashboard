import { encodeUpdates, MarketUpdate } from '../models/market-update';
import { ProducerSettings } from '../models/producer-settings';
import { WorkerEvent } from '../models/worker-protocol';
import { MarketGenerator, Scheduler } from './market-generator';
import { ProducerEngine } from './producer-engine';

class FakeScheduler implements Scheduler {
  private time = 0;
  private nextId = 1;
  private tasks: { id: number; at: number; fn: () => void }[] = [];

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.push({ id, at: this.time + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle);
  }

  now(): number {
    return this.time;
  }

  get pendingCount(): number {
    return this.tasks.length;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) {
        break;
      }
      this.tasks = this.tasks.filter((t) => t !== due);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}

class FakeGenerator implements MarketGenerator {
  configureCalls: { instrumentCount: number; seed: number }[] = [];
  generateCalls: number[] = [];
  disposed = false;
  configureError: Error | null = null;
  private instrumentCount = 0;

  configure(instrumentCount: number, seed: number): void {
    this.configureCalls.push({ instrumentCount, seed });
    if (this.configureError) {
      throw this.configureError;
    }
    this.instrumentCount = instrumentCount;
  }

  generate(count: number): Int32Array {
    this.generateCalls.push(count);
    const updates: MarketUpdate[] = [];
    for (let i = 0; i < count; i++) {
      updates.push({
        instrumentIndex: i % this.instrumentCount,
        priceCents: 10000,
        tradeQuantity: 1,
        bidCents: 9999,
        askCents: 10000,
        bidQuantity: 10,
        askQuantity: 10,
      });
    }
    return encodeUpdates(updates);
  }

  dispose(): void {
    this.disposed = true;
  }
}

const SETTINGS: ProducerSettings = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

const flushPromises = async () => {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
  }
};

type Snapshot = Extract<WorkerEvent, { type: 'snapshot' }>;

function setup(loader?: () => Promise<MarketGenerator>) {
  const events: WorkerEvent[] = [];
  const scheduler = new FakeScheduler();
  const generator = new FakeGenerator();
  const engine = new ProducerEngine(
    (e) => events.push(e),
    scheduler,
    loader ?? (async () => generator),
  );
  const snapshots = () => events.filter((e): e is Snapshot => e.type === 'snapshot');
  const lastSnapshot = () => snapshots().at(-1);
  return { events, scheduler, generator, engine, snapshots, lastSnapshot };
}

async function startedEngine() {
  const ctx = setup();
  ctx.engine.handle({ type: 'init', wasmUrl: 'wasm/market_generator.wasm' });
  ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
  await flushPromises();
  return ctx;
}

describe('ProducerEngine', () => {
  it('queues a start sent before ready and runs it after the loader resolves', async () => {
    const ctx = setup();
    ctx.engine.handle({ type: 'init', wasmUrl: 'x.wasm' });
    ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
    expect(ctx.events).toEqual([]);

    await flushPromises();

    expect(ctx.events[0]).toEqual({ type: 'ready' });
    expect(ctx.events[1]).toEqual({ type: 'status', runId: 1, state: 'running' });
    expect(ctx.generator.configureCalls).toEqual([{ instrumentCount: 5, seed: 42 }]);
    const snap = ctx.lastSnapshot()!;
    expect(snap.runId).toBe(1);
    expect(snap.totalUpdates).toBe(100);
    expect(snap.batchCount).toBe(1);
    expect(snap.metrics.length).toBe(5);
    expect(snap.metrics[0].volume).toBe(20);
  });

  it('generates one more batch per interval', async () => {
    const ctx = await startedEngine();
    ctx.scheduler.advance(499);
    expect(ctx.snapshots().length).toBe(1);
    ctx.scheduler.advance(1);
    expect(ctx.snapshots().length).toBe(2);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);
  });

  it('pause stops generation entirely', async () => {
    const ctx = await startedEngine();
    ctx.engine.handle({ type: 'pause', runId: 1 });
    expect(ctx.events.at(-1)).toEqual({ type: 'status', runId: 1, state: 'paused' });

    const calls = ctx.generator.generateCalls.length;
    ctx.scheduler.advance(10_000);
    expect(ctx.generator.generateCalls.length).toBe(calls);
    expect(ctx.scheduler.pendingCount).toBe(0);
  });

  it('resume preserves totals and generates one batch immediately, with no catch-up', async () => {
    const ctx = await startedEngine();
    ctx.scheduler.advance(500);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);

    ctx.engine.handle({ type: 'pause', runId: 1 });
    ctx.scheduler.advance(10_000);
    ctx.engine.handle({ type: 'resume', runId: 1 });

    expect(ctx.events.filter((e) => e.type === 'status').at(-1)).toEqual({
      type: 'status',
      runId: 1,
      state: 'running',
    });
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(300);
    expect(ctx.lastSnapshot()!.metrics[0].volume).toBe(60);

    ctx.scheduler.advance(500);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(400);
  });

  it('a new start resets totals and the old run never posts again', async () => {
    const ctx = await startedEngine();
    ctx.scheduler.advance(1000);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(300);

    const before = ctx.snapshots().length;
    ctx.engine.handle({
      type: 'start',
      runId: 2,
      settings: { instrumentCount: 3, updatesPerBatch: 10, batchIntervalMs: 200 },
      seed: 7,
    });
    expect(ctx.generator.configureCalls.at(-1)).toEqual({ instrumentCount: 3, seed: 7 });
    expect(ctx.lastSnapshot()!.runId).toBe(2);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(10);
    expect(ctx.lastSnapshot()!.metrics.length).toBe(3);

    ctx.scheduler.advance(5_000);
    const after = ctx.snapshots().slice(before);
    expect(after.length).toBe(26);
    expect(after.every((s) => s.runId === 2)).toBe(true);
  });

  it('a new start while paused starts running', async () => {
    const ctx = await startedEngine();
    ctx.engine.handle({ type: 'pause', runId: 1 });
    ctx.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: 1 });
    expect(ctx.events.filter((e) => e.type === 'status').at(-1)).toEqual({
      type: 'status',
      runId: 2,
      state: 'running',
    });
    ctx.scheduler.advance(500);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);
  });

  it('ignores pause and resume with a stale runId', async () => {
    const ctx = await startedEngine();
    ctx.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: 1 });
    const count = ctx.events.length;
    ctx.engine.handle({ type: 'pause', runId: 1 });
    expect(ctx.events.length).toBe(count);
    ctx.scheduler.advance(500);
    expect(ctx.lastSnapshot()!.runId).toBe(2);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);

    ctx.engine.handle({ type: 'pause', runId: 2 });
    ctx.engine.handle({ type: 'resume', runId: 1 });
    ctx.scheduler.advance(1000);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);
  });

  it('applies queued pause/resume in order after ready', async () => {
    const ctx = setup();
    ctx.engine.handle({ type: 'init', wasmUrl: 'x.wasm' });
    ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
    ctx.engine.handle({ type: 'pause', runId: 1 });
    await flushPromises();
    expect(ctx.events.at(-1)).toEqual({ type: 'status', runId: 1, state: 'paused' });
    ctx.scheduler.advance(2000);
    expect(ctx.snapshots().length).toBe(1);
  });

  it('posts init-error when the loader rejects, and ignores later starts', async () => {
    const ctx = setup(() => Promise.reject(new Error('Failed to load Wasm module (HTTP 404)')));
    ctx.engine.handle({ type: 'init', wasmUrl: 'x.wasm' });
    ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
    await flushPromises();
    expect(ctx.events).toEqual([
      { type: 'init-error', message: 'Failed to load Wasm module (HTTP 404)' },
    ]);

    ctx.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: 42 });
    ctx.scheduler.advance(1000);
    expect(ctx.events.length).toBe(1);
    expect(ctx.generator.generateCalls).toEqual([]);
  });

  it('posts run-error when configure throws and stays usable for the next start', async () => {
    const ctx = setup();
    ctx.generator.configureError = new Error('Invalid instrument count');
    ctx.engine.handle({ type: 'init', wasmUrl: 'x.wasm' });
    ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
    await flushPromises();
    expect(ctx.events.at(-1)).toEqual({
      type: 'run-error',
      runId: 1,
      message: 'Invalid instrument count',
    });
    expect(ctx.snapshots()).toEqual([]);

    ctx.generator.configureError = null;
    ctx.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: 42 });
    expect(ctx.lastSnapshot()!.runId).toBe(2);
    ctx.scheduler.advance(500);
    expect(ctx.lastSnapshot()!.totalUpdates).toBe(200);
  });

  it('posts run-error when generate throws and stops the run', async () => {
    const ctx = await startedEngine();
    ctx.generator.generate = () => {
      throw new Error('Generator is not configured');
    };
    ctx.scheduler.advance(500);
    expect(ctx.events.at(-1)).toEqual({
      type: 'run-error',
      runId: 1,
      message: 'Generator is not configured',
    });
    expect(ctx.scheduler.pendingCount).toBe(0);
  });

  it('dispose frees the generator and stops all further work', async () => {
    const ctx = await startedEngine();
    ctx.engine.handle({ type: 'dispose' });
    expect(ctx.generator.disposed).toBe(true);

    const calls = ctx.generator.generateCalls.length;
    const events = ctx.events.length;
    ctx.scheduler.advance(10_000);
    ctx.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: 1 });
    expect(ctx.generator.generateCalls.length).toBe(calls);
    expect(ctx.events.length).toBe(events);
  });

  it('disposes a generator that finishes loading after dispose', async () => {
    const ctx = setup();
    ctx.engine.handle({ type: 'init', wasmUrl: 'x.wasm' });
    ctx.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: 42 });
    ctx.engine.handle({ type: 'dispose' });
    await flushPromises();
    expect(ctx.generator.disposed).toBe(true);
    expect(ctx.events).toEqual([]);
  });
});
