'use strict';

const express = require('express');
const Joi = require('joi');
const SavedAddressController = require('../controllers/savedAddress.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

const addressSchema = Joi.object({
  label: Joi.string().max(60),
  address: Joi.string().max(255),
  lat: Joi.number().min(-90).max(90),
  lng: Joi.number().min(-180).max(180),
  isDefault: Joi.boolean(),
}).min(1);

router.get('/', SavedAddressController.list);
router.post('/', validateBody(addressSchema), SavedAddressController.create);
router.put('/:id', validateBody(addressSchema), SavedAddressController.update);
router.delete('/:id', SavedAddressController.remove);

module.exports = router;
