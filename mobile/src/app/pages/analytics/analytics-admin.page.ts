import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActionSheetController, IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, AdminAnalytics } from '../../core/analytics.service';
import { ChartCardComponent } from '../../components/chart-card.component';
import { ReportExportService } from '../../core/report-export.service';

@Component({
  selector: 'app-analytics-admin',
  standalone: true,
  imports: [IonicModule, CommonModule, ChartCardComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Platform analytics</ion-title>
        <ion-buttons slot="end"><ion-button (click)="exportReport()"><ion-icon slot="icon-only" name="download-outline"></ion-icon></ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="data as d">
      <ion-grid>
        <ion-row>
          <ion-col size="6"><div class="stat"><span>{{ d.revenueMinor / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>Revenue</div></ion-col>
          <ion-col size="6"><div class="stat"><span>{{ d.totalBookings }}</span>Bookings</div></ion-col>
        </ion-row>
      </ion-grid>

      <app-chart-card title="Popular services" type="bar" [labels]="catLabels" [values]="catValues" seriesLabel="Bookings"></app-chart-card>
      <app-chart-card title="Peak booking hours" type="area" [labels]="hourLabels" [values]="hourValues" seriesLabel="Bookings"></app-chart-card>
      <app-chart-card title="Geographic demand" type="doughnut" [labels]="geoLabels" [values]="geoValues"></app-chart-card>

      <ion-card>
        <ion-card-header><ion-card-title>Top providers</ion-card-title></ion-card-header>
        <ion-list>
          <ion-item *ngFor="let p of d.topProviders">
            <ion-label><h3>{{ p.businessName }}</h3><p>{{ p.completedJobs }} jobs · {{ p.rating }}★</p></ion-label>
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
  private exporter = inject(ReportExportService);
  private actionSheet = inject(ActionSheetController);

  data?: AdminAnalytics;
  catLabels: string[] = [];
  catValues: number[] = [];
  hourLabels: string[] = [];
  hourValues: number[] = [];
  geoLabels: string[] = [];
  geoValues: number[] = [];

  ionViewWillEnter(): void {
    this.analytics.admin().subscribe((d) => {
      this.data = d;
      this.catLabels = d.popularCategories.map((c) => c.category);
      this.catValues = d.popularCategories.map((c) => c.count);
      this.hourLabels = d.peakHours.map((h) => `${h.hour}:00`);
      this.hourValues = d.peakHours.map((h) => h.count);
      this.geoLabels = d.geographicDemand.map((g) => g.area);
      this.geoValues = d.geographicDemand.map((g) => g.count);
    });
  }

  async exportReport(): Promise<void> {
    const rows = (this.data?.popularCategories || []).map((c) => ({ category: c.category, bookings: c.count }));
    const sheet = await this.actionSheet.create({
      header: 'Export popular services',
      buttons: [
        { text: 'CSV', handler: () => this.exporter.csv('popular-services', rows) },
        { text: 'Excel', handler: () => this.exporter.excel('popular-services', rows) },
        { text: 'PDF', handler: () => this.exporter.pdf('popular-services', rows, 'Popular services') },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }
}
