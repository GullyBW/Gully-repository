import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Booking, BookingLocation, BookingStatus, Payment, PaymentMethod, PaymentStatus } from './models';

/** All booking operations, including kicking off payment for a booking. */
@Injectable({ providedIn: 'root' })
export class BookingService {
  private api = inject(ApiService);

  list(): Observable<Booking[]> {
    return this.api.get<Booking[]>('/bookings');
  }

  get(reference: string): Observable<Booking> {
    return this.api.get<Booking>(`/bookings/${reference}`);
  }

  create(input: {
    providerId: string;
    serviceType: string;
    description?: string;
    amount: number;
    scheduledFor?: string;
    location?: BookingLocation;
  }): Observable<Booking> {
    return this.api.post<Booking>('/bookings', input);
  }

  updateStatus(reference: string, status: BookingStatus): Observable<Booking> {
    return this.api.patch<Booking>(`/bookings/${reference}/status`, { status });
  }

  /** Initiate payment for an accepted booking. */
  pay(
    reference: string,
    method: PaymentMethod,
    payerMsisdn?: string
  ): Observable<{ booking: Booking; payment: Payment }> {
    return this.api.post<{ booking: Booking; payment: Payment }>(`/bookings/${reference}/pay`, {
      method,
      payerMsisdn,
    });
  }

  paymentStatus(
    reference: string
  ): Observable<{ reference: string; paymentReference?: string; paymentStatus?: PaymentStatus }> {
    return this.api.get(`/bookings/${reference}/payment`);
  }
}
