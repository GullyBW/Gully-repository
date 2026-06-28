'use strict';

const { v4: uuidv4 } = require('uuid');
const { BOOKING_STATUS, BOOKING_TRANSITIONS } = require('../utils/constants');

/**
 * Plain-object booking domain helpers, shared by every repository.
 * A booking is a customer's request for a service from a provider; once the
 * provider accepts, the customer pays through the payment service.
 */

function generateReference() {
  return `BKG-${uuidv4().split('-')[0].toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
}

function createBooking(input) {
  const now = new Date();
  return {
    reference: input.reference || generateReference(),
    customerId: input.customerId,
    providerId: input.providerId,
    serviceType: input.serviceType, // e.g. 'plumbing', 'electrical', 'cleaning'
    description: input.description,
    scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
    location: input.location || {}, // { address, lat, lng }
    amount: input.amount, // agreed price in minor units (thebe)
    currency: input.currency,
    status: BOOKING_STATUS.PENDING,
    // Payment linkage — filled once the customer initiates payment.
    paymentReference: undefined,
    paymentStatus: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/** Whether a status change is allowed by the booking state machine. */
function canTransition(from, to) {
  return (BOOKING_TRANSITIONS[from] || []).includes(to);
}

function toPublicJSON(b) {
  return {
    reference: b.reference,
    customerId: b.customerId,
    providerId: b.providerId,
    serviceType: b.serviceType,
    description: b.description,
    scheduledFor: b.scheduledFor,
    location: b.location,
    amount: b.amount,
    currency: b.currency,
    status: b.status,
    paymentReference: b.paymentReference,
    paymentStatus: b.paymentStatus,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

module.exports = { generateReference, createBooking, canTransition, toPublicJSON, BOOKING_STATUS };
