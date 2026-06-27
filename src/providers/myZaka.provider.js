'use strict';

const crypto = require('crypto');
const axios = require('axios');
const BaseProvider = require('./base.provider');
const { PAYMENT_STATUS } = require('../utils/constants');

/**
 * Mascom MyZaka adapter.
 *
 * MyZaka uses an API-key authenticated request to push a payment prompt to the
 * customer's MSISDN, then notifies us asynchronously of the outcome. Falls back
 * to SANDBOX mode when no API key is configured.
 */
class MyZakaProvider extends BaseProvider {
  get name() {
    return 'myzaka';
  }

  get isLive() {
    return Boolean(this.config.apiKey && this.config.baseUrl);
  }

  async initiatePayment(ctx) {
    if (!this.isLive) {
      return {
        providerTransactionId: `mz_sbx_${ctx.reference}`,
        status: PAYMENT_STATUS.PROCESSING,
        providerMeta: {
          sandbox: true,
          instructions:
            'Dial the MyZaka prompt and enter your PIN (sandbox auto-approves via webhook simulation).',
        },
      };
    }

    const { data } = await axios.post(
      `${this.config.baseUrl}/collections/request`,
      {
        merchantId: this.config.merchantId,
        externalRef: ctx.reference,
        amount: ctx.amount,
        currency: ctx.currency,
        msisdn: ctx.payerMsisdn,
        narration: ctx.description,
        callbackUrl: ctx.callbackUrl,
      },
      {
        headers: {
          'X-Api-Key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return {
      providerTransactionId: data.transactionId,
      status: PAYMENT_STATUS.PROCESSING,
      providerMeta: { ussdPushSent: true },
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
      COMPLETED: PAYMENT_STATUS.SUCCEEDED,
      SUCCESS: PAYMENT_STATUS.SUCCEEDED,
      FAILED: PAYMENT_STATUS.FAILED,
      REJECTED: PAYMENT_STATUS.FAILED,
      TIMEOUT: PAYMENT_STATUS.FAILED,
      CANCELLED: PAYMENT_STATUS.CANCELLED,
      PENDING: PAYMENT_STATUS.PROCESSING,
    };
    const raw = (payload.status || '').toUpperCase();
    return {
      reference: payload.externalRef || payload.reference,
      providerTransactionId: payload.transactionId,
      status: statusMap[raw] || PAYMENT_STATUS.PROCESSING,
    };
  }
}

module.exports = MyZakaProvider;
