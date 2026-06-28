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

const refreshSchema = Joi.object({ refreshToken: Joi.string().required() });
const logoutSchema = Joi.object({ refreshToken: Joi.string().optional() });
const verifyEmailSchema = Joi.object({ token: Joi.string().required() });
const forgotSchema = Joi.object({ email: Joi.string().email().required() });
const resetSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).max(128).required(),
});

router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);
router.post('/refresh', validateBody(refreshSchema), AuthController.refresh);
router.post('/logout', validateBody(logoutSchema), AuthController.logout);
router.post('/verify-email', validateBody(verifyEmailSchema), AuthController.verifyEmail);
router.post('/forgot-password', validateBody(forgotSchema), AuthController.forgotPassword);
router.post('/reset-password', validateBody(resetSchema), AuthController.resetPassword);

router.get('/me', authenticate, AuthController.me);
router.get('/sessions', authenticate, AuthController.sessions);
router.delete('/sessions/:id', authenticate, AuthController.revokeSession);

module.exports = router;
