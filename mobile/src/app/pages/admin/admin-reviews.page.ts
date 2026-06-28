import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';
import { Review } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';
import { RatingStarsComponent } from '../../components/rating-stars.component';

@Component({
  selector: 'app-admin-reviews',
  standalone: true,
  imports: [IonicModule, CommonModule, EmptyStateComponent, RatingStarsComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Review moderation</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state
        *ngIf="!loading && reviews.length === 0"
        icon="shield-checkmark-outline"
        title="Nothing to moderate"
        message="No reported reviews right now."
      ></app-empty-state>

      <ion-card *ngFor="let r of reviews">
        <ion-card-content>
          <div class="head">
            <strong>{{ r.customerName }}</strong>
            <app-rating-stars [rating]="r.rating" [showValue]="false"></app-rating-stars>
          </div>
          <p *ngIf="r.title"><strong>{{ r.title }}</strong></p>
          <p>{{ r.comment }}</p>
          <p class="muted">Reports: {{ r.reportCount }} · Status: {{ r.status }}</p>
          <ion-buttons>
            <ion-button color="danger" (click)="moderate(r, 'remove')">Remove</ion-button>
            <ion-button color="success" (click)="moderate(r, 'publish')">Reinstate</ion-button>
          </ion-buttons>
        </ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [`.head { display:flex; justify-content:space-between; align-items:center; } .muted{color:var(--ion-color-medium);font-size:.8rem;}`],
})
export class AdminReviewsPage implements ViewWillEnter {
  private admin = inject(AdminService);
  private toast = inject(ToastController);

  reviews: (Review & { reportCount?: number })[] = [];
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.reviews('reported').subscribe({
      next: (r) => {
        this.reviews = r;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  moderate(r: Review, action: 'remove' | 'publish'): void {
    this.admin.moderateReview(r.id, action).subscribe(() => {
      this.reviews = this.reviews.filter((x) => x.id !== r.id);
      this.notify(action === 'remove' ? 'Review removed' : 'Review reinstated');
    });
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1800, color: 'medium' });
    await t.present();
  }
}
