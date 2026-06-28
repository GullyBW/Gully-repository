'use strict';

/**
 * Shared payment constants. Exported so the rest of the Tirelo backend
 * (bookings, notifications, etc.) can reference the same enums.
 */

const PAYMENT_METHODS = Object.freeze({
  ORANGE_MONEY: 'orange_money',
  MYZAKA: 'myzaka',
  BANK_TRANSFER: 'bank_transfer',
  CARD: 'card', // Visa/Mastercard via a hosted card gateway (DPO/Flutterwave/Stripe)
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending', // created, awaiting provider/customer action
  PROCESSING: 'processing', // provider acknowledged, in flight
  SUCCEEDED: 'succeeded', // funds confirmed
  FAILED: 'failed', // provider declined or errored
  CANCELLED: 'cancelled', // cancelled by user/system before completion
  REFUNDED: 'refunded', // funds returned to customer
});

// Status values that are final and cannot transition further.
const TERMINAL_STATUSES = Object.freeze([
  PAYMENT_STATUS.SUCCEEDED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
]);

const USER_ROLES = Object.freeze({
  CUSTOMER: 'customer', // books services
  PROVIDER: 'provider', // a vendor: plumber, electrician, cleaner, healer...
  ADMIN: 'admin',
});

const BOOKING_STATUS = Object.freeze({
  PENDING: 'pending', // requested by customer, awaiting provider
  ACCEPTED: 'accepted', // provider agreed
  IN_PROGRESS: 'in_progress', // work underway
  COMPLETED: 'completed', // work done
  CANCELLED: 'cancelled', // cancelled by either party
  DECLINED: 'declined', // provider rejected the request
});

// Allowed booking status transitions. Used to reject illegal state changes.
const BOOKING_TRANSITIONS = Object.freeze({
  [BOOKING_STATUS.PENDING]: [
    BOOKING_STATUS.ACCEPTED,
    BOOKING_STATUS.DECLINED,
    BOOKING_STATUS.CANCELLED,
  ],
  [BOOKING_STATUS.ACCEPTED]: [BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED],
  [BOOKING_STATUS.IN_PROGRESS]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED],
  [BOOKING_STATUS.COMPLETED]: [],
  [BOOKING_STATUS.CANCELLED]: [],
  [BOOKING_STATUS.DECLINED]: [],
});

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  TERMINAL_STATUSES,
  USER_ROLES,
  BOOKING_STATUS,
  BOOKING_TRANSITIONS,
};
