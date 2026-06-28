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

      <ion-list>
        <ion-item button routerLink="/favourites">
          <ion-icon slot="start" name="heart-outline"></ion-icon>
          <ion-label>Favourite providers</ion-label>
        </ion-item>
        <ion-item button routerLink="/provider/dashboard" *ngIf="user()?.role === 'provider'">
          <ion-icon slot="start" name="briefcase-outline"></ion-icon>
          <ion-label>Provider dashboard</ion-label>
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
