'use strict';

const PaymentService = require('../services/payment.service');
const { toPublicJSON } = require('../domain/transaction');
const { supportedMethods } = require('../providers');

/** Small wrapper so async handlers forward rejections to the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const PaymentController = {
  // GET /api/payments/methods
  listMethods: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: supportedMethods() });
  }),

  // POST /api/payments
  create: asyncHandler(async (req, res) => {
    const transaction = await PaymentService.createPayment(req.body);
    res.status(201).json({ success: true, data: toPublicJSON(transaction) });
  }),

  // GET /api/payments/:reference
  getOne: asyncHandler(async (req, res) => {
    const transaction = await PaymentService.getByReference(req.params.reference);
    res.json({ success: true, data: toPublicJSON(transaction) });
  }),

  // GET /api/payments?customerId=...
  list: asyncHandler(async (req, res) => {
    const { customerId, limit } = req.query;
    const transactions = await PaymentService.listForCustomer(customerId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ success: true, data: transactions.map(toPublicJSON) });
  }),

  // POST /api/payments/:reference/cancel
  cancel: asyncHandler(async (req, res) => {
    const transaction = await PaymentService.cancelPayment(
      req.params.reference,
      req.body && req.body.reason
    );
    res.json({ success: true, data: toPublicJSON(transaction) });
  }),

  // POST /api/payments/webhook/:method
  webhook: asyncHandler(async (req, res) => {
    const signature =
      req.get('x-signature') || req.get('x-orange-signature') || req.get('x-myzaka-signature');
    const transaction = await PaymentService.handleWebhook(req.params.method, {
      rawBody: req.rawBody || JSON.stringify(req.body),
      signature,
      payload: req.body,
    });
    // Providers expect a fast 200 ack.
    res.json({
      success: true,
      data: { reference: transaction.reference, status: transaction.status },
    });
  }),
};

module.exports = PaymentController;
