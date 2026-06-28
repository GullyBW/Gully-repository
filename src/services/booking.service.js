'use strict';

const domain = require('../domain/booking');
const PaymentService = require('./payment.service');
const ProviderService = require('./provider.service');
const NotificationService = require('./notification.service');
const { getBookingRepository, getUserRepository } = require('../repositories');
const {
  BOOKING_STATUS,
  USER_ROLES,
  PAYMENT_STATUS,
  NOTIFICATION_TYPES,
} = require('../utils/constants');
const ApiError = require('../utils/ApiError');
const config = require('../config');

/**
 * Booking workflow for the marketplace: a customer picks a provider through
 * discovery, schedules a date/time and map location, and books. The provider
 * accepts and progresses the job; the customer pays through the (unchanged)
 * payment service. Lifecycle changes emit notifications to both parties.
 */
class BookingService {
  static get repo() {
    return getBookingRepository();
  }

  /** Customer creates a booking request. The customer is always the actor. */
  static async create(input, actor) {
    if (!input.providerId) throw ApiError.badRequest('providerId is required');
    if (!input.serviceType) throw ApiError.badRequest('serviceType is required');

    // The target must be a real provider account.
    const providerUser = await getUserRepository().findById(input.providerId);
    if (!providerUser || providerUser.role !== USER_ROLES.PROVIDER) {
      throw ApiError.notFound('Provider not found');
    }

    let booking = domain.createBooking({
      ...input,
      customerId: actor.id,
      currency: input.currency || config.payment.defaultCurrency,
    });
    booking = await BookingService.repo.create(booking);

    await NotificationService.emit(booking.providerId, NOTIFICATION_TYPES.NEW_BOOKING, {
      bookingReference: booking.reference,
      serviceType: booking.serviceType,
    });

    return booking;
  }

  /** Fetch a booking; only the customer, the provider or an admin may view it. */
  static async getForActor(reference, actor) {
    const booking = await BookingService.repo.findByReference(reference);
    if (!booking) throw ApiError.notFound(`No booking found for reference ${reference}`);
    BookingService._assertParticipant(booking, actor);
    return booking;
  }

  /** List the actor's bookings (as customer or as provider). */
  static async listMine(actor, { limit } = {}) {
    if (actor.role === USER_ROLES.PROVIDER) {
      return BookingService.repo.listByProvider(actor.id, { limit });
    }
    return BookingService.repo.listByCustomer(actor.id, { limit });
  }

  /**
   * Transition a booking to a new status, enforcing the state machine and
   * role-based rules, then notifying the relevant party.
   */
  static async updateStatus(reference, newStatus, actor) {
    const booking = await BookingService.getForActor(reference, actor);

    if (!domain.canTransition(booking.status, newStatus)) {
      throw ApiError.conflict(`Cannot change booking from '${booking.status}' to '${newStatus}'`);
    }

    const providerActions = [
      BOOKING_STATUS.ACCEPTED,
      BOOKING_STATUS.DECLINED,
      BOOKING_STATUS.IN_PROGRESS,
      BOOKING_STATUS.COMPLETED,
    ];
    const isAdmin = actor.role === USER_ROLES.ADMIN;
    const isProvider = actor.id === booking.providerId || isAdmin;
    const isCustomer = actor.id === booking.customerId || isAdmin;

    if (providerActions.includes(newStatus) && !isProvider) {
      throw new ApiError(403, `Only the provider can set a booking to '${newStatus}'`);
    }
    if (newStatus === BOOKING_STATUS.CANCELLED && !isCustomer && !isProvider) {
      throw new ApiError(403, 'Only a participant can cancel a booking');
    }

    booking.status = newStatus;
    booking.updatedAt = new Date();
    const saved = await BookingService.repo.save(booking);

    await BookingService._notifyStatusChange(saved, newStatus, actor);
    if (newStatus === BOOKING_STATUS.COMPLETED) {
      await ProviderService.incrementCompletedJobs(saved.providerId);
    }

    return saved;
  }

