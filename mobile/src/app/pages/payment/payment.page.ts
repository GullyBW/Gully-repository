import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { BookingService } from '../../core/booking.service';
import { PaymentService } from '../../core/payment.service';
import { Booking, PaymentMethod } from '../../core/models';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  orange_money: 'Orange Money',
  myzaka: 'Mascom MyZaka',
  card: 'Debit / Credit card',
  bank_transfer: 'Bank transfer',
};

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button></ion-back-button></ion-buttons>
        <ion-title>Payment</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div *ngIf="booking as b" class="ion-margin-bottom">
        <h2>{{ b.serviceType | titlecase }}</h2>
        <h1>{{ b.amount / 100 | currency: b.currency : 'symbol-narrow' }}</h1>
      </div>

      <ion-radio-group [(ngModel)]="method" name="method">
        <ion-list>
          <ion-item *ngFor="let m of methods">
            <ion-radio [value]="m">{{ label(m) }}</ion-radio>
          </ion-item>
        </ion-list>
      </ion-radio-group>

      <ion-item *ngIf="needsMsisdn()">
        <ion-input
          label="Mobile money number"
          labelPlacement="floating"
          type="tel"
          [(ngModel)]="payerMsisdn"
          name="payerMsisdn"
          placeholder="26771000000"
        ></ion-input>
      </ion-item>

      <ion-button expand="block" class="ion-margin-top" [disabled]="loading || !method" (click)="pay()">
        {{ loading ? 'Processing…' : 'Pay now' }}
      </ion-button>
    </ion-content>
  `,
})
export class PaymentPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private bookings = inject(BookingService);
  private payments = inject(PaymentService);
  private toast = inject(ToastController);

  reference = '';
  booking?: Booking;
  methods: PaymentMethod[] = [];
  method?: PaymentMethod;
  payerMsisdn = '';
  loading = false;

  ionViewWillEnter(): void {
    this.reference = this.route.snapshot.paramMap.get('reference') || '';
    this.bookings.get(this.reference).subscribe((b) => (this.booking = b));
    this.payments.methods().subscribe((m) => (this.methods = m));
  }

  label(m: PaymentMethod): string {
    return METHOD_LABELS[m] ?? m;
  }

  needsMsisdn(): boolean {
    return this.method === 'orange_money' || this.method === 'myzaka';
  }

  pay(): void {
    if (!this.method) return;
    if (this.needsMsisdn() && !this.payerMsisdn) {
      this.notify('Enter your mobile money number', 'warning');
      return;
    }
    this.loading = true;
    this.bookings
      .pay(this.reference, this.method, this.needsMsisdn() ? this.payerMsisdn : undefined)
      .subscribe({
        next: ({ payment }) => {
          this.loading = false;
          // Hand the provider instructions/checkout URL to the confirmation screen.
          this.router.navigate(['/bookings', this.reference, 'confirmation'], {
            state: { payment },
          });
        },
        error: async (err) => {
          this.loading = false;
          await this.notify(err?.error?.error?.message || 'Payment failed', 'danger');
        },
      });
  }

  private async notify(message: string, color: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2500, color });
    await t.present();
  }
}
