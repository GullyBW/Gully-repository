'use strict';

const express = require('express');
const Joi = require('joi');
const AdminController = require('../controllers/admin.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

const router = express.Router();

// Every admin route requires an authenticated admin.
router.use(authenticate, authorize(USER_ROLES.ADMIN));

const broadcastSchema = Joi.object({
  role: Joi.string().valid(USER_ROLES.CUSTOMER, USER_ROLES.PROVIDER, USER_ROLES.ADMIN).optional(),
  title: Joi.string().max(120).required(),
  body: Joi.string().max(1000).required(),
});

router.get('/dashboard', AdminController.dashboard);
router.get('/users', AdminController.searchUsers);
router.patch('/providers/:userId/verify', AdminController.verifyProvider);
router.patch('/users/:userId/suspend', AdminController.suspendUser);
router.get('/bookings', AdminController.listBookings);
router.post('/bookings/:reference/cancel', AdminController.cancelBooking);
router.post('/payments/:reference/refund', AdminController.refund);
router.get('/payments', AdminController.payments);
router.post('/broadcast', validateBody(broadcastSchema), AdminController.broadcast);
router.get('/reviews', AdminController.reviews);
router.get('/audit-logs', AdminController.auditLogs);

module.exports = router;
