'use strict';

const domain = require('../domain/transaction');
const { getTransactionRepository } = require('../repositories');
const { getProvider, supportedMethods } = require('../providers');
const { PAYMENT_STATUS, PAYMENT_METHODS } = require('../utils/constants');
const ApiError = require('../utils/ApiError');
const config = require('../config');

/**
 * Orchestrates payments across all providers. This is the single integration
 * point the rest of the Tirelo backend uses — bookings call `createPayment`,
 * providers call `handleWebhook`, and clients poll `getByReference`.
 *
 * Storage is reached only through the injected transaction repository, so the
 * service runs identically against MongoDB or the in-memory test store.
 */
class PaymentService {
  static get repo() {
    return getTransactionRepository();
  }

  /**
   * Create and initiate a payment.
   * @param {object} input
   * @param {string} input.customerId
   * @param {number} input.amount  amount in minor units (thebe)
   * @param {string} input.method  one of PAYMENT_METHODS
   * @returns {Promise<object>} the transaction
   */
  static async createPayment(input) {
    const {
      method,
      payerMsisdn,
      currency = config.payment.defaultCurrency,
    } = input;

    const gateway = getProvider(method);
    if (!gateway) {
      throw ApiError.badRequest(
        `Unsupported payment method '${method}'. Supported: ${supportedMethods().join(', ')}`
      );
    }

    // Mobile-money methods require the payer's phone number.
    const mobileMoney = [PAYMENT_METHODS.ORANGE_MONEY, PAYMENT_METHODS.MYZAKA];
    if (mobileMoney.includes(method) && !payerMsisdn) {
      throw ApiError.badRequest(`payerMsisdn is required for ${method}`);
    }

    let transaction = domain.createTransaction({ ...input, currency });
    transaction = await PaymentService.repo.create(transaction);

    const callbackUrl = `${config.publicBaseUrl}/api/payments/webhook/${method}`;

    try {
      const result = await gateway.initiatePayment({
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        payerMsisdn,
        description: transaction.description,
        callbackUrl,
      });

      transaction.providerTransactionId = result.providerTransactionId;
      transaction.providerMeta = result.providerMeta || {};
      domain.recordEvent(
        transaction,
        result.status || PAYMENT_STATUS.PROCESSING,
        'Payment initiated with provider'
      );
      transaction = await PaymentService.repo.save(transaction);
    } catch (err) {
      domain.recordEvent(
        transaction,
        PAYMENT_STATUS.FAILED,
        `Provider initiation failed: ${err.message}`
      );
      await PaymentService.repo.save(transaction);
      throw ApiError.badRequest('Payment provider could not be reached. Please try again.', {
        reference: transaction.reference,
      });
    }

    return transaction;
  }

  /** Fetch a transaction by its public reference. */
  static async getByReference(reference) {
    const transaction = await PaymentService.repo.findByReference(reference);
    if (!transaction) throw ApiError.notFound(`No payment found for reference ${reference}`);
    return transaction;
  }

  /** List a customer's transactions, newest first. */
  static async listForCustomer(customerId, { limit = 20 } = {}) {
    return PaymentService.repo.listByCustomer(customerId, { limit });
  }

  /**
   * Process an asynchronous provider notification (webhook). Verifies the
   * signature, maps the payload to an internal status and transitions the
   * transaction. Idempotent: replaying a terminal webhook is a no-op.
   *
   * @returns {Promise<object>}
   */
  static async handleWebhook(method, { rawBody, signature, payload }) {
    const gateway = getProvider(method);
    if (!gateway) throw ApiError.badRequest(`Unsupported payment method '${method}'`);

    if (!gateway.verifyWebhook({ rawBody, signature, payload })) {
      throw ApiError.unauthorized('Invalid webhook signature');
    }

    const parsed = gateway.parseWebhook(payload);
    if (!parsed.reference) {
      throw ApiError.badRequest('Webhook payload missing transaction reference');
    }

    const transaction = await PaymentService.repo.findByReference(parsed.reference);
    if (!transaction) {
      throw ApiError.notFound(`No payment found for reference ${parsed.reference}`);
    }

    // Idempotency: ignore updates once a transaction has reached a final state.
    if (domain.isTerminal(transaction)) {
      return transaction;
    }

    if (parsed.providerTransactionId) {
      transaction.providerTransactionId = parsed.providerTransactionId;
    }
    domain.recordEvent(transaction, parsed.status, 'Status update from provider webhook', payload);
    return PaymentService.repo.save(transaction);
  }

  /**
   * Cancel a payment that has not yet completed. Used when a user abandons
   * checkout or a booking is dropped before payment confirms.
   */
  static async cancelPayment(reference, reason = 'Cancelled by user') {
    const transaction = await PaymentService.getByReference(reference);
    if (domain.isTerminal(transaction)) {
      throw ApiError.conflict(
        `Payment ${reference} is already ${transaction.status} and cannot be cancelled`
      );
    }
    domain.recordEvent(transaction, PAYMENT_STATUS.CANCELLED, reason);
    return PaymentService.repo.save(transaction);
  }
}

module.exports = PaymentService;
