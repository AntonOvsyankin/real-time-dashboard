import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { InstrumentMetrics } from '../../core/models/instrument-metrics';
import { CentsPipe, SignedRatioPipe, VolumePipe } from '../../shared/format/format.pipes';

@Component({
  selector: 'app-metrics-table',
  imports: [CentsPipe, VolumePipe, SignedRatioPipe],
  templateUrl: './metrics-table.html',
  styleUrl: './metrics-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsTable {
  readonly rows = input.required<InstrumentMetrics[]>();
}
