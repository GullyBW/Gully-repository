import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ProviderCard } from '../core/models';
import { RatingStarsComponent } from './rating-stars.component';

/** Presentational provider card used across discovery, favourites, etc. */
@Component({
  selector: 'app-provider-card',
  standalone: true,
  imports: [IonicModule, CommonModule, RatingStarsComponent],
  template: `
    <ion-card button class="provider-card">
      <ion-card-content>
        <div class="row">
          <ion-avatar>
            <img
              [src]="provider.profilePhoto || 'https://ui-avatars.com/api/?name=' + (provider.businessName || 'P')"
              alt="provider photo"
            />
          </ion-avatar>
          <div class="info">
            <div class="title">
              <strong>{{ provider.businessName }}</strong>
              <ion-icon *ngIf="provider.verified" name="checkmark-circle" color="primary" title="Verified"></ion-icon>
            </div>
            <p class="muted">{{ provider.fullName }} · {{ provider.category | titlecase }}</p>
            <app-rating-stars [rating]="provider.rating" [count]="provider.reviewCount"></app-rating-stars>
            <p class="muted small">
              {{ provider.completedJobs }} jobs ·
              <ion-text [color]="provider.availabilityStatus === 'available' ? 'success' : 'medium'">
                {{ provider.availabilityStatus }}
              </ion-text>
              <span *ngIf="provider.distanceKm != null"> · {{ provider.distanceKm }} km</span>
            </p>
          </div>
          <div class="price" *ngIf="provider.startingPrice != null">
            <span class="muted small">from</span>
            <strong>{{ provider.startingPrice / 100 | currency: 'BWP' : 'symbol-narrow' }}</strong>
          </div>
        </div>
      </ion-card-content>
    </ion-card>
  `,
  styles: [
    `
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .info {
        flex: 1;
        min-width: 0;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .muted {
        color: var(--ion-color-medium);
        margin: 2px 0;
      }
      .small {
        font-size: 0.8rem;
      }
      .price {
        text-align: right;
        white-space: nowrap;
      }
    `,
  ],
})
export class ProviderCardComponent {
  @Input({ required: true }) provider!: ProviderCard;
}
