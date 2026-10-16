import { MetricsAccumulator } from '../metrics/metrics-accumulator';
import { ProducerSettings } from '../models/producer-settings';
import { WorkerCommand, WorkerEvent } from '../models/worker-protocol';
import { errorMessage } from '../utils/error-message';
import { GeneratorLoader, MarketGenerator, Scheduler } from './market-generator';

type EnginePhase = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';

interface Run {
  runId: number;
  settings: ProducerSettings;
  acc: MetricsAccumulator;
  paused: boolean;
  timer: unknown | null;
}

type RunCommand = Extract<WorkerCommand, { type: 'start' | 'pause' | 'resume' }>;

/**
 * Worker-side producer logic: loads the generator, runs the batch timer,
 * aggregates metrics and posts snapshots tagged with the run id.
 * Has no dependency on the worker global scope, so it is unit-testable.
 */
export class ProducerEngine {
  private generator: MarketGenerator | null = null;
  private phase: EnginePhase = 'idle';
  private pending: RunCommand[] = [];
  private run: Run | null = null;

  constructor(
    private readonly post: (e: WorkerEvent) => void,
    private readonly scheduler: Scheduler,
    private readonly loadGenerator: GeneratorLoader,
  ) {}

  handle(cmd: WorkerCommand): void {
    if (this.phase === 'disposed') {
      return;
    }
    switch (cmd.type) {
      case 'init':
        void this.init(cmd.wasmUrl);
        return;
      case 'dispose':
        this.dispose();
        return;
      case 'start':
      case 'pause':
      case 'resume':
        this.handleRunCommand(cmd);
        return;
    }
  }

  private handleRunCommand(cmd: RunCommand): void {
    if (this.phase === 'idle' || this.phase === 'loading') {
      this.pending.push(cmd);
      return;
    }
    if (this.phase !== 'ready') {
      return;
    }
    switch (cmd.type) {
      case 'start':
        this.start(cmd.runId, cmd.settings, cmd.seed);
        return;
      case 'pause':
        this.pause(cmd.runId);
        return;
      case 'resume':
        this.resume(cmd.runId);
        return;
    }
  }

  private async init(wasmUrl: string): Promise<void> {
    if (this.phase !== 'idle') {
      return;
    }
    this.phase = 'loading';

    let generator: MarketGenerator;
    try {
      generator = await this.loadGenerator(wasmUrl);
    } catch (e) {
      if (this.isDisposed()) {
        return;
      }
      this.phase = 'failed';
      this.pending = [];
      this.post({ type: 'init-error', message: errorMessage(e) });
      return;
    }

    if (this.isDisposed()) {
      generator.dispose();
      return;
    }

    this.generator = generator;
    this.phase = 'ready';
    this.post({ type: 'ready' });

    const queued = this.pending;
    this.pending = [];
    for (const cmd of queued) {
      this.handle(cmd);
    }
  }

  // Re-reads the field so TypeScript does not narrow it across the `await` in init().
  private isDisposed(): boolean {
    return this.phase === 'disposed';
  }

  private start(runId: number, settings: ProducerSettings, seed: number): void {
    this.stopRun();
    const generator = this.generator;
    if (!generator) {
      return;
    }

    try {
      generator.configure(settings.instrumentCount, seed);
    } catch (e) {
      this.post({ type: 'run-error', runId, message: errorMessage(e) });
      return;
    }

    const run: Run = {
      runId,
      settings: { ...settings },
      acc: new MetricsAccumulator(settings.instrumentCount),
      paused: false,
      timer: null,
    };
    this.run = run;
    this.post({ type: 'status', runId, state: 'running' });
    this.tick(run);
  }

  private pause(runId: number): void {
    const run = this.run;
    if (!run || run.runId !== runId || run.paused) {
      return;
    }
    this.clearTimer(run);
    run.paused = true;
    this.post({ type: 'status', runId, state: 'paused' });
  }

  private resume(runId: number): void {
    const run = this.run;
    if (!run || run.runId !== runId || !run.paused) {
      return;
    }
    run.paused = false;
    this.post({ type: 'status', runId, state: 'running' });
    this.tick(run);
  }

  private tick(run: Run): void {
    const generator = this.generator;
    if (this.run !== run || run.paused || !generator) {
      return;
    }
    run.timer = null;

    const t0 = this.scheduler.now();
    const { updatesPerBatch, batchIntervalMs } = run.settings;
    try {
      const view = generator.generate(updatesPerBatch);
      run.acc.applyBatch(view, updatesPerBatch);
      this.post({
        type: 'snapshot',
        runId: run.runId,
        metrics: run.acc.snapshot(),
        totalUpdates: run.acc.totalUpdates,
        batchCount: run.acc.batchCount,
      });
    } catch (e) {
      this.run = null;
      this.post({ type: 'run-error', runId: run.runId, message: errorMessage(e) });
      return;
    }

    const delay = Math.max(0, batchIntervalMs - (this.scheduler.now() - t0));
    run.timer = this.scheduler.setTimeout(() => this.tick(run), delay);
  }

  private clearTimer(run: Run): void {
    if (run.timer !== null) {
      this.scheduler.clearTimeout(run.timer);
      run.timer = null;
    }
  }

  private stopRun(): void {
    if (this.run) {
      this.clearTimer(this.run);
      this.run = null;
    }
  }

  private dispose(): void {
    this.stopRun();
    this.pending = [];
    this.generator?.dispose();
    this.generator = null;
    this.phase = 'disposed';
  }
}
