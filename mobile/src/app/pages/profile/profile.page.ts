import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [IonicModule, CommonModule, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ng-container *ngIf="user() as u">
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ u.name }}</ion-card-title>
            <ion-card-subtitle>{{ u.role | titlecase }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <p><strong>Email:</strong> {{ u.email }}</p>
            <p *ngIf="u.phone"><strong>Phone:</strong> {{ u.phone }}</p>
            <ion-item lines="none" class="ion-no-padding">
              <ion-label class="ion-text-wrap">
                <strong>Your ID</strong>
                <p>{{ u.id }}</p>
              </ion-label>
              <ion-button slot="end" fill="clear" (click)="copyId(u.id)">Copy</ion-button>
            </ion-item>
            <ion-note *ngIf="u.role === 'provider'">
              Share this ID with customers so they can book you.
            </ion-note>
          </ion-card-content>
        </ion-card>
      </ng-container>

      <ion-list inset="true">
        <ion-item button routerLink="/chat">
          <ion-icon slot="start" name="chatbubbles-outline"></ion-icon>
          <ion-label>Messages</ion-label>
        </ion-item>
        <ion-item button routerLink="/favourites">
          <ion-icon slot="start" name="heart-outline"></ion-icon>
          <ion-label>Favourite providers</ion-label>
        </ion-item>
        <ion-item button routerLink="/recently-viewed">
          <ion-icon slot="start" name="time-outline"></ion-icon>
          <ion-label>Recently viewed</ion-label>
        </ion-item>
        <ion-item button routerLink="/saved-addresses">
          <ion-icon slot="start" name="location-outline"></ion-icon>
          <ion-label>Saved addresses</ion-label>
        </ion-item>
        <ion-item button routerLink="/payment-history">
          <ion-icon slot="start" name="card-outline"></ion-icon>
          <ion-label>Payment history</ion-label>
        </ion-item>
        <ion-item button routerLink="/review-history">
          <ion-icon slot="start" name="star-outline"></ion-icon>
          <ion-label>My reviews</ion-label>
        </ion-item>
        <ion-item button routerLink="/analytics/customer">
          <ion-icon slot="start" name="stats-chart-outline"></ion-icon>
          <ion-label>My activity</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset="true" *ngIf="user()?.role === 'provider'">
        <ion-item button routerLink="/provider/dashboard">
          <ion-icon slot="start" name="briefcase-outline"></ion-icon>
          <ion-label>Provider dashboard</ion-label>
        </ion-item>
        <ion-item button routerLink="/portfolio">
          <ion-icon slot="start" name="images-outline"></ion-icon>
          <ion-label>Portfolio</ion-label>
        </ion-item>
        <ion-item button routerLink="/analytics/provider">
          <ion-icon slot="start" name="cash-outline"></ion-icon>
          <ion-label>Earnings & analytics</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset="true" *ngIf="user()?.role === 'admin'">
        <ion-item button routerLink="/admin">
          <ion-icon slot="start" name="shield-checkmark-outline"></ion-icon>
          <ion-label>Admin portal</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset="true">
        <ion-item button routerLink="/settings">
          <ion-icon slot="start" name="settings-outline"></ion-icon>
          <ion-label>Settings</ion-label>
        </ion-item>
      </ion-list>

      <ion-button expand="block" color="danger" (click)="logout()">Log out</ion-button>
    </ion-content>
  `,
})
export class ProfilePage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  user = this.auth.currentUser;

  async copyId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      const t = await this.toast.create({ message: 'ID copied', duration: 1500, color: 'success' });
      await t.present();
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
