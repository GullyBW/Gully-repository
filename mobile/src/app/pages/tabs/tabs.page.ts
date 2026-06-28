import { Component, inject } from '@angular/core';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../core/notification.service';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="bookings">
          <ion-icon name="calendar-outline"></ion-icon>
          <ion-label>Bookings</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="notifications">
          <ion-icon name="notifications-outline"></ion-icon>
          <ion-label>Alerts</ion-label>
          <ion-badge *ngIf="notifications.unread() > 0" color="danger">
            {{ notifications.unread() }}
          </ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="profile">
          <ion-icon name="person-outline"></ion-icon>
          <ion-label>Profile</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage implements ViewWillEnter {
  notifications = inject(NotificationService);

  ionViewWillEnter(): void {
    this.notifications.refreshUnreadCount().subscribe();
  }
}
