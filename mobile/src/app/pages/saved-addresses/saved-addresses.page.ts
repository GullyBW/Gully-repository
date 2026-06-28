import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { SavedAddress, SavedAddressService } from '../../core/saved-address.service';
import { BookingLocation } from '../../core/models';
import { MapPickerComponent } from '../../components/map-picker.component';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-saved-addresses',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, MapPickerComponent, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>Saved addresses</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!adding && addresses.length === 0" icon="location-outline" title="No saved places"
        message="Save your home or office to book faster."></app-empty-state>

      <ion-list *ngIf="!adding">
        <ion-item-sliding *ngFor="let a of addresses">
          <ion-item>
            <ion-icon slot="start" [name]="a.isDefault ? 'star' : 'location-outline'" [color]="a.isDefault ? 'warning' : 'medium'"></ion-icon>
            <ion-label>
              <h2>{{ a.label }}</h2>
              <p>{{ a.address }}</p>
            </ion-label>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option color="danger" (click)="remove(a)">Delete</ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <ion-button *ngIf="!adding" expand="block" (click)="adding = true">
        <ion-icon slot="start" name="add"></ion-icon> Add address
      </ion-button>

      <div *ngIf="adding">
        <ion-item>
          <ion-input label="Label (e.g. Home)" labelPlacement="floating" [(ngModel)]="label"></ion-input>
        </ion-item>
        <app-map-picker [(value)]="location"></app-map-picker>
        <ion-item lines="none">
          <ion-checkbox [(ngModel)]="isDefault">Set as default</ion-checkbox>
        </ion-item>
        <ion-button expand="block" [disabled]="location.lat == null" (click)="save()">Save</ion-button>
        <ion-button expand="block" fill="clear" (click)="adding = false">Cancel</ion-button>
      </div>
    </ion-content>
  `,
})
export class SavedAddressesPage implements ViewWillEnter {
  private service = inject(SavedAddressService);
  private toast = inject(ToastController);

  addresses: SavedAddress[] = [];
  adding = false;
  label = 'Home';
  isDefault = false;
  location: BookingLocation = {};

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.service.list().subscribe((a) => (this.addresses = a));
  }

  save(): void {
    this.service
      .create({ label: this.label, isDefault: this.isDefault, ...this.location })
      .subscribe(() => {
        this.adding = false;
        this.location = {};
        this.label = 'Home';
        this.isDefault = false;
        this.load();
        this.notify('Address saved');
      });
  }

  remove(a: SavedAddress): void {
    this.service.remove(a.id).subscribe(() => {
      this.addresses = this.addresses.filter((x) => x.id !== a.id);
    });
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1500, color: 'success' });
    await t.present();
  }
}
