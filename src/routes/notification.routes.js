'use strict';

const express = require('express');
const NotificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', NotificationController.list);
router.get('/unread-count', NotificationController.unreadCount);
router.patch('/read-all', NotificationController.markAllRead);
router.patch('/:id/read', NotificationController.markRead);

module.exports = router;
