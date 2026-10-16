import { computed, provideAppInitializer, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { createEmptyMetrics } from '../../core/metrics/metrics-accumulator';
import { InstrumentMetrics } from '../../core/models/instrument-metrics';
import { DEFAULT_SETTINGS, ProducerSettings } from '../../core/models/producer-settings';
import { ProducerState } from '../../core/models/producer-status';
import { FakeWorker } from '../../core/producer/fake-worker.testing';
import { ProducerService } from '../../core/producer/producer.service';
import { PRODUCER_SEED, PRODUCER_WORKER_FACTORY } from '../../core/producer/worker-factory';
import { DashboardPage } from './dashboard-page';

function createProducerStub() {
  const state = signal<ProducerState>('running');
  return {
    state,
    runId: signal(1),
    settings: signal<ProducerSettings>({ ...DEFAULT_SETTINGS }),
    metrics: signal<InstrumentMetrics[]>(createEmptyMetrics(5)),
    totalUpdates: signal(0),
    errorMessage: signal<string | null>(null),
    canControl: computed(() => state() === 'running' || state() === 'paused'),
    canApply: computed(() => state() !== 'init-error'),
    canRetry: computed(() => state() === 'init-error'),
    init: vi.fn(),
    apply: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
  };
}

type ProducerStub = ReturnType<typeof createProducerStub>;

const WORKED_EXAMPLE_ROW: InstrumentMetrics = {
  symbol: 'ALFA',
  lastPriceCents: 10200,
  spreadCents: 4,
  volume: 40,
  vwapCents: 10150,
  imbalance: 0.2,
};

function cellTexts(el: HTMLElement, rowIndex: number): string[] {
  const row = el.querySelectorAll('tbody tr')[rowIndex];
  return Array.from(row.children).map((c) => c.textContent?.trim() ?? '');
}

function text(el: HTMLElement, selector: string): string {
  return (el.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('DashboardPage', () => {
  let stub: ProducerStub;
  let fixture: ComponentFixture<DashboardPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    stub = createProducerStub();
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), { provide: ProducerService, useValue: stub }],
    });
    fixture = TestBed.createComponent(DashboardPage);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const pauseButton = () => el.querySelector<HTMLButtonElement>('.pause-button')!;

  it('shows unavailable values and zero volume before data', () => {
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
    for (let i = 0; i < rows.length; i++) {
      const [symbol, last, spread, volume, vwap, imbalance] = cellTexts(el, i);
      expect(symbol).toBe(['ALFA', 'BETA', 'GAMA', 'DLTA', 'EPSI'][i]);
      expect([last, spread, vwap, imbalance]).toEqual(['—', '—', '—', '—']);
      expect(volume).toBe('0');
    }
    expect(rows[0].querySelectorAll('[aria-label="unavailable"]').length).toBe(4);
  });

  it('renders the worked example with currency, volume and signed imbalance', async () => {
    stub.metrics.set([WORKED_EXAMPLE_ROW, ...createEmptyMetrics(5).slice(1)]);
    await fixture.whenStable();
    expect(cellTexts(el, 0)).toEqual(['ALFA', '$102.00', '$0.04', '40', '$101.50', '+0.20']);
    expect(el.querySelector('tbody tr td:last-child')!.classList).toContain('positive');
  });

  it('shows the producer status for the default settings', () => {
    const status = text(el, '[role="status"]');
    expect(status).toContain('Running');
    expect(status).toContain('Run #1');
    expect(status).toContain('5 instruments · 100 updates/batch · 500 ms interval');
    expect(status).toContain('≈ 200 updates/s across all instruments');
    expect(text(el, '.total')).toBe('Total updates this run: 0');
  });

  it('shows Pause when running and calls pause()', () => {
    expect(pauseButton().textContent?.trim()).toBe('Pause');
    expect(pauseButton().getAttribute('aria-pressed')).toBe('false');
    pauseButton().click();
    expect(stub.pause).toHaveBeenCalledTimes(1);
    expect(stub.resume).not.toHaveBeenCalled();
  });

  it('shows Resume when paused and calls resume()', async () => {
    stub.state.set('paused');
    await fixture.whenStable();
    expect(pauseButton().textContent?.trim()).toBe('Resume');
    expect(pauseButton().getAttribute('aria-pressed')).toBe('true');
    pauseButton().click();
    expect(stub.resume).toHaveBeenCalledTimes(1);
    expect(stub.pause).not.toHaveBeenCalled();
  });

  it.each<ProducerState>(['initializing', 'run-error', 'init-error'])(
    'disables the Pause button in state %s',
    async (state) => {
      stub.state.set(state);
      await fixture.whenStable();
      expect(pauseButton().disabled).toBe(true);
    },
  );

  it('shows Retry only in init-error and calls retry()', async () => {
    expect(el.querySelector('.retry')).toBeNull();

    stub.state.set('init-error');
    stub.errorMessage.set('Failed to load Wasm module (HTTP 404)');
    await fixture.whenStable();

    expect(text(el, '[role="alert"]')).toContain('Failed to load Wasm module (HTTP 404)');
    expect(text(el, '.badge')).toBe('Error');
    expect(el.querySelector('[role="alert"] a')).toBeNull();
    el.querySelector<HTMLButtonElement>('.retry')!.click();
    expect(stub.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the Apply settings link instead of Retry in run-error', async () => {
    stub.state.set('run-error');
    stub.errorMessage.set('Invalid instrument count');
    await fixture.whenStable();

    expect(el.querySelector('.retry')).toBeNull();
    const link = el.querySelector<HTMLAnchorElement>('[role="alert"] a')!;
    expect(link.textContent?.trim()).toBe('Apply settings to start a new run.');
    expect(link.getAttribute('href')).toBe('/settings');
  });
});

describe('Navigation and the producer', () => {
  it('does not create additional producers when navigating', async () => {
    const workers: FakeWorker[] = [];
    const factory = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: PRODUCER_WORKER_FACTORY, useValue: factory },
        { provide: PRODUCER_SEED, useValue: () => 42 },
        provideAppInitializer(() => inject(ProducerService).init()),
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    await harness.navigateByUrl('/settings');
    await harness.navigateByUrl('/dashboard');

    const producer = TestBed.inject(ProducerService);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(producer.runId()).toBe(1);
    expect(workers[0].posted.filter((c) => c.type === 'start').length).toBe(1);
  });
});
