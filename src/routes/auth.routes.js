'use strict';

const express = require('express');
const Joi = require('joi');
const AuthController = require('../controllers/auth.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');

const router = express.Router();

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid(USER_ROLES.CUSTOMER, USER_ROLES.PROVIDER).optional(),
  phone: Joi.string().pattern(/^[0-9+]{8,15}$/).optional(),
  profile: Joi.object().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);
router.get('/me', authenticate, AuthController.me);

module.exports = router;
