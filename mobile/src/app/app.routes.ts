import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'tabs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'home', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
      {
        path: 'bookings',
        loadComponent: () => import('./pages/bookings/bookings.page').then((m) => m.BookingsPage),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./pages/notifications/notifications.page').then((m) => m.NotificationsPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },

  // Discovery
  {
    path: 'providers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/provider-list/provider-list.page').then((m) => m.ProviderListPage),
  },
  {
    path: 'providers/:userId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/provider-details/provider-details.page').then((m) => m.ProviderDetailsPage),
  },
  {
    path: 'providers/:userId/book',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/booking-wizard/booking-wizard.page').then((m) => m.BookingWizardPage),
  },

  // Provider self-service
  {
    path: 'provider/dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/provider-dashboard/provider-dashboard.page').then(
        (m) => m.ProviderDashboardPage
      ),
  },

  // Favourites
  {
    path: 'favourites',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/favourites/favourites.page').then((m) => m.FavouritesPage),
  },

  // Bookings detail / payment / review
  {
    path: 'bookings/:reference',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/booking-detail/booking-detail.page').then((m) => m.BookingDetailPage),
  },
  {
    path: 'bookings/:reference/pay',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/payment/payment.page').then((m) => m.PaymentPage),
  },
  {
    path: 'bookings/:reference/confirmation',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/confirmation/confirmation.page').then((m) => m.ConfirmationPage),
  },
  {
    path: 'bookings/:reference/review',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/leave-review/leave-review.page').then((m) => m.LeaveReviewPage),
  },

  { path: '**', redirectTo: 'login' },
];
