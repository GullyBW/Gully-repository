import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-app>
      <div class="offline-banner" *ngIf="!online()">You are offline — changes will retry when reconnected.</div>
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
})
export class AppComponent {
  private theme = inject(ThemeService);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

  constructor() {
    this.theme.init();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.online.set(true));
      window.addEventListener('offline', () => this.online.set(false));
    }
  }
}
