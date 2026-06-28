'use strict';

const express = require('express');
const Joi = require('joi');
const GeoController = require('../controllers/geo.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Authenticated to limit abuse of the (quota-bound) maps backend.
router.use(authenticate);

router.get('/search', GeoController.search);
router.get('/reverse', GeoController.reverse);
router.get('/distance', GeoController.distance);
router.get('/directions', GeoController.directions);
router.post('/geocode', validateBody(Joi.object({ address: Joi.string().min(2).required() })), GeoController.geocode);

module.exports = router;
