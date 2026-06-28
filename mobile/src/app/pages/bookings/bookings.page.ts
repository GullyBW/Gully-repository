import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { BookingService } from '../../core/booking.service';
import { Booking } from '../../core/models';

@Component({
  selector: 'app-bookings',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>My bookings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div *ngIf="!loading && bookings.length === 0" class="ion-padding ion-text-center">
        <p>No bookings yet. Head to Home to request a service.</p>
      </div>

      <ion-list>
        <ion-item
          *ngFor="let b of bookings"
          button
          [detail]="true"
          (click)="open(b)"
        >
          <ion-label>
            <h2>{{ b.serviceType | titlecase }}</h2>
            <p>{{ b.description || 'No description' }}</p>
            <p>{{ b.amount / 100 | currency: b.currency : 'symbol-narrow' }}</p>
          </ion-label>
          <ion-badge slot="end" [color]="statusColor(b.status)">{{ b.status }}</ion-badge>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class BookingsPage implements ViewWillEnter {
  private service = inject(BookingService);
  private router = inject(Router);

  bookings: Booking[] = [];
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(event?: CustomEvent): void {
    this.loading = true;
    const complete = () => (event?.target as { complete?: () => void } | null)?.complete?.();
    this.service.list().subscribe({
      next: (data) => {
        this.bookings = data;
        this.loading = false;
        complete();
      },
      error: () => {
        this.loading = false;
        complete();
      },
    });
  }

  open(b: Booking): void {
    this.router.navigate(['/bookings', b.reference]);
  }

  statusColor(status: string): string {
    switch (status) {
      case 'completed':
      case 'accepted':
        return 'success';
      case 'in_progress':
        return 'secondary';
      case 'cancelled':
      case 'declined':
        return 'danger';
      default:
        return 'medium';
    }
  }
}
