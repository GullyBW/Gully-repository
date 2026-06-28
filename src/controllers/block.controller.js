'use strict';

const BlockService = require('../services/block.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const BlockController = {
  list: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await BlockService.list(req.user) });
  }),
  block: asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await BlockService.block(req.user, req.params.userId) });
  }),
  unblock: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await BlockService.unblock(req.user, req.params.userId) });
  }),
};

module.exports = BlockController;
