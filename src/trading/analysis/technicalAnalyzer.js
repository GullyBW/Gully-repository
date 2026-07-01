'use strict';

const ind = require('./indicators');
const { detectPatterns } = require('./patterns');

/**
 * Turns a raw bar series into a single "technical snapshot" — the latest value
 * of every indicator plus derived context (trend, volatility regime, detected
 * candlestick patterns). Strategies and the REST layer consume this object
 * rather than recomputing indicators themselves.
 *
 * @param {Array<{time,open,high,low,close,volume}>} bars ascending by time
 * @param {object} [opts] indicator period overrides
 */
function analyze(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return { ok: false, reason: 'no_data' };
  }
  const closes = bars.map((b) => b.close);
  const last = (arr) => (arr.length ? arr.at(-1) : null);

  const rsi = ind.rsi(closes, opts.rsiPeriod || 14);
  const macd = ind.macd(closes);
  const bb = ind.bollingerBands(closes, opts.bbPeriod || 20, opts.bbMult || 2);
  const atr = ind.atr(bars, opts.atrPeriod || 14);
  const stoch = ind.stochastic(bars);
  const adx = ind.adx(bars);
  const sma20 = ind.sma(closes, 20);
  const sma50 = ind.sma(closes, 50);
  const ema9 = ind.ema(closes, 9);
  const ema21 = ind.ema(closes, 21);
  const vwap = ind.vwap(bars);
  const obv = ind.obv(bars);
  const price = last(closes);
  const atrVal = last(atr);

  const snapshot = {
    ok: true,
    price,
    bars: bars.length,
    rsi: round(last(rsi)),
    macd: {
      macd: round(last(macd.macd)),
      signal: round(last(macd.signal)),
      histogram: round(last(macd.histogram)),
      cross: ind.crossover(macd.macd, macd.signal),
    },
    bollinger: {
      upper: round(last(bb.upper)),
      middle: round(last(bb.middle)),
      lower: round(last(bb.lower)),
      percentB: round(last(bb.percentB)),
      bandwidth: round(last(bb.bandwidth)),
    },
    atr: round(atrVal),
    atrPct: price && atrVal ? round((atrVal / price) * 100) : null,
    stochastic: { k: round(last(stoch.k)), d: round(last(stoch.d)) },
    adx: { adx: round(last(adx.adx)), plusDI: round(last(adx.plusDI)), minusDI: round(last(adx.minusDI)) },
    movingAverages: {
      sma20: round(last(sma20)),
      sma50: round(last(sma50)),
      ema9: round(last(ema9)),
      ema21: round(last(ema21)),
      goldenCross: ind.crossover(sma20, sma50),
      emaCross: ind.crossover(ema9, ema21),
    },
    vwap: round(last(vwap)),
    obv: last(obv),
    slope: round(ind.linearRegressionSlope(closes, Math.min(20, closes.length))),
    patterns: detectPatterns(bars),
  };

  snapshot.trend = classifyTrend(snapshot);
  snapshot.volatilityRegime = classifyVolatility(snapshot);
  // Series retained (not just latest) for callers that need history, e.g. the
  // strategies that look at crossovers over the last few bars.
  snapshot.series = { rsi, macd, bb, atr, stoch, adx, sma20, sma50, ema9, ema21, vwap, obv };
  return snapshot;
}

function classifyTrend(s) {
  const { adx, movingAverages: ma, price } = s;
  const strong = adx.adx != null && adx.adx >= 25;
  if (ma.sma20 != null && ma.sma50 != null) {
    if (price > ma.sma20 && ma.sma20 > ma.sma50) return strong ? 'strong_uptrend' : 'uptrend';
    if (price < ma.sma20 && ma.sma20 < ma.sma50) return strong ? 'strong_downtrend' : 'downtrend';
  }
  return 'sideways';
}

function classifyVolatility(s) {
  if (s.atrPct == null) return 'unknown';
  if (s.atrPct >= 3) return 'high';
  if (s.atrPct <= 1) return 'low';
  return 'normal';
}

function round(v, dp = 4) {
  if (v == null || Number.isNaN(v)) return null;
  return Number(v.toFixed(dp));
}

module.exports = { analyze };
