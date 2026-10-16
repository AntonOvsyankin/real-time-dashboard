import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FieldTree, form, FormField, ValidationError } from '@angular/forms/signals';
import { SETTINGS_LIMITS } from '../../core/models/producer-settings';
import { ProducerService } from '../../core/producer/producer.service';
import {
  fromSettings,
  settingsSchema,
  SettingsModel,
  toSettings,
} from '../../core/settings/settings-schema';
import { formatNominalRate, formatRange } from '../../shared/format/display-format';
import { SettingsFieldView } from './settings-field-view';

@Component({
  selector: 'app-settings-page',
  imports: [FormField],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly producer = inject(ProducerService);

  protected readonly model = signal<SettingsModel>(fromSettings(this.producer.settings()));
  protected readonly settingsForm = form(this.model, settingsSchema);

  protected readonly fields: readonly SettingsFieldView[] = [
    {
      name: 'instrumentCount',
      label: 'Instrument count',
      hint: formatRange(SETTINGS_LIMITS.instrumentCount),
      field: this.settingsForm.instrumentCount,
    },
    {
      name: 'updatesPerBatch',
      label: 'Updates per batch',
      hint: formatRange(SETTINGS_LIMITS.updatesPerBatch),
      field: this.settingsForm.updatesPerBatch,
    },
    {
      name: 'batchIntervalMs',
      label: 'Batch interval (ms)',
      hint: formatRange(SETTINGS_LIMITS.batchIntervalMs, ' ms'),
      field: this.settingsForm.batchIntervalMs,
    },
  ];

  protected readonly nominalRate = computed(() => {
    if (!this.settingsForm().valid()) {
      return null;
    }
    return formatNominalRate(toSettings(this.model()));
  });

  protected readonly canSubmit = computed(
    () => this.settingsForm().valid() && this.producer.canApply(),
  );

  private readonly lastAppliedMessage = signal<string | null>(null);
  protected readonly appliedMessage = computed(() =>
    this.settingsForm().dirty() ? null : this.lastAppliedMessage(),
  );

  protected showErrors(field: FieldTree<number | null>): boolean {
    const state = field();
    return (state.touched() || state.dirty()) && state.invalid();
  }

  protected errorText(error: ValidationError): string {
    if (error.message) {
      return error.message;
    }
    return error.kind === 'parse' ? 'Must be a number' : 'Invalid value';
  }

  protected apply(event: Event): void {
    event.preventDefault();
    if (!this.settingsForm().valid()) {
      this.settingsForm().markAsTouched();
      return;
    }
    if (!this.producer.canApply()) {
      return;
    }
    this.producer.apply(toSettings(this.model()));
    this.settingsForm().reset();
    this.lastAppliedMessage.set(`Applied. Run #${this.producer.runId()} started.`);
  }
}
