'use strict';

/**
 * In-memory portfolio: cash, positions (long or short), realised/unrealised
 * P&L and an equity curve. It is the single source of truth the risk manager
 * reads (via `riskState()`) and the engine marks to market each cycle.
 *
 * A position's `quantity` is signed: positive = long, negative = short.
 * Cash accounting is signed too, so short proceeds and covers fall out
 * naturally.
 */
class Portfolio {
  constructor({ startingEquity = 100000, baseCurrency = 'USD' } = {}) {
    this.baseCurrency = baseCurrency;
    this.startingEquity = startingEquity;
    this.cash = startingEquity;
    this.realizedPnL = 0;
    this.positions = new Map(); // symbol → position
    this.equityCurve = [{ time: new Date().toISOString(), equity: startingEquity }];
    this.dayStartEquity = startingEquity;
    this.dayKey = todayKey();
    this.trades = [];
  }

  hasPosition(symbol) {
    const p = this.positions.get(symbol);
    return Boolean(p && p.quantity !== 0);
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  /**
   * Apply an executed fill. Handles averaging up, partial closes, full closes
   * and flips (closing then reopening on the other side).
   * @param {{symbol,side,quantity,price,commission?,time?}} fill
   */
  applyFill(fill) {
    const { symbol, side, price } = fill;
    const commission = fill.commission || 0;
    const delta = side === 'buy' ? Math.abs(fill.quantity) : -Math.abs(fill.quantity);

    this.cash -= delta * price; // buy reduces cash, sell/short adds cash
    this.cash -= commission;

    let pos = this.positions.get(symbol);
    if (!pos) {
      pos = { symbol, quantity: 0, avgPrice: 0, realizedPnL: 0, lastPrice: price };
      this.positions.set(symbol, pos);
    }

    const q = pos.quantity;
    let realized = 0;
    if (q === 0 || Math.sign(q) === Math.sign(delta)) {
      // Opening or adding in the same direction: volume-weighted average.
      const newQty = q + delta;
      pos.avgPrice = (Math.abs(q) * pos.avgPrice + Math.abs(delta) * price) / Math.abs(newQty);
      pos.quantity = newQty;
    } else {
      // Reducing / closing / flipping.
      const closing = Math.min(Math.abs(q), Math.abs(delta));
      realized = q > 0 ? closing * (price - pos.avgPrice) : closing * (pos.avgPrice - price);
      const newQty = q + delta;
      pos.quantity = newQty;
      if (Math.sign(newQty) !== Math.sign(q) && newQty !== 0) {
        pos.avgPrice = price; // flipped: remainder opens fresh at fill price
      } else if (newQty === 0) {
        pos.avgPrice = 0;
      }
    }

    pos.realizedPnL += realized;
    pos.lastPrice = price;
    this.realizedPnL += realized;

    const trade = {
      symbol,
      side,
      quantity: Math.abs(fill.quantity),
      price,
      commission,
      realizedPnL: round(realized),
      time: fill.time || new Date().toISOString(),
    };
    this.trades.push(trade);
    if (pos.quantity === 0) this.positions.delete(symbol);
    return trade;
  }

  /** Update last prices and refresh the equity curve. `prices` is symbol→price. */
  markToMarket(prices = {}) {
    this._rollDayIfNeeded();
    for (const pos of this.positions.values()) {
      if (prices[pos.symbol] != null) pos.lastPrice = prices[pos.symbol];
    }
    const eq = this.equity();
    this.equityCurve.push({ time: new Date().toISOString(), equity: round(eq) });
    if (this.equityCurve.length > 5000) this.equityCurve.shift();
    return eq;
  }

  unrealizedPnL() {
    let u = 0;
    for (const pos of this.positions.values()) {
      u += pos.quantity * (pos.lastPrice - pos.avgPrice);
    }
    return u;
  }

  /** Marked-to-market account value. */
  equity() {
    let holdings = 0;
    for (const pos of this.positions.values()) holdings += pos.quantity * pos.lastPrice;
    return this.cash + holdings;
  }

  grossExposure() {
    let ex = 0;
    for (const pos of this.positions.values()) ex += Math.abs(pos.quantity) * pos.lastPrice;
    return ex;
  }

  /** Plain risk-state object the RiskManager consumes. */
  riskState() {
    this._rollDayIfNeeded();
    const equity = this.equity();
    return {
      equity,
      cash: this.cash,
      openPositions: this.positions.size,
      exposure: this.grossExposure(),
      dailyPnL: equity - this.dayStartEquity,
      hasPosition: (symbol) => this.hasPosition(symbol),
    };
  }

  _rollDayIfNeeded() {
    const key = todayKey();
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayStartEquity = this.equity();
    }
  }

  snapshot() {
    const equity = this.equity();
    return {
      baseCurrency: this.baseCurrency,
      cash: round(this.cash),
      equity: round(equity),
      startingEquity: this.startingEquity,
      realizedPnL: round(this.realizedPnL),
      unrealizedPnL: round(this.unrealizedPnL()),
      totalReturnPct: round(((equity - this.startingEquity) / this.startingEquity) * 100, 3),
      dailyPnL: round(equity - this.dayStartEquity),
      openPositions: this.positions.size,
      grossExposure: round(this.grossExposure()),
      positions: [...this.positions.values()].map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        avgPrice: round(p.avgPrice),
        lastPrice: round(p.lastPrice),
        marketValue: round(p.quantity * p.lastPrice),
        unrealizedPnL: round(p.quantity * (p.lastPrice - p.avgPrice)),
        realizedPnL: round(p.realizedPnL),
      })),
    };
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function round(v, dp = 2) {
  return Number(Number(v).toFixed(dp));
}

module.exports = Portfolio;
