'use strict';

/**
 * Candlestick pattern recognition. Each detector inspects the tail of a bar
 * series and returns a `{ pattern, direction, strength }` descriptor or null.
 * Directions are 'bullish' | 'bearish'; strength is a 0..1 confidence used as a
 * weight when the pattern feeds into a strategy.
 */

const body = (b) => Math.abs(b.close - b.open);
const range = (b) => b.high - b.low;
const upperWick = (b) => b.high - Math.max(b.open, b.close);
const lowerWick = (b) => Math.min(b.open, b.close) - b.low;
const isBull = (b) => b.close > b.open;
const isBear = (b) => b.close < b.open;

/** Doji — indecision: a tiny body relative to range. */
function doji(bars) {
  const b = bars.at(-1);
  if (!b || range(b) === 0) return null;
  if (body(b) <= 0.1 * range(b)) {
    return { pattern: 'doji', direction: 'neutral', strength: 0.3 };
  }
  return null;
}

/** Hammer — bullish reversal: long lower wick, small body near the top. */
function hammer(bars) {
  const b = bars.at(-1);
  if (!b || range(b) === 0) return null;
  if (lowerWick(b) >= 2 * body(b) && upperWick(b) <= body(b) && body(b) > 0) {
    return { pattern: 'hammer', direction: 'bullish', strength: 0.6 };
  }
  return null;
}

/** Shooting star — bearish reversal: long upper wick, small body near the low. */
function shootingStar(bars) {
  const b = bars.at(-1);
  if (!b || range(b) === 0) return null;
  if (upperWick(b) >= 2 * body(b) && lowerWick(b) <= body(b) && body(b) > 0) {
    return { pattern: 'shooting_star', direction: 'bearish', strength: 0.6 };
  }
  return null;
}

/** Engulfing — the latest body fully engulfs the prior opposite-colour body. */
function engulfing(bars) {
  if (bars.length < 2) return null;
  const prev = bars.at(-2);
  const cur = bars.at(-1);
  const engulfs = Math.max(cur.open, cur.close) >= Math.max(prev.open, prev.close) &&
    Math.min(cur.open, cur.close) <= Math.min(prev.open, prev.close);
  if (!engulfs) return null;
  if (isBull(cur) && isBear(prev)) {
    return { pattern: 'bullish_engulfing', direction: 'bullish', strength: 0.7 };
  }
  if (isBear(cur) && isBull(prev)) {
    return { pattern: 'bearish_engulfing', direction: 'bearish', strength: 0.7 };
  }
  return null;
}

/** Morning/evening star — 3-bar reversals with a small-bodied middle candle. */
function star(bars) {
  if (bars.length < 3) return null;
  const [a, b, c] = bars.slice(-3);
  const smallMiddle = body(b) <= 0.5 * body(a);
  if (isBear(a) && smallMiddle && isBull(c) && c.close > (a.open + a.close) / 2) {
    return { pattern: 'morning_star', direction: 'bullish', strength: 0.75 };
  }
  if (isBull(a) && smallMiddle && isBear(c) && c.close < (a.open + a.close) / 2) {
    return { pattern: 'evening_star', direction: 'bearish', strength: 0.75 };
  }
  return null;
}

const DETECTORS = [doji, hammer, shootingStar, engulfing, star];

/** Run every detector and return the patterns present on the latest bars. */
function detectPatterns(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  return DETECTORS.map((fn) => fn(bars)).filter(Boolean);
}

module.exports = {
  detectPatterns,
  doji,
  hammer,
  shootingStar,
  engulfing,
  star,
};
