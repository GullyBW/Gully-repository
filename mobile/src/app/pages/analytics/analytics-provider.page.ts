import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, ProviderAnalytics } from '../../core/analytics.service';
import { BarChartComponent, ChartDatum } from '../../components/bar-chart.component';
import { downloadText } from '../../core/download.util';

@Component({
  selector: 'app-analytics-provider',
  standalone: true,
  imports: [IonicModule, CommonModule, BarChartComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>My earnings</ion-title>
        <ion-buttons slot="end"><ion-button (click)="exportCsv()">CSV</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="data as d">
      <ion-grid>
        <ion-row>
          <ion-col size="6"><div class="stat"><span>{{ d.earningsMinor / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>Earnings</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.completedJobs }}</span>Completed</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.acceptanceRate }}%</span>Acceptance</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.rating }}</span>Rating</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.repeatCustomers }}</span>Repeat</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.uniqueCustomers }}</span>Customers</div></ion-col>
        </ion-row>
      </ion-grid>

      <ion-card>
        <ion-card-header><ion-card-title>Monthly earnings</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="earningsChart" [format]="money"></app-bar-chart></ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>Bookings per month</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="bookingsChart"></app-bar-chart></ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [
    `.stat{background:var(--ion-color-light);border-radius:12px;padding:14px;text-align:center;font-size:.8rem;color:var(--ion-color-medium);}
     .stat span{display:block;font-size:1.3rem;font-weight:700;color:var(--ion-text-color);}`,
  ],
})
export class AnalyticsProviderPage implements ViewWillEnter {
  private analytics = inject(AnalyticsService);

  data?: ProviderAnalytics;
  earningsChart: ChartDatum[] = [];
  bookingsChart: ChartDatum[] = [];
  money = (v: number) => `P${(v / 100).toFixed(0)}`;

  ionViewWillEnter(): void {
    this.analytics.provider().subscribe((d) => {
      this.data = d;
      this.earningsChart = d.monthly.map((m) => ({ label: m.month, value: m.earningsMinor }));
      this.bookingsChart = d.monthly.map((m) => ({ label: m.month, value: m.bookings }));
    });
  }

  exportCsv(): void {
    this.analytics.exportCsv('provider-monthly').subscribe((csv) => downloadText('earnings.csv', csv));
  }
}
