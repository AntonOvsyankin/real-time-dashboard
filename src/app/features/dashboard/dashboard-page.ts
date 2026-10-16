import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ProducerService } from '../../core/producer/producer.service';
import { MetricsTable } from './metrics-table';
import { ProducerStatusPanel } from './producer-status-panel';

@Component({
  selector: 'app-dashboard-page',
  imports: [MetricsTable, ProducerStatusPanel],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  protected readonly producer = inject(ProducerService);
  protected readonly isPaused = computed(() => this.producer.state() === 'paused');

  protected togglePause(): void {
    if (this.isPaused()) {
      this.producer.resume();
    } else {
      this.producer.pause();
    }
  }
}
