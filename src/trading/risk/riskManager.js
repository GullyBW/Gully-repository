'use strict';

const { ORDER_SIDES, SIGNAL_ACTIONS } = require('../constants');

/**
 * Risk manager — the discipline layer between a signal and an order. Good risk
 * control, not signal quality, is what separates desks that survive from those
 * that blow up, so every entry is sized and bounded here:
 *
 *   • Risk-per-trade budgeting  — never risk more than X% of equity to the stop
 *   • ATR stops & targets       — distances scale with each name's volatility
 *   • Volatility targeting      — larger size in calm names, smaller in wild ones
 *   • Fractional Kelly overlay  — edge-scaled sizing, capped well below full Kelly
 *   • Portfolio limits          — max position %, gross exposure, open-position count
 *   • Daily-loss kill switch    — stop opening risk after a bad day
 *
 * `assess()` is pure: it takes the signal, the technical snapshot and a plain
 * portfolio risk-state and returns a sizing decision. It never mutates state.
 */
class RiskManager {
  constructor(riskConfig = {}) {
    this.cfg = {
      riskPerTradePct: 0.01,
      maxPositionPct: 0.2,
      maxPortfolioExposurePct: 1.0,
      maxOpenPositions: 8,
      maxDailyLossPct: 0.03,
      targetAnnualVolPct: 0.15,
      kellyFraction: 0.5,
      atrStopMultiple: 2.0,
      atrTargetMultiple: 3.0,
      ...riskConfig,
    };
  }

  /**
   * @param {object} signal   ensemble output { action, score, confidence, agreement }
   * @param {object} snapshot technical snapshot { price, atr, atrPct }
   * @param {object} state     portfolio risk-state
   * @returns {object} sizing decision
   */
  assess(signal, snapshot, state) {
    const reject = (reason) => ({ approved: false, quantity: 0, reasons: [reason] });

    if (!signal || signal.action === SIGNAL_ACTIONS.HOLD) return reject('signal is HOLD');
    if (!snapshot || !snapshot.ok || !snapshot.price) return reject('no price/snapshot');

    const equity = state.equity;
    const price = snapshot.price;
    const side = signal.score > 0 ? ORDER_SIDES.BUY : ORDER_SIDES.SELL;
    const reasons = [];

    // --- Kill switch: stop opening new risk after a bad day. ---
    if (state.dailyPnL != null && state.dailyPnL <= -equity * this.cfg.maxDailyLossPct) {
      return reject(
        `daily-loss kill switch active (P&L ${round(state.dailyPnL)} ≤ -${(this.cfg.maxDailyLossPct * 100).toFixed(1)}% of equity)`
      );
    }

    // --- Position count limit (existing positions may still be scaled). ---
    const alreadyHeld = state.hasPosition ? state.hasPosition(signal.symbol) : false;
    if (!alreadyHeld && state.openPositions >= this.cfg.maxOpenPositions) {
      return reject(`max open positions reached (${this.cfg.maxOpenPositions})`);
    }

    // --- Stop distance from ATR (fallback: 2% of price). ---
    const atr = snapshot.atr && snapshot.atr > 0 ? snapshot.atr : price * 0.02;
    const stopDistance = this.cfg.atrStopMultiple * atr;
    const targetDistance = this.cfg.atrTargetMultiple * atr;

    // --- Size factor from conviction (score magnitude × confidence × agreement). ---
    const conviction = Math.min(1, (Math.abs(signal.score) / 2) * signal.confidence * (0.5 + 0.5 * (signal.agreement || 0)));
    reasons.push(`conviction ${round(conviction, 3)} (score ${signal.score}, conf ${signal.confidence})`);

    // 1) Risk-budget sizing: risk at most riskPerTradePct·equity to the stop.
    const riskBudget = equity * this.cfg.riskPerTradePct * (0.4 + 0.6 * conviction);
    const sharesByRisk = riskBudget / stopDistance;

    // 2) Volatility targeting: scale down names whose per-trade vol is high.
    const perTradeVol = (atr / price) * this.cfg.atrStopMultiple; // fractional risk to stop
    const volBudgetFraction = perTradeVol > 0 ? this.cfg.targetAnnualVolPct / (perTradeVol * 16) : this.cfg.maxPositionPct;
    const sharesByVol = (equity * clamp(volBudgetFraction, 0, this.cfg.maxPositionPct)) / price;

    // 3) Fractional-Kelly overlay from the estimated edge.
    const edge = clamp(conviction, 0, 1);
    const kellyFractionOfEquity = this.cfg.kellyFraction * edge * this.cfg.maxPositionPct;
    const sharesByKelly = (equity * kellyFractionOfEquity) / price;

    // 4) Hard notional cap.
    const sharesByNotional = (equity * this.cfg.maxPositionPct) / price;

    let quantity = Math.floor(Math.min(sharesByRisk, sharesByVol, sharesByKelly, sharesByNotional));

    // --- Gross-exposure cap across the book. ---
    const currentExposure = state.exposure || 0;
    const maxExposure = equity * this.cfg.maxPortfolioExposurePct;
    const roomNotional = Math.max(0, maxExposure - currentExposure);
    const maxSharesByExposure = Math.floor(roomNotional / price);
    if (quantity > maxSharesByExposure) {
      quantity = maxSharesByExposure;
      reasons.push('trimmed to respect gross-exposure cap');
    }

    if (quantity <= 0) return reject('sized position rounds to zero shares');

    const notional = round(quantity * price);
    const riskAmount = round(quantity * stopDistance);
    const stopPrice = round(side === ORDER_SIDES.BUY ? price - stopDistance : price + stopDistance);
    const takeProfit = round(side === ORDER_SIDES.BUY ? price + targetDistance : price - targetDistance);

    reasons.push(
      `sized ${quantity} sh (risk-budget ${Math.floor(sharesByRisk)}, vol-target ${Math.floor(sharesByVol)}, kelly ${Math.floor(sharesByKelly)}, notional-cap ${Math.floor(sharesByNotional)})`
    );

    return {
      approved: true,
      symbol: signal.symbol,
      side,
      quantity,
      entryPrice: price,
      notional,
      stopPrice,
      takeProfit,
      riskAmount,
      rewardToRisk: round(targetDistance / stopDistance, 2),
      reasons,
    };
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function round(v, dp = 2) {
  return Number(Number(v).toFixed(dp));
}

module.exports = RiskManager;
