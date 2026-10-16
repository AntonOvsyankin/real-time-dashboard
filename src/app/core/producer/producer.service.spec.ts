import { TestBed } from '@angular/core/testing';
import { createEmptyMetrics } from '../metrics/metrics-accumulator';
import { InstrumentMetrics } from '../models/instrument-metrics';
import { DEFAULT_SETTINGS, ProducerSettings } from '../models/producer-settings';
import { FakeWorker } from './fake-worker.testing';
import { ProducerService } from './producer.service';
import { PRODUCER_SEED, PRODUCER_WORKER_FACTORY } from './worker-factory';

const NEW_SETTINGS: ProducerSettings = {
  instrumentCount: 10,
  updatesPerBatch: 50,
  batchIntervalMs: 100,
};

function dataRow(symbol: string): InstrumentMetrics {
  return {
    symbol,
    lastPriceCents: 10200,
    spreadCents: 4,
    volume: 40,
    vwapCents: 10150,
    imbalance: 0.2,
  };
}

function setup() {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PRODUCER_WORKER_FACTORY, useValue: factory },
      { provide: PRODUCER_SEED, useValue: () => 42 },
    ],
  });
  const service = TestBed.inject(ProducerService);
  const worker = () => workers[workers.length - 1];
  return { service, factory, workers, worker };
}

function startedService() {
  const ctx = setup();
  ctx.service.init();
  ctx.worker().emit({ type: 'ready' });
  return ctx;
}

