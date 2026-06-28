'use strict';

const express = require('express');
const Joi = require('joi');
const ReviewController = require('../controllers/review.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

const router = express.Router();

const createSchema = Joi.object({
  providerId: Joi.string().required(),
  bookingReference: Joi.string().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  title: Joi.string().max(120).allow(''),
  comment: Joi.string().max(2000).allow(''),
  photos: Joi.array().items(Joi.string().uri()),
});

const editSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5),
  title: Joi.string().max(120).allow(''),
  comment: Joi.string().max(2000).allow(''),
  photos: Joi.array().items(Joi.string().uri()),
}).min(1);

const reportSchema = Joi.object({ reason: Joi.string().max(255) });
const moderateSchema = Joi.object({ action: Joi.string().valid('remove', 'publish').required() });

// Public.
router.get('/provider/:providerId', ReviewController.listForProvider);

// Authenticated.
router.post('/', authenticate, validateBody(createSchema), ReviewController.create);
router.patch('/:id', authenticate, validateBody(editSchema), ReviewController.edit);
router.post('/:id/report', authenticate, validateBody(reportSchema), ReviewController.report);
router.patch('/:id/moderate', authenticate, authorize(USER_ROLES.ADMIN), validateBody(moderateSchema), ReviewController.moderate);

module.exports = router;
