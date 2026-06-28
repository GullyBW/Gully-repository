import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActionSheetController, IonicModule, ViewWillEnter } from '@ionic/angular';
import { AnalyticsService, ProviderAnalytics } from '../../core/analytics.service';
import { ChartCardComponent } from '../../components/chart-card.component';
import { ReportExportService } from '../../core/report-export.service';

@Component({
  selector: 'app-analytics-provider',
  standalone: true,
  imports: [IonicModule, CommonModule, ChartCardComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>My earnings</ion-title>
        <ion-buttons slot="end"><ion-button (click)="exportReport()"><ion-icon slot="icon-only" name="download-outline"></ion-icon></ion-button></ion-buttons>
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

      <app-chart-card title="Monthly earnings (BWP)" type="area" [labels]="months" [values]="earnings" seriesLabel="Earnings"></app-chart-card>
      <app-chart-card title="Bookings per month" type="bar" [labels]="months" [values]="bookings" seriesLabel="Bookings"></app-chart-card>
    </ion-content>
  `,
  styles: [
    `.stat{background:var(--ion-color-light);border-radius:12px;padding:14px;text-align:center;font-size:.8rem;color:var(--ion-color-medium);}
     .stat span{display:block;font-size:1.3rem;font-weight:700;color:var(--ion-text-color);}`,
  ],
})
export class AnalyticsProviderPage implements ViewWillEnter {
  private analytics = inject(AnalyticsService);
  private exporter = inject(ReportExportService);
  private actionSheet = inject(ActionSheetController);

  data?: ProviderAnalytics;
  months: string[] = [];
  earnings: number[] = [];
  bookings: number[] = [];

  ionViewWillEnter(): void {
    this.analytics.provider().subscribe((d) => {
      this.data = d;
      this.months = d.monthly.map((m) => m.month);
      this.earnings = d.monthly.map((m) => Math.round(m.earningsMinor / 100));
      this.bookings = d.monthly.map((m) => m.bookings);
    });
  }

  async exportReport(): Promise<void> {
    const rows = (this.data?.monthly || []).map((m) => ({
      month: m.month,
      bookings: m.bookings,
      earningsBWP: (m.earningsMinor / 100).toFixed(2),
    }));
    const sheet = await this.actionSheet.create({
      header: 'Export earnings',
      buttons: [
        { text: 'CSV', handler: () => this.exporter.csv('earnings', rows) },
        { text: 'Excel', handler: () => this.exporter.excel('earnings', rows) },
        { text: 'PDF', handler: () => this.exporter.pdf('earnings', rows, 'Monthly earnings') },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }
}
