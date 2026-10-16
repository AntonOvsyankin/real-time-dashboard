import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree, form } from '@angular/forms/signals';
import { DEFAULT_SETTINGS } from '../models/producer-settings';
import { fromSettings, settingsSchema, SettingsModel, toSettings } from './settings-schema';

type FieldName = keyof SettingsModel;

function createForm(initial: SettingsModel = fromSettings(DEFAULT_SETTINGS)) {
  const model = signal<SettingsModel>(initial);
  const settingsForm: FieldTree<SettingsModel> = TestBed.runInInjectionContext(() =>
    form(model, settingsSchema),
  );
  return { model, settingsForm };
}

function errorKinds(f: FieldTree<SettingsModel>, name: FieldName): string[] {
  return f[name]()
    .errors()
    .map((e) => e.kind);
}

function check(name: FieldName, value: number | null) {
  const { model, settingsForm } = createForm();
  model.update((m) => ({ ...m, [name]: value }));
  return {
    valid: settingsForm[name]().valid(),
    formValid: settingsForm().valid(),
    kinds: errorKinds(settingsForm, name),
    messages: settingsForm[name]()
      .errors()
      .map((e) => e.message),
  };
}

describe('settingsSchema', () => {
  it('accepts the defaults', () => {
    const { settingsForm } = createForm();
    expect(settingsForm().valid()).toBe(true);
  });

  it.each<[FieldName, number, number]>([
    ['instrumentCount', 1, 50],
    ['updatesPerBatch', 1, 1000],
    ['batchIntervalMs', 50, 2000],
  ])('accepts the boundaries of %s (%i and %i)', (name, lo, hi) => {
    expect(check(name, lo).valid).toBe(true);
    expect(check(name, hi).valid).toBe(true);
  });

  it.each<[FieldName, number, string, string]>([
    ['instrumentCount', 0, 'min', 'Must be at least 1'],
    ['instrumentCount', 51, 'max', 'Must be at most 50'],
    ['updatesPerBatch', 0, 'min', 'Must be at least 1'],
    ['updatesPerBatch', 1001, 'max', 'Must be at most 1000'],
    ['batchIntervalMs', 49, 'min', 'Must be at least 50'],
    ['batchIntervalMs', 2001, 'max', 'Must be at most 2000'],
    ['instrumentCount', -5, 'min', 'Must be at least 1'],
    ['batchIntervalMs', -100, 'min', 'Must be at least 50'],
  ])('rejects %s = %i with a %s error', (name, value, kind, message) => {
    const result = check(name, value);
    expect(result.valid).toBe(false);
    expect(result.formValid).toBe(false);
    expect(result.kinds).toContain(kind);
    expect(result.messages).toContain(message);
  });

  it.each<[FieldName, number]>([
    ['instrumentCount', 1.5],
    ['updatesPerBatch', 100.1],
    ['batchIntervalMs', NaN],
  ])('rejects non-integer %s = %d with an integer error', (name, value) => {
    const result = check(name, value);
    expect(result.valid).toBe(false);
    expect(result.kinds).toContain('integer');
    expect(result.messages).toContain('Must be a whole number');
  });

  it.each<FieldName>(['instrumentCount', 'updatesPerBatch', 'batchIntervalMs'])(
    'rejects an empty %s with a required error only',
    (name) => {
      const result = check(name, null);
      expect(result.valid).toBe(false);
      expect(result.kinds).toEqual(['required']);
      expect(result.messages).toEqual(['Required']);
    },
  );

  it('round-trips settings through the form model', () => {
    expect(toSettings(fromSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });

  it('toSettings refuses an incomplete model', () => {
    expect(() =>
      toSettings({ instrumentCount: null, updatesPerBatch: 1, batchIntervalMs: 50 }),
    ).toThrow();
  });
});
