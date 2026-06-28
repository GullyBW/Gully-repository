import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth.guard';

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

  // Chat
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/chat/conversations.page').then((m) => m.ConversationsPage),
  },
  {
    path: 'chat/:reference',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/chat/chat.page').then((m) => m.ChatPage),
  },

  // Analytics
  {
    path: 'analytics/provider',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics-provider.page').then((m) => m.AnalyticsProviderPage),
  },
  {
    path: 'analytics/customer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics-customer.page').then((m) => m.AnalyticsCustomerPage),
  },
  {
    path: 'analytics/admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics-admin.page').then((m) => m.AnalyticsAdminPage),
  },

  // Customer / provider experience
  {
    path: 'recently-viewed',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/recently-viewed/recently-viewed.page').then((m) => m.RecentlyViewedPage),
  },
  {
    path: 'saved-addresses',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/saved-addresses/saved-addresses.page').then((m) => m.SavedAddressesPage),
  },
  {
    path: 'payment-history',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/payment-history/payment-history.page').then((m) => m.PaymentHistoryPage),
  },
  {
    path: 'review-history',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/review-history/review-history.page').then((m) => m.ReviewHistoryPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/account-settings/account-settings.page').then((m) => m.AccountSettingsPage),
  },
  {
    path: 'portfolio',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/portfolio-manager/portfolio-manager.page').then((m) => m.PortfolioManagerPage),
  },

  // Admin portal
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-dashboard.page').then((m) => m.AdminDashboardPage),
  },
  {
    path: 'admin/providers',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-providers.page').then((m) => m.AdminProvidersPage),
  },
  {
    path: 'admin/users',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-users.page').then((m) => m.AdminUsersPage),
  },
  {
    path: 'admin/bookings',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-bookings.page').then((m) => m.AdminBookingsPage),
  },
  {
    path: 'admin/payments',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-payments.page').then((m) => m.AdminPaymentsPage),
  },
  {
    path: 'admin/reviews',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-reviews.page').then((m) => m.AdminReviewsPage),
  },
  {
    path: 'admin/broadcast',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin-broadcast.page').then((m) => m.AdminBroadcastPage),
  },
  {
    path: 'admin/audit',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-audit.page').then((m) => m.AdminAuditPage),
  },

  { path: '**', redirectTo: 'login' },
];
