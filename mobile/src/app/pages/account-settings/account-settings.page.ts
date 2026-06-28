import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ThemeService } from '../../core/theme.service';
import { NotificationService } from '../../core/notification.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-list inset="true">
        <ion-item>
          <ion-icon slot="start" name="moon-outline"></ion-icon>
          <ion-toggle [checked]="theme.dark()" (ionChange)="theme.toggle()">Dark mode</ion-toggle>
        </ion-item>
      </ion-list>

      <ion-list-header>Notification preferences</ion-list-header>
      <ion-list inset="true">
        <ion-item *ngFor="let key of prefKeys">
          <ion-toggle [(ngModel)]="prefs[key]" (ionChange)="savePrefs()">{{ key | titlecase }}</ion-toggle>
        </ion-item>
      </ion-list>

      <ion-list-header>Active sessions</ion-list-header>
      <ion-list inset="true">
        <ion-item *ngFor="let s of sessions">
          <ion-label class="ion-text-wrap">
            <h3>{{ s.device }}</h3>
            <p>{{ s.ip || 'unknown ip' }} · {{ s.lastUsedAt | date: 'short' }}</p>
          </ion-label>
          <ion-button slot="end" fill="clear" color="danger" *ngIf="!s.revoked" (click)="revoke(s.id)">Revoke</ion-button>
          <ion-badge slot="end" color="medium" *ngIf="s.revoked">revoked</ion-badge>
        </ion-item>
      </ion-list>

      <ion-button expand="block" color="danger" (click)="logout()">Log out</ion-button>
    </ion-content>
  `,
})
export class AccountSettingsPage implements ViewWillEnter {
  theme = inject(ThemeService);
  private notifications = inject(NotificationService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  prefs: Record<string, boolean> = {};
  prefKeys: string[] = [];
  sessions: { id: string; device: string; ip: string; lastUsedAt: string; revoked: boolean }[] = [];

  ionViewWillEnter(): void {
    this.notifications.getPreferences().subscribe((p) => {
      this.prefs = p;
      this.prefKeys = Object.keys(p);
    });
    this.auth.listSessions().subscribe((s) => (this.sessions = s));
  }

  savePrefs(): void {
    this.notifications.updatePreferences(this.prefs).subscribe();
  }

  revoke(id: string): void {
    this.auth.revokeSession(id).subscribe(() => {
      const s = this.sessions.find((x) => x.id === id);
      if (s) s.revoked = true;
      this.notify('Session revoked');
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1500 });
    await t.present();
  }
}
