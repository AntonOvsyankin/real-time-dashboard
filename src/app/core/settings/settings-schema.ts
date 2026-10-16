import { max, min, required, schema, SchemaPath, validate } from '@angular/forms/signals';
import { NumberRange, ProducerSettings, SETTINGS_LIMITS } from '../models/producer-settings';

/** Form model; fields are nullable because an empty number input writes `null`. */
export interface SettingsModel {
  instrumentCount: number | null;
  updatesPerBatch: number | null;
  batchIntervalMs: number | null;
}

function integerInRange(path: SchemaPath<number | null>, limits: NumberRange): void {
  required(path, { message: 'Required' });
  validate(path, ({ value }) => {
    const v = value();
    if (v !== null && !Number.isInteger(v)) {
      return { kind: 'integer', message: 'Must be a whole number' };
    }
    return undefined;
  });
  min(path, limits.min, { message: `Must be at least ${limits.min}` });
  max(path, limits.max, { message: `Must be at most ${limits.max}` });
}

export const settingsSchema = schema<SettingsModel>((p) => {
  integerInRange(p.instrumentCount, SETTINGS_LIMITS.instrumentCount);
  integerInRange(p.updatesPerBatch, SETTINGS_LIMITS.updatesPerBatch);
  integerInRange(p.batchIntervalMs, SETTINGS_LIMITS.batchIntervalMs);
});

/** Call only when the form is valid. */
export function toSettings(model: SettingsModel): ProducerSettings {
  const { instrumentCount, updatesPerBatch, batchIntervalMs } = model;
  if (instrumentCount === null || updatesPerBatch === null || batchIntervalMs === null) {
    throw new Error('toSettings called with an incomplete settings model');
  }
  return { instrumentCount, updatesPerBatch, batchIntervalMs };
}

export function fromSettings(s: ProducerSettings): SettingsModel {
  return {
    instrumentCount: s.instrumentCount,
    updatesPerBatch: s.updatesPerBatch,
    batchIntervalMs: s.batchIntervalMs,
  };
}
