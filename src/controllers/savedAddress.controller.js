'use strict';

const SavedAddressService = require('../services/savedAddress.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SavedAddressController = {
  list: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await SavedAddressService.list(req.user) });
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await SavedAddressService.create(req.user, req.body) });
  }),
  update: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await SavedAddressService.update(req.user, req.params.id, req.body) });
  }),
  remove: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await SavedAddressService.remove(req.user, req.params.id) });
  }),
};

module.exports = SavedAddressController;
