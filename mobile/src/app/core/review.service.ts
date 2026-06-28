import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Review } from './models';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private api = inject(ApiService);

  listForProvider(providerId: string): Observable<Review[]> {
    return this.api.get<Review[]>(`/reviews/provider/${providerId}`);
  }

  mine(): Observable<Review[]> {
    return this.api.get<Review[]>('/reviews/mine');
  }

  create(input: {
    providerId: string;
    bookingReference: string;
    rating: number;
    title?: string;
    comment?: string;
  }): Observable<Review> {
    return this.api.post<Review>('/reviews', input);
  }

  report(id: string, reason: string): Observable<Review> {
    return this.api.post<Review>(`/reviews/${id}/report`, { reason });
  }
}
