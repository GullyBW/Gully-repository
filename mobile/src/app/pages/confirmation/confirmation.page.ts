import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Subscription, interval } from 'rxjs';
import { BookingService } from '../../core/booking.service';
import { Payment, PaymentStatus } from '../../core/models';

@Component({
  selector: 'app-confirmation',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Payment status</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding ion-text-center">
      <div class="ion-margin-vertical">
        <ion-icon
          [name]="iconFor(status)"
          [color]="colorFor(status)"
          style="font-size: 72px"
        ></ion-icon>
        <h1>{{ headline() }}</h1>
        <p>Reference: {{ payment?.reference || bookingRef }}</p>
      </div>

      <!-- Card hosted checkout -->
      <ion-button
        *ngIf="payment?.providerMeta?.checkoutUrl && status !== 'succeeded'"
        expand="block"
        [href]="payment?.providerMeta?.checkoutUrl"
        target="_blank"
      >
        Open secure checkout
      </ion-button>

      <!-- Mobile money / generic instructions -->
      <ion-card *ngIf="payment?.providerMeta?.instructions">
        <ion-card-content>{{ payment?.providerMeta?.instructions }}</ion-card-content>
      </ion-card>

      <!-- Bank transfer details -->
      <ion-card *ngIf="payment?.providerMeta?.accountNumber">
        <ion-card-header><ion-card-title>Bank details</ion-card-title></ion-card-header>
        <ion-card-content>
          <p><strong>Bank:</strong> {{ payment?.providerMeta?.bankName }}</p>
          <p><strong>Account name:</strong> {{ payment?.providerMeta?.accountName }}</p>
          <p><strong>Account no:</strong> {{ payment?.providerMeta?.accountNumber }}</p>
          <p><strong>Branch:</strong> {{ payment?.providerMeta?.branchCode }}</p>
          <p><strong>Reference to quote:</strong> {{ payment?.providerMeta?.paymentReference }}</p>
        </ion-card-content>
      </ion-card>

      <p *ngIf="status === 'processing' || status === 'pending'">
        <ion-spinner name="dots"></ion-spinner><br />
        Waiting for confirmation…
      </p>

      <ion-button expand="block" fill="outline" (click)="done()">Back to bookings</ion-button>
    </ion-content>
  `,
})
export class ConfirmationPage implements ViewWillEnter, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private bookings = inject(BookingService);

  bookingRef = '';
  payment?: Payment;
  status: PaymentStatus = 'pending';
  private poll?: Subscription;

  constructor() {
    // Payment object handed over from the payment screen via router state.
    this.payment = this.router.getCurrentNavigation()?.extras?.state?.['payment'];
    if (this.payment) this.status = this.payment.status;
  }

  ionViewWillEnter(): void {
    this.bookingRef = this.route.snapshot.paramMap.get('reference') || '';
    this.refresh();
    // Poll the backend until the payment reaches a terminal state.
    this.poll = interval(4000).subscribe(() => this.refresh());
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }

  refresh(): void {
    this.bookings.paymentStatus(this.bookingRef).subscribe((res) => {
      if (res.paymentStatus) this.status = res.paymentStatus;
      if (this.isTerminal(this.status)) this.poll?.unsubscribe();
    });
  }

  headline(): string {
    switch (this.status) {
      case 'succeeded':
        return 'Payment successful';
      case 'failed':
        return 'Payment failed';
      case 'cancelled':
        return 'Payment cancelled';
      default:
        return 'Awaiting payment';
    }
  }

  iconFor(status: PaymentStatus): string {
    if (status === 'succeeded') return 'checkmark-circle-outline';
    if (status === 'failed' || status === 'cancelled') return 'close-circle-outline';
    return 'time-outline';
  }

  colorFor(status: PaymentStatus): string {
    if (status === 'succeeded') return 'success';
    if (status === 'failed' || status === 'cancelled') return 'danger';
    return 'medium';
  }

  isTerminal(status: PaymentStatus): boolean {
    return ['succeeded', 'failed', 'cancelled', 'refunded'].includes(status);
  }

  done(): void {
    this.router.navigateByUrl('/tabs/bookings');
  }
}
