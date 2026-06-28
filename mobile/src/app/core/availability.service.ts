import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Availability, Slot } from './models';

@Injectable({ providedIn: 'root' })
export class AvailabilityService {
  private api = inject(ApiService);

  mine(): Observable<Availability> {
    return this.api.get<Availability>('/availability/me');
  }

  update(input: Partial<Availability>): Observable<Availability> {
    return this.api.put<Availability>('/availability', input);
  }

  slots(providerId: string, date: string): Observable<{ providerId: string; date: string; slots: Slot[] }> {
    return this.api.get(`/availability/${providerId}/slots${ApiService.qs({ date })}`);
  }
}
