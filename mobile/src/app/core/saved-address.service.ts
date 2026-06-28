import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { BookingLocation } from './models';

export interface SavedAddress extends BookingLocation {
  id: string;
  label: string;
  isDefault: boolean;
}

/** Customer saved service locations (multiple per customer). */
@Injectable({ providedIn: 'root' })
export class SavedAddressService {
  private api = inject(ApiService);

  list(): Observable<SavedAddress[]> {
    return this.api.get<SavedAddress[]>('/addresses');
  }

  create(input: Partial<SavedAddress>): Observable<SavedAddress> {
    return this.api.post<SavedAddress>('/addresses', input);
  }

  update(id: string, input: Partial<SavedAddress>): Observable<SavedAddress> {
    return this.api.put<SavedAddress>(`/addresses/${id}`, input);
  }

  remove(id: string): Observable<{ removed: boolean }> {
    return this.api.delete<{ removed: boolean }>(`/addresses/${id}`);
  }
}
