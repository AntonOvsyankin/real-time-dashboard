import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProducerSettings } from '../../core/models/producer-settings';
import { ProducerState } from '../../core/models/producer-status';
import { formatNominalRate } from '../../shared/format/display-format';
import { VolumePipe } from '../../shared/format/format.pipes';

const STATE_LABELS: Record<ProducerState, string> = {
  initializing: 'Initializing…',
  running: 'Running',
  paused: 'Paused',
  'run-error': 'Error',
  'init-error': 'Error',
};

@Component({
  selector: 'app-producer-status-panel',
  imports: [RouterLink, VolumePipe],
  templateUrl: './producer-status-panel.html',
  styleUrl: './producer-status-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProducerStatusPanel {
  readonly state = input.required<ProducerState>();
  readonly runId = input.required<number>();
  readonly settings = input.required<ProducerSettings>();
  readonly totalUpdates = input.required<number>();
  readonly errorMessage = input<string | null>(null);
  readonly retry = output<void>();

  protected readonly stateLabel = computed(() => STATE_LABELS[this.state()]);
  protected readonly isError = computed(
    () => this.state() === 'run-error' || this.state() === 'init-error',
  );
  protected readonly nominalRate = computed(() => formatNominalRate(this.settings()));
}
