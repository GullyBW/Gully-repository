import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { BookingService } from '../../core/booking.service';

const SERVICE_TYPES = [
  'plumbing',
  'electrical',
  'cleaning',
  'gardening',
  'painting',
  'traditional_healing',
  'appliance_repair',
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Book a service</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p>Request a local vendor. Once they accept, you can pay securely in-app.</p>

      <form (ngSubmit)="submit()">
        <ion-list>
          <ion-item>
            <ion-select label="Service" [(ngModel)]="serviceType" name="serviceType" interface="popover">
              <ion-select-option *ngFor="let s of serviceTypes" [value]="s">
                {{ s | titlecase }}
              </ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-input
              label="Provider ID"
              labelPlacement="floating"
              [(ngModel)]="providerId"
              name="providerId"
              placeholder="ID of the vendor you chose"
              required
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-textarea
              label="What do you need?"
              labelPlacement="floating"
              [(ngModel)]="description"
              name="description"
              [autoGrow]="true"
            ></ion-textarea>
          </ion-item>
          <ion-item>
            <ion-input
              label="Address"
              labelPlacement="floating"
              [(ngModel)]="address"
              name="address"
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Agreed price (BWP)"
              labelPlacement="floating"
              type="number"
              [(ngModel)]="amountPula"
              name="amountPula"
              min="1"
              required
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Preferred date/time"
              labelPlacement="floating"
              type="datetime-local"
              [(ngModel)]="scheduledFor"
              name="scheduledFor"
            ></ion-input>
          </ion-item>
        </ion-list>

        <ion-button expand="block" type="submit" [disabled]="loading">
          {{ loading ? 'Sending request…' : 'Request booking' }}
        </ion-button>
      </form>
    </ion-content>
  `,
})
export class HomePage {
  private bookings = inject(BookingService);
  private router = inject(Router);
  private toast = inject(ToastController);

  serviceTypes = SERVICE_TYPES;
  serviceType = SERVICE_TYPES[0];
  providerId = '';
  description = '';
  address = '';
  amountPula: number | null = null;
  scheduledFor = '';
  loading = false;

  submit(): void {
    if (!this.providerId || !this.amountPula) return;
    this.loading = true;
    this.bookings
      .create({
        providerId: this.providerId.trim(),
        serviceType: this.serviceType,
        description: this.description || undefined,
        // Backend stores minor units (thebe).
        amount: Math.round(this.amountPula * 100),
        location: this.address ? { address: this.address } : undefined,
        scheduledFor: this.scheduledFor ? new Date(this.scheduledFor).toISOString() : undefined,
      })
      .subscribe({
        next: async (booking) => {
          this.loading = false;
          await this.notify('Booking requested', 'success');
          this.router.navigate(['/bookings', booking.reference]);
        },
        error: async (err) => {
          this.loading = false;
          await this.notify(err?.error?.error?.message || 'Could not create booking', 'danger');
        },
      });
  }

  private async notify(message: string, color: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, color });
    await t.present();
  }
}
