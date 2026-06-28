'use strict';

const AdminService = require('../services/admin.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const AdminController = {
  dashboard: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await AdminService.dashboard() });
  }),

  verifyProvider: asyncHandler(async (req, res) => {
    const data = await AdminService.verifyProvider(req.user, req.params.userId, req.body.verified !== false);
    res.json({ success: true, data });
  }),

  suspendUser: asyncHandler(async (req, res) => {
    const data = await AdminService.suspendUser(req.user, req.params.userId, req.body.suspended !== false, req.body.reason);
    res.json({ success: true, data });
  }),

  searchUsers: asyncHandler(async (req, res) => {
    const data = await AdminService.searchUsers({ q: req.query.q, role: req.query.role });
    res.json({ success: true, data });
  }),

  listBookings: asyncHandler(async (req, res) => {
    const data = await AdminService.listBookings({ status: req.query.status });
    res.json({ success: true, data });
  }),

  cancelBooking: asyncHandler(async (req, res) => {
    const data = await AdminService.cancelBooking(req.user, req.params.reference, req.body && req.body.reason);
    res.json({ success: true, data });
  }),

  refund: asyncHandler(async (req, res) => {
    const data = await AdminService.issueRefund(req.user, req.params.reference, req.body && req.body.reason);
    res.json({ success: true, data });
  }),

  payments: asyncHandler(async (req, res) => {
    const data = await AdminService.payments({ status: req.query.status });
    res.json({ success: true, data });
  }),

  broadcast: asyncHandler(async (req, res) => {
    const data = await AdminService.broadcast(req.user, req.body);
    res.status(201).json({ success: true, data });
  }),

  auditLogs: asyncHandler(async (req, res) => {
    const data = await AdminService.auditLogs({ action: req.query.action, actorId: req.query.actorId });
    res.json({ success: true, data });
  }),
};

module.exports = AdminController;
