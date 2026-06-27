'use strict';

const crypto = require('crypto');
const axios = require('axios');
const BaseProvider = require('./base.provider');
const { PAYMENT_STATUS } = require('../utils/constants');

/**
 * Card payment gateway adapter (Visa / Mastercard).
 *
 * Implements the hosted-checkout pattern used by most online card gateways
 * (DPO Pay, Flutterwave, Paystack, Stripe): the server creates a checkout
 * session, the customer is redirected to the gateway's secure page to enter
 * card details — so raw card data never touches Tirelo's servers (PCI scope
 * stays minimal) — and the gateway notifies us of the result via webhook.
 *
 * Runs in SANDBOX mode until a secret key + base URL are configured, so the
 * full flow is testable; going live is a config change, not a code change.
 */
class CardProvider extends BaseProvider {
  get name() {
    return 'card';
  }

  get isLive() {
    return Boolean(this.config.secretKey && this.config.baseUrl);
  }

  async initiatePayment(ctx) {
    if (!this.isLive) {
      return {
        providerTransactionId: `card_sbx_${ctx.reference}`,
        status: PAYMENT_STATUS.PROCESSING,
        providerMeta: {
          sandbox: true,
          checkoutUrl: `https://sandbox.gateway.test/checkout/${ctx.reference}`,
          instructions:
            'Open the checkout URL to enter card details (sandbox auto-approves via webhook simulation).',
        },
      };
    }

    const { data } = await axios.post(
      `${this.config.baseUrl}/checkout/sessions`,
      {
        reference: ctx.reference,
        amount: ctx.amount, // minor units
        currency: ctx.currency,
        description: ctx.description,
        callback_url: ctx.callbackUrl,
        return_url: this.config.returnUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return {
      providerTransactionId: data.id,
      status: PAYMENT_STATUS.PROCESSING,
      providerMeta: { checkoutUrl: data.checkout_url, sessionId: data.id },
    };
  }

  verifyWebhook({ rawBody, signature }) {
    if (!this.isLive) return true;
    const expected = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(rawBody)
      .digest('hex');
    if (!signature) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload) {
    const statusMap = {
      PAID: PAYMENT_STATUS.SUCCEEDED,
      SUCCEEDED: PAYMENT_STATUS.SUCCEEDED,
      COMPLETED: PAYMENT_STATUS.SUCCEEDED,
      FAILED: PAYMENT_STATUS.FAILED,
      DECLINED: PAYMENT_STATUS.FAILED,
      EXPIRED: PAYMENT_STATUS.FAILED,
      CANCELLED: PAYMENT_STATUS.CANCELLED,
      REFUNDED: PAYMENT_STATUS.REFUNDED,
      PENDING: PAYMENT_STATUS.PROCESSING,
    };
    const raw = (payload.status || payload.event || '').toUpperCase();
    return {
      reference: payload.reference || payload.metadata?.reference,
      providerTransactionId: payload.id || payload.session_id,
      status: statusMap[raw] || PAYMENT_STATUS.PROCESSING,
    };
  }
}

module.exports = CardProvider;
