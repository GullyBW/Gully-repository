import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';

export interface ProviderAnalytics {
  monthly: { month: string; bookings: number; earningsMinor: number }[];
  totalBookings: number;
  earningsMinor: number;
  uniqueCustomers: number;
  repeatCustomers: number;
  acceptanceRate: number;
  rating: number;
  completedJobs: number;
}

export interface CustomerAnalytics {
  totalBookings: number;
  completed: number;
  favouriteProviders: number;
  spendingMinor: number;
  byCategory: { category: string; count: number }[];
}

export interface AdminAnalytics {
  revenueMinor: number;
  totalBookings: number;
  popularCategories: { category: string; count: number }[];
  topProviders: { providerId: string; businessName: string; completedJobs: number; rating: number }[];
  peakHours: { hour: number; count: number }[];
  geographicDemand: { area: string; count: number }[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private api = inject(ApiService);
  private http = inject(HttpClient);

  provider(): Observable<ProviderAnalytics> {
    return this.api.get<ProviderAnalytics>('/analytics/provider');
  }

  customer(): Observable<CustomerAnalytics> {
    return this.api.get<CustomerAnalytics>('/analytics/customer');
  }

  admin(): Observable<AdminAnalytics> {
    return this.api.get<AdminAnalytics>('/analytics/admin');
  }

  /** Fetch a CSV report as text (the auth interceptor adds the Bearer token). */
  exportCsv(report: string): Observable<string> {
    return this.http.get(`${environment.apiBaseUrl}/analytics/export?report=${report}&format=csv`, {
      responseType: 'text',
    });
  }
}
