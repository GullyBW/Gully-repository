import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AdminService, AdminDashboard } from '../../core/admin.service';
import { BarChartComponent, ChartDatum } from '../../components/bar-chart.component';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [IonicModule, CommonModule, RouterLink, BarChartComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>Admin</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="load($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <ng-container *ngIf="data as d">
        <ion-grid>
          <ion-row>
            <ion-col size="6"><div class="stat"><span>{{ d.users.total }}</span>Users</div></ion-col>
            <ion-col size="6"><div class="stat"><span>{{ d.users.customers }}</span>Customers</div></ion-col>
            <ion-col size="6"><div class="stat"><span>{{ d.providers.total }}</span>Providers</div></ion-col>
            <ion-col size="6"><div class="stat"><span>{{ d.providers.verified }}</span>Verified</div></ion-col>
            <ion-col size="6"><div class="stat"><span>{{ d.providers.active }}</span>Active now</div></ion-col>
            <ion-col size="6"><div class="stat"><span>{{ d.bookings['total'] || 0 }}</span>Bookings</div></ion-col>
            <ion-col size="12">
              <div class="stat revenue">
                <span>{{ d.revenue.succeededMinor / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>
                Revenue
              </div>
            </ion-col>
          </ion-row>
        </ion-grid>

        <ion-card>
          <ion-card-header><ion-card-title>Bookings by status</ion-card-title></ion-card-header>
          <ion-card-content><app-bar-chart [data]="bookingChart"></app-bar-chart></ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header><ion-card-title>Payments</ion-card-title></ion-card-header>
          <ion-card-content><app-bar-chart [data]="paymentChart"></app-bar-chart></ion-card-content>
        </ion-card>
      </ng-container>

      <ion-list inset="true">
        <ion-item button routerLink="/admin/providers"><ion-icon slot="start" name="people-outline"></ion-icon><ion-label>Provider management</ion-label></ion-item>
        <ion-item button routerLink="/admin/users"><ion-icon slot="start" name="person-outline"></ion-icon><ion-label>Customer management</ion-label></ion-item>
        <ion-item button routerLink="/admin/bookings"><ion-icon slot="start" name="calendar-outline"></ion-icon><ion-label>Booking management</ion-label></ion-item>
        <ion-item button routerLink="/admin/payments"><ion-icon slot="start" name="card-outline"></ion-icon><ion-label>Payment monitoring</ion-label></ion-item>
        <ion-item button routerLink="/admin/reviews"><ion-icon slot="start" name="star-outline"></ion-icon><ion-label>Review moderation</ion-label></ion-item>
        <ion-item button routerLink="/admin/broadcast"><ion-icon slot="start" name="megaphone-outline"></ion-icon><ion-label>Broadcast centre</ion-label></ion-item>
        <ion-item button routerLink="/admin/audit"><ion-icon slot="start" name="document-text-outline"></ion-icon><ion-label>Audit logs</ion-label></ion-item>
        <ion-item button routerLink="/analytics/admin"><ion-icon slot="start" name="bar-chart-outline"></ion-icon><ion-label>Analytics</ion-label></ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [
    `
      .stat {
        background: var(--ion-color-light);
        border-radius: 12px;
        padding: 14px;
        text-align: center;
        font-size: 0.8rem;
        color: var(--ion-color-medium);
      }
      .stat span {
        display: block;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--ion-text-color);
      }
      .revenue span {
        color: var(--ion-color-primary);
      }
    `,
  ],
})
export class AdminDashboardPage implements ViewWillEnter {
  private admin = inject(AdminService);

  data?: AdminDashboard;
  bookingChart: ChartDatum[] = [];
  paymentChart: ChartDatum[] = [];

  ionViewWillEnter(): void {
    this.load();
  }

  load(event?: CustomEvent): void {
    this.admin.dashboard().subscribe({
      next: (d) => {
        this.data = d;
        this.bookingChart = Object.entries(d.bookings)
          .filter(([k]) => k !== 'total')
          .map(([label, value]) => ({ label, value }));
        this.paymentChart = [
          { label: 'succeeded', value: d.payments.succeeded },
          { label: 'pending', value: d.payments.pending },
          { label: 'failed', value: d.payments.failed },
        ];
        (event?.target as { complete?: () => void } | null)?.complete?.();
      },
      error: () => (event?.target as { complete?: () => void } | null)?.complete?.(),
    });
  }
}
