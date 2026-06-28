import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';
import { Booking } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Bookings</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-select [(ngModel)]="status" (ionChange)="load()" interface="popover" placeholder="All statuses">
          <ion-select-option [value]="''">All</ion-select-option>
          <ion-select-option value="pending">Pending</ion-select-option>
          <ion-select-option value="accepted">Accepted</ion-select-option>
          <ion-select-option value="in_progress">In progress</ion-select-option>
          <ion-select-option value="completed">Completed</ion-select-option>
          <ion-select-option value="cancelled">Cancelled</ion-select-option>
        </ion-select>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && bookings.length === 0" icon="calendar-outline" title="No bookings"></app-empty-state>
      <ion-list>
        <ion-item *ngFor="let b of bookings">
          <ion-label>
            <h2>{{ b.serviceType | titlecase }} · {{ b.reference }}</h2>
            <p>{{ b.amount / 100 | currency: b.currency : 'symbol-narrow' }} · <ion-badge>{{ b.status }}</ion-badge></p>
            <p *ngIf="b.paymentStatus">Payment: {{ b.paymentStatus }}</p>
          </ion-label>
          <ion-button
            slot="end"
            color="danger"
            fill="outline"
            *ngIf="b.status === 'pending' || b.status === 'accepted' || b.status === 'in_progress'"
            (click)="cancel(b)"
          >
            Cancel
          </ion-button>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class AdminBookingsPage implements ViewWillEnter {
  private admin = inject(AdminService);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  bookings: Booking[] = [];
  status = '';
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.bookings(this.status || undefined).subscribe({
      next: (b) => {
        this.bookings = b;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  async cancel(b: Booking): Promise<void> {
    const alert = await this.alert.create({
      header: 'Cancel booking',
      inputs: [{ name: 'reason', type: 'text', placeholder: 'Reason' }],
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Cancel booking',
          role: 'destructive',
          handler: (val) => {
            this.admin.cancelBooking(b.reference, val?.reason).subscribe((res) => {
              b.status = res.status;
              this.notify('Booking cancelled');
            });
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
