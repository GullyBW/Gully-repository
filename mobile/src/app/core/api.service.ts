import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ApiEnvelope } from './models';

/**
 * Thin HTTP wrapper around the Tirelo backend. Unwraps the `{ success, data }`
 * envelope so callers work directly with the payload.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;

  get<T>(path: string): Observable<T> {
    return this.http.get<ApiEnvelope<T>>(`${this.base}${path}`).pipe(map((r) => r.data));
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<ApiEnvelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<ApiEnvelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }
}
