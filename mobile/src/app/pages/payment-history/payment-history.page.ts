import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { PaymentService } from '../../core/payment.service';
import { AuthService } from '../../core/auth.service';
import { Payment } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-payment-history',
  standalone: true,
  imports: [IonicModule, CommonModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>Payment history</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && payments.length === 0" icon="card-outline" title="No payments yet"></app-empty-state>
      <ion-list>
        <ion-item *ngFor="let p of payments">
          <ion-label>
            <h2>{{ p.amount / 100 | currency: p.currency : 'symbol-narrow' }}</h2>
            <p>{{ p.method }} · {{ p.reference }}</p>
            <p>{{ p.createdAt | date: 'medium' }}</p>
          </ion-label>
          <ion-badge slot="end" [color]="color(p.status)">{{ p.status }}</ion-badge>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class PaymentHistoryPage implements ViewWillEnter {
  private payments$ = inject(PaymentService);
  private auth = inject(AuthService);

  payments: Payment[] = [];
  loading = false;

  ionViewWillEnter(): void {
    const id = this.auth.currentUser()?.id;
    if (!id) return;
    this.loading = true;
    this.payments$.history(id).subscribe({
      next: (p) => {
        this.payments = p;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  color(status: string): string {
    if (status === 'succeeded') return 'success';
    if (status === 'failed' || status === 'cancelled') return 'danger';
    if (status === 'refunded') return 'tertiary';
    return 'medium';
  }
}
