'use strict';

const NotificationService = require('../services/notification.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const NotificationController = {
  // GET /api/notifications?unreadOnly=&limit=
  list: asyncHandler(async (req, res) => {
    const items = await NotificationService.list(req.user.id, {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.json({ success: true, data: items });
  }),

  // GET /api/notifications/unread-count
  unreadCount: asyncHandler(async (req, res) => {
    const count = await NotificationService.unreadCount(req.user.id);
    res.json({ success: true, data: { count } });
  }),

  // PATCH /api/notifications/:id/read
  markRead: asyncHandler(async (req, res) => {
    const n = await NotificationService.markRead(req.user, req.params.id);
    res.json({ success: true, data: n });
  }),

  // PATCH /api/notifications/read-all
  markAllRead: asyncHandler(async (req, res) => {
    await NotificationService.markAllRead(req.user);
    res.json({ success: true });
  }),
};

module.exports = NotificationController;
