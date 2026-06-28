'use strict';

const ProviderService = require('../services/provider.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ProviderController = {
  // GET /api/providers  (public discovery/search)
  search: asyncHandler(async (req, res) => {
    const result = await ProviderService.search(req.query);
    res.json({ success: true, ...result });
  }),

  // GET /api/providers/me  (provider's own profile)
  myProfile: asyncHandler(async (req, res) => {
    const profile = await ProviderService.getProfile(req.user.id);
    res.json({ success: true, data: profile });
  }),

  // POST /api/providers  (create/update own profile)
  upsert: asyncHandler(async (req, res) => {
    const provider = await ProviderService.upsertProfile(req.user, req.body);
    res.status(201).json({ success: true, data: provider });
  }),

  // PATCH /api/providers/availability
  setAvailability: asyncHandler(async (req, res) => {
    const provider = await ProviderService.setAvailabilityStatus(req.user, req.body.status);
    res.json({ success: true, data: provider });
  }),

  // PATCH /api/providers/:userId/verify  (admin)
  verify: asyncHandler(async (req, res) => {
    const provider = await ProviderService.setVerified(
      req.params.userId,
      req.body.verified !== false,
      req.user
    );
    res.json({ success: true, data: provider });
  }),

  // GET /api/providers/:userId  (public profile)
  getOne: asyncHandler(async (req, res) => {
    const profile = await ProviderService.getProfile(req.params.userId);
    res.json({ success: true, data: profile });
  }),
};

module.exports = ProviderController;
