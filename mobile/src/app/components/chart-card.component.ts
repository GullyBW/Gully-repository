import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';

export type AppChartType = 'line' | 'bar' | 'pie' | 'doughnut' | 'area';

const PALETTE = ['#1f7a8c', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#8ecae6', '#457b9d', '#a8dadc'];

/**
 * Reusable Chart.js card. Encapsulates ng2-charts so charting can be swapped
 * later without touching pages. Supports line/bar/pie/doughnut and "area"
 * (a filled line). Responsive across desktop/tablet/mobile.
 */
@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [IonicModule, CommonModule, BaseChartDirective],
  template: `
    <ion-card>
      <ion-card-header *ngIf="title">
        <ion-card-title>{{ title }}</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <div class="chart-wrap" *ngIf="labels.length; else empty">
          <canvas baseChart [type]="chartJsType" [data]="chartData" [options]="options"></canvas>
        </div>
        <ng-template #empty><p class="muted">No data yet.</p></ng-template>
      </ion-card-content>
    </ion-card>
  `,
  styles: [
    `
      .chart-wrap { position: relative; height: 240px; width: 100%; }
      .muted { color: var(--ion-color-medium); }
    `,
  ],
})
export class ChartCardComponent {
  @Input() title = '';
  @Input() type: AppChartType = 'bar';
  @Input() labels: string[] = [];
  /** Single-series values. */
  @Input() values: number[] = [];
  @Input() seriesLabel = '';

  get chartJsType(): ChartType {
    return (this.type === 'area' ? 'line' : this.type) as ChartType;
  }

  get isCircular(): boolean {
    return this.type === 'pie' || this.type === 'doughnut';
  }

  get chartData(): ChartData {
    return {
      labels: this.labels,
      datasets: [
        {
          label: this.seriesLabel,
          data: this.values,
          fill: this.type === 'area',
          tension: 0.35,
          backgroundColor: this.isCircular
            ? this.labels.map((_, i) => PALETTE[i % PALETTE.length])
            : this.type === 'area'
              ? 'rgba(31, 122, 140, 0.25)'
              : PALETTE[0],
          borderColor: PALETTE[0],
          borderWidth: 2,
          pointRadius: this.type === 'line' || this.type === 'area' ? 3 : 0,
        },
      ],
    };
  }

  get options(): ChartConfiguration['options'] {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: this.isCircular || !!this.seriesLabel, position: 'bottom' },
      },
      scales: this.isCircular
        ? {}
        : {
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
    };
  }
}
