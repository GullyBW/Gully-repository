import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ProviderService } from '../../core/provider.service';
import { AvailabilityService } from '../../core/availability.service';
import { CategoryService } from '../../core/category.service';
import { Availability, BookingLocation, Category, ProviderProfile } from '../../core/models';
import { MapPickerComponent } from '../../components/map-picker.component';

const DAYS = [
  { i: 0, label: 'Sun' },
  { i: 1, label: 'Mon' },
  { i: 2, label: 'Tue' },
  { i: 3, label: 'Wed' },
  { i: 4, label: 'Thu' },
  { i: 5, label: 'Fri' },
  { i: 6, label: 'Sat' },
];

@Component({
  selector: 'app-provider-dashboard',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, MapPickerComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>Provider dashboard</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-segment [(ngModel)]="tab">
        <ion-segment-button value="profile"><ion-label>Profile</ion-label></ion-segment-button>
        <ion-segment-button value="availability"><ion-label>Availability</ion-label></ion-segment-button>
      </ion-segment>

      <!-- PROFILE -->
      <div *ngIf="tab === 'profile'">
        <ion-chip *ngIf="profile?.verified" color="primary">
          <ion-icon name="checkmark-circle"></ion-icon><ion-label>Verified</ion-label>
        </ion-chip>
        <ion-chip *ngIf="profile && !profile.verified" color="medium">Pending verification</ion-chip>

        <ion-item>
          <ion-select label="Live status" [(ngModel)]="liveStatus" (ionChange)="saveStatus()" interface="popover">
            <ion-select-option value="available">Available</ion-select-option>
            <ion-select-option value="busy">Busy</ion-select-option>
            <ion-select-option value="offline">Offline</ion-select-option>
            <ion-select-option value="vacation">Vacation</ion-select-option>
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-input label="Business name" labelPlacement="floating" [(ngModel)]="form.businessName"></ion-input>
        </ion-item>
        <ion-item>
          <ion-select label="Primary category" labelPlacement="floating" [(ngModel)]="form.category" interface="popover">
            <ion-select-option *ngFor="let c of categories" [value]="c.key">{{ c.name }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-textarea label="Bio" labelPlacement="floating" [(ngModel)]="form.bio" [autoGrow]="true"></ion-textarea>
        </ion-item>
        <ion-item>
          <ion-input label="Years experience" labelPlacement="floating" type="number" [(ngModel)]="form.yearsExperience"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="Starting price (BWP)" labelPlacement="floating" type="number" [(ngModel)]="startingPricePula"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="Languages (comma separated)" labelPlacement="floating" [(ngModel)]="languagesText"></ion-input>
        </ion-item>

        <h4>Base location</h4>
        <app-map-picker [(value)]="location"></app-map-picker>

        <ion-button expand="block" (click)="saveProfile()" [disabled]="saving">
          {{ saving ? 'Saving…' : profile ? 'Update profile' : 'Create profile' }}
        </ion-button>
      </div>

      <!-- AVAILABILITY -->
      <div *ngIf="tab === 'availability' && availability as a">
        <h4>Working days</h4>
        <ion-chip
          *ngFor="let d of days"
          [color]="a.workingDays.includes(d.i) ? 'primary' : 'medium'"
          (click)="toggleDay(d.i)"
        >
          {{ d.label }}
        </ion-chip>

        <ion-item>
          <ion-input label="Start time (HH:mm)" labelPlacement="floating" [(ngModel)]="a.startTime"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="End time (HH:mm)" labelPlacement="floating" [(ngModel)]="a.endTime"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="Slot length (minutes)" labelPlacement="floating" type="number" [(ngModel)]="a.slotMinutes"></ion-input>
        </ion-item>
        <ion-item>
          <ion-toggle [(ngModel)]="a.emergencyAvailable">Emergency availability</ion-toggle>
        </ion-item>
        <ion-item>
          <ion-toggle [(ngModel)]="a.vacationMode">Vacation mode</ion-toggle>
        </ion-item>
        <ion-item *ngIf="a.vacationMode">
          <ion-input label="Vacation until (YYYY-MM-DD)" labelPlacement="floating" [(ngModel)]="a.vacationUntil"></ion-input>
        </ion-item>

        <ion-button expand="block" (click)="saveAvailability()" [disabled]="saving">
          {{ saving ? 'Saving…' : 'Save availability' }}
        </ion-button>
      </div>
    </ion-content>
  `,
})
export class ProviderDashboardPage implements ViewWillEnter {
  private providerService = inject(ProviderService);
  private availabilityService = inject(AvailabilityService);
  private categoryService = inject(CategoryService);
  private toast = inject(ToastController);

  tab: 'profile' | 'availability' = 'profile';
  days = DAYS;

  profile?: ProviderProfile;
  categories: Category[] = [];
  form: Partial<ProviderProfile> = {};
  startingPricePula: number | null = null;
  languagesText = '';
  location: BookingLocation = {};
  liveStatus = 'available';

  availability?: Availability;
  saving = false;

  ionViewWillEnter(): void {
    this.categoryService.list().subscribe((c) => (this.categories = c));

    this.providerService.myProfile().subscribe({
      next: (p) => {
        this.profile = p;
        this.form = { businessName: p.businessName, category: p.category, bio: p.bio, yearsExperience: p.yearsExperience };
        this.startingPricePula = p.startingPrice != null ? p.startingPrice / 100 : null;
        this.languagesText = (p.languages || []).join(', ');
        this.location = p.location || {};
        this.liveStatus = p.availabilityStatus;
      },
      error: () => {
        /* no profile yet — create mode */
      },
    });

    this.availabilityService.mine().subscribe((a) => (this.availability = a));
  }

  saveProfile(): void {
    this.saving = true;
    const payload: Partial<ProviderProfile> = {
      ...this.form,
      startingPrice: this.startingPricePula != null ? Math.round(this.startingPricePula * 100) : undefined,
      languages: this.languagesText
        ? this.languagesText.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      location: this.location,
    };
    this.providerService.upsert(payload).subscribe({
      next: async (p) => {
        this.profile = p;
        this.saving = false;
        await this.notify('Profile saved', 'success');
      },
      error: async (err) => {
        this.saving = false;
        await this.notify(err?.error?.error?.message || 'Could not save profile', 'danger');
      },
    });
  }

  saveStatus(): void {
    this.providerService.setAvailabilityStatus(this.liveStatus).subscribe();
  }

  toggleDay(i: number): void {
    if (!this.availability) return;
    const set = new Set(this.availability.workingDays);
    if (set.has(i)) set.delete(i);
    else set.add(i);
    this.availability.workingDays = [...set].sort((a, b) => a - b);
  }

  saveAvailability(): void {
    if (!this.availability) return;
    this.saving = true;
    this.availabilityService.update(this.availability).subscribe({
      next: async (a) => {
        this.availability = a;
        this.saving = false;
        await this.notify('Availability saved', 'success');
      },
      error: async () => {
        this.saving = false;
        await this.notify('Could not save availability', 'danger');
      },
    });
  }

  private async notify(message: string, color: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, color });
    await t.present();
  }
}
