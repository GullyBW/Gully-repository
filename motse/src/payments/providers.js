'use strict';

const { PaymentProvider } = require('./base.provider');

/**
 * Botswana mobile-money providers. Each subclass owns only operator
 * dialect: webhook field names, capability matrix, credential shape.
 * Live-mode HTTP dispatch slots into `_sandboxInitiate`'s place behind
 * the same methods when `live: true` credentials are configured.
 */

/** Orange Money Botswana (OAuth + web-payment push, async webhook). */
class OrangeMoneyProvider extends PaymentProvider {
  constructor(deps, options = {}) {
    super('orange_money', deps, {
      capabilities: { c2b: true, b2c: true, refunds: true },
      ...options,
    });
  }

  parseWebhook(body) {
    // Orange dialect: { txnid, status: SUCCESSFULL|FAILED, amount, payToken }
    return {
      provider_ref: body.txnid,
      outcome: body.status === 'SUCCESSFULL' ? 'success' : 'failure',
      amount_minor: body.amount,
      provider_receipt: body.payToken || null,
      failure_reason: body.status === 'SUCCESSFULL' ? null : body.reason || 'FAILED',
    };
  }

  _webhookBody(txn, outcome) {
    return {
      txnid: txn.provider_ref,
      status: outcome === 'success' ? 'SUCCESSFULL' : 'FAILED',
      amount: txn.amount_minor,
      payToken: txn.receipt,
      reason: outcome === 'success' ? null : 'SUBSCRIBER_DECLINED',
    };
  }
}

/** Mascom MyZaka (API-key collection requests; no operator refunds). */
class MyZakaProvider extends PaymentProvider {
  constructor(deps, options = {}) {
    super('myzaka', deps, {
      capabilities: { c2b: true, b2c: true, refunds: false },
      ...options,
    });
  }

  parseWebhook(body) {
    // MyZaka dialect: { transactionId, resultCode: 0 = ok, resultDesc, transAmount, receiptNo }
    return {
      provider_ref: body.transactionId,
      outcome: body.resultCode === 0 ? 'success' : 'failure',
      amount_minor: body.transAmount,
      provider_receipt: body.receiptNo || null,
      failure_reason: body.resultCode === 0 ? null : body.resultDesc || `code ${body.resultCode}`,
    };
  }

  _webhookBody(txn, outcome) {
    return {
      transactionId: txn.provider_ref,
      resultCode: outcome === 'success' ? 0 : 1032,
      resultDesc: outcome === 'success' ? 'The service request is processed successfully.' : 'Request cancelled by user',
      transAmount: txn.amount_minor,
      receiptNo: txn.receipt,
    };
  }
}

/** BeMobile Smega (C2B + B2C, refunds supported). */
class SmegaProvider extends PaymentProvider {
  constructor(deps, options = {}) {
    super('smega', deps, {
      capabilities: { c2b: true, b2c: true, refunds: true },
      ...options,
    });
  }

  parseWebhook(body) {
    // Smega dialect: { reference, state: COMPLETED|DECLINED, value, voucher }
    return {
      provider_ref: body.reference,
      outcome: body.state === 'COMPLETED' ? 'success' : 'failure',
      amount_minor: body.value,
      provider_receipt: body.voucher || null,
      failure_reason: body.state === 'COMPLETED' ? null : body.state,
    };
  }

  _webhookBody(txn, outcome) {
    return {
      reference: txn.provider_ref,
      state: outcome === 'success' ? 'COMPLETED' : 'DECLINED',
      value: txn.amount_minor,
      voucher: txn.receipt,
    };
  }
}

module.exports = { OrangeMoneyProvider, MyZakaProvider, SmegaProvider };
