'use strict';

const TradingService = require('../services/trading.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * REST surface for the day-trading subsystem. Read endpoints (quote, bars,
 * news, analysis, signal, portfolio) are available to any authenticated user;
 * the mutating engine controls (cycle/start/stop) are guarded to admins in the
 * route layer.
 */
const TradingController = {
  // GET /api/trading/quote/:symbol
  quote: asyncHandler(async (req, res) => {
    const data = await TradingService.quote(req.params.symbol);
    res.json({ success: true, data });
  }),

  // GET /api/trading/bars/:symbol
  bars: asyncHandler(async (req, res) => {
    const { timeframe, limit } = req.query;
    const data = await TradingService.bars(req.params.symbol, {
      timeframe,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ success: true, data });
  }),

  // GET /api/trading/news  and  GET /api/trading/news/:symbol
  news: asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const data = await TradingService.news(req.params.symbol, { limit });
    res.json({ success: true, data });
  }),

  // GET /api/trading/sentiment/:symbol
  sentiment: asyncHandler(async (req, res) => {
    const data = await TradingService.sentiment(req.params.symbol);
    res.json({ success: true, data });
  }),

  // GET /api/trading/analyze/:symbol
  analyze: asyncHandler(async (req, res) => {
    const { timeframe } = req.query;
    const data = await TradingService.analyze(req.params.symbol, { timeframe });
    res.json({ success: true, data });
  }),

  // GET /api/trading/signal/:symbol  (signal + risk-managed decision, no execution)
  signal: asyncHandler(async (req, res) => {
    const { timeframe } = req.query;
    const data = await TradingService.evaluate(req.params.symbol, { timeframe });
    res.json({ success: true, data });
  }),

  // POST /api/trading/backtest
  backtest: asyncHandler(async (req, res) => {
    const data = await TradingService.backtest(req.body || {});
    res.json({ success: true, data });
  }),

  // GET /api/trading/portfolio
  portfolio: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: TradingService.portfolio() });
  }),

  // GET /api/trading/orders
  orders: asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    res.json({ success: true, data: TradingService.orders({ limit }) });
  }),

  // GET /api/trading/state
  state: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: TradingService.state() });
  }),

  // POST /api/trading/cycle  (admin) — run one decision cycle now
  cycle: asyncHandler(async (req, res) => {
    const symbols = Array.isArray(req.body && req.body.symbols) ? req.body.symbols : undefined;
    const data = await TradingService.runCycle(symbols);
    res.json({ success: true, data });
  }),

  // POST /api/trading/engine/start  (admin)
  start: asyncHandler(async (req, res) => {
    const { intervalMs, symbols } = req.body || {};
    res.json({ success: true, data: TradingService.startEngine({ intervalMs, symbols }) });
  }),

  // POST /api/trading/engine/stop  (admin)
  stop: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: TradingService.stopEngine() });
  }),
};

module.exports = TradingController;
