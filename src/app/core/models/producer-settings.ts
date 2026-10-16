export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchIntervalMs: number;
}

/** Inclusive range of allowed values for one setting. */
export interface NumberRange {
  readonly min: number;
  readonly max: number;
}

export const SETTINGS_LIMITS = {
  instrumentCount: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1000 },
  batchIntervalMs: { min: 50, max: 2000 },
} as const;

export const DEFAULT_SETTINGS: Readonly<ProducerSettings> = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};