describe('ProducerService', () => {
  describe('init and apply (settings apply/reset)', () => {
    it('posts init then start for run 1 with default settings and shows empty rows', () => {
      const { service, worker } = setup();
      service.init();

      const posted = worker().posted;
      expect(posted[0].type).toBe('init');
      expect(posted[0]).toEqual({
        type: 'init',
        wasmUrl: expect.stringMatching(/wasm\/market_generator\.wasm$/),
      });
      expect(posted[1]).toEqual({ type: 'start', runId: 1, settings: DEFAULT_SETTINGS, seed: 42 });
      expect(service.runId()).toBe(1);
      expect(service.metrics()).toEqual(createEmptyMetrics(5));
      expect(service.state()).toBe('initializing');

      worker().emit({ type: 'ready' });
      expect(service.state()).toBe('running');
    });

    it('apply starts a new run, resets metrics and totals, and posts start', () => {
      const { service, worker } = startedService();
      worker().emit({
        type: 'snapshot',
        runId: 1,
        metrics: [dataRow('ALFA')],
        totalUpdates: 100,
        batchCount: 1,
      });
      expect(service.totalUpdates()).toBe(100);

      service.apply(NEW_SETTINGS);

      expect(service.runId()).toBe(2);
      expect(service.metrics()).toEqual(createEmptyMetrics(10));
      expect(service.totalUpdates()).toBe(0);
      expect(service.settings()).toEqual(NEW_SETTINGS);
      expect(service.state()).toBe('running');
      expect(worker().lastPosted).toEqual({
        type: 'start',
        runId: 2,
        settings: NEW_SETTINGS,
        seed: 42,
      });
    });

    it('apply while paused starts running', () => {
      const { service, worker } = startedService();
      service.pause();
      expect(service.state()).toBe('paused');
      service.apply(NEW_SETTINGS);
      expect(service.state()).toBe('running');
      expect(worker().lastPosted?.type).toBe('start');
    });

    it('init is idempotent: one worker only', () => {
      const { service, factory } = setup();
      service.init();
      service.init();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.runId()).toBe(1);
    });
  });

  describe('pause/resume and stale-run rejection', () => {
    it('pause and resume post commands and update state', () => {
      const { service, worker } = startedService();
      service.pause();
      expect(worker().lastPosted).toEqual({ type: 'pause', runId: 1 });
      expect(service.state()).toBe('paused');

      service.resume();
      expect(worker().lastPosted).toEqual({ type: 'resume', runId: 1 });
      expect(service.state()).toBe('running');
    });

    it('pause while initializing does nothing', () => {
      const { service, worker } = setup();
      service.init();
      const count = worker().posted.length;
      service.pause();
      service.resume();
      expect(worker().posted.length).toBe(count);
      expect(service.state()).toBe('initializing');
      expect(service.canControl()).toBe(false);
    });

    it('drops snapshots, statuses and run errors from a previous run', () => {
      const { service, worker } = startedService();
      service.apply(NEW_SETTINGS);

      worker().emit({
        type: 'snapshot',
        runId: 1,
        metrics: [dataRow('ALFA')],
        totalUpdates: 999,
        batchCount: 9,
      });
      worker().emit({ type: 'status', runId: 1, state: 'paused' });
      worker().emit({ type: 'run-error', runId: 1, message: 'old failure' });
      expect(service.metrics()).toEqual(createEmptyMetrics(10));
      expect(service.totalUpdates()).toBe(0);
      expect(service.state()).toBe('running');
      expect(service.errorMessage()).toBeNull();

      const rows = createEmptyMetrics(10);
      rows[0] = dataRow('ALFA');
      worker().emit({ type: 'snapshot', runId: 2, metrics: rows, totalUpdates: 50, batchCount: 1 });
      expect(service.metrics()[0]).toEqual(dataRow('ALFA'));
      expect(service.totalUpdates()).toBe(50);
    });

    it('applies status events for the current run', () => {
      const { service, worker } = startedService();
      worker().emit({ type: 'status', runId: 1, state: 'paused' });
      expect(service.state()).toBe('paused');
    });
  });

  describe('errors and recovery', () => {
    it('init-error event and worker onerror both give init-error; apply is blocked', () => {
      const { service, worker } = setup();
      service.init();
      worker().emit({ type: 'init-error', message: 'Failed to load Wasm module (HTTP 404)' });
      expect(service.state()).toBe('init-error');
      expect(service.errorMessage()).toBe('Failed to load Wasm module (HTTP 404)');
      expect(service.canApply()).toBe(false);
      expect(service.canRetry()).toBe(true);
      expect(service.canControl()).toBe(false);

      const count = worker().posted.length;
      service.apply(NEW_SETTINGS);
      expect(worker().posted.length).toBe(count);
      expect(service.runId()).toBe(1);
    });

    it('worker onerror gives init-error with a readable message', () => {
      const { service, worker } = startedService();
      worker().fail('boom');
      expect(service.state()).toBe('init-error');
      expect(service.errorMessage()).toBe('Producer worker failed: boom');
    });

    it('a status event does not overwrite an error state', () => {
      const { service, worker } = startedService();
      worker().emit({ type: 'run-error', runId: 1, message: 'bad' });
      worker().emit({ type: 'status', runId: 1, state: 'running' });
      expect(service.state()).toBe('run-error');
    });

    it('a throwing worker factory gives init-error', () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: PRODUCER_WORKER_FACTORY,
            useValue: () => {
              throw new Error('Workers unsupported');
            },
          },
          { provide: PRODUCER_SEED, useValue: () => 42 },
        ],
      });
      const service = TestBed.inject(ProducerService);
      service.init();
      expect(service.state()).toBe('init-error');
      expect(service.errorMessage()).toBe(
        'Could not start the producer worker: Workers unsupported',
      );
    });

    it('recovers from run-error with apply', () => {
      const { service, worker } = startedService();
      worker().emit({ type: 'run-error', runId: 1, message: 'Invalid instrument count' });
      expect(service.state()).toBe('run-error');
      expect(service.errorMessage()).toBe('Invalid instrument count');
      expect(service.canApply()).toBe(true);
      expect(service.canControl()).toBe(false);

      service.apply(NEW_SETTINGS);
      expect(worker().lastPosted).toEqual({
        type: 'start',
        runId: 2,
        settings: NEW_SETTINGS,
        seed: 42,
      });
      expect(service.state()).toBe('running');
      expect(service.errorMessage()).toBeNull();
    });

    it('retry replaces the worker and starts a new run with the applied settings', () => {
      const { service, factory, workers } = startedService();
      service.apply(NEW_SETTINGS);
      const oldWorker = workers[0];
      oldWorker.emit({ type: 'init-error', message: 'crashed' });
      expect(service.state()).toBe('init-error');

      service.retry();

      expect(oldWorker.terminated).toBe(true);
      expect(oldWorker.posted.at(-1)).toEqual({ type: 'dispose' });
      expect(factory).toHaveBeenCalledTimes(2);
      const newWorker = workers[1];
      expect(newWorker.posted[0].type).toBe('init');
      expect(newWorker.posted[1]).toEqual({
        type: 'start',
        runId: 3,
        settings: NEW_SETTINGS,
        seed: 42,
      });
      expect(service.state()).toBe('initializing');
      expect(service.errorMessage()).toBeNull();

      oldWorker.emit({ type: 'ready' });
      oldWorker.emit({
        type: 'snapshot',
        runId: 3,
        metrics: [dataRow('ALFA')],
        totalUpdates: 5,
        batchCount: 1,
      });
      oldWorker.fail('late');
      expect(service.state()).toBe('initializing');
      expect(service.totalUpdates()).toBe(0);
      expect(service.errorMessage()).toBeNull();

      newWorker.emit({ type: 'ready' });
      expect(service.state()).toBe('running');
    });

    it('retry outside init-error does nothing', () => {
      const { service, factory } = startedService();
      service.retry();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.runId()).toBe(1);
    });
  });

  it('disposes and terminates the worker when the injector is destroyed', () => {
    const { worker } = startedService();
    const w = worker();
    TestBed.resetTestingModule();
    expect(w.posted.at(-1)).toEqual({ type: 'dispose' });
    expect(w.terminated).toBe(true);
  });
});
