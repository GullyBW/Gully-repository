'use strict';

const config = require('../../config');
const bus = require('../../realtime/bus');
const { getProvider } = require('../providers');
const NewsService = require('../news/newsService');
const technicalAnalyzer = require('../analysis/technicalAnalyzer');
const StrategyEnsemble = require('../strategy/ensemble');
const RiskManager = require('../risk/riskManager');
const Portfolio = require('../portfolio/portfolio');
const OrderManager = require('../execution/orderManager');
const { ORDER_SIDES, ORDER_TYPES, SIGNAL_ACTIONS, RUN_MODES } = require('../constants');

/**
 * The trading engine ties the whole pipeline together:
 *
 *   data (IBKR/sim) → technical analysis + news sentiment → strategy ensemble
 *        → risk-managed sizing → order management → portfolio → realtime
 *
 * It runs a discrete decision *cycle* per tick. Each cycle first manages open
 * positions (stop/target/reversal exits), then considers new entries, then
 * marks the book to market and broadcasts a signal snapshot. `runCycle()` is
 * safe to call ad-hoc (e.g. from the REST layer) or on an interval via
 * `start()`. Everything is paper-traded unless live routing is explicitly
 * enabled in config.
 */
class TradingEngine {
  constructor(deps = {}) {
    const t = config.trading;
    this.provider = deps.provider || getProvider();
    this.news = deps.news || new NewsService(this.provider);
    this.ensemble = deps.ensemble || new StrategyEnsemble(t.strategyWeights);
    this.risk = deps.risk || new RiskManager(t.risk);
    this.portfolio = deps.portfolio || new Portfolio({ startingEquity: t.risk.startingEquity, baseCurrency: t.baseCurrency });
    this.oms =
      deps.oms ||
      new OrderManager(this.provider, { runMode: t.runMode, liveOrdersEnabled: t.liveOrdersEnabled });

    this.watchlist = deps.watchlist || t.watchlist;
    this.timeframe = deps.timeframe || '5min';
    this.brackets = new Map(); // symbol → { side, stopPrice, takeProfit }
    this.history = []; // recent cycle reports
    this.running = false;
    this._timer = null;
    this.lastCycleAt = null;
  }

  get mode() {
    return this.oms.isLive ? RUN_MODES.LIVE : RUN_MODES.PAPER;
  }

  /** Fetch every input needed to reason about one symbol. */
  async gatherContext(symbol, opts = {}) {
    const sym = String(symbol).toUpperCase();
    const [bars, quote, news, fundamentals] = await Promise.all([
      this.provider.getBars(sym, { timeframe: opts.timeframe || this.timeframe, limit: opts.barLimit || 200 }),
      this.provider.getQuote(sym).catch(() => null),
      this.news.sentimentFor(sym, { limit: opts.newsLimit || 8 }).catch(() => null),
      this.provider.getFundamentals(sym).catch(() => ({})),
    ]);
    const snapshot = technicalAnalyzer.analyze(bars);
    return { symbol: sym, bars, quote, snapshot, news, fundamentals };
  }

  /** Full analysis for a symbol: technicals + news + blended signal. */
  async analyze(symbol, opts = {}) {
    const ctx = await this.gatherContext(symbol, opts);
    const signal = this.ensemble.evaluate(ctx);
    return {
      symbol: ctx.symbol,
      time: new Date().toISOString(),
      price: ctx.snapshot.ok ? ctx.snapshot.price : ctx.quote && ctx.quote.last,
      signal,
      technical: publicSnapshot(ctx.snapshot),
      news: ctx.news,
      quote: ctx.quote,
      fundamentals: ctx.fundamentals,
    };
  }

  /** Analysis plus the risk-managed decision — *without* executing anything. */
  async evaluate(symbol, opts = {}) {
    const ctx = await this.gatherContext(symbol, opts);
    const signal = this.ensemble.evaluate(ctx);
    const decision = this.risk.assess(signal, ctx.snapshot, this.portfolio.riskState());
    return {
      symbol: ctx.symbol,
      signal,
      decision,
      technical: publicSnapshot(ctx.snapshot),
      news: ctx.news,
    };
  }

  /**
   * Run one decision cycle across `symbols` (defaults to the watchlist).
   * Manages exits, opens risk-approved entries, marks to market, broadcasts.
   */
  async runCycle(symbols, opts = {}) {
    const list = (symbols && symbols.length ? symbols : this.watchlist).map((s) => s.toUpperCase());
    const evaluated = [];
    const actions = [];
    const prices = {};

    for (const symbol of list) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await this.gatherContext(symbol, opts);
      if (!ctx.snapshot.ok) {
        evaluated.push({ symbol, skipped: 'no_data' });
        continue;
      }
      const price = ctx.snapshot.price;
      prices[symbol] = price;
      const signal = this.ensemble.evaluate(ctx);

      // 1) Manage an existing position first.
      // eslint-disable-next-line no-await-in-loop
      const exit = await this._manageExit(symbol, price, signal, ctx);
      if (exit) actions.push(exit);

      // 2) Consider a fresh entry (only if flat after any exit).
      if (!this.portfolio.hasPosition(symbol) && signal.action !== SIGNAL_ACTIONS.HOLD) {
        const decision = this.risk.assess(signal, ctx.snapshot, this.portfolio.riskState());
        if (decision.approved) {
          // eslint-disable-next-line no-await-in-loop
          const action = await this._enter(symbol, decision, signal, ctx);
          actions.push(action);
        } else {
          evaluated.push({ symbol, action: signal.action, score: signal.score, blocked: decision.reasons });
          continue;
        }
      }

      evaluated.push({
        symbol,
        action: signal.action,
        score: signal.score,
        confidence: signal.confidence,
        agreement: signal.agreement,
        price,
      });
    }

