import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';
import { EmptyStateComponent } from '../../components/empty-state.component';

interface PaymentRow {
  reference: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  bookingId?: string;
  createdAt?: string;
}

@Component({
  selector: 'app-admin-payments',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Payments</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [(ngModel)]="status" (ionChange)="load()" scrollable="true">
          <ion-segment-button value=""><ion-label>All</ion-label></ion-segment-button>
          <ion-segment-button value="succeeded"><ion-label>Succeeded</ion-label></ion-segment-button>
          <ion-segment-button value="pending"><ion-label>Pending</ion-label></ion-segment-button>
          <ion-segment-button value="failed"><ion-label>Failed</ion-label></ion-segment-button>
          <ion-segment-button value="refunded"><ion-label>Refunded</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && payments.length === 0" icon="card-outline" title="No payments"></app-empty-state>
      <ion-list>
        <ion-item *ngFor="let p of payments">
          <ion-label>
            <h2>{{ p.amount / 100 | currency: p.currency : 'symbol-narrow' }} · {{ p.method }}</h2>
            <p>{{ p.reference }} · <ion-badge [color]="color(p.status)">{{ p.status }}</ion-badge></p>
          </ion-label>
          <ion-button slot="end" *ngIf="p.status === 'succeeded'" fill="outline" (click)="refund(p)">Refund</ion-button>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class AdminPaymentsPage implements ViewWillEnter {
  private admin = inject(AdminService);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  payments: PaymentRow[] = [];
  status = '';
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.payments(this.status || undefined).subscribe({
      next: (p) => {
        this.payments = p as unknown as PaymentRow[];
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  color(status: string): string {
    if (status === 'succeeded') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'refunded') return 'tertiary';
    return 'medium';
  }

  async refund(p: PaymentRow): Promise<void> {
    const alert = await this.alert.create({
      header: 'Request refund',
      message: `Refund ${p.reference}?`,
      inputs: [{ name: 'reason', type: 'text', placeholder: 'Reason' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Request',
          handler: (val) => {
            this.admin.refund(p.reference, val?.reason).subscribe(() =>
              this.notify('Refund requested')
            );
          },
        },
      ],
    });
    await alert.present();
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1800, color: 'medium' });
    await t.present();
  }
}
