'use strict';

const express = require('express');
const AnalyticsController = require('../controllers/analytics.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.get('/provider', authorize(USER_ROLES.PROVIDER, USER_ROLES.ADMIN), AnalyticsController.provider);
router.get('/customer', AnalyticsController.customer);
router.get('/admin', authorize(USER_ROLES.ADMIN), AnalyticsController.admin);
router.get('/export', AnalyticsController.export);

module.exports = router;
