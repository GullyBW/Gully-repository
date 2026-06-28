import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { ReviewService } from '../../core/review.service';
import { Review } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';
import { RatingStarsComponent } from '../../components/rating-stars.component';

@Component({
  selector: 'app-review-history',
  standalone: true,
  imports: [IonicModule, CommonModule, EmptyStateComponent, RatingStarsComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>My reviews</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && reviews.length === 0" icon="star-outline" title="No reviews yet"
        message="Reviews you leave after completed bookings show up here."></app-empty-state>

      <ion-card *ngFor="let r of reviews">
        <ion-card-content>
          <app-rating-stars [rating]="r.rating"></app-rating-stars>
          <p *ngIf="r.title"><strong>{{ r.title }}</strong></p>
          <p>{{ r.comment }}</p>
          <p class="muted">{{ r.createdAt | date: 'mediumDate' }} · {{ r.status }}</p>
        </ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [`.muted{color:var(--ion-color-medium);font-size:.8rem;}`],
})
export class ReviewHistoryPage implements ViewWillEnter {
  private service = inject(ReviewService);

  reviews: Review[] = [];
  loading = false;

  ionViewWillEnter(): void {
    this.loading = true;
    this.service.mine().subscribe({
      next: (r) => {
        this.reviews = r;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }
}
