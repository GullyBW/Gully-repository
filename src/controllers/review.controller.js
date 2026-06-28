'use strict';

const ReviewService = require('../services/review.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ReviewController = {
  // GET /api/reviews/provider/:providerId  (public)
  listForProvider: asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const reviews = await ReviewService.listForProvider(req.params.providerId, { limit });
    res.json({ success: true, data: reviews });
  }),

  // POST /api/reviews
  create: asyncHandler(async (req, res) => {
    const review = await ReviewService.create(req.user, req.body);
    res.status(201).json({ success: true, data: review });
  }),

  // PATCH /api/reviews/:id
  edit: asyncHandler(async (req, res) => {
    const review = await ReviewService.edit(req.user, req.params.id, req.body);
    res.json({ success: true, data: review });
  }),

  // POST /api/reviews/:id/report
  report: asyncHandler(async (req, res) => {
    const review = await ReviewService.report(req.user, req.params.id, req.body && req.body.reason);
    res.json({ success: true, data: review });
  }),

  // PATCH /api/reviews/:id/moderate  (admin)
  moderate: asyncHandler(async (req, res) => {
    const review = await ReviewService.moderate(req.user, req.params.id, req.body.action);
    res.json({ success: true, data: review });
  }),
};

module.exports = ReviewController;
