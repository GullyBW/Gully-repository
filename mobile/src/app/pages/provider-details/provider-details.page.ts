import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ProviderService } from '../../core/provider.service';
import { ReviewService } from '../../core/review.service';
import { FavouriteService } from '../../core/favourite.service';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { ProviderProfile, Review } from '../../core/models';
import { RatingStarsComponent } from '../../components/rating-stars.component';

@Component({
  selector: 'app-provider-details',
  standalone: true,
  imports: [IonicModule, CommonModule, RatingStarsComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>Provider</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="share()"><ion-icon slot="icon-only" name="share-outline"></ion-icon></ion-button>
          <ion-button (click)="toggleFavourite()">
            <ion-icon slot="icon-only" [name]="isFavourite ? 'heart' : 'heart-outline'" color="light"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" *ngIf="provider as p">
      <div class="hero">
        <ion-avatar>
          <img [src]="p.profilePhoto || 'https://ui-avatars.com/api/?name=' + p.businessName" alt="photo" />
        </ion-avatar>
        <div>
          <div class="name">
            <h2>{{ p.businessName }}</h2>
            <ion-icon *ngIf="p.verified" name="checkmark-circle" color="primary"></ion-icon>
          </div>
          <p class="muted">{{ p.fullName }} · {{ p.category | titlecase }}</p>
          <app-rating-stars [rating]="p.rating" [count]="p.reviewCount"></app-rating-stars>
        </div>
      </div>

      <ion-grid class="metrics">
        <ion-row>
          <ion-col class="metric"><strong>{{ p.completedJobs }}</strong><span>Jobs</span></ion-col>
          <ion-col class="metric"><strong>{{ p.responseRate }}%</strong><span>Response</span></ion-col>
          <ion-col class="metric"><strong>{{ p.yearsExperience }}y</strong><span>Experience</span></ion-col>
          <ion-col class="metric"><strong>{{ p.responseTimeMinutes }}m</strong><span>Replies in</span></ion-col>
        </ion-row>
      </ion-grid>

      <ion-button expand="block" (click)="book()" [disabled]="p.availabilityStatus === 'vacation'">
        Book now
        <span *ngIf="p.startingPrice != null">&nbsp;· from {{ p.startingPrice / 100 | currency: 'BWP' : 'symbol-narrow' }}</span>
      </ion-button>

      <ng-container *ngIf="p.bio">
        <h3>About</h3>
        <p>{{ p.bio }}</p>
      </ng-container>

      <ng-container *ngIf="p.languages?.length">
        <h3>Languages</h3>
        <ion-chip *ngFor="let l of p.languages">{{ l }}</ion-chip>
      </ng-container>

      <ng-container *ngIf="p.certifications?.length || p.licenses?.length">
        <h3>Credentials</h3>
        <ion-chip *ngFor="let c of p.certifications" color="success">{{ c }}</ion-chip>
        <ion-chip *ngFor="let l of p.licenses" color="tertiary">{{ l }}</ion-chip>
      </ng-container>

      <ng-container *ngIf="p.areasServed?.length">
        <h3>Areas served</h3>
        <ion-chip *ngFor="let a of p.areasServed">{{ a }}</ion-chip>
      </ng-container>

      <ng-container *ngIf="p.portfolio?.length">
        <h3>Portfolio</h3>
        <div class="portfolio">
          <img *ngFor="let img of p.portfolio" [src]="img" alt="portfolio" />
        </div>
      </ng-container>

      <h3>Reviews ({{ reviews.length }})</h3>
      <p *ngIf="reviews.length === 0" class="muted">No reviews yet.</p>
      <ion-card *ngFor="let r of reviews">
        <ion-card-content>
          <div class="review-head">
            <strong>{{ r.customerName }}</strong>
            <app-rating-stars [rating]="r.rating" [showValue]="false"></app-rating-stars>
          </div>
          <p *ngIf="r.title"><strong>{{ r.title }}</strong></p>
          <p>{{ r.comment }}</p>
          <ion-button size="small" fill="clear" color="medium" (click)="report(r)">Report</ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [
    `
      .hero {
        display: flex;
        gap: 14px;
        align-items: center;
      }
      .hero ion-avatar {
        width: 72px;
        height: 72px;
      }
      .name {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .name h2 {
        margin: 0;
      }
      .muted {
        color: var(--ion-color-medium);
      }
      .metrics {
        margin: 12px 0;
      }
      .metric {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .metric span {
        font-size: 0.75rem;
        color: var(--ion-color-medium);
      }
      .portfolio {
        display: flex;
        gap: 8px;
        overflow-x: auto;
      }
      .portfolio img {
        height: 90px;
        border-radius: 8px;
      }
      .review-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    `,
  ],
})
export class ProviderDetailsPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ProviderService);
  private reviewService = inject(ReviewService);
  private favourites = inject(FavouriteService);
  private recent = inject(RecentlyViewedService);
  private toast = inject(ToastController);

  provider?: ProviderProfile;
  reviews: Review[] = [];
  isFavourite = false;
  userId = '';

  ionViewWillEnter(): void {
    this.userId = this.route.snapshot.paramMap.get('userId') || '';
    this.service.getProfile(this.userId).subscribe((p) => {
      this.provider = p;
      this.recent.add(p); // track for "recently viewed"
    });
    this.reviewService.listForProvider(this.userId).subscribe((r) => (this.reviews = r));
    this.favourites
      .list()
      .subscribe((favs) => (this.isFavourite = favs.some((f) => f.userId === this.userId)));
  }

  book(): void {
    this.router.navigate(['/providers', this.userId, 'book']);
  }

  toggleFavourite(): void {
    if (this.isFavourite) {
      this.favourites.remove(this.userId).subscribe(() => (this.isFavourite = false));
    } else {
      this.favourites.add(this.userId).subscribe(() => (this.isFavourite = true));
    }
  }

  async share(): Promise<void> {
    const text = `Check out ${this.provider?.businessName} on Tirelo Services`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Tirelo Services', text });
      } catch {
        /* user cancelled */
      }
    } else {
      await this.notify('Sharing is not supported on this device');
    }
  }

  report(r: Review): void {
    this.reviewService.report(r.id, 'inappropriate').subscribe(() => this.notify('Review reported'));
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2000 });
    await t.present();
  }
}
