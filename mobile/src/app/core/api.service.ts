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

  /** Returns the full response body (for endpoints whose payload isn't under `data`). */
  getFull<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<ApiEnvelope<T>>(`${this.base}${path}`).pipe(map((r) => r.data));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<ApiEnvelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }

  /** Build a query string from a params object, skipping null/undefined/empty. */
  static qs(params: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<ApiEnvelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<ApiEnvelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }
}
