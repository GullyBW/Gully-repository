import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Payment, PaymentMethod } from './models';

/** Read-only payment helpers (initiation happens via BookingService.pay). */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private api = inject(ApiService);

  methods(): Observable<PaymentMethod[]> {
    return this.api.get<PaymentMethod[]>('/payments/methods');
  }

  get(reference: string): Observable<Payment> {
    return this.api.get<Payment>(`/payments/${reference}`);
  }
}
