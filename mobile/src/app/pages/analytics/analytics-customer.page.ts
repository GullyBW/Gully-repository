import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, CustomerAnalytics } from '../../core/analytics.service';
import { ChartCardComponent } from '../../components/chart-card.component';

@Component({
  selector: 'app-analytics-customer',
  standalone: true,
  imports: [IonicModule, CommonModule, ChartCardComponent],
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

      <app-chart-card title="Services used" type="doughnut" [labels]="catLabels" [values]="catValues"></app-chart-card>
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
  catLabels: string[] = [];
  catValues: number[] = [];

  ionViewWillEnter(): void {
    this.analytics.customer().subscribe((d) => {
      this.data = d;
      this.catLabels = d.byCategory.map((c) => c.category);
      this.catValues = d.byCategory.map((c) => c.count);
    });
  }
}
