'use strict';

const AuthService = require('../services/auth.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ctx = (req) => ({ ip: req.ip, device: req.get('user-agent') || 'unknown' });

const AuthController = {
  // POST /api/auth/register
  register: asyncHandler(async (req, res) => {
    const result = await AuthService.register(req.body, ctx(req));
    res.status(201).json({ success: true, data: result });
  }),

  // POST /api/auth/login
  login: asyncHandler(async (req, res) => {
    const result = await AuthService.login(req.body, ctx(req));
    res.json({ success: true, data: result });
  }),

  // POST /api/auth/refresh
  refresh: asyncHandler(async (req, res) => {
    const result = await AuthService.refresh(req.body.refreshToken, ctx(req));
    res.json({ success: true, data: result });
  }),

  // POST /api/auth/logout
  logout: asyncHandler(async (req, res) => {
    const result = await AuthService.logout(req.body.refreshToken, req.user);
    res.json({ success: true, data: result });
  }),

  // POST /api/auth/verify-email
  verifyEmail: asyncHandler(async (req, res) => {
    const result = await AuthService.verifyEmail(req.body.token);
    res.json({ success: true, data: result });
  }),

  // POST /api/auth/forgot-password
  forgotPassword: asyncHandler(async (req, res) => {
    const result = await AuthService.requestPasswordReset(req.body.email);
    res.json({ success: true, data: result });
  }),

  // POST /api/auth/reset-password
  resetPassword: asyncHandler(async (req, res) => {
    const result = await AuthService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, data: result });
  }),

  // GET /api/auth/me
  me: asyncHandler(async (req, res) => {
    const user = await AuthService.getById(req.user.id);
    res.json({ success: true, data: user });
  }),

  // GET /api/auth/sessions
  sessions: asyncHandler(async (req, res) => {
    const sessions = await AuthService.listSessions(req.user.id);
    res.json({ success: true, data: sessions });
  }),

  // DELETE /api/auth/sessions/:id
  revokeSession: asyncHandler(async (req, res) => {
    const result = await AuthService.revokeSession(req.user, req.params.id);
    res.json({ success: true, data: result });
  }),
};

module.exports = AuthController;
