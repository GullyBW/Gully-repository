'use strict';

const express = require('express');
const Joi = require('joi');
const PaymentController = require('../controllers/payment.controller');
const { validateBody } = require('../middleware/validate');
const { PAYMENT_METHODS } = require('../utils/constants');

const router = express.Router();

const createPaymentSchema = Joi.object({
  customerId: Joi.string().required(),
  bookingId: Joi.string().optional(),
  providerId: Joi.string().optional(),
  amount: Joi.number().integer().min(1).required(), // minor units (thebe)
  currency: Joi.string().length(3).uppercase().optional(),
  method: Joi.string()
    .valid(...Object.values(PAYMENT_METHODS))
    .required(),
  payerMsisdn: Joi.string()
    .pattern(/^[0-9+]{8,15}$/)
    .optional()
    .messages({ 'string.pattern.base': 'payerMsisdn must be a valid phone number' }),
  description: Joi.string().max(255).optional(),
  metadata: Joi.object().optional(),
});

const cancelSchema = Joi.object({
  reason: Joi.string().max(255).optional(),
});

router.get('/methods', PaymentController.listMethods);
router.get('/', PaymentController.list);
router.post('/', validateBody(createPaymentSchema), PaymentController.create);
router.get('/:reference', PaymentController.getOne);
router.post('/:reference/cancel', validateBody(cancelSchema), PaymentController.cancel);

// Provider-to-server callbacks. No body validation — payload shape varies per
// provider and is verified by the provider adapter's signature check instead.
router.post('/webhook/:method', PaymentController.webhook);

module.exports = router;
