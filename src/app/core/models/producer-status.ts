/**
 * - `run-error`: worker and Wasm are healthy but the current run failed; recover with Apply.
 * - `init-error`: worker creation, Wasm load/validation failed, or the worker crashed; recover with Retry.
 */
export type ProducerState = 'initializing' | 'running' | 'paused' | 'run-error' | 'init-error';
