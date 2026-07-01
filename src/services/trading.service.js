'use strict';

const config = require('../config');
const TradingEngine = require('../trading/engine/tradingEngine');
const Backtester = require('../trading/backtest/backtester');
const { getProvider, getSimulatedProvider } = require('../trading/providers');
const ApiError = require('../utils/ApiError');

/**
 * Application-facing facade for the day-trading subsystem. Owns the singleton
 * engine (so the whole process shares one paper portfolio and one live-order
 * gate) and exposes the read/act operations the REST controller needs. Mirrors
 * the static-service style used across the codebase.
 */
let engine = null;

class TradingService {
  /** Lazily build (and cache) the shared engine. */
  static get engine() {
    if (!engine) engine = new TradingEngine();
    return engine;
  }

  /** Swap the engine (tests / config reloads). */
  static setEngine(next) {
    engine = next;
  }

  static resetEngine() {
    if (engine) engine.stop();
    engine = null;
  }

  static async quote(symbol) {
    return getProvider().getQuote(symbol);
  }

  static async bars(symbol, opts) {
    return getProvider().getBars(symbol, opts);
  }

  static async news(symbol, opts) {
    const provider = getProvider();
    return provider.getNews(symbol || null, opts);
  }

  static async sentiment(symbol) {
    if (!symbol) throw ApiError.badRequest('symbol is required');
    return TradingService.engine.news.sentimentFor(symbol);
  }

  /** Technical + news + blended signal for a symbol (read-only). */
  static async analyze(symbol, opts) {
    if (!symbol) throw ApiError.badRequest('symbol is required');
    return TradingService.engine.analyze(symbol, opts);
  }

  /** Signal + risk-managed decision without executing (read-only). */
  static async evaluate(symbol, opts) {
    if (!symbol) throw ApiError.badRequest('symbol is required');
    return TradingService.engine.evaluate(symbol, opts);
  }

  /** Run one live decision cycle (paper unless live is enabled). */
  static async runCycle(symbols, opts) {
    return TradingService.engine.runCycle(symbols, opts);
  }

  static startEngine(opts) {
    return TradingService.engine.start(opts);
  }

  static stopEngine() {
    return TradingService.engine.stop();
  }

  static state() {
    return TradingService.engine.getState();
  }

  static portfolio() {
    return TradingService.engine.portfolio.snapshot();
  }

  static orders(opts) {
    return TradingService.engine.oms.history(opts);
  }

  /**
   * Backtest a strategy over historical/simulated bars. When bars are not
   * supplied, they are drawn from the offline simulator so the endpoint always
   * works without a live data feed.
   */
  static async backtest({ symbol, timeframe = '5min', limit = 500, bars, startingEquity } = {}) {
    if (!symbol) throw ApiError.badRequest('symbol is required');
    const series = bars || (await getSimulatedProvider().getBars(symbol, { timeframe, limit }));
    const bt = new Backtester({ riskConfig: config.trading.risk });
    const result = bt.run({
      symbol,
      bars: series,
      timeframe,
      startingEquity: startingEquity || config.trading.risk.startingEquity,
    });
    if (!result.ok) throw ApiError.badRequest(`Backtest failed: ${result.reason}`);
    return result;
  }
}

module.exports = TradingService;
