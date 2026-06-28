import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';
import { NotificationService } from './notification.service';
import { DeepLinkService } from './deep-link.service';

/**
 * Native FCM/APNs integration via Capacitor. Registers the device token with the
 * existing backend (`NotificationService.registerDevice`) without changing any
 * API contract, handles foreground/background/tap, badge counts and token
 * refresh. On the web it is a no-op (the PWA path uses in-app notifications).
 */
@Injectable({ providedIn: 'root' })
export class NativePushService {
  private notifications = inject(NotificationService);
  private deepLinks = inject(DeepLinkService);

  get available(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** Request permission, register, and wire listeners. Safe to call once at start. */
  async init(): Promise<void> {
    if (!this.available) return;

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;

    await PushNotifications.register();

    // Device token → backend (handles first registration AND refresh).
    PushNotifications.addListener('registration', (token: Token) => {
      const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
      this.notifications.registerDevice(token.value, platform).subscribe({ error: () => {} });
    });

    PushNotifications.addListener('registrationError', () => {
      /* surfaced via logs only; nothing user-facing required */
    });

    // Foreground delivery: refresh the unread badge.
    PushNotifications.addListener('pushNotificationReceived', (_n: PushNotificationSchema) => {
      this.notifications.refreshUnreadCount().subscribe({ error: () => {} });
    });

    // Tap handling → deep link into the relevant screen.
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const data = (action.notification?.data || {}) as Record<string, unknown>;
      this.deepLinks.openFromNotification(data);
    });
  }

  /** Re-request permission (used by the settings screen). */
  async enable(): Promise<boolean> {
    if (!this.available) return false;
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;
    await PushNotifications.register();
    return true;
  }
}
