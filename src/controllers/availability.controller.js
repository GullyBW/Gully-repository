'use strict';

const AvailabilityService = require('../services/availability.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const AvailabilityController = {
  // GET /api/availability/me  (provider)
  mine: asyncHandler(async (req, res) => {
    const data = await AvailabilityService.getForProvider(req.user.id);
    res.json({ success: true, data });
  }),

  // PUT /api/availability  (provider upsert)
  upsert: asyncHandler(async (req, res) => {
    const data = await AvailabilityService.upsert(req.user, req.body);
    res.json({ success: true, data });
  }),

  // GET /api/availability/:providerId  (public config)
  getOne: asyncHandler(async (req, res) => {
    const data = await AvailabilityService.getForProvider(req.params.providerId);
    res.json({ success: true, data });
  }),

  // GET /api/availability/:providerId/slots?date=YYYY-MM-DD  (public)
  slots: asyncHandler(async (req, res) => {
    const data = await AvailabilityService.slots(req.params.providerId, req.query.date);
    res.json({ success: true, data });
  }),
};

module.exports = AvailabilityController;
