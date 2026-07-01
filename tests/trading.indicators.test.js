'use strict';

const ind = require('../src/trading/analysis/indicators');
const { detectPatterns } = require('../src/trading/analysis/patterns');

const bar = (o, h, l, c, v = 1000) => ({ time: new Date().toISOString(), open: o, high: h, low: l, close: c, volume: v });

describe('Technical indicators', () => {
  test('SMA computes trailing averages and nulls the warmup', () => {
    const out = ind.sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out.at(-1)).toBeCloseTo(4);
  });

  test('EMA is seeded with the opening SMA', () => {
    const out = ind.ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(2); // seed = SMA(1,2,3)
    expect(out[3]).toBeCloseTo(3);
    expect(out.at(-1)).toBeCloseTo(4);
  });

  test('RSI is 100 for a pure uptrend and 0 for a pure downtrend', () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    const down = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(ind.rsi(up, 14).at(-1)).toBeCloseTo(100);
    expect(ind.rsi(down, 14).at(-1)).toBeCloseTo(0);
  });

  test('RSI stays within [0, 100]', () => {
    const noisy = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const r = ind.rsi(noisy, 14).at(-1);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(100);
  });

  test('MACD histogram is ~0 for a flat series', () => {
    const flat = new Array(60).fill(100);
    const m = ind.macd(flat);
    expect(m.macd.at(-1)).toBeCloseTo(0);
    expect(m.histogram.at(-1)).toBeCloseTo(0);
  });

  test('Bollinger bands collapse to price when volatility is zero', () => {
    const flat = new Array(25).fill(50);
    const bb = ind.bollingerBands(flat, 20, 2);
    expect(bb.middle.at(-1)).toBeCloseTo(50);
    expect(bb.upper.at(-1)).toBeCloseTo(50);
    expect(bb.lower.at(-1)).toBeCloseTo(50);
    expect(bb.percentB.at(-1)).toBeCloseTo(0.5);
  });

  test('Bollinger bands match a hand-computed window', () => {
    const bb = ind.bollingerBands([2, 4, 6, 8, 10], 5, 2);
    expect(bb.middle.at(-1)).toBeCloseTo(6); // mean
    // population stddev = sqrt(8) = 2.8284
    expect(bb.upper.at(-1)).toBeCloseTo(6 + 2 * Math.sqrt(8), 3);
    expect(bb.lower.at(-1)).toBeCloseTo(6 - 2 * Math.sqrt(8), 3);
  });

  test('ATR equals the constant true range of uniform bars', () => {
    const bars = Array.from({ length: 20 }, () => bar(100, 101, 99, 100));
    expect(ind.atr(bars, 14).at(-1)).toBeCloseTo(2);
  });

  test('VWAP of single-volume flat bars equals the price', () => {
    const bars = Array.from({ length: 5 }, () => bar(10, 10, 10, 10, 100));
    expect(ind.vwap(bars).at(-1)).toBeCloseTo(10);
  });

  test('crossover detects a bullish cross on the last bar', () => {
    expect(ind.crossover([1, 3], [2, 2])).toBe('bullish');
    expect(ind.crossover([3, 1], [2, 2])).toBe('bearish');
    expect(ind.crossover([1, 1], [2, 2])).toBeNull();
  });

  test('ADX stays within [0, 100]', () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(100 + i, 100 + i + 1, 99 + i, 100 + i));
    const a = ind.adx(bars).adx.at(-1);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(100);
  });
});

describe('Candlestick patterns', () => {
  test('detects a bullish engulfing', () => {
    const bars = [bar(10, 10.2, 9.5, 9.6), bar(9.5, 10.6, 9.4, 10.5)];
    const found = detectPatterns(bars).map((p) => p.pattern);
    expect(found).toContain('bullish_engulfing');
  });

  test('detects a hammer', () => {
    // small body near the top, long lower wick, negligible upper wick
    const bars = [bar(10, 10.05, 8.0, 9.5)];
    const found = detectPatterns(bars).map((p) => p.pattern);
    expect(found).toContain('hammer');
  });
});
