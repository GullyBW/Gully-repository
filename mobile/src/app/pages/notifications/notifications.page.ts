import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { NotificationService } from '../../core/notification.service';
import { AppNotification } from '../../core/models';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Notifications</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="markAllRead()">Mark all read</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div *ngIf="items.length === 0" class="ion-padding ion-text-center">
        <p>No notifications yet.</p>
      </div>

      <ion-list>
        <ion-item *ngFor="let n of items" [color]="n.read ? undefined : 'light'" button (click)="open(n)">
          <ion-icon slot="start" [name]="icon(n.type)" [color]="n.read ? 'medium' : 'primary'"></ion-icon>
          <ion-label class="ion-text-wrap">
            <h2>{{ n.title }}</h2>
            <p>{{ n.body }}</p>
            <p class="time">{{ n.createdAt | date: 'short' }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [`.time { font-size: 0.75rem; color: var(--ion-color-medium); }`],
})
export class NotificationsPage implements ViewWillEnter {
  private service = inject(NotificationService);
  items: AppNotification[] = [];

  ionViewWillEnter(): void {
    this.load();
  }

  load(event?: CustomEvent): void {
    this.service.list().subscribe({
      next: (items) => {
        this.items = items;
        (event?.target as { complete?: () => void } | null)?.complete?.();
      },
      error: () => (event?.target as { complete?: () => void } | null)?.complete?.(),
    });
    this.service.refreshUnreadCount().subscribe();
  }

  open(n: AppNotification): void {
    if (!n.read) {
      this.service.markRead(n.id).subscribe(() => {
        n.read = true;
        this.service.refreshUnreadCount().subscribe();
      });
    }
  }

  markAllRead(): void {
    this.service.markAllRead().subscribe(() => this.items.forEach((n) => (n.read = true)));
  }

  icon(type: string): string {
    if (type.includes('payment')) return 'card-outline';
    if (type.includes('review')) return 'star-outline';
    if (type.includes('cancel')) return 'close-circle-outline';
    if (type.includes('completed')) return 'checkmark-done-outline';
    if (type.includes('booking') || type === 'new_booking') return 'calendar-outline';
    return 'notifications-outline';
  }
}
