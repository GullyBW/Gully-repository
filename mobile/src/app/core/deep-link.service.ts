import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';

/**
 * Routes deep links (custom scheme / universal links) and notification payloads
 * into in-app pages. Both Capacitor `appUrlOpen` events and FCM notification
 * `data` are normalised to the same internal route map, so a tapped booking
 * notification and a `tirelo://bookings/REF` link land on the same screen.
 */
@Injectable({ providedIn: 'root' })
export class DeepLinkService {
  private router = inject(Router);

  /** Start listening for OS-delivered links (native only). */
  init(): void {
    if (!Capacitor.isNativePlatform()) return;
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      this.openUrl(event.url);
    });
  }

  /** Navigate from a full URL, e.g. tirelo://app/bookings/REF or https://…/chat/REF. */
  openUrl(url: string): void {
    try {
      const path = this.toPath(url);
      if (path) this.router.navigateByUrl(path);
    } catch {
      /* ignore malformed links */
    }
  }

  /**
   * Map a notification `data` payload to an internal route.
   * The backend notification `data` carries identifiers like `bookingReference`,
   * `conversationId`, `providerId` and a `type`.
   */
  openFromNotification(data: Record<string, unknown> = {}): void {
    const type = String(data['type'] || '');
    const bookingRef = data['bookingReference'] as string | undefined;
    const providerId = data['providerId'] as string | undefined;

    if (type === 'new_message' && bookingRef) return this.go(`/chat/${bookingRef}`);
    if (type === 'review_reminder' && bookingRef) return this.go(`/bookings/${bookingRef}/review`);
    if (type === 'payment_confirmed' && bookingRef) return this.go(`/bookings/${bookingRef}`);
    if (type.startsWith('booking') && bookingRef) return this.go(`/bookings/${bookingRef}`);
    if (type === 'new_favourite' && providerId) return this.go(`/providers/${providerId}`);
    if (type === 'announcement') return this.go('/tabs/notifications');
    if (bookingRef) return this.go(`/bookings/${bookingRef}`);
    this.go('/tabs/notifications');
  }

  private go(path: string): void {
    this.router.navigateByUrl(path);
  }

  /** Strip scheme/host and keep the in-app path (everything from /…). */
  private toPath(url: string): string | null {
    const m = url.match(/^[a-zA-Z][\w+.-]*:\/\/[^/]*(\/.*)?$/);
    if (m) return m[1] || '/';
    return url.startsWith('/') ? url : null;
  }
}
