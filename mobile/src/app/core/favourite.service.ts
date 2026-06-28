import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ProviderCard } from './models';

@Injectable({ providedIn: 'root' })
export class FavouriteService {
  private api = inject(ApiService);

  list(): Observable<ProviderCard[]> {
    return this.api.get<ProviderCard[]>('/favourites');
  }

  add(providerId: string): Observable<unknown> {
    return this.api.post(`/favourites/${providerId}`, {});
  }

  remove(providerId: string): Observable<{ removed: boolean }> {
    return this.api.delete<{ removed: boolean }>(`/favourites/${providerId}`);
  }
}
