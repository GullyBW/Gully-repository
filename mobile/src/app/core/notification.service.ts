import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AppNotification } from './models';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = inject(ApiService);

  /** Unread badge count, kept as a signal for the tab badge. */
  readonly unread = signal(0);

  list(unreadOnly = false): Observable<AppNotification[]> {
    return this.api.get<AppNotification[]>(`/notifications${ApiService.qs({ unreadOnly })}`);
  }

  refreshUnreadCount(): Observable<{ count: number }> {
    return this.api
      .get<{ count: number }>('/notifications/unread-count')
      .pipe(tap((r) => this.unread.set(r.count)));
  }

  markRead(id: string): Observable<AppNotification> {
    return this.api.patch<AppNotification>(`/notifications/${id}/read`, {});
  }

  markAllRead(): Observable<unknown> {
    return this.api.patch('/notifications/read-all', {}).pipe(tap(() => this.unread.set(0)));
  }

  // ---- Push devices & preferences (Phase 2) ----

  registerDevice(token: string, platform: 'android' | 'ios' | 'web'): Observable<unknown> {
    return this.api.post('/notifications/devices', { token, platform });
  }

  getPreferences(): Observable<Record<string, boolean>> {
    return this.api.get<Record<string, boolean>>('/notifications/preferences');
  }

  updatePreferences(prefs: Record<string, boolean>): Observable<Record<string, boolean>> {
    return this.api.put<Record<string, boolean>>('/notifications/preferences', prefs);
  }
}
