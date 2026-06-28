'use strict';

const userDomain = require('../domain/user');
const paymentDomain = require('../domain/transaction');
const bookingDomain = require('../domain/booking');
const ProviderService = require('./provider.service');
const BookingService = require('./booking.service');
const NotificationService = require('./notification.service');
const AuditService = require('./audit.service');
const {
  getUserRepository,
  getProviderRepository,
  getBookingRepository,
  getTransactionRepository,
} = require('../repositories');
const {
  USER_ROLES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
} = require('../utils/constants');
const ApiError = require('../utils/ApiError');

/**
 * Administration backend: aggregate stats, provider/customer/booking management,
 * payment monitoring, broadcasts and audit access. All mutating actions are
 * audited. Read-only over the payment data — the payment module is untouched.
 */
class AdminService {
  // ---- Dashboard ----
  static async dashboard() {
    const userRepo = getUserRepository();
    const [customers, providers, admins] = await Promise.all([
      userRepo.countByRole(USER_ROLES.CUSTOMER),
      userRepo.countByRole(USER_ROLES.PROVIDER),
      userRepo.countByRole(USER_ROLES.ADMIN),
    ]);

    const allProviders = await getProviderRepository().query({});
    const activeProviders = allProviders.filter((p) => p.availabilityStatus === 'available').length;

    const bookingRepo = getBookingRepository();
    const bookingCounts = {};
    for (const s of Object.values(BOOKING_STATUS)) {
      // eslint-disable-next-line no-await-in-loop
      bookingCounts[s] = await bookingRepo.countByStatus(s);
    }
    bookingCounts.total = await bookingRepo.countByStatus();

    const txRepo = getTransactionRepository();
    const revenue = await txRepo.sumByStatus(PAYMENT_STATUS.SUCCEEDED);
    const succeeded = (await txRepo.query({ status: PAYMENT_STATUS.SUCCEEDED, limit: 10000 })).length;
    const failed = (await txRepo.query({ status: PAYMENT_STATUS.FAILED, limit: 10000 })).length;
    const pending = (await txRepo.query({ status: PAYMENT_STATUS.PENDING, limit: 10000 })).length;

    return {
      users: { customers, providers, admins, total: customers + providers + admins },
      providers: { total: allProviders.length, active: activeProviders, verified: allProviders.filter((p) => p.verified).length },
      bookings: bookingCounts,
      revenue: { currency: 'BWP', succeededMinor: revenue },
      payments: { succeeded, failed, pending },
    };
  }

  // ---- Provider management ----
  static async verifyProvider(actor, userId, verified) {
    const provider = await ProviderService.setVerified(userId, verified, actor);
    await AuditService.log(AUDIT_ACTIONS.PROVIDER_VERIFIED, {
      actorId: actor.id,
      targetId: userId,
      meta: { verified },
    });
    return provider;
  }

  static async suspendUser(actor, userId, suspended, reason) {
    const userRepo = getUserRepository();
    const user = await userRepo.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    user.suspended = !!suspended;
    user.suspendedReason = suspended ? reason || 'Policy violation' : null;
    user.updatedAt = new Date();
    await userRepo.save(user);
    await AuditService.log(AUDIT_ACTIONS.PROVIDER_SUSPENDED, {
      actorId: actor.id,
      targetId: userId,
      meta: { suspended, reason },
    });
    return userDomain.toPublicJSON(user);
  }

  // ---- Customer / user management ----
  static async searchUsers({ q, role }) {
    const users = await getUserRepository().search({ q, role });
    return users.map(userDomain.toPublicJSON);
  }

  // ---- Booking management ----
  static async listBookings({ status } = {}) {
    const bookings = await getBookingRepository().query({ status, limit: 500 });
    return bookings.map(bookingDomain.toPublicJSON);
  }

  static async cancelBooking(actor, reference, reason) {
    const booking = await BookingService.updateStatus(reference, BOOKING_STATUS.CANCELLED, actor);
    await AuditService.log(AUDIT_ACTIONS.BOOKING_CANCELLED_ADMIN, {
      actorId: actor.id,
      targetId: reference,
      meta: { reason },
    });
    return bookingDomain.toPublicJSON(booking);
  }

  /**
   * Record a refund request. Execution against the gateway lives in the payment
   * module (intentionally untouched); this audits the decision and returns an
   * acknowledgement an operator can act on.
   */
  static async issueRefund(actor, paymentReference, reason) {
    await AuditService.log(AUDIT_ACTIONS.REFUND_ISSUED, {
      actorId: actor.id,
      targetId: paymentReference,
      meta: { reason },
    });
    return { paymentReference, status: 'refund_requested', reason: reason || null };
  }

  // ---- Payment monitoring (read-only) ----
  static async payments({ status } = {}) {
    const txns = await getTransactionRepository().query({ status, limit: 500 });
    return txns.map(paymentDomain.toPublicJSON);
  }

  // ---- Broadcasts ----
  static async broadcast(actor, { role, title, body }) {
    const users = await getUserRepository().search({ role, limit: 10000 });
    await Promise.all(
      users.map((u) =>
        NotificationService.emit(u.id, NOTIFICATION_TYPES.ANNOUNCEMENT, { title, body })
      )
    );
    await AuditService.log(AUDIT_ACTIONS.BROADCAST_SENT, {
      actorId: actor.id,
      meta: { role: role || 'all', recipients: users.length, title },
    });
    return { sent: users.length };
  }

  // ---- Review moderation queue ----
  static async reviews({ status } = {}) {
    // Lazy require to avoid a circular dependency (review.service → provider → admin chains).
    // eslint-disable-next-line global-require
    const ReviewService = require('./review.service');
    return ReviewService.listForModeration({ status });
  }

  // ---- Audit logs ----
  static async auditLogs(filter) {
    return AuditService.list(filter);
  }
}

module.exports = AdminService;
