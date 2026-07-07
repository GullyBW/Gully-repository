'use strict';

const crypto = require('crypto');
const { PaymentProvider } = require('./base.provider');
const { err } = require('../kernel/errors');

/**
 * PayPal provider (Phase 3, WS1) — the diaspora card/remittance rail
 * from the engineering doc (§9.1). First-class citizen of the same
 * PaymentProvider contract as the mobile-money adapters; the Ledger
 * remains the only financial source of truth.
 *
 * PayPal's own lifecycle is richer than a mobile-money push, so this
 * provider models it faithfully while presenting the SAME normalised
 * surface to PaymentService:
 *   createOrder → (authorize) → capture → webhook(success) → ledger
 *   refund / partial refund → webhook → ledger reversal
 *   chargeback (dispute) → webhook → ledger reversal + fraud review
 *
 * Multi-currency: PayPal collects in USD/EUR/GBP/ZAR; the amount is
 * converted to BWP thebe at a declared rate stored on the intent, so
 * the ledger stays single-currency and every conversion is auditable.
 */
const DEFAULT_FX = {
  // Illustrative sandbox rates: 1 unit of currency → BWP. Production
  // pulls live rates from the FX integration and stores them per intent.
  USD: 13.5,
  EUR: 14.6,
  GBP: 17.1,
  ZAR: 0.74,
  BWP: 1,
};

class PayPalProvider extends PaymentProvider {
  constructor(deps, options = {}) {
    super('paypal', deps, {
      capabilities: {
        c2b: true,
        b2c: true, // PayPal Payouts API
        refunds: true,
        partial_refunds: true,
        recurring: true, // billing agreements
        subscriptions: true,
        escrow: false, // Motse escrow is the Ledger's, not PayPal's
        multi_currency: true,
        webhooks: true,
        chargebacks: true, // disputes / reversals
        currencies: ['USD', 'EUR', 'GBP', 'ZAR', 'BWP'],
        countries: ['US', 'GB', 'ZA', 'BW', 'DE', 'AU', 'CA'], // diaspora reach
      },
      ...options,
    });
    this.fxRates = options.fxRates || DEFAULT_FX;
    this.orders = new Map(); // order id → { intent_ref, currency, amount, state }
  }

  /**
   * Order creation + checkout (WS1). Returns an approval handle the
   * client redirects to; capture happens after buyer approval.
   */
  createOrder({ amountMinor, currency = 'USD', ref, intent = 'CAPTURE' }) {
    if (!this.supportedCurrencies().includes(currency)) {
      throw err('INVALID_ARGUMENT', `PayPal is not configured for ${currency}`);
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw err('INVALID_ARGUMENT', 'amount_minor must be a positive integer');
    }
    const orderId = `PAYPAL-O-${crypto.randomBytes(6).toString('hex')}`;
    this.orders.set(orderId, {
      order_id: orderId,
      ref,
      currency,
      amount_minor: amountMinor,
      intent, // CAPTURE (immediate) | AUTHORIZE (hold then capture)
      state: 'CREATED',
    });
    // Mirror into the sandbox txn log so verify/statement/refund reuse
    // the shared machinery.
    this.sandboxTxns.set(orderId, {
      provider_ref: orderId,
      type: 'collection',
      amount_minor: amountMinor,
      currency,
      ref,
      state: 'pending',
      created_at: this.clock.nowIso(),
    });
    return {
      order_id: orderId,
      provider_ref: orderId,
      state: 'CREATED',
      approve_url: `/paypal/checkout/${orderId}`, // client redirect target
    };
  }

  /** Standard collection entry point maps to an order (CAPTURE intent). */
  initiateCollection({ amountMinor, ref, currency = 'USD' }) {
    this._requireCapability('c2b');
    return this.createOrder({ amountMinor, currency, ref, intent: 'CAPTURE' });
  }

  /** Authorize: place a hold without capturing (AUTHORIZE intent). */
  authorizeOrder(orderId) {
    const order = this._order(orderId);
    if (order.state !== 'CREATED') throw err('STATE_CONFLICT', `Order is ${order.state}`);
    order.state = 'AUTHORIZED';
    return { order_id: orderId, state: 'AUTHORIZED' };
  }

  /** Capture: move money for real. Emits the success webhook. */
  captureOrder(orderId, { nonce } = {}) {
    const order = this._order(orderId);
    if (!['CREATED', 'AUTHORIZED'].includes(order.state)) {
      throw err('STATE_CONFLICT', `Cannot capture from ${order.state}`);
    }
    order.state = 'CAPTURED';
    const txn = this.sandboxTxns.get(orderId);
    txn.state = 'completed';
    txn.completed_at = this.clock.nowIso();
    txn.receipt = `PAYPAL-CAP-${orderId.slice(-6)}`;
    this.sandboxBalanceMinor += txn.amount_minor;
    return this._signWebhook(
      {
        id: `WH-${crypto.randomBytes(6).toString('hex')}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: txn.receipt,
          custom_id: orderId,
          amount: { value: (txn.amount_minor / 100).toFixed(2), currency_code: txn.currency },
          status: 'COMPLETED',
        },
      },
      { nonce }
    );
  }

  /** PayPal dialect → normalised webhook shape. */
  parseWebhook(body) {
    const type = body.event_type;
    const resource = body.resource || {};
    const amountMinor = resource.amount
      ? Math.round(parseFloat(resource.amount.value) * 100)
      : undefined;
    if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      return {
        provider_ref: resource.custom_id,
        outcome: 'success',
        amount_minor: amountMinor,
        currency: resource.amount && resource.amount.currency_code,
        provider_receipt: resource.id,
      };
    }
    if (type === 'PAYMENT.CAPTURE.DENIED') {
      return {
        provider_ref: resource.custom_id,
        outcome: 'failure',
        amount_minor: amountMinor,
        failure_reason: 'CAPTURE_DENIED',
      };
    }
    if (type === 'PAYMENT.CAPTURE.REFUNDED') {
      return {
        provider_ref: resource.custom_id,
        outcome: 'success',
        amount_minor: amountMinor,
        provider_receipt: resource.id,
        event: 'refund',
      };
    }
    if (type === 'CUSTOMER.DISPUTE.CREATED' || type === 'PAYMENT.CAPTURE.REVERSED') {
      return {
        provider_ref: resource.custom_id,
        outcome: 'chargeback',
        amount_minor: amountMinor,
        event: 'chargeback',
        failure_reason: resource.reason || 'DISPUTE',
      };
    }
    return { provider_ref: resource.custom_id, outcome: 'unknown' };
  }

  _webhookBody(txn, outcome) {
    const eventType =
      outcome === 'success'
        ? 'PAYMENT.CAPTURE.COMPLETED'
        : outcome === 'chargeback'
          ? 'CUSTOMER.DISPUTE.CREATED'
          : 'PAYMENT.CAPTURE.DENIED';
    return {
      id: `WH-${crypto.randomBytes(6).toString('hex')}`,
      event_type: eventType,
      resource: {
        id: txn.receipt || `PAYPAL-${txn.provider_ref.slice(-6)}`,
        custom_id: txn.provider_ref,
        amount: { value: (txn.amount_minor / 100).toFixed(2), currency_code: txn.currency },
      },
    };
  }

  _order(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw err('NOT_FOUND', `No PayPal order ${orderId}`);
    return order;
  }
}

module.exports = { PayPalProvider, DEFAULT_FX };
