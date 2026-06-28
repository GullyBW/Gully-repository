import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ThemeService } from './core/theme.service';
import { DeepLinkService } from './core/deep-link.service';
import { NativePushService } from './core/native-push.service';
import { AuthService } from './core/auth.service';
import { SocketService } from './core/socket.service';

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
  private deepLinks = inject(DeepLinkService);
  private push = inject(NativePushService);
  private auth = inject(AuthService);
  private socket = inject(SocketService);

  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

  constructor() {
    this.theme.init();
    this.deepLinks.init();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online.set(true);
        // Resume the realtime connection after reconnecting.
        if (this.auth.isAuthenticated()) this.socket.connect();
      });
      window.addEventListener('offline', () => this.online.set(false));
    }

    // Register for native push + realtime once we already have a session.
    if (this.auth.isAuthenticated()) {
      this.push.init();
      this.socket.connect();
    }
  }
}
