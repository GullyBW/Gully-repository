'use strict';

/**
 * Contract every payment provider adapter must implement. The payment service
 * talks only to this interface, so adding a new gateway (Stripe, PayPal, a new
 * mobile-money operator) means dropping in one more subclass and registering
 * it — no changes to controllers, routes or the service layer.
 */
class BaseProvider {
  /** @param {object} config provider-specific config slice */
  constructor(config = {}) {
    this.config = config;
  }

  /** Machine name, e.g. 'orange_money'. Must match a PAYMENT_METHODS value. */
  get name() {
    throw new Error('provider.name not implemented');
  }

  /**
   * Initiate a charge with the provider.
   * @param {object} ctx
   * @param {string} ctx.reference   our transaction reference
   * @param {number} ctx.amount      amount in minor units
   * @param {string} ctx.currency    ISO 4217 code
   * @param {string} [ctx.payerMsisdn] mobile-money number
   * @param {string} [ctx.description]
   * @param {string} [ctx.callbackUrl] webhook URL the provider should call
   * @returns {Promise<{providerTransactionId?: string, status: string, providerMeta?: object}>}
   */
  async initiatePayment() {
    throw new Error('provider.initiatePayment not implemented');
  }

  /**
   * Verify a webhook signature/payload coming from the provider.
   * @returns {boolean}
   */
  verifyWebhook() {
    throw new Error('provider.verifyWebhook not implemented');
  }

  /**
   * Translate a raw webhook payload into our internal status + provider ref.
   * @returns {{reference: string, status: string, providerTransactionId?: string}}
   */
  parseWebhook() {
    throw new Error('provider.parseWebhook not implemented');
  }
}

module.exports = BaseProvider;
