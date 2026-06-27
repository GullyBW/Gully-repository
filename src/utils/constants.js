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

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  TERMINAL_STATUSES,
};
