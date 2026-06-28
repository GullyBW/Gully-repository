'use strict';

const express = require('express');
const Joi = require('joi');
const NotificationController = require('../controllers/notification.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { deviceDomainPlatforms } = (() => ({ deviceDomainPlatforms: ['android', 'ios', 'web'] }))();

const router = express.Router();

router.use(authenticate);

const deviceSchema = Joi.object({
  token: Joi.string().min(8).required(),
  platform: Joi.string().valid(...deviceDomainPlatforms).optional(),
});

// Preferences accept arbitrary boolean category flags.
const prefSchema = Joi.object().pattern(Joi.string(), Joi.boolean()).min(1);

// Notifications
router.get('/', NotificationController.list);
router.get('/unread-count', NotificationController.unreadCount);
router.patch('/read-all', NotificationController.markAllRead);

// Devices & preferences (declared before '/:id/read' to avoid shadowing)
router.get('/devices', NotificationController.listDevices);
router.post('/devices', validateBody(deviceSchema), NotificationController.registerDevice);
router.delete('/devices/:token', NotificationController.unregisterDevice);
router.get('/preferences', NotificationController.getPreferences);
router.put('/preferences', validateBody(prefSchema), NotificationController.updatePreferences);

router.patch('/:id/read', NotificationController.markRead);

module.exports = router;
