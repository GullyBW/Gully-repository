import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, CustomerAnalytics } from '../../core/analytics.service';
import { BarChartComponent, ChartDatum } from '../../components/bar-chart.component';

@Component({
  selector: 'app-analytics-customer',
  standalone: true,
  imports: [IonicModule, CommonModule, BarChartComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>My activity</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="data as d">
      <ion-grid>
        <ion-row>
          <ion-col size="6"><div class="stat"><span>{{ d.totalBookings }}</span>Bookings</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.completed }}</span>Completed</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.spendingMinor / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>Spent</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.favouriteProviders }}</span>Favourites</div></ion-col>
        </ion-row>
      </ion-grid>

      <ion-card>
        <ion-card-header><ion-card-title>Services used</ion-card-title></ion-card-header>
        <ion-card-content><app-bar-chart [data]="categoryChart"></app-bar-chart></ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [
    `.stat{background:var(--ion-color-light);border-radius:12px;padding:14px;text-align:center;font-size:.8rem;color:var(--ion-color-medium);}
     .stat span{display:block;font-size:1.3rem;font-weight:700;color:var(--ion-text-color);}`,
  ],
})
export class AnalyticsCustomerPage implements ViewWillEnter {
  private analytics = inject(AnalyticsService);

  data?: CustomerAnalytics;
  categoryChart: ChartDatum[] = [];

  ionViewWillEnter(): void {
    this.analytics.customer().subscribe((d) => {
      this.data = d;
      this.categoryChart = d.byCategory.map((c) => ({ label: c.category, value: c.count }));
    });
  }
}
