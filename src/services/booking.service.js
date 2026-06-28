'use strict';

const domain = require('../domain/booking');
const PaymentService = require('./payment.service');
const { getBookingRepository } = require('../repositories');
const { BOOKING_STATUS, USER_ROLES } = require('../utils/constants');
const ApiError = require('../utils/ApiError');
const config = require('../config');

/**
 * Booking workflow for the Local Vendor Finder: a customer requests a service
 * from a provider, the provider accepts, and the customer pays through the
 * payment service. Enforces ownership and the booking state machine.
 */
class BookingService {
  static get repo() {
    return getBookingRepository();
  }

  /** Customer creates a booking request. The customer is always the actor. */
  static async create(input, actor) {
    if (!input.providerId) throw ApiError.badRequest('providerId is required');
    if (!input.serviceType) throw ApiError.badRequest('serviceType is required');

    let booking = domain.createBooking({
      ...input,
      customerId: actor.id,
      currency: input.currency || config.payment.defaultCurrency,
    });
    booking = await BookingService.repo.create(booking);
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
   * Transition a booking to a new status, enforcing both the state machine and
   * role-based rules (providers manage acceptance/progress; either party can
   * cancel).
   */
  static async updateStatus(reference, newStatus, actor) {
    const booking = await BookingService.getForActor(reference, actor);

    if (!domain.canTransition(booking.status, newStatus)) {
      throw ApiError.conflict(
        `Cannot change booking from '${booking.status}' to '${newStatus}'`
      );
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
    return BookingService.repo.save(booking);
  }

  /**
   * Customer initiates payment for an accepted booking. Creates a transaction
   * through the payment service and links it back to the booking.
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
   * Refresh a booking's cached payment status from the payment service. Call
   * after a payment webhook settles, or when the client polls.
   */
  static async syncPayment(reference, actor) {
    const booking = await BookingService.getForActor(reference, actor);
    if (!booking.paymentReference) return booking;

    const payment = await PaymentService.getByReference(booking.paymentReference);
    booking.paymentStatus = payment.status;
    booking.updatedAt = new Date();
    return BookingService.repo.save(booking);
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