    // 3) Mark the book to market with this cycle's prices.
    this.portfolio.markToMarket(prices);
    this.lastCycleAt = new Date().toISOString();

    const report = {
      time: this.lastCycleAt,
      mode: this.mode,
      evaluated,
      actions,
      portfolio: this.portfolio.snapshot(),
    };
    this.history.push({ time: report.time, actions: actions.length, evaluated: evaluated.length });
    if (this.history.length > 500) this.history.shift();

    bus.emit('trading:cycle', 'trading', { time: report.time, mode: report.mode, actions, equity: report.portfolio.equity });
    return report;
  }

  async _enter(symbol, decision, signal, ctx) {
    const order = {
      symbol,
      side: decision.side,
      quantity: decision.quantity,
      type: ORDER_TYPES.MARKET,
    };
    const fill = await this.oms.submit(order, { quote: ctx.quote });
    if (fill.status === 'filled') {
      const trade = this.portfolio.applyFill(fill);
      this.brackets.set(symbol, {
        side: decision.side,
        stopPrice: decision.stopPrice,
        takeProfit: decision.takeProfit,
      });
      const action = {
        type: 'entry',
        symbol,
        side: decision.side,
        quantity: decision.quantity,
        price: fill.price,
        stopPrice: decision.stopPrice,
        takeProfit: decision.takeProfit,
        signalAction: signal.action,
        reasons: [...signal.reasons.slice(0, 4), ...decision.reasons.slice(-2)],
        trade,
      };
      bus.emit('trading:fill', 'trading', action);
      return action;
    }
    return { type: 'entry_rejected', symbol, status: fill.status, reason: fill.reason };
  }

  async _manageExit(symbol, price, signal, ctx) {
    const pos = this.portfolio.getPosition(symbol);
    if (!pos || pos.quantity === 0) return null;
    const bracket = this.brackets.get(symbol);
    const isLong = pos.quantity > 0;

    let reason = null;
    if (bracket) {
      if (isLong && price <= bracket.stopPrice) reason = 'stop_loss';
      else if (isLong && price >= bracket.takeProfit) reason = 'take_profit';
      else if (!isLong && price >= bracket.stopPrice) reason = 'stop_loss';
      else if (!isLong && price <= bracket.takeProfit) reason = 'take_profit';
    }
    // Signal reversal exit: a strong opposite signal closes the position.
    if (!reason) {
      const opposed = (isLong && signal.score <= -1) || (!isLong && signal.score >= 1);
      if (opposed) reason = 'signal_reversal';
    }
    if (!reason) return null;

    const order = {
      symbol,
      side: isLong ? ORDER_SIDES.SELL : ORDER_SIDES.BUY,
      quantity: Math.abs(pos.quantity),
      type: ORDER_TYPES.MARKET,
    };
    const fill = await this.oms.submit(order, { quote: ctx.quote });
    if (fill.status !== 'filled') return { type: 'exit_rejected', symbol, status: fill.status };
    const trade = this.portfolio.applyFill(fill);
    this.brackets.delete(symbol);
    const action = { type: 'exit', symbol, reason, price: fill.price, realizedPnL: trade.realizedPnL, trade };
    bus.emit('trading:fill', 'trading', action);
    return action;
  }

  /** Start the periodic loop. `intervalMs` defaults to 60s. */
  start({ intervalMs = 60000, symbols } = {}) {
    if (this.running) return { running: true, alreadyRunning: true };
    this.running = true;
    const tick = async () => {
      try {
        await this.runCycle(symbols);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[trading] cycle error', err.message);
      }
    };
    this._timer = setInterval(tick, intervalMs);
    if (this._timer.unref) this._timer.unref();
    tick();
    return { running: true, intervalMs, mode: this.mode };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.running = false;
    return { running: false };
  }

  getState() {
    return {
      running: this.running,
      mode: this.mode,
      liveOrdersEnabled: this.oms.liveOrdersEnabled,
      dataProvider: this.provider.name,
      watchlist: this.watchlist,
      timeframe: this.timeframe,
      lastCycleAt: this.lastCycleAt,
      portfolio: this.portfolio.snapshot(),
      openBrackets: [...this.brackets.entries()].map(([symbol, b]) => ({ symbol, ...b })),
      recentCycles: this.history.slice(-20),
    };
  }
}

/** Trim the heavy `series` arrays before sending a snapshot over the wire. */
function publicSnapshot(snapshot) {
  if (!snapshot || !snapshot.ok) return snapshot;
  const { series, ...rest } = snapshot;
  void series;
  return rest;
}

module.exports = TradingEngine;
