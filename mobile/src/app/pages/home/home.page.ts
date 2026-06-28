import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { CategoryService } from '../../core/category.service';
import { AuthService } from '../../core/auth.service';
import { RecentlyViewedService, RecentProvider } from '../../core/recently-viewed.service';
import { Category } from '../../core/models';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Tirelo Services</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <h2 class="greeting">Hi {{ firstName }} 👋</h2>
      <p class="muted">What service do you need today?</p>

      <ion-searchbar
        placeholder="Search providers or services"
        [(ngModel)]="query"
        (keyup.enter)="searchProviders()"
        (ionClear)="query = ''"
      ></ion-searchbar>

      <ion-button
        *ngIf="isProvider"
        expand="block"
        fill="outline"
        (click)="goDashboard()"
        class="ion-margin-bottom"
      >
        <ion-icon slot="start" name="briefcase-outline"></ion-icon>
        Go to provider dashboard
      </ion-button>

      <div *ngIf="recent.length" class="section-head">
        <h3>Recently viewed</h3>
        <ion-button size="small" fill="clear" routerLink="/recently-viewed">See all</ion-button>
      </div>
      <div *ngIf="recent.length" class="recent-scroll">
        <div class="recent-card" *ngFor="let p of recent" (click)="openProvider(p)">
          <img loading="lazy" [src]="p.profilePhoto || 'https://ui-avatars.com/api/?name=' + p.businessName" alt="" />
          <span class="name">{{ p.businessName }}</span>
          <span class="muted">{{ p.rating }}★ · {{ p.category | titlecase }}</span>
        </div>
      </div>

      <h3>Categories</h3>
      <ion-grid>
        <ion-row>
          <ion-col size="4" *ngFor="let c of categories" (click)="openCategory(c)">
            <div class="cat">
              <ion-icon [name]="c.icon"></ion-icon>
              <span>{{ c.name }}</span>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-content>
  `,
  styles: [
    `
      .greeting {
        margin-bottom: 0;
      }
      .muted {
        color: var(--ion-color-medium);
        margin-top: 2px;
      }
      .cat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 14px 6px;
        text-align: center;
        border-radius: 12px;
        background: var(--ion-color-light);
        cursor: pointer;
        height: 100%;
      }
      .cat ion-icon {
        font-size: 28px;
        color: var(--ion-color-primary);
      }
      .cat span {
        font-size: 0.75rem;
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .recent-scroll {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 6px;
      }
      .recent-card {
        flex: 0 0 auto;
        width: 110px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        cursor: pointer;
      }
      .recent-card img {
        width: 110px;
        height: 80px;
        object-fit: cover;
        border-radius: 10px;
      }
      .recent-card .name {
        font-size: 0.8rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .recent-card .muted {
        font-size: 0.7rem;
        color: var(--ion-color-medium);
      }
    `,
  ],
})
export class HomePage implements ViewWillEnter {
  private categoryService = inject(CategoryService);
  private auth = inject(AuthService);
  private recentService = inject(RecentlyViewedService);
  private router = inject(Router);

  categories: Category[] = [];
  recent: RecentProvider[] = [];
  query = '';

  get firstName(): string {
    return this.auth.currentUser()?.name?.split(' ')[0] || 'there';
  }

  get isProvider(): boolean {
    return this.auth.currentUser()?.role === 'provider';
  }

  ionViewWillEnter(): void {
    this.categoryService.list().subscribe((c) => (this.categories = c));
    this.recent = this.recentService.list().slice(0, 8);
  }

  openCategory(c: Category): void {
    this.router.navigate(['/providers'], { queryParams: { category: c.key } });
  }

  openProvider(p: RecentProvider): void {
    this.router.navigate(['/providers', p.userId]);
  }

  searchProviders(): void {
    if (!this.query.trim()) return;
    this.router.navigate(['/providers'], { queryParams: { q: this.query.trim() } });
  }

  goDashboard(): void {
    this.router.navigateByUrl('/provider/dashboard');
  }
}
