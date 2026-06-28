'use strict';

const express = require('express');
const Joi = require('joi');
const AvailabilityController = require('../controllers/availability.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

const router = express.Router();

const upsertSchema = Joi.object({
  workingDays: Joi.array().items(Joi.number().integer().min(0).max(6)),
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
  slotMinutes: Joi.number().integer().min(15).max(480),
  holidays: Joi.array().items(Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)),
  emergencyAvailable: Joi.boolean(),
  vacationMode: Joi.boolean(),
  vacationUntil: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null),
}).min(1);

// Provider self-management (before '/:providerId').
router.get('/me', authenticate, AvailabilityController.mine);
router.put('/', authenticate, authorize(USER_ROLES.PROVIDER, USER_ROLES.ADMIN), validateBody(upsertSchema), AvailabilityController.upsert);

// Public.
router.get('/:providerId/slots', AvailabilityController.slots);
router.get('/:providerId', AvailabilityController.getOne);

module.exports = router;
