import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { BookingService } from '../../core/booking.service';
import { AuthService } from '../../core/auth.service';
import { Booking, BookingStatus } from '../../core/models';

@Component({
  selector: 'app-booking-detail',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/bookings"></ion-back-button></ion-buttons>
        <ion-title>Booking</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="booking as b">
      <ion-card>
        <ion-card-header>
          <ion-card-subtitle>{{ b.reference }}</ion-card-subtitle>
          <ion-card-title>{{ b.serviceType | titlecase }}</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p><strong>Status:</strong> <ion-badge [color]="statusColor(b.status)">{{ b.status }}</ion-badge></p>
          <p><strong>Amount:</strong> {{ b.amount / 100 | currency: b.currency : 'symbol-narrow' }}</p>
          <p *ngIf="b.description"><strong>Details:</strong> {{ b.description }}</p>
          <p *ngIf="b.location?.address"><strong>Address:</strong> {{ b.location?.address }}</p>
          <p *ngIf="b.scheduledFor"><strong>Scheduled:</strong> {{ b.scheduledFor | date: 'medium' }}</p>
          <p *ngIf="b.paymentStatus">
            <strong>Payment:</strong>
            <ion-badge [color]="b.paymentStatus === 'succeeded' ? 'success' : 'medium'">
              {{ b.paymentStatus }}
            </ion-badge>
          </p>
        </ion-card-content>
      </ion-card>

      <!-- Provider actions -->
      <ng-container *ngIf="isProvider">
        <ion-button *ngIf="b.status === 'pending'" expand="block" (click)="setStatus('accepted')">Accept</ion-button>
        <ion-button *ngIf="b.status === 'pending'" expand="block" color="danger" fill="outline" (click)="setStatus('declined')">Decline</ion-button>
        <ion-button *ngIf="b.status === 'accepted'" expand="block" (click)="setStatus('in_progress')">Start work</ion-button>
        <ion-button *ngIf="b.status === 'in_progress'" expand="block" (click)="setStatus('completed')">Mark completed</ion-button>
      </ng-container>

      <!-- Customer actions -->
      <ng-container *ngIf="isCustomer">
        <ion-button
          *ngIf="canPay(b)"
          expand="block"
          (click)="goPay()"
        >
          Pay {{ b.amount / 100 | currency: b.currency : 'symbol-narrow' }}
        </ion-button>
      </ng-container>

      <ion-button
        *ngIf="b.status === 'pending' || b.status === 'accepted'"
        expand="block"
        color="medium"
        fill="clear"
        (click)="setStatus('cancelled')"
      >
        Cancel booking
      </ion-button>
    </ion-content>
  `,
})
export class BookingDetailPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(BookingService);
  private auth = inject(AuthService);
  private toast = inject(ToastController);

  booking?: Booking;
  reference = '';

  get isProvider(): boolean {
    return this.auth.currentUser()?.id === this.booking?.providerId;
  }

  get isCustomer(): boolean {
    return this.auth.currentUser()?.id === this.booking?.customerId;
  }

  ionViewWillEnter(): void {
    this.reference = this.route.snapshot.paramMap.get('reference') || '';
    this.load();
  }

  load(): void {
    this.service.get(this.reference).subscribe({
      next: (b) => (this.booking = b),
      error: async () => this.notify('Could not load booking', 'danger'),
    });
  }

  canPay(b: Booking): boolean {
    const payable = ['accepted', 'in_progress', 'completed'];
    return payable.includes(b.status) && b.paymentStatus !== 'succeeded';
  }

  goPay(): void {
    this.router.navigate(['/bookings', this.reference, 'pay']);
  }

  setStatus(status: BookingStatus): void {
    this.service.updateStatus(this.reference, status).subscribe({
      next: (b) => {
        this.booking = b;
        this.notify(`Booking ${status}`, 'success');
      },
      error: async (err) =>
        this.notify(err?.error?.error?.message || 'Update failed', 'danger'),
    });
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

  private async notify(message: string, color: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, color });
    await t.present();
  }
}
