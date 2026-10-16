import { WorkerCommand, WorkerEvent } from '../models/worker-protocol';
import { WorkerLike } from './worker-factory';

/** Test double for the producer worker: records commands and lets tests emit events. */
export class FakeWorker implements WorkerLike {
  posted: WorkerCommand[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;

  postMessage(msg: WorkerCommand): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: WorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  get lastPosted(): WorkerCommand | undefined {
    return this.posted[this.posted.length - 1];
  }
}
