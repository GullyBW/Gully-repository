import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ProviderProfile, ProviderSearchParams, ProviderSearchResult } from './models';

/** Provider discovery + profile management. */
@Injectable({ providedIn: 'root' })
export class ProviderService {
  private api = inject(ApiService);

  search(params: ProviderSearchParams): Observable<ProviderSearchResult> {
    return this.api.getFull<ProviderSearchResult>(
      `/providers${ApiService.qs(params as Record<string, unknown>)}`
    );
  }

  getProfile(userId: string): Observable<ProviderProfile> {
    return this.api.get<ProviderProfile>(`/providers/${userId}`);
  }

  myProfile(): Observable<ProviderProfile> {
    return this.api.get<ProviderProfile>('/providers/me');
  }

  upsert(input: Partial<ProviderProfile>): Observable<ProviderProfile> {
    return this.api.post<ProviderProfile>('/providers', input);
  }

  setAvailabilityStatus(status: string): Observable<ProviderProfile> {
    return this.api.patch<ProviderProfile>('/providers/availability', { status });
  }
}
