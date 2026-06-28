'use strict';

const AuthService = require('../services/auth.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const AuthController = {
  // POST /api/auth/register
  register: asyncHandler(async (req, res) => {
    const result = await AuthService.register(req.body);
    res.status(201).json({ success: true, data: result });
  }),

  // POST /api/auth/login
  login: asyncHandler(async (req, res) => {
    const result = await AuthService.login(req.body);
    res.json({ success: true, data: result });
  }),

  // GET /api/auth/me  (protected)
  me: asyncHandler(async (req, res) => {
    const user = await AuthService.getById(req.user.id);
    res.json({ success: true, data: user });
  }),
};

module.exports = AuthController;
