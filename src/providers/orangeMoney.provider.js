'use strict';

const crypto = require('crypto');
const axios = require('axios');
const BaseProvider = require('./base.provider');
const { PAYMENT_STATUS } = require('../utils/constants');

/**
 * Orange Money (Botswana) adapter.
 *
 * Orange Money Web Payment works as: obtain an OAuth bearer token, create a
 * "web payment" / USSD push order, then receive an asynchronous notification
 * (webhook) when the customer approves the payment on their handset.
 *
 * When credentials are not configured the adapter runs in SANDBOX mode and
 * simulates the provider so the rest of the system is fully testable. Wiring in
 * the live API later means only filling the env vars — no code changes.
 */
class OrangeMoneyProvider extends BaseProvider {
  get name() {
    return 'orange_money';
  }

  get isLive() {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.baseUrl);
  }

  /** Exchange client credentials for a short-lived bearer token. */
  async _getAccessToken() {
    const creds = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const { data } = await axios.post(
      `${this.config.baseUrl}/oauth/v3/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );
    return data.access_token;
  }

  async initiatePayment(ctx) {
    if (!this.isLive) {
      // Sandbox: pretend the USSD push was delivered to the customer.
      return {
        providerTransactionId: `om_sbx_${ctx.reference}`,
        status: PAYMENT_STATUS.PROCESSING,
        providerMeta: {
          sandbox: true,
          instructions:
            'Approve the Orange Money prompt on your phone (sandbox auto-approves via webhook simulation).',
        },
      };
    }

    const token = await this._getAccessToken();
    const { data } = await axios.post(
      `${this.config.baseUrl}/webpayment`,
      {
        merchant_key: this.config.merchantId,
        currency: ctx.currency,
        order_id: ctx.reference,
        amount: ctx.amount,
        // Orange's web flow expects major units for display.
        notif_url: ctx.callbackUrl,
        lang: 'en',
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      }
    );

    return {
      providerTransactionId: data.pay_token,
      status: PAYMENT_STATUS.PROCESSING,
      providerMeta: { paymentUrl: data.payment_url, payToken: data.pay_token },
    };
  }

  verifyWebhook({ rawBody, signature }) {
    if (!this.isLive) return true; // sandbox accepts simulated callbacks
    const expected = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(rawBody)
      .digest('hex');
    if (!signature) return false;
    // Constant-time comparison to avoid timing attacks.
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload) {
    const statusMap = {
      SUCCESS: PAYMENT_STATUS.SUCCEEDED,
      SUCCESSFUL: PAYMENT_STATUS.SUCCEEDED,
      FAILED: PAYMENT_STATUS.FAILED,
      EXPIRED: PAYMENT_STATUS.FAILED,
      CANCELLED: PAYMENT_STATUS.CANCELLED,
      PENDING: PAYMENT_STATUS.PROCESSING,
    };
    const raw = (payload.status || payload.txnstatus || '').toUpperCase();
    return {
      reference: payload.order_id || payload.reference,
      providerTransactionId: payload.txnid || payload.pay_token,
      status: statusMap[raw] || PAYMENT_STATUS.PROCESSING,
    };
  }
}

module.exports = OrangeMoneyProvider;
