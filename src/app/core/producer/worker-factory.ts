import { InjectionToken } from '@angular/core';
import { WorkerCommand, WorkerEvent } from '../models/worker-protocol';

export interface WorkerLike {
  postMessage(msg: WorkerCommand): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<WorkerEvent>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export const PRODUCER_WORKER_FACTORY = new InjectionToken<() => WorkerLike>(
  'PRODUCER_WORKER_FACTORY',
  {
    providedIn: 'root',
    factory: () => () =>
      new Worker(new URL('./producer.worker', import.meta.url), {
        type: 'module',
      }) as unknown as WorkerLike,
  },
);

export const PRODUCER_SEED = new InjectionToken<() => number>('PRODUCER_SEED', {
  providedIn: 'root',
  factory: () => () => crypto.getRandomValues(new Uint32Array(1))[0],
});
