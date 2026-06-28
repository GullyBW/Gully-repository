import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResult, User, UserRole } from './models';

const TOKEN_KEY = 'tirelo_token';
const USER_KEY = 'tirelo_user';

/**
 * Holds the authenticated session. Persists the JWT + user in localStorage so
 * the session survives reloads, and exposes the current user as a signal.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);

  readonly currentUser = signal<User | null>(this.readStoredUser());

  register(input: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    phone?: string;
  }): Observable<AuthResult> {
    return this.api
      .post<AuthResult>('/auth/register', input)
      .pipe(tap((res) => this.persist(res)));
  }

  login(email: string, password: string): Observable<AuthResult> {
    return this.api
      .post<AuthResult>('/auth/login', { email, password })
      .pipe(tap((res) => this.persist(res)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUser.set(null);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private persist(res: AuthResult): void {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this.currentUser.set(res.user);
  }

  private readStoredUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  }
}
