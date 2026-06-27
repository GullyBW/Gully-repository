'use strict';

const mongoose = require('mongoose');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../utils/constants');

/**
 * A single payment transaction. One transaction is created per attempt to pay
 * for a booking. The `events` array gives an auditable history of every status
 * change, which is important for reconciling mobile-money payments.
 */
const transactionEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    message: { type: String },
    at: { type: Date, default: Date.now },
    // Raw payload received from the provider (webhook/poll), for auditing.
    raw: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    // Stable public id we expose to clients and use as the provider order ref.
    reference: { type: String, required: true, unique: true, index: true },

    // Links into the rest of the Tirelo domain.
    bookingId: { type: String, index: true },
    customerId: { type: String, required: true, index: true },
    providerId: { type: String, index: true }, // the service provider being paid

    method: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },

    // Amounts are stored in minor units (thebe/cents) to avoid float errors.
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'BWP' },

    // Customer's mobile-money MSISDN for Orange Money / MyZaka.
    payerMsisdn: { type: String },

    // The id the provider assigns to the transaction on their side.
    providerTransactionId: { type: String, index: true },

    // Anything provider-specific the client needs (e.g. USSD push prompt,
    // deep link, or bank reference to quote).
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: {} },

    description: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    events: { type: [transactionEventSchema], default: [] },
  },
  { timestamps: true }
);

// Status transitions and client serialization live in src/domain/transaction.js
// so the same rules apply across the Mongo and in-memory repositories.

module.exports = mongoose.model('Transaction', transactionSchema);
