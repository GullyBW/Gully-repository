'use strict';

const Portfolio = require('../src/trading/portfolio/portfolio');
const RiskManager = require('../src/trading/risk/riskManager');
const { SIGNAL_ACTIONS } = require('../src/trading/constants');

describe('Portfolio accounting', () => {
  test('realises P&L on a round-trip long', () => {
    const p = new Portfolio({ startingEquity: 100000 });
    p.applyFill({ symbol: 'AAPL', side: 'buy', quantity: 100, price: 10, commission: 0 });
    expect(p.getPosition('AAPL').quantity).toBe(100);
    expect(p.cash).toBeCloseTo(99000);
    p.applyFill({ symbol: 'AAPL', side: 'sell', quantity: 100, price: 12, commission: 0 });
    expect(p.hasPosition('AAPL')).toBe(false);
    expect(p.realizedPnL).toBeCloseTo(200);
    expect(p.equity()).toBeCloseTo(100200);
  });

  test('realises P&L on a round-trip short', () => {
    const p = new Portfolio({ startingEquity: 100000 });
    p.applyFill({ symbol: 'TSLA', side: 'sell', quantity: 100, price: 10, commission: 0 });
    expect(p.getPosition('TSLA').quantity).toBe(-100);
    expect(p.cash).toBeCloseTo(101000);
    p.applyFill({ symbol: 'TSLA', side: 'buy', quantity: 100, price: 8, commission: 0 });
    expect(p.realizedPnL).toBeCloseTo(200);
  });

  test('averages up and marks to market', () => {
    const p = new Portfolio({ startingEquity: 100000 });
    p.applyFill({ symbol: 'MSFT', side: 'buy', quantity: 100, price: 10, commission: 0 });
    p.applyFill({ symbol: 'MSFT', side: 'buy', quantity: 100, price: 20, commission: 0 });
    expect(p.getPosition('MSFT').avgPrice).toBeCloseTo(15);
    p.markToMarket({ MSFT: 25 });
    expect(p.unrealizedPnL()).toBeCloseTo(200 * (25 - 15) / 1 - 0); // 200 sh × (25-15)
    expect(p.unrealizedPnL()).toBeCloseTo(2000);
  });
});

describe('Risk manager sizing', () => {
  const snapshot = { ok: true, price: 100, atr: 2, atrPct: 2 };
  const bullSignal = { symbol: 'AAPL', action: SIGNAL_ACTIONS.BUY, score: 1.2, confidence: 0.8, agreement: 1 };

  const state = (over = {}) => ({
    equity: 100000,
    cash: 100000,
    openPositions: 0,
    exposure: 0,
    dailyPnL: 0,
    hasPosition: () => false,
    ...over,
  });

  test('approves a sized long with a stop below and target above entry', () => {
    const rm = new RiskManager({ riskPerTradePct: 0.01, atrStopMultiple: 2, atrTargetMultiple: 3 });
    const d = rm.assess(bullSignal, snapshot, state());
    expect(d.approved).toBe(true);
    expect(d.side).toBe('buy');
    expect(d.quantity).toBeGreaterThan(0);
    expect(d.stopPrice).toBeLessThan(100);
    expect(d.takeProfit).toBeGreaterThan(100);
    expect(d.rewardToRisk).toBeCloseTo(1.5);
  });

  test('rejects when the daily-loss kill switch has tripped', () => {
    const rm = new RiskManager({ maxDailyLossPct: 0.03 });
    const d = rm.assess(bullSignal, snapshot, state({ dailyPnL: -4000 }));
    expect(d.approved).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/kill switch/i);
  });

  test('rejects new symbols once max open positions is reached', () => {
    const rm = new RiskManager({ maxOpenPositions: 3 });
    const d = rm.assess(bullSignal, snapshot, state({ openPositions: 3 }));
    expect(d.approved).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/max open positions/i);
  });

  test('never risks more than the configured fraction of equity to the stop', () => {
    const rm = new RiskManager({ riskPerTradePct: 0.01, atrStopMultiple: 2 });
    const d = rm.assess(bullSignal, snapshot, state());
    // riskAmount = quantity × stopDistance must not exceed 1% of equity.
    expect(d.riskAmount).toBeLessThanOrEqual(100000 * 0.01 + 1e-6);
  });

  test('holds are not sized', () => {
    const rm = new RiskManager();
    const d = rm.assess({ action: SIGNAL_ACTIONS.HOLD, score: 0 }, snapshot, state());
    expect(d.approved).toBe(false);
  });
});
