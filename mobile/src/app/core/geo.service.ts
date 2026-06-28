import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Place } from './models';

/** Maps/location backend wrapper. */
@Injectable({ providedIn: 'root' })
export class GeoService {
  private api = inject(ApiService);

  searchPlaces(q: string): Observable<Place[]> {
    return this.api.get<Place[]>(`/geo/search${ApiService.qs({ q })}`);
  }

  reverseGeocode(lat: number, lng: number): Observable<{ formattedAddress: string; lat: number; lng: number }> {
    return this.api.get(`/geo/reverse${ApiService.qs({ lat, lng })}`);
  }

  geocode(address: string): Observable<{ lat: number; lng: number; formattedAddress: string }> {
    return this.api.post('/geo/geocode', { address });
  }
}
