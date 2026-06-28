import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Blocks routes for unauthenticated users, redirecting them to login. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.parseUrl('/login');
};

/** Admin-only guard for the administration portal. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated() && auth.currentUser()?.role === 'admin') return true;
  return router.parseUrl(auth.isAuthenticated() ? '/tabs/home' : '/login');
};
