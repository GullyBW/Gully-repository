import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChartDatum {
  label: string;
  value: number;
}

/**
 * Dependency-free responsive bar chart (CSS-based). Keeps the bundle light and
 * avoids a charting library while covering analytics needs.
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart" *ngIf="data.length; else empty">
      <div class="bar-row" *ngFor="let d of data">
        <span class="label">{{ d.label }}</span>
        <div class="track">
          <div class="fill" [style.width.%]="pct(d.value)"></div>
        </div>
        <span class="value">{{ format(d.value) }}</span>
      </div>
    </div>
    <ng-template #empty><p class="muted">No data yet.</p></ng-template>
  `,
  styles: [
    `
      .chart {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .bar-row {
        display: grid;
        grid-template-columns: 90px 1fr auto;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
      }
      .label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--ion-color-medium);
      }
      .track {
        background: var(--ion-color-light, #eee);
        border-radius: 6px;
        height: 14px;
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--ion-color-primary);
        border-radius: 6px;
        transition: width 0.4s ease;
        min-width: 2px;
      }
      .value {
        font-variant-numeric: tabular-nums;
      }
      .muted {
        color: var(--ion-color-medium);
      }
    `,
  ],
})
export class BarChartComponent {
  @Input() data: ChartDatum[] = [];
  /** Optional value formatter (e.g. currency). */
  @Input() format: (v: number) => string = (v) => String(v);

  pct(value: number): number {
    const max = Math.max(...this.data.map((d) => d.value), 1);
    return Math.round((value / max) * 100);
  }
}
