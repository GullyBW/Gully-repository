'use strict';

const BaseProvider = require('./base.provider');
const { PAYMENT_STATUS } = require('../utils/constants');

/**
 * Manual bank-transfer adapter.
 *
 * There is no real-time API: we hand the customer the company's banking details
 * plus a unique reference to quote, and the payment stays PENDING until an admin
 * (or a reconciliation webhook from the bank) confirms receipt. Confirmation is
 * driven through the normal webhook endpoint with an admin-signed payload.
 */
class BankTransferProvider extends BaseProvider {
  get name() {
    return 'bank_transfer';
  }

  async initiatePayment(ctx) {
    return {
      providerTransactionId: undefined,
      status: PAYMENT_STATUS.PENDING,
      providerMeta: {
        bankName: this.config.bankName,
        accountName: this.config.accountName,
        accountNumber: this.config.accountNumber,
        branchCode: this.config.branchCode,
        // The customer MUST quote this so we can match the deposit.
        paymentReference: ctx.reference,
        instructions:
          'Transfer the exact amount to the account above and quote the payment reference. ' +
          'Your booking is confirmed once we verify the deposit.',
      },
    };
  }

  // Confirmation comes from a trusted internal/admin call, so the route-level
  // auth is the gate. Accept the payload as-is here.
  verifyWebhook() {
    return true;
  }

  parseWebhook(payload) {
    const statusMap = {
      CONFIRMED: PAYMENT_STATUS.SUCCEEDED,
      RECEIVED: PAYMENT_STATUS.SUCCEEDED,
      REJECTED: PAYMENT_STATUS.FAILED,
      CANCELLED: PAYMENT_STATUS.CANCELLED,
    };
    const raw = (payload.status || '').toUpperCase();
    return {
      reference: payload.reference,
      providerTransactionId: payload.bankReference,
      status: statusMap[raw] || PAYMENT_STATUS.PENDING,
    };
  }
}

module.exports = BankTransferProvider;
