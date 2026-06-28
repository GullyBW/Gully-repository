import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { GeoService } from '../core/geo.service';
import { SavedAddress, SavedAddressService } from '../core/saved-address.service';
import { BookingLocation, Place } from '../core/models';

/**
 * Location picker. Uses the backend geo service for address search + reverse
 * geocoding and the device geolocation API for "current location". The selected
 * {lat,lng,address} is emitted to the parent and stored on the booking.
 *
 * A Google Maps JS widget can be slotted into the `.map` placeholder later
 * without changing this component's public API.
 */
@Component({
  selector: 'app-map-picker',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <div class="map">
      <ion-icon name="map-outline"></ion-icon>
      <p *ngIf="value?.address; else noLoc">{{ value?.address }}</p>
      <ng-template #noLoc><p class="muted">No location selected yet</p></ng-template>
      <p class="coords muted" *ngIf="value?.lat != null">
        {{ value?.lat | number: '1.4-4' }}, {{ value?.lng | number: '1.4-4' }}
      </p>
    </div>

    <ion-button expand="block" fill="outline" (click)="useCurrent()">
      <ion-icon slot="start" name="locate-outline"></ion-icon>
      Use my current location
    </ion-button>

    <div *ngIf="savedAddresses.length" class="saved">
      <p class="muted">Saved places</p>
      <ion-chip *ngFor="let s of savedAddresses" (click)="pickSaved(s)">
        <ion-icon name="bookmark-outline"></ion-icon>
        <ion-label>{{ s.label }}</ion-label>
      </ion-chip>
    </div>

    <ion-button
      *ngIf="value?.lat != null"
      size="small"
      fill="clear"
      (click)="saveCurrent()"
    >
      <ion-icon slot="start" name="bookmark-outline"></ion-icon>
      Save this location
    </ion-button>

    <ion-searchbar
      placeholder="Search for an address"
      [debounce]="400"
      (ionInput)="onSearch($any($event).target.value)"
    ></ion-searchbar>

    <ion-list *ngIf="results.length">
      <ion-item *ngFor="let p of results" button (click)="select(p)">
        <ion-icon slot="start" name="location-outline"></ion-icon>
        <ion-label class="ion-text-wrap">
          <h3>{{ p.name }}</h3>
          <p>{{ p.address }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
  `,
  styles: [
    `
      .map {
        border: 1px dashed var(--ion-color-medium);
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        margin-bottom: 12px;
      }
      .map ion-icon {
        font-size: 40px;
        color: var(--ion-color-primary);
      }
      .muted {
        color: var(--ion-color-medium);
      }
      .coords {
        font-size: 0.8rem;
      }
    `,
  ],
})
export class MapPickerComponent implements OnInit {
  private geo = inject(GeoService);
  private savedAddressService = inject(SavedAddressService);
  private toast = inject(ToastController);

  @Input() value?: BookingLocation;
  @Output() valueChange = new EventEmitter<BookingLocation>();

  results: Place[] = [];
  savedAddresses: SavedAddress[] = [];

  ngOnInit(): void {
    this.savedAddressService.list().subscribe({
      next: (a) => (this.savedAddresses = a),
      error: () => (this.savedAddresses = []),
    });
  }

  pickSaved(s: SavedAddress): void {
    this.value = { lat: s.lat, lng: s.lng, address: s.address };
    this.valueChange.emit(this.value);
  }

  saveCurrent(): void {
    if (this.value?.lat == null) return;
    this.savedAddressService
      .create({ label: this.value.address?.split(',')[0] || 'Saved', ...this.value })
      .subscribe((a) => {
        this.savedAddresses = [a, ...this.savedAddresses];
        this.notify('Location saved');
      });
  }

  onSearch(q: string): void {
    if (!q || q.length < 2) {
      this.results = [];
      return;
    }
    this.geo.searchPlaces(q).subscribe((r) => (this.results = r));
  }

  select(p: Place): void {
    this.value = { lat: p.lat, lng: p.lng, address: p.address };
    this.results = [];
    this.valueChange.emit(this.value);
  }

  useCurrent(): void {
    if (!navigator.geolocation) {
      this.notify('Geolocation is not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.geo.reverseGeocode(latitude, longitude).subscribe((r) => {
          this.value = { lat: latitude, lng: longitude, address: r.formattedAddress };
          this.valueChange.emit(this.value);
        });
      },
      () => this.notify('Could not get your location')
    );
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2000, color: 'warning' });
    await t.present();
  }
}
