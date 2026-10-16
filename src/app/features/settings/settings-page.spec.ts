import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProducerSettings } from '../../core/models/producer-settings';
import { ProducerState } from '../../core/models/producer-status';
import { ProducerService } from '../../core/producer/producer.service';
import { SettingsPage } from './settings-page';

const APPLIED: ProducerSettings = { instrumentCount: 7, updatesPerBatch: 20, batchIntervalMs: 300 };

function createProducerStub() {
  const state = signal<ProducerState>('running');
  const runId = signal(1);
  return {
    state,
    runId,
    settings: signal<ProducerSettings>({ ...APPLIED }),
    canApply: computed(() => state() !== 'init-error'),
    apply: vi.fn(() => runId.update((n) => n + 1)),
  };
}

type ProducerStub = ReturnType<typeof createProducerStub>;

describe('SettingsPage', () => {
  let stub: ProducerStub;
  let fixture: ComponentFixture<SettingsPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    stub = createProducerStub();
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [{ provide: ProducerService, useValue: stub }],
    });
    fixture = TestBed.createComponent(SettingsPage);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const input = (name: string) => el.querySelector<HTMLInputElement>(`#${name}-input`)!;
  const applyButton = () => el.querySelector<HTMLButtonElement>('.apply-button')!;
  const errors = (name: string) => el.querySelector(`#${name}-errors`)?.textContent?.trim() ?? '';

  async function typeInto(name: string, value: string): Promise<void> {
    const i = input(name);
    i.value = value;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it('initializes the form from the applied settings', () => {
    expect(input('instrumentCount').value).toBe('7');
    expect(input('updatesPerBatch').value).toBe('20');
    expect(input('batchIntervalMs').value).toBe('300');
    expect(applyButton().disabled).toBe(false);
    expect(el.textContent).toContain('≈ 66.7 updates/s');
  });

  it('does not call apply while editing', async () => {
    await typeInto('instrumentCount', '12');
    await typeInto('updatesPerBatch', '40');
    expect(stub.apply).not.toHaveBeenCalled();
    expect(el.querySelector('.unapplied')?.textContent).toContain('Unapplied changes');
  });

  it('shows a min error for 0 and disables Apply', async () => {
    await typeInto('instrumentCount', '0');
    expect(errors('instrumentCount')).toContain('Must be at least 1');
    expect(input('instrumentCount').getAttribute('aria-invalid')).toBe('true');
    expect(input('instrumentCount').getAttribute('aria-describedby')).toContain(
      'instrumentCount-errors',
    );
    expect(applyButton().disabled).toBe(true);
  });

  it('shows an integer error for 1.5 and disables Apply', async () => {
    await typeInto('instrumentCount', '1.5');
    expect(errors('instrumentCount')).toContain('Must be a whole number');
    expect(applyButton().disabled).toBe(true);
  });

  it('shows a required error for an empty field', async () => {
    await typeInto('batchIntervalMs', '');
    expect(errors('batchIntervalMs')).toBe('Required');
    expect(applyButton().disabled).toBe(true);
  });

  it('submitting valid values calls apply once with numeric settings', async () => {
    await typeInto('instrumentCount', '10');
    await typeInto('updatesPerBatch', '50');
    await typeInto('batchIntervalMs', '100');
    await submit();

    expect(stub.apply).toHaveBeenCalledTimes(1);
    expect(stub.apply).toHaveBeenCalledWith({
      instrumentCount: 10,
      updatesPerBatch: 50,
      batchIntervalMs: 100,
    });
    expect(el.querySelector('.applied')?.textContent).toContain('Applied. Run #2 started.');
    expect(el.querySelector('.unapplied')).toBeNull();
  });

  it('submitting invalid values does not call apply', async () => {
    await typeInto('updatesPerBatch', '1001');
    await submit();
    expect(stub.apply).not.toHaveBeenCalled();
    expect(errors('updatesPerBatch')).toContain('Must be at most 1000');
  });

  it('disables Apply in init-error', async () => {
    stub.state.set('init-error');
    await fixture.whenStable();
    expect(applyButton().disabled).toBe(true);
    await submit();
    expect(stub.apply).not.toHaveBeenCalled();
  });
});
