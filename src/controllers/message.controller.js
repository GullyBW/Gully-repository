'use strict';

const MessageService = require('../services/message.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const MessageController = {
  // GET /api/messages/conversations
  conversations: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await MessageService.listConversations(req.user) });
  }),

  // GET /api/messages/:bookingReference
  history: asyncHandler(async (req, res) => {
    const data = await MessageService.listMessages(req.user, req.params.bookingReference, {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ success: true, data });
  }),

  // POST /api/messages/:bookingReference
  send: asyncHandler(async (req, res) => {
    const message = await MessageService.sendMessage(req.user, req.params.bookingReference, req.body);
    res.status(201).json({ success: true, data: message });
  }),

  // POST /api/messages/:bookingReference/read
  markRead: asyncHandler(async (req, res) => {
    const result = await MessageService.markRead(req.user, req.params.bookingReference);
    res.json({ success: true, data: result });
  }),
};

module.exports = MessageController;