  /**
   * Customer initiates payment for an accepted booking. Creates a transaction
   * through the payment service and links it back to the booking. The payment
   * module itself is unchanged — it simply receives the completed booking.
   * @returns {Promise<{booking: object, payment: object}>}
   */
  static async initiatePayment(reference, { method, payerMsisdn }, actor) {
    const booking = await BookingService.getForActor(reference, actor);

    if (actor.id !== booking.customerId && actor.role !== USER_ROLES.ADMIN) {
      throw new ApiError(403, 'Only the customer can pay for this booking');
    }
    const payable = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.COMPLETED];
    if (!payable.includes(booking.status)) {
      throw ApiError.conflict(
        `Booking must be accepted before payment (current status: ${booking.status})`
      );
    }

    const payment = await PaymentService.createPayment({
      customerId: booking.customerId,
      providerId: booking.providerId,
      bookingId: booking.reference,
      amount: booking.amount,
      currency: booking.currency,
      method,
      payerMsisdn,
      description: `Payment for ${booking.serviceType} booking ${booking.reference}`,
    });

    booking.paymentReference = payment.reference;
    booking.paymentStatus = payment.status;
    booking.updatedAt = new Date();
    const saved = await BookingService.repo.save(booking);

    return { booking: saved, payment };
  }

  /**
   * Refresh a booking's cached payment status from the payment service. When the
   * payment newly settles, notify both parties.
   */
  static async syncPayment(reference, actor) {
    const booking = await BookingService.getForActor(reference, actor);
    if (!booking.paymentReference) return booking;

    const payment = await PaymentService.getByReference(booking.paymentReference);
    const wasSucceeded = booking.paymentStatus === PAYMENT_STATUS.SUCCEEDED;
    booking.paymentStatus = payment.status;
    booking.updatedAt = new Date();
    const saved = await BookingService.repo.save(booking);

    if (!wasSucceeded && payment.status === PAYMENT_STATUS.SUCCEEDED) {
      await NotificationService.emit(saved.customerId, NOTIFICATION_TYPES.PAYMENT_CONFIRMED, {
        bookingReference: saved.reference,
      });
      await NotificationService.emit(saved.providerId, NOTIFICATION_TYPES.PAYMENT_RECEIVED, {
        bookingReference: saved.reference,
      });
    }

    return saved;
  }

  static async _notifyStatusChange(booking, newStatus, actor) {
    const map = {
      [BOOKING_STATUS.ACCEPTED]: [booking.customerId, NOTIFICATION_TYPES.BOOKING_ACCEPTED],
      [BOOKING_STATUS.IN_PROGRESS]: [booking.customerId, NOTIFICATION_TYPES.PROVIDER_ARRIVED],
      [BOOKING_STATUS.DECLINED]: [booking.customerId, NOTIFICATION_TYPES.BOOKING_CANCELLED],
    };
    if (newStatus === BOOKING_STATUS.COMPLETED) {
      await NotificationService.emit(booking.customerId, NOTIFICATION_TYPES.JOB_COMPLETED, {
        bookingReference: booking.reference,
      });
      await NotificationService.emit(booking.customerId, NOTIFICATION_TYPES.REVIEW_REMINDER, {
        bookingReference: booking.reference,
        providerId: booking.providerId,
      });
      return;
    }
    if (newStatus === BOOKING_STATUS.CANCELLED) {
      // Notify whichever party did NOT cancel.
      const recipient = actor.id === booking.customerId ? booking.providerId : booking.customerId;
      await NotificationService.emit(recipient, NOTIFICATION_TYPES.BOOKING_CANCELLED, {
        bookingReference: booking.reference,
      });
      return;
    }
    const entry = map[newStatus];
    if (entry) {
      await NotificationService.emit(entry[0], entry[1], {
        bookingReference: booking.reference,
        serviceType: booking.serviceType,
      });
    }
  }

  static _assertParticipant(booking, actor) {
    const isParticipant =
      actor.role === USER_ROLES.ADMIN ||
      actor.id === booking.customerId ||
      actor.id === booking.providerId;
    if (!isParticipant) {
      throw new ApiError(403, 'You do not have access to this booking');
    }
  }
}

module.exports = BookingService;
