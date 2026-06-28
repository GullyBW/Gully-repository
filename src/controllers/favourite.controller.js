'use strict';

const FavouriteService = require('../services/favourite.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const FavouriteController = {
  // GET /api/favourites
  list: asyncHandler(async (req, res) => {
    const data = await FavouriteService.list(req.user);
    res.json({ success: true, data });
  }),

  // POST /api/favourites/:providerId
  add: asyncHandler(async (req, res) => {
    await FavouriteService.add(req.user, req.params.providerId);
    res.status(201).json({ success: true });
  }),

  // DELETE /api/favourites/:providerId
  remove: asyncHandler(async (req, res) => {
    const result = await FavouriteService.remove(req.user, req.params.providerId);
    res.json({ success: true, data: result });
  }),
};

module.exports = FavouriteController;
