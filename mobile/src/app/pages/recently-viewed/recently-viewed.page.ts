import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { RecentlyViewedService, RecentProvider } from '../../core/recently-viewed.service';
import { ProviderCardComponent } from '../../components/provider-card.component';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-recently-viewed',
  standalone: true,
  imports: [IonicModule, CommonModule, ProviderCardComponent, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>Recently viewed</ion-title>
        <ion-buttons slot="end"><ion-button *ngIf="items.length" (click)="clearAll()">Clear</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state
        *ngIf="items.length === 0"
        icon="time-outline"
        title="Nothing viewed yet"
        message="Providers you open will appear here."
      >
        <ion-button fill="outline" routerLink="/tabs/home">Continue browsing</ion-button>
      </app-empty-state>

      <div *ngFor="let p of items" class="row">
        <app-provider-card [provider]="p" (click)="open(p)"></app-provider-card>
        <div class="actions">
          <span class="muted">{{ p.viewedAt | date: 'short' }}</span>
          <ion-button size="small" (click)="book(p)">Quick book</ion-button>
          <ion-button size="small" fill="clear" color="danger" (click)="remove(p)">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </div>
      </div>
    </ion-content>
  `,
  styles: [
    `.actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;margin:-8px 8px 8px;}
     .muted{color:var(--ion-color-medium);font-size:.75rem;margin-right:auto;}`,
  ],
})
export class RecentlyViewedPage implements ViewWillEnter {
  private service = inject(RecentlyViewedService);
  private router = inject(Router);

  items: RecentProvider[] = [];

  ionViewWillEnter(): void {
    this.items = this.service.list();
  }

  open(p: RecentProvider): void {
    this.router.navigate(['/providers', p.userId]);
  }

  book(p: RecentProvider): void {
    this.router.navigate(['/providers', p.userId, 'book']);
  }

  remove(p: RecentProvider): void {
    this.service.remove(p.userId);
    this.items = this.service.list();
  }

  clearAll(): void {
    this.service.clear();
    this.items = [];
  }
}
