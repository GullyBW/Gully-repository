import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { ProviderService } from '../../core/provider.service';
import { ProviderCard, ProviderSearchParams } from '../../core/models';
import { ProviderCardComponent } from '../../components/provider-card.component';

@Component({
  selector: 'app-provider-list',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ProviderCardComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>{{ title }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          [(ngModel)]="params.q"
          placeholder="Search"
          [debounce]="400"
          (ionInput)="reload()"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="filters">
        <ion-select
          label="Sort"
          interface="popover"
          [(ngModel)]="params.sort"
          (ionChange)="reload()"
        >
          <ion-select-option value="">Recommended</ion-select-option>
          <ion-select-option value="nearest">Nearest</ion-select-option>
          <ion-select-option value="highest_rated">Highest rated</ion-select-option>
          <ion-select-option value="lowest_price">Lowest price</ion-select-option>
          <ion-select-option value="most_jobs">Most jobs</ion-select-option>
          <ion-select-option value="fastest_response">Fastest response</ion-select-option>
        </ion-select>

        <ion-chip [color]="params.availableOnly ? 'primary' : 'medium'" (click)="toggle('availableOnly')">
          Available
        </ion-chip>
        <ion-chip [color]="params.verifiedOnly ? 'primary' : 'medium'" (click)="toggle('verifiedOnly')">
          Verified
        </ion-chip>
        <ion-chip [color]="nearMe ? 'primary' : 'medium'" (click)="toggleNearMe()">
          <ion-icon name="locate-outline"></ion-icon>
          Near me
        </ion-chip>
      </div>

      <div *ngIf="!loading && providers.length === 0" class="ion-text-center ion-padding">
        <p>No providers found. Try widening your filters.</p>
      </div>

      <app-provider-card
        *ngFor="let p of providers"
        [provider]="p"
        (click)="open(p)"
      ></app-provider-card>

      <ion-infinite-scroll (ionInfinite)="loadMore($event)" [disabled]="!hasMore">
        <ion-infinite-scroll-content></ion-infinite-scroll-content>
      </ion-infinite-scroll>
    </ion-content>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
      }
    `,
  ],
})
export class ProviderListPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ProviderService);

  params: ProviderSearchParams = { page: 1, limit: 10, sort: '' };
  providers: ProviderCard[] = [];
  hasMore = false;
  loading = false;
  nearMe = false;
  title = 'Providers';

  ionViewWillEnter(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.params.category = qp.get('category') || undefined;
    this.params.q = qp.get('q') || undefined;
    this.title = this.params.category
      ? this.params.category.replace(/_/g, ' ')
      : this.params.q
        ? `“${this.params.q}”`
        : 'All providers';
    this.reload();
  }

  reload(): void {
    this.params.page = 1;
    this.providers = [];
    this.fetch();
  }

  loadMore(event: CustomEvent): void {
    this.params.page = (this.params.page || 1) + 1;
    this.fetch(() => (event.target as { complete?: () => void } | null)?.complete?.());
  }

  private fetch(done?: () => void): void {
    this.loading = true;
    this.service.search(this.params).subscribe({
      next: (res) => {
        this.providers = [...this.providers, ...res.items];
        this.hasMore = res.hasMore;
        this.loading = false;
        done?.();
      },
      error: () => {
        this.loading = false;
        done?.();
      },
    });
  }

  toggle(key: 'availableOnly' | 'verifiedOnly'): void {
    this.params[key] = !this.params[key];
    this.reload();
  }

  toggleNearMe(): void {
    if (this.nearMe) {
      this.nearMe = false;
      this.params.lat = undefined;
      this.params.lng = undefined;
      this.reload();
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      this.params.lat = pos.coords.latitude;
      this.params.lng = pos.coords.longitude;
      this.params.sort = 'nearest';
      this.nearMe = true;
      this.reload();
    });
  }

  open(p: ProviderCard): void {
    this.router.navigate(['/providers', p.userId]);
  }
}
