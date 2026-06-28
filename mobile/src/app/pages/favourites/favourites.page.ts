import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { FavouriteService } from '../../core/favourite.service';
import { ProviderCard } from '../../core/models';
import { ProviderCardComponent } from '../../components/provider-card.component';

@Component({
  selector: 'app-favourites',
  standalone: true,
  imports: [IonicModule, CommonModule, ProviderCardComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>Favourites</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div *ngIf="providers.length === 0" class="ion-text-center ion-padding">
        <p>No saved providers yet.</p>
      </div>
      <app-provider-card
        *ngFor="let p of providers"
        [provider]="p"
        (click)="open(p)"
      ></app-provider-card>
    </ion-content>
  `,
})
export class FavouritesPage implements ViewWillEnter {
  private service = inject(FavouriteService);
  private router = inject(Router);
  providers: ProviderCard[] = [];

  ionViewWillEnter(): void {
    this.service.list().subscribe((p) => (this.providers = p));
  }

  open(p: ProviderCard): void {
    this.router.navigate(['/providers', p.userId]);
  }
}
