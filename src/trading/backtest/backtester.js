'use strict';

const technicalAnalyzer = require('../analysis/technicalAnalyzer');
const StrategyEnsemble = require('../strategy/ensemble');
const MomentumStrategy = require('../strategy/momentum.strategy');
const MeanReversionStrategy = require('../strategy/meanReversion.strategy');
const BreakoutStrategy = require('../strategy/breakout.strategy');
const RiskManager = require('../risk/riskManager');
const Portfolio = require('../portfolio/portfolio');
const { ORDER_SIDES, SIGNAL_ACTIONS, TIMEFRAMES } = require('../constants');

/**
 * Event-driven backtester. Replays a bar series bar-by-bar through the exact
 * same technical-analysis → ensemble → risk-manager → portfolio pipeline the
 * live engine uses, so a strategy is validated on the code that will trade it
 * (no separate, divergent research implementation — a classic source of live
 * vs. backtest drift on real desks).
 *
 * Costs are modelled: fills cross a configurable slippage and pay commission.
 * Exits are checked intrabar against the bar's high/low so stops/targets are
 * realistic rather than close-to-close.
 *
 * News-driven signals are excluded by default because historical news replay is
 * not modelled here — the backtest therefore reflects the technical edge only.
 */
class Backtester {
  constructor({ riskConfig = {}, strategies = null, weights = {}, warmup = 60, slippageBps = 2, commissionPerShare = 0.005, minCommission = 1 } = {}) {
    this.risk = new RiskManager(riskConfig);
    this.ensemble = new StrategyEnsemble(
      weights,
      strategies || [new MomentumStrategy(), new MeanReversionStrategy(), new BreakoutStrategy()]
    );
    this.warmup = warmup;
    this.slippageBps = slippageBps;
    this.commissionPerShare = commissionPerShare;
    this.minCommission = minCommission;
  }

  /**
   * @param {object} args
   * @param {string} args.symbol
   * @param {Array} args.bars  ascending OHLCV
   * @param {number} [args.startingEquity]
   * @param {string} [args.timeframe] used only to annualise the Sharpe ratio
   */
  run({ symbol, bars, startingEquity = 100000, timeframe = '5min' }) {
    if (!Array.isArray(bars) || bars.length < this.warmup + 5) {
      return { ok: false, reason: 'not_enough_bars' };
    }
    const sym = String(symbol || 'TEST').toUpperCase();
    const portfolio = new Portfolio({ startingEquity });
    let bracket = null;

    for (let i = this.warmup; i < bars.length; i += 1) {
      const window = bars.slice(0, i + 1);
      const bar = bars[i];
      const snapshot = technicalAnalyzer.analyze(window);
      if (!snapshot.ok) continue;

      // --- Manage an open position intrabar (stop/target on this bar's range). ---
      const pos = portfolio.getPosition(sym);
      if (pos && bracket) {
        const isLong = pos.quantity > 0;
        let exitPrice = null;
        let reason = null;
        if (isLong) {
          if (bar.low <= bracket.stopPrice) { exitPrice = bracket.stopPrice; reason = 'stop'; }
          else if (bar.high >= bracket.takeProfit) { exitPrice = bracket.takeProfit; reason = 'target'; }
        } else if (bar.high >= bracket.stopPrice) { exitPrice = bracket.stopPrice; reason = 'stop'; }
        else if (bar.low <= bracket.takeProfit) { exitPrice = bracket.takeProfit; reason = 'target'; }

        if (exitPrice != null) {
          this._fill(portfolio, sym, isLong ? ORDER_SIDES.SELL : ORDER_SIDES.BUY, Math.abs(pos.quantity), exitPrice, bar.time, reason);
          bracket = null;
        }
      }

      // --- Consider a new entry when flat. ---
      const signal = this.ensemble.evaluate({ symbol: sym, snapshot, bars: window, news: null });
      if (!portfolio.hasPosition(sym) && signal.action !== SIGNAL_ACTIONS.HOLD) {
        const decision = this.risk.assess(signal, snapshot, portfolio.riskState());
        if (decision.approved) {
          this._fill(portfolio, sym, decision.side, decision.quantity, bar.close, bar.time, 'entry');
          bracket = { stopPrice: decision.stopPrice, takeProfit: decision.takeProfit };
        }
      }

      portfolio.positions.forEach((p) => { p.lastPrice = bar.close; });
      portfolio.markToMarket({ [sym]: bar.close });
    }

    // Liquidate anything still open at the last close.
    const open = portfolio.getPosition(sym);
    if (open) {
      const lastBar = bars.at(-1);
      this._fill(portfolio, sym, open.quantity > 0 ? ORDER_SIDES.SELL : ORDER_SIDES.BUY, Math.abs(open.quantity), lastBar.close, lastBar.time, 'liquidate');
    }

    return this._metrics(portfolio, startingEquity, timeframe, sym);
  }

  _fill(portfolio, symbol, side, quantity, price, time, tag) {
    const isBuy = side === ORDER_SIDES.BUY;
    const fillPrice = price * (1 + (isBuy ? 1 : -1) * (this.slippageBps / 10000));
    const commission = Math.max(this.minCommission, quantity * this.commissionPerShare);
    portfolio.applyFill({ symbol, side, quantity, price: fillPrice, commission, time, tag });
  }

  _metrics(portfolio, startingEquity, timeframe, symbol) {
    const curve = portfolio.equityCurve;
    const equity = portfolio.equity();

    // Per-step returns → annualised Sharpe.
    const rets = [];
    for (let i = 1; i < curve.length; i += 1) {
      const prev = curve[i - 1].equity;
      if (prev > 0) rets.push((curve[i].equity - prev) / prev);
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length : 0;
    const sd = Math.sqrt(variance);
    const barsPerYear = (252 * 6.5 * 3600) / (TIMEFRAMES[timeframe] || 300);
    const sharpe = sd === 0 ? 0 : (mean / sd) * Math.sqrt(barsPerYear);

    // Max drawdown from the equity curve.
    let peak = -Infinity;
    let maxDD = 0;
    for (const point of curve) {
      if (point.equity > peak) peak = point.equity;
      const dd = peak > 0 ? (peak - point.equity) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Trade stats from realised closes.
    const closes = portfolio.trades.filter((t) => t.realizedPnL !== 0);
    const wins = closes.filter((t) => t.realizedPnL > 0);
    const losses = closes.filter((t) => t.realizedPnL < 0);
    const grossWin = wins.reduce((a, t) => a + t.realizedPnL, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnL, 0));

    return {
      ok: true,
      symbol,
      startingEquity,
      endingEquity: round(equity),
      totalReturnPct: round(((equity - startingEquity) / startingEquity) * 100, 2),
      totalTrades: portfolio.trades.length,
      closedTrades: closes.length,
      winRatePct: closes.length ? round((wins.length / closes.length) * 100, 1) : 0,
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : round(grossWin / grossLoss, 2),
      avgWin: wins.length ? round(grossWin / wins.length) : 0,
      avgLoss: losses.length ? round(grossLoss / losses.length) : 0,
      expectancy: closes.length ? round((grossWin - grossLoss) / closes.length) : 0,
      sharpe: round(sharpe, 2),
      maxDrawdownPct: round(maxDD * 100, 2),
      realizedPnL: round(portfolio.realizedPnL),
    };
  }
}

function round(v, dp = 2) {
  return Number(Number(v).toFixed(dp));
}

module.exports = Backtester;
