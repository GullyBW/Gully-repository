import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ProviderService } from '../../core/provider.service';
import { AvailabilityService } from '../../core/availability.service';
import { BookingService } from '../../core/booking.service';
import { BookingLocation, ProviderProfile, Slot } from '../../core/models';
import { MapPickerComponent } from '../../components/map-picker.component';

@Component({
  selector: 'app-booking-wizard',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, MapPickerComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start">
          <ion-button (click)="back()"><ion-icon slot="icon-only" name="arrow-back"></ion-icon></ion-button>
        </ion-buttons>
        <ion-title>Book {{ provider?.businessName }}</ion-title>
      </ion-toolbar>
      <ion-progress-bar [value]="(step + 1) / 4"></ion-progress-bar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Step 0: date & time -->
      <div *ngIf="step === 0">
        <h3>Choose a date</h3>
        <ion-datetime
          presentation="date"
          [min]="today"
          (ionChange)="onDate($any($event).detail.value)"
        ></ion-datetime>

        <ng-container *ngIf="selectedDate">
          <h3>Available times</h3>
          <p *ngIf="slots.length === 0" class="muted">No slots available on this day.</p>
          <ion-chip
            *ngFor="let s of slots"
            [color]="selectedSlot === s ? 'primary' : 'medium'"
            (click)="selectedSlot = s"
          >
            {{ s.start }}
          </ion-chip>
        </ng-container>
      </div>

      <!-- Step 1: location -->
      <div *ngIf="step === 1">
        <h3>Where do you need the service?</h3>
        <app-map-picker [(value)]="location"></app-map-picker>
      </div>

      <!-- Step 2: details -->
      <div *ngIf="step === 2">
        <h3>Job details</h3>
        <ion-item>
          <ion-textarea
            label="Describe the job"
            labelPlacement="floating"
            [(ngModel)]="description"
            [autoGrow]="true"
          ></ion-textarea>
        </ion-item>
        <ion-item>
          <ion-input
            label="Agreed price (BWP)"
            labelPlacement="floating"
            type="number"
            [(ngModel)]="amountPula"
          ></ion-input>
        </ion-item>
      </div>

      <!-- Step 3: summary -->
      <div *ngIf="step === 3">
        <h3>Booking summary</h3>
        <ion-list>
          <ion-item><ion-label>Provider</ion-label><ion-note slot="end">{{ provider?.businessName }}</ion-note></ion-item>
          <ion-item><ion-label>Service</ion-label><ion-note slot="end">{{ provider?.category | titlecase }}</ion-note></ion-item>
          <ion-item><ion-label>Date</ion-label><ion-note slot="end">{{ selectedDate | date: 'mediumDate' }}</ion-note></ion-item>
          <ion-item><ion-label>Time</ion-label><ion-note slot="end">{{ selectedSlot?.start || '—' }}</ion-note></ion-item>
          <ion-item><ion-label>Location</ion-label><ion-note slot="end" class="ion-text-wrap">{{ location.address || '—' }}</ion-note></ion-item>
          <ion-item><ion-label>Price</ion-label><ion-note slot="end">{{ amountPula | currency: 'BWP' : 'symbol-narrow' }}</ion-note></ion-item>
        </ion-list>
      </div>

      <ion-button expand="block" class="ion-margin-top" (click)="next()" [disabled]="!canAdvance() || submitting">
        {{ step < 3 ? 'Continue' : submitting ? 'Creating…' : 'Confirm & pay' }}
      </ion-button>
    </ion-content>
  `,
  styles: [`.muted { color: var(--ion-color-medium); }`],
})
export class BookingWizardPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private providerService = inject(ProviderService);
  private availability = inject(AvailabilityService);
  private bookings = inject(BookingService);
  private toast = inject(ToastController);

  provider?: ProviderProfile;
  providerId = '';
  step = 0;
  today = new Date().toISOString();

  selectedDate = '';
  slots: Slot[] = [];
  selectedSlot?: Slot;
  location: BookingLocation = {};
  description = '';
  amountPula: number | null = null;
  submitting = false;

  ionViewWillEnter(): void {
    this.providerId = this.route.snapshot.paramMap.get('userId') || '';
    this.providerService.getProfile(this.providerId).subscribe((p) => {
      this.provider = p;
      if (p.startingPrice != null && this.amountPula == null) this.amountPula = p.startingPrice / 100;
    });
  }

  onDate(value: string): void {
    this.selectedDate = (value || '').slice(0, 10);
    this.selectedSlot = undefined;
    if (this.selectedDate) {
      this.availability
        .slots(this.providerId, this.selectedDate)
        .subscribe((r) => (this.slots = r.slots));
    }
  }

  canAdvance(): boolean {
    if (this.step === 0) return !!this.selectedDate && !!this.selectedSlot;
    if (this.step === 1) return this.location.lat != null;
    if (this.step === 2) return !!this.amountPula && this.amountPula > 0;
    return true;
  }

  next(): void {
    if (this.step < 3) {
      this.step++;
      return;
    }
    this.confirm();
  }

  back(): void {
    if (this.step > 0) this.step--;
    else this.router.navigate(['/providers', this.providerId]);
  }

  private confirm(): void {
    if (!this.provider || !this.amountPula) return;
    this.submitting = true;
    const scheduledFor =
      this.selectedDate && this.selectedSlot
        ? new Date(`${this.selectedDate}T${this.selectedSlot.start}:00`).toISOString()
        : undefined;

    this.bookings
      .create({
        providerId: this.providerId,
        serviceType: this.provider.category,
        description: this.description || undefined,
        amount: Math.round(this.amountPula * 100),
        scheduledFor,
        location: this.location,
      })
      .subscribe({
        next: async (booking) => {
          this.submitting = false;
          await this.notify('Booking requested — pay once the provider accepts', 'success');
          this.router.navigate(['/bookings', booking.reference]);
        },
        error: async (err) => {
          this.submitting = false;
          await this.notify(err?.error?.error?.message || 'Could not create booking', 'danger');
        },
      });
  }

  private async notify(message: string, color = 'medium'): Promise<void> {
    const t = await this.toast.create({ message, duration: 2400, color });
    await t.present();
  }
}
