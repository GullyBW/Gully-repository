import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Booking, ProviderProfile, Review, User } from './models';

export interface AdminDashboard {
  users: { customers: number; providers: number; admins: number; total: number };
  providers: { total: number; active: number; verified: number };
  bookings: Record<string, number>;
  revenue: { currency: string; succeededMinor: number };
  payments: { succeeded: number; failed: number; pending: number };
}

export interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  targetId: string | null;
  ip: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** Admin portal API client. All endpoints require an admin JWT. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private api = inject(ApiService);

  dashboard(): Observable<AdminDashboard> {
    return this.api.get<AdminDashboard>('/admin/dashboard');
  }

  searchUsers(q?: string, role?: string): Observable<User[]> {
    return this.api.get<User[]>(`/admin/users${ApiService.qs({ q, role })}`);
  }

  verifyProvider(userId: string, verified: boolean): Observable<ProviderProfile> {
    return this.api.patch<ProviderProfile>(`/admin/providers/${userId}/verify`, { verified });
  }

  suspendUser(userId: string, suspended: boolean, reason?: string): Observable<User> {
    return this.api.patch<User>(`/admin/users/${userId}/suspend`, { suspended, reason });
  }

  bookings(status?: string): Observable<Booking[]> {
    return this.api.get<Booking[]>(`/admin/bookings${ApiService.qs({ status })}`);
  }

  cancelBooking(reference: string, reason?: string): Observable<Booking> {
    return this.api.post<Booking>(`/admin/bookings/${reference}/cancel`, { reason });
  }

  payments(status?: string): Observable<Record<string, unknown>[]> {
    return this.api.get<Record<string, unknown>[]>(`/admin/payments${ApiService.qs({ status })}`);
  }

  refund(reference: string, reason?: string): Observable<unknown> {
    return this.api.post(`/admin/payments/${reference}/refund`, { reason });
  }

  reviews(status = 'reported'): Observable<Review[]> {
    return this.api.get<Review[]>(`/admin/reviews${ApiService.qs({ status })}`);
  }

  moderateReview(id: string, action: 'remove' | 'publish'): Observable<Review> {
    return this.api.patch<Review>(`/reviews/${id}/moderate`, { action });
  }

  broadcast(input: { role?: string; title: string; body: string }): Observable<{ sent: number }> {
    return this.api.post<{ sent: number }>('/admin/broadcast', input);
  }

  auditLogs(action?: string): Observable<AuditEntry[]> {
    return this.api.get<AuditEntry[]>(`/admin/audit-logs${ApiService.qs({ action })}`);
  }
}
