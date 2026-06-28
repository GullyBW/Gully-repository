'use strict';

const {
  getBookingRepository,
  getTransactionRepository,
  getFavouriteRepository,
  getProviderRepository,
} = require('../repositories');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../utils/constants');

const monthKey = (d) => {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

function tally(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k === undefined || k === null) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

/**
 * Read-only analytics computed from the existing repositories. Returns plain
 * JSON; the controller can also render any tabular section as CSV.
 */
class AnalyticsService {
  static async providerAnalytics(providerId) {
    const bookings = await getBookingRepository().listByProvider(providerId, { limit: 10000 });
    const provider = await getProviderRepository().findByUserId(providerId);

    const monthly = {};
    let earningsMinor = 0;
    const customers = new Set();
    const counts = { accepted: 0, declined: 0, total: bookings.length };

    for (const b of bookings) {
      const mk = monthKey(b.createdAt);
      monthly[mk] = monthly[mk] || { month: mk, bookings: 0, earningsMinor: 0 };
      monthly[mk].bookings += 1;
      customers.add(b.customerId);
      if (b.status === BOOKING_STATUS.ACCEPTED || b.status === BOOKING_STATUS.COMPLETED) counts.accepted += 1;
      if (b.status === BOOKING_STATUS.DECLINED) counts.declined += 1;
      if (b.paymentStatus === PAYMENT_STATUS.SUCCEEDED) {
        earningsMinor += b.amount || 0;
        monthly[mk].earningsMinor += b.amount || 0;
      }
    }

    const customerCounts = {};
    bookings.forEach((b) => {
      customerCounts[b.customerId] = (customerCounts[b.customerId] || 0) + 1;
    });
    const repeatCustomers = Object.values(customerCounts).filter((n) => n > 1).length;

    const decisions = counts.accepted + counts.declined;
    return {
      monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
      totalBookings: counts.total,
      earningsMinor,
      uniqueCustomers: customers.size,
      repeatCustomers,
      acceptanceRate: decisions ? Math.round((counts.accepted / decisions) * 100) : 100,
      rating: provider ? Math.round((provider.rating || 0) * 10) / 10 : 0,
      completedJobs: provider ? provider.completedJobs || 0 : 0,
    };
  }

  static async customerAnalytics(customerId) {
    const bookings = await getBookingRepository().listByCustomer(customerId, { limit: 10000 });
    const favourites = await getFavouriteRepository().listByCustomer(customerId);
    const spendingMinor = bookings
      .filter((b) => b.paymentStatus === PAYMENT_STATUS.SUCCEEDED)
      .reduce((acc, b) => acc + (b.amount || 0), 0);

    return {
      totalBookings: bookings.length,
      completed: bookings.filter((b) => b.status === BOOKING_STATUS.COMPLETED).length,
      favouriteProviders: favourites.length,
      spendingMinor,
      byCategory: tally(bookings, (b) => b.serviceType).map((r) => ({ category: r.key, count: r.count })),
    };
  }

  static async adminAnalytics() {
    const bookings = await getBookingRepository().all();
    const revenueMinor = await getTransactionRepository().sumByStatus(PAYMENT_STATUS.SUCCEEDED);
    const providers = await getProviderRepository().query({});

    const peakHours = tally(bookings, (b) =>
      new Date(b.scheduledFor || b.createdAt).getHours()
    ).map((r) => ({ hour: r.key, count: r.count })).sort((a, b) => a.hour - b.hour);

    const geographicDemand = tally(bookings, (b) => {
      const addr = b.location && b.location.address;
      if (!addr) return 'Unknown';
      return addr.split(',').pop().trim() || 'Unknown';
    }).map((r) => ({ area: r.key, count: r.count }));

    return {
      revenueMinor,
      totalBookings: bookings.length,
      popularCategories: tally(bookings, (b) => b.serviceType)
        .map((r) => ({ category: r.key, count: r.count }))
        .sort((a, b) => b.count - a.count),
      topProviders: providers
        .slice()
        .sort((a, b) => (b.completedJobs || 0) - (a.completedJobs || 0))
        .slice(0, 10)
        .map((p) => ({ providerId: p.userId, businessName: p.businessName, completedJobs: p.completedJobs || 0, rating: Math.round((p.rating || 0) * 10) / 10 })),
      peakHours,
      geographicDemand,
    };
  }

  /** Returns a flat row array for CSV/Excel export of a named report. */
  static async reportRows(name, actor) {
    if (name === 'provider-monthly') {
      const a = await AnalyticsService.providerAnalytics(actor.id);
      return a.monthly;
    }
    if (name === 'customer-bookings') {
      const a = await AnalyticsService.customerAnalytics(actor.id);
      return a.byCategory;
    }
    if (name === 'admin-categories') {
      const a = await AnalyticsService.adminAnalytics();
      return a.popularCategories;
    }
    if (name === 'admin-top-providers') {
      const a = await AnalyticsService.adminAnalytics();
      return a.topProviders;
    }
    return [];
  }
}

module.exports = AnalyticsService;
