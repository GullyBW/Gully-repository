'use strict';

const express = require('express');
const Joi = require('joi');
const BookingController = require('../controllers/booking.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { PAYMENT_METHODS, BOOKING_STATUS } = require('../utils/constants');

const router = express.Router();

// Every booking route requires authentication.
router.use(authenticate);

const createSchema = Joi.object({
  providerId: Joi.string().required(),
  serviceType: Joi.string().max(80).required(),
  description: Joi.string().max(1000).optional(),
  scheduledFor: Joi.date().iso().optional(),
  amount: Joi.number().integer().min(1).required(), // minor units (thebe)
  currency: Joi.string().length(3).uppercase().optional(),
  location: Joi.object({
    address: Joi.string().max(255).optional(),
    lat: Joi.number().optional(),
    lng: Joi.number().optional(),
  }).optional(),
});

const statusSchema = Joi.object({
  status: Joi.string()
    .valid(...Object.values(BOOKING_STATUS))
    .required(),
});

const paySchema = Joi.object({
  method: Joi.string()
    .valid(...Object.values(PAYMENT_METHODS))
    .required(),
  payerMsisdn: Joi.string().pattern(/^[0-9+]{8,15}$/).optional(),
});

router.post('/', validateBody(createSchema), BookingController.create);
router.get('/', BookingController.list);
router.get('/:reference', BookingController.getOne);
router.patch('/:reference/status', validateBody(statusSchema), BookingController.updateStatus);
router.post('/:reference/pay', validateBody(paySchema), BookingController.pay);
router.get('/:reference/payment', BookingController.paymentStatus);

module.exports = router;
