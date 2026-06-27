'use strict';

const { v4: uuidv4 } = require('uuid');
const { PAYMENT_STATUS, TERMINAL_STATUSES } = require('../utils/constants');

/**
 * Plain-object transaction domain helpers. Kept free of any database concern so
 * both the Mongo and in-memory repositories — and the unit tests — operate on
 * exactly the same shape and rules.
 */

/** Human-friendly, collision-resistant reference, e.g. TRL-7F3A9CLK8Z2. */
function generateReference() {
  return `TRL-${uuidv4().split('-')[0].toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
}

/** Build a new transaction object in the PENDING state. */
function createTransaction(input) {
  const now = new Date();
  return {
    reference: input.reference || generateReference(),
    bookingId: input.bookingId,
    customerId: input.customerId,
    providerId: input.providerId,
    method: input.method,
    status: PAYMENT_STATUS.PENDING,
    amount: input.amount,
    currency: input.currency,
    payerMsisdn: input.payerMsisdn,
    providerTransactionId: undefined,
    providerMeta: {},
    description: input.description,
    metadata: input.metadata || {},
    events: [{ status: PAYMENT_STATUS.PENDING, message: 'Payment created', at: now }],
    createdAt: now,
    updatedAt: now,
  };
}

/** Append an audit event and move the transaction to a new status. */
function recordEvent(txn, status, message, raw) {
  txn.status = status;
  txn.updatedAt = new Date();
  txn.events.push({ status, message, at: new Date(), ...(raw ? { raw } : {}) });
  return txn;
}

function isTerminal(txn) {
  return TERMINAL_STATUSES.includes(txn.status);
}

/** Shape returned to API clients — omits internal/audit fields. */
function toPublicJSON(txn) {
  return {
    reference: txn.reference,
    bookingId: txn.bookingId,
    customerId: txn.customerId,
    providerId: txn.providerId,
    method: txn.method,
    status: txn.status,
    amount: txn.amount,
    currency: txn.currency,
    description: txn.description,
    providerMeta: txn.providerMeta,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
  };
}

module.exports = {
  generateReference,
  createTransaction,
  recordEvent,
  isTerminal,
  toPublicJSON,
};
