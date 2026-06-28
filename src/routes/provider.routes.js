'use strict';

const express = require('express');
const Joi = require('joi');
const ProviderController = require('../controllers/provider.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { USER_ROLES, SERVICE_CATEGORY_KEYS, PROVIDER_AVAILABILITY } = require('../utils/constants');

const router = express.Router();

const upsertSchema = Joi.object({
  businessName: Joi.string().max(120),
  fullName: Joi.string().max(120),
  bio: Joi.string().max(2000).allow(''),
  category: Joi.string().valid(...SERVICE_CATEGORY_KEYS),
  categories: Joi.array().items(Joi.string().valid(...SERVICE_CATEGORY_KEYS)),
  yearsExperience: Joi.number().integer().min(0).max(80),
  languages: Joi.array().items(Joi.string().max(40)),
  certifications: Joi.array().items(Joi.string().max(120)),
  licenses: Joi.array().items(Joi.string().max(120)),
  profilePhoto: Joi.string().uri().allow(''),
  portfolio: Joi.array().items(Joi.string().uri()),
  areasServed: Joi.array().items(Joi.string().max(80)),
  operatingHours: Joi.string().max(200).allow(''),
  startingPrice: Joi.number().integer().min(0),
  location: Joi.object({
    lat: Joi.number().min(-90).max(90),
    lng: Joi.number().min(-180).max(180),
    address: Joi.string().max(255),
  }),
  responseTimeMinutes: Joi.number().integer().min(1).max(10080),
}).min(1);

const availabilitySchema = Joi.object({
  status: Joi.string().valid(...Object.values(PROVIDER_AVAILABILITY)).required(),
});

const verifySchema = Joi.object({ verified: Joi.boolean() });

// Public discovery.
router.get('/', ProviderController.search);

// Authenticated provider self-management (declared before '/:userId').
router.get('/me', authenticate, ProviderController.myProfile);
router.post('/', authenticate, authorize(USER_ROLES.PROVIDER, USER_ROLES.ADMIN), validateBody(upsertSchema), ProviderController.upsert);
router.patch('/availability', authenticate, authorize(USER_ROLES.PROVIDER, USER_ROLES.ADMIN), validateBody(availabilitySchema), ProviderController.setAvailability);

// Admin moderation.
router.patch('/:userId/verify', authenticate, authorize(USER_ROLES.ADMIN), validateBody(verifySchema), ProviderController.verify);

// Public profile (keep last so it doesn't shadow the routes above).
router.get('/:userId', ProviderController.getOne);

module.exports = router;
