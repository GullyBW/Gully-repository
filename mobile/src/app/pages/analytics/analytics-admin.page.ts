import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, AdminAnalytics } from '../../core/analytics.service';
import { BarChartComponent, ChartDatum } from '../../components/bar-chart.component';
import { downloadText } from '../../core/download.util';

@Component({
  selector: 'app-analytics-admin',
  standalone: true,
  imports: [IonicModule, CommonModule, BarChartComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Platform analytics</ion-title>
        <ion-buttons slot="end"><ion-button (click)="exportCsv()">CSV</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="data as d">
      <ion-grid>
        <ion-row>
          <ion-col size="6"><div class="stat"><span>{{ d.revenueMinor / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>Revenue</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.totalBookings }}</span>Bookings</div></ion-col>
        </ion-row>
      </ion-grid>

      <ion-card>
        <ion-card-header><ion-card-title>Popular services</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="categoryChart"></app-bar-chart></ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>Peak booking hours</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="hoursChart"></app-bar-chart></ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>Geographic demand</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="geoChart"></app-bar-chart></ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>Top providers</ion-card-title></ion-card-header>
        <ion-list>
          <ion-item *ngFor="let p of d.topProviders">
            <ion-label>
              <h3>{{ p.businessName }}</h3>
              <p>{{ p.completedJobs }} jobs · {{ p.rating }}★</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </ion-card>
    </ion-content>
  `,
  styles: [
    `.stat{background:var(--ion-color-light);border-radius:12px;padding:14px;text-align:center;font-size:.8rem;color:var(--ion-color-medium);}
     .stat span{display:block;font-size:1.3rem;font-weight:700;color:var(--ion-text-color);}`,
  ],
})
export class AnalyticsAdminPage implements ViewWillEnter {
  private analytics = inject(AnalyticsService);

  data?: AdminAnalytics;
  categoryChart: ChartDatum[] = [];
  hoursChart: ChartDatum[] = [];
  geoChart: ChartDatum[] = [];

  ionViewWillEnter(): void {
    this.analytics.admin().subscribe((d) => {
      this.data = d;
      this.categoryChart = d.popularCategories.map((c) => ({ label: c.category, value: c.count }));
      this.hoursChart = d.peakHours.map((h) => ({ label: `${h.hour}:00`, value: h.count }));
      this.geoChart = d.geographicDemand.map((g) => ({ label: g.area, value: g.count }));
    });
  }

  exportCsv(): void {
    this.analytics.exportCsv('admin-categories').subscribe((csv) => downloadText('categories.csv', csv));
  }
}
