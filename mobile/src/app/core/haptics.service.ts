import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/** Thin haptics wrapper. No-ops on platforms without haptic support. */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  private get enabled(): boolean {
    return Capacitor.isPluginAvailable('Haptics');
  }

  impact(style: ImpactStyle = ImpactStyle.Light): void {
    if (this.enabled) Haptics.impact({ style }).catch(() => {});
  }

  success(): void {
    if (this.enabled) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  }

  error(): void {
    if (this.enabled) Haptics.notification({ type: NotificationType.Error }).catch(() => {});
  }
}
