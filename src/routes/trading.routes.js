'use strict';

const express = require('express');
const Joi = require('joi');
const TradingController = require('../controllers/trading.controller');
const { validateBody } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// The whole trading surface requires authentication.
router.use(authenticate);

const backtestSchema = Joi.object({
  symbol: Joi.string().max(12).uppercase().required(),
  timeframe: Joi.string().valid('1min', '5min', '15min', '30min', '1hour', '1day').optional(),
  limit: Joi.number().integer().min(80).max(5000).optional(),
  startingEquity: Joi.number().positive().optional(),
  bars: Joi.array().items(
    Joi.object({
      time: Joi.any().optional(),
      open: Joi.number().required(),
      high: Joi.number().required(),
      low: Joi.number().required(),
      close: Joi.number().required(),
      volume: Joi.number().optional(),
    })
  ).optional(),
});

const cycleSchema = Joi.object({
  symbols: Joi.array().items(Joi.string().max(12).uppercase()).optional(),
});

const startSchema = Joi.object({
  intervalMs: Joi.number().integer().min(1000).max(3600000).optional(),
  symbols: Joi.array().items(Joi.string().max(12).uppercase()).optional(),
});

// ---- Read-only market data & analysis (any authenticated user) ----
router.get('/quote/:symbol', TradingController.quote);
router.get('/bars/:symbol', TradingController.bars);
router.get('/news', TradingController.news);
router.get('/news/:symbol', TradingController.news);
router.get('/sentiment/:symbol', TradingController.sentiment);
router.get('/analyze/:symbol', TradingController.analyze);
router.get('/signal/:symbol', TradingController.signal);
router.post('/backtest', validateBody(backtestSchema), TradingController.backtest);

// ---- Portfolio / engine state (any authenticated user) ----
router.get('/portfolio', TradingController.portfolio);
router.get('/orders', TradingController.orders);
router.get('/state', TradingController.state);

// ---- Engine controls: mutate the shared paper/live engine → admin only ----
router.post('/cycle', authorize('admin'), validateBody(cycleSchema), TradingController.cycle);
router.post('/engine/start', authorize('admin'), validateBody(startSchema), TradingController.start);
router.post('/engine/stop', authorize('admin'), TradingController.stop);

module.exports = router;
