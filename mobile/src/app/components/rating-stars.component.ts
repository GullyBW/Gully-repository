import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/** Displays a 1–5 star rating (read-only) with an optional count. */
@Component({
  selector: 'app-rating-stars',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <span class="stars">
      <ion-icon
        *ngFor="let i of [1, 2, 3, 4, 5]"
        [name]="i <= rounded ? 'star' : i - 0.5 <= rating ? 'star-half' : 'star-outline'"
        color="warning"
      ></ion-icon>
      <span class="meta" *ngIf="showValue">{{ rating | number: '1.1-1' }}</span>
      <span class="meta" *ngIf="count !== undefined">({{ count }})</span>
    </span>
  `,
  styles: [
    `
      .stars {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .meta {
        margin-left: 6px;
        font-size: 0.85rem;
        color: var(--ion-color-medium);
      }
    `,
  ],
})
export class RatingStarsComponent {
  @Input() rating = 0;
  @Input() count?: number;
  @Input() showValue = true;

  get rounded(): number {
    return Math.round(this.rating);
  }
}
