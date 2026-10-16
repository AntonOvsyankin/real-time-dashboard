import { ProducerSettings } from './producer-settings';
import { InstrumentMetrics } from './instrument-metrics';

export type WorkerCommand =
  | { type: 'init'; wasmUrl: string }
  | { type: 'start'; runId: number; settings: ProducerSettings; seed: number }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number }
  | { type: 'dispose' };

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | {
      type: 'snapshot';
      runId: number;
      metrics: InstrumentMetrics[];
      totalUpdates: number;
      batchCount: number;
    }
  | { type: 'status'; runId: number; state: 'running' | 'paused' }
  | { type: 'run-error'; runId: number; message: string };
