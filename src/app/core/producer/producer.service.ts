import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { createEmptyMetrics } from '../metrics/metrics-accumulator';
import { InstrumentMetrics } from '../models/instrument-metrics';
import { DEFAULT_SETTINGS, ProducerSettings } from '../models/producer-settings';
import { ProducerState } from '../models/producer-status';
import { WorkerEvent } from '../models/worker-protocol';
import { errorMessage } from '../utils/error-message';
import { PRODUCER_SEED, PRODUCER_WORKER_FACTORY, WorkerLike } from './worker-factory';

/**
 * Owns the single producer worker and exposes its state as signals.
 * Every run gets a new runId; events from any other run are dropped.
 */
@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly workerFactory = inject(PRODUCER_WORKER_FACTORY);
  private readonly seed = inject(PRODUCER_SEED);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stateSignal = signal<ProducerState>('initializing');
  private readonly runIdSignal = signal(0);
  private readonly settingsSignal = signal<ProducerSettings>({ ...DEFAULT_SETTINGS });
  private readonly metricsSignal = signal<InstrumentMetrics[]>(
    createEmptyMetrics(DEFAULT_SETTINGS.instrumentCount),
  );
  private readonly totalUpdatesSignal = signal(0);
  private readonly errorMessageSignal = signal<string | null>(null);

  readonly state = this.stateSignal.asReadonly();
  readonly runId = this.runIdSignal.asReadonly();
  readonly settings = this.settingsSignal.asReadonly();
  readonly metrics = this.metricsSignal.asReadonly();
  readonly totalUpdates = this.totalUpdatesSignal.asReadonly();
  readonly errorMessage = this.errorMessageSignal.asReadonly();
  readonly canControl = computed(() => this.state() === 'running' || this.state() === 'paused');
  readonly canApply = computed(() => this.state() !== 'init-error');
  readonly canRetry = computed(() => this.state() === 'init-error');

  private worker: WorkerLike | null = null;
  private ready = false;
  private initialized = false;

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.createWorker();
    this.startRun({ ...DEFAULT_SETTINGS });
    this.destroyRef.onDestroy(() => this.disposeWorker());
  }

  apply(settings: ProducerSettings): void {
    if (this.state() === 'init-error') {
      return;
    }
    this.startRun({ ...settings });
  }

  pause(): void {
    if (this.state() !== 'running' || !this.worker) {
      return;
    }
    this.stateSignal.set('paused');
    this.worker.postMessage({ type: 'pause', runId: this.runId() });
  }

  resume(): void {
    if (this.state() !== 'paused' || !this.worker) {
      return;
    }
    this.stateSignal.set('running');
    this.worker.postMessage({ type: 'resume', runId: this.runId() });
  }

  retry(): void {
    if (this.state() !== 'init-error') {
      return;
    }
    this.disposeWorker();
    this.createWorker();
    this.startRun(this.settings());
  }

  private createWorker(): void {
    this.ready = false;
    this.stateSignal.set('initializing');
    this.errorMessageSignal.set(null);

    let worker: WorkerLike;
    try {
      worker = this.workerFactory();
    } catch (e) {
      this.stateSignal.set('init-error');
      this.errorMessageSignal.set('Could not start the producer worker: ' + errorMessage(e));
      return;
    }

    worker.onmessage = (ev) => this.handleEvent(ev.data);
    worker.onerror = (ev) => {
      this.stateSignal.set('init-error');
      this.errorMessageSignal.set('Producer worker failed: ' + (ev.message || 'unknown error'));
    };
    this.worker = worker;
    worker.postMessage({
      type: 'init',
      wasmUrl: new URL('wasm/market_generator.wasm', document.baseURI).href,
    });
  }

  private disposeWorker(): void {
    const worker = this.worker;
    if (!worker) {
      return;
    }
    worker.onmessage = null;
    worker.onerror = null;
    worker.postMessage({ type: 'dispose' });
    worker.terminate();
    this.worker = null;
    this.ready = false;
  }

  private startRun(settings: ProducerSettings): void {
    const worker = this.worker;
    if (!worker) {
      return;
    }
    this.runIdSignal.update((n) => n + 1);
    this.settingsSignal.set(settings);
    this.metricsSignal.set(createEmptyMetrics(settings.instrumentCount));
    this.totalUpdatesSignal.set(0);
    this.errorMessageSignal.set(null);
    this.stateSignal.set(this.ready ? 'running' : 'initializing');
    worker.postMessage({ type: 'start', runId: this.runId(), settings, seed: this.seed() });
  }

  private handleEvent(e: WorkerEvent): void {
    switch (e.type) {
      case 'ready':
        this.ready = true;
        if (this.state() === 'initializing') {
          this.stateSignal.set('running');
        }
        return;
      case 'init-error':
        this.stateSignal.set('init-error');
        this.errorMessageSignal.set(e.message);
        return;
      case 'snapshot':
        if (e.runId !== this.runId()) {
          return;
        }
        this.metricsSignal.set(e.metrics);
        this.totalUpdatesSignal.set(e.totalUpdates);
        return;
      case 'status':
        if (e.runId !== this.runId() || this.isErrorState()) {
          return;
        }
        this.stateSignal.set(e.state);
        return;
      case 'run-error':
        if (e.runId !== this.runId()) {
          return;
        }
        this.stateSignal.set('run-error');
        this.errorMessageSignal.set(e.message);
        return;
    }
  }

  private isErrorState(): boolean {
    const s = this.state();
    return s === 'run-error' || s === 'init-error';
  }
}
