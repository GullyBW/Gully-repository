'use strict';

const express = require('express');
const Joi = require('joi');
const MessageController = require('../controllers/message.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

const sendSchema = Joi.object({
  type: Joi.string().valid('text', 'image', 'location').default('text'),
  text: Joi.string().max(2000).allow(''),
  imageUrl: Joi.string().uri(),
  location: Joi.object({ lat: Joi.number(), lng: Joi.number() }),
  forwardedFrom: Joi.string().optional(),
}).or('text', 'imageUrl', 'location');

const reactSchema = Joi.object({
  messageId: Joi.string().required(),
  emoji: Joi.string().max(8).required(),
});
const reportSchema = Joi.object({ reason: Joi.string().max(255) });

router.get('/conversations', MessageController.conversations);
router.get('/:bookingReference', MessageController.history);
router.post('/:bookingReference', validateBody(sendSchema), MessageController.send);
router.post('/:bookingReference/read', MessageController.markRead);
router.post('/:bookingReference/react', validateBody(reactSchema), MessageController.react);
router.post('/:bookingReference/report', validateBody(reportSchema), MessageController.report);

module.exports = router;
