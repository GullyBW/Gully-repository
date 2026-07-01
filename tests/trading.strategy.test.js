'use strict';

const MomentumStrategy = require('../src/trading/strategy/momentum.strategy');
const MeanReversionStrategy = require('../src/trading/strategy/meanReversion.strategy');
const BreakoutStrategy = require('../src/trading/strategy/breakout.strategy');
const StrategyEnsemble = require('../src/trading/strategy/ensemble');
const technicalAnalyzer = require('../src/trading/analysis/technicalAnalyzer');
const Backtester = require('../src/trading/backtest/backtester');
const SimulatedProvider = require('../src/trading/providers/simulated.provider');
const { SIGNAL_ACTIONS } = require('../src/trading/constants');

const bar = (o, h, l, c, v = 1000) => ({ time: new Date().toISOString(), open: o, high: h, low: l, close: c, volume: v });
const validActions = Object.values(SIGNAL_ACTIONS);

describe('Strategies', () => {
  test('momentum votes bullish on a clean uptrend snapshot', () => {
    const snapshot = {
      ok: true,
      price: 105,
      rsi: 62,
      macd: { histogram: 0.5, cross: 'bullish' },
      movingAverages: { ema9: 104, ema21: 102, emaCross: 'bullish', sma20: 101, sma50: 98 },
      adx: { adx: 30 },
      trend: 'strong_uptrend',
    };
    const vote = new MomentumStrategy().evaluate({ snapshot });
    expect(vote.score).toBeGreaterThan(0);
    expect([SIGNAL_ACTIONS.BUY, SIGNAL_ACTIONS.STRONG_BUY]).toContain(vote.action);
    expect(vote.reasons.length).toBeGreaterThan(0);
  });

  test('mean-reversion fades an overbought, rangebound snapshot', () => {
    const snapshot = {
      ok: true,
      price: 110,
      rsi: 76,
      bollinger: { percentB: 0.98, upper: 109, lower: 90 },
      stochastic: { k: 85 },
      adx: { adx: 15 },
    };
    const vote = new MeanReversionStrategy().evaluate({ snapshot });
    expect(vote.score).toBeLessThan(0);
  });

  test('mean-reversion refuses to fade a strong trend', () => {
    const snapshot = {
      ok: true,
      price: 110,
      rsi: 76,
      bollinger: { percentB: 0.98, upper: 109, lower: 90 },
      stochastic: { k: 85 },
      adx: { adx: 40 },
    };
    const vote = new MeanReversionStrategy().evaluate({ snapshot });
    expect(vote.action).toBe(SIGNAL_ACTIONS.HOLD);
  });

  test('breakout votes bullish when price clears the prior range', () => {
    const bars = [];
    for (let i = 0; i < 25; i += 1) bars.push(bar(100, 100.5, 99.5, 100));
    bars.push(bar(100, 111, 100, 110)); // decisive breakout up
    const snapshot = technicalAnalyzer.analyze(bars);
    const vote = new BreakoutStrategy().evaluate({ snapshot, bars });
    expect(vote.score).toBeGreaterThan(0);
    expect([SIGNAL_ACTIONS.BUY, SIGNAL_ACTIONS.STRONG_BUY]).toContain(vote.action);
  });
});

describe('Ensemble', () => {
  test('blends all strategy votes into one explainable signal', async () => {
    const bars = await new SimulatedProvider().getBars('AAPL', { timeframe: '5min', limit: 200 });
    const snapshot = technicalAnalyzer.analyze(bars);
    const ensemble = new StrategyEnsemble({ momentum: 1, mean_reversion: 1, breakout: 1, news_sentiment: 1 });
    const signal = ensemble.evaluate({
      symbol: 'AAPL',
      snapshot,
      bars,
      news: { score: 0.5, label: 'positive', count: 3 },
    });
    expect(signal.votes).toHaveLength(4);
    expect(validActions).toContain(signal.action);
    expect(typeof signal.score).toBe('number');
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(signal.reasons)).toBe(true);
  });
});

describe('Backtester', () => {
  test('produces a full performance report on simulated data', async () => {
    const bars = await new SimulatedProvider().getBars('NVDA', { timeframe: '5min', limit: 500 });
    const result = new Backtester({ riskConfig: { riskPerTradePct: 0.01 } }).run({
      symbol: 'NVDA',
      bars,
      startingEquity: 100000,
    });
    expect(result.ok).toBe(true);
    expect(typeof result.totalReturnPct).toBe('number');
    expect(typeof result.sharpe).toBe('number');
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.endingEquity).toBeGreaterThan(0);
  });

  test('rejects a too-short series', () => {
    const result = new Backtester().run({ symbol: 'X', bars: [bar(1, 1, 1, 1)] });
    expect(result.ok).toBe(false);
  });
});
