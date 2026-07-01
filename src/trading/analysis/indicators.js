'use strict';

/**
 * Technical-analysis primitives. Every function is pure and works on plain
 * arrays so the whole library is trivially unit-testable and reusable by the
 * backtester, the live engine and the REST layer alike.
 *
 * Convention: outputs are aligned to the input length. Positions that do not
 * yet have enough history to be defined are `null`, so `series.at(-1)` is
 * always "the latest value or null" and indicators line up index-for-index
 * with the bars they were computed from.
 *
 * A "bar" is `{ time, open, high, low, close, volume }`.
 */

/** Population standard deviation of a numeric window. */
function stddev(values) {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/** Simple Moving Average. */
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential Moving Average, seeded with the SMA of the first `period` points. */
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed at index period-1 with the SMA of the opening window.
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Rate of change (%) over `period` bars. */
function roc(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i += 1) {
    const base = values[i - period];
    if (base !== 0) out[i] = ((values[i] - base) / base) * 100;
  }
  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing. Returns values in [0, 100];
 * `null` until `period` changes are available.
 */
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD: the classic 12/26/9 trend-momentum oscillator.
 * @returns {{ macd: number[], signal: number[], histogram: number[] }}
 */
function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine = values.map((_, i) =>
    fastEma[i] != null && slowEma[i] != null ? fastEma[i] - slowEma[i] : null
  );

  // Signal line = EMA of the defined portion of the MACD line.
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal = new Array(values.length).fill(null);
  const histogram = new Array(values.length).fill(null);
  if (firstIdx !== -1) {
    const compact = macdLine.slice(firstIdx).map((v) => v ?? 0);
    const sig = ema(compact, signalPeriod);
    for (let i = 0; i < sig.length; i += 1) {
      const idx = firstIdx + i;
      if (sig[i] != null) {
        signal[idx] = sig[i];
        histogram[idx] = macdLine[idx] - sig[i];
      }
    }
  }
  return { macd: macdLine, signal, histogram };
}

/**
 * Bollinger Bands (SMA ± mult·σ). Returns middle/upper/lower plus %B and the
 * band width, both handy as standalone signals.
 */
function bollingerBands(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const percentB = new Array(values.length).fill(null);
  const bandwidth = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const window = values.slice(i - period + 1, i + 1);
    const sd = stddev(window);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
    const range = upper[i] - lower[i];
    percentB[i] = range === 0 ? 0.5 : (values[i] - lower[i]) / range;
    bandwidth[i] = middle[i] === 0 ? 0 : range / middle[i];
  }
  return { middle, upper, lower, percentB, bandwidth };
}

/** True Range series for a set of bars. */
function trueRange(bars) {
  return bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
  });
}

/** Average True Range (Wilder). Measures volatility for stop/size decisions. */
function atr(bars, period = 14) {
  const tr = trueRange(bars);
  const out = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i += 1) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Stochastic oscillator. %K is where price sits in its recent high/low range;
 * %D smooths it.
 */
function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  const k = new Array(bars.length).fill(null);
  for (let i = kPeriod - 1; i < bars.length; i += 1) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j += 1) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    const range = hh - ll;
    k[i] = range === 0 ? 50 : ((bars[i].close - ll) / range) * 100;
  }
  const kDefined = k.map((v) => (v == null ? 0 : v));
  const dRaw = sma(kDefined, dPeriod);
  const d = k.map((v, i) => (v == null ? null : dRaw[i]));
  return { k, d };
}

/** On-Balance Volume: cumulative volume flow confirming price moves. */
function obv(bars) {
  const out = new Array(bars.length).fill(null);
  if (bars.length === 0) return out;
  let running = 0;
  out[0] = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].close > bars[i - 1].close) running += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) running -= bars[i].volume;
    out[i] = running;
  }
  return out;
}

/** Session Volume-Weighted Average Price (cumulative over the supplied bars). */
function vwap(bars) {
  const out = new Array(bars.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const typical = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += typical * bars[i].volume;
    cumV += bars[i].volume;
    out[i] = cumV === 0 ? typical : cumPV / cumV;
  }
  return out;
}

/**
 * Average Directional Index (+DI / -DI / ADX), Wilder-smoothed. ADX gauges
 * trend *strength* (not direction); the DIs give direction.
 */
function adx(bars, period = 14) {
  const len = bars.length;
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const adxOut = new Array(len).fill(null);
  if (len <= period * 2) return { plusDI, minusDI, adx: adxOut };

  const tr = trueRange(bars);
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  for (let i = 1; i < len; i += 1) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  // Wilder-smoothed sums seeded over the first `period` bars (index 1..period).
  let trS = 0;
  let plusS = 0;
  let minusS = 0;
  for (let i = 1; i <= period; i += 1) {
    trS += tr[i];
    plusS += plusDM[i];
    minusS += minusDM[i];
  }
  const dx = new Array(len).fill(null);
  const computeDX = (idx) => {
    const pdi = trS === 0 ? 0 : (plusS / trS) * 100;
    const mdi = trS === 0 ? 0 : (minusS / trS) * 100;
    plusDI[idx] = pdi;
    minusDI[idx] = mdi;
    const sum = pdi + mdi;
    dx[idx] = sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100;
  };
  computeDX(period);
  for (let i = period + 1; i < len; i += 1) {
    trS = trS - trS / period + tr[i];
    plusS = plusS - plusS / period + plusDM[i];
    minusS = minusS - minusS / period + minusDM[i];
    computeDX(i);
  }

  // ADX = Wilder average of DX, first value at index period*2.
  let adxSum = 0;
  for (let i = period; i < period * 2; i += 1) adxSum += dx[i];
  let adxVal = adxSum / period;
  adxOut[period * 2 - 1] = adxVal;
  for (let i = period * 2; i < len; i += 1) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    adxOut[i] = adxVal;
  }
  return { plusDI, minusDI, adx: adxOut };
}

/** Ordinary-least-squares slope of the last `period` points (per-bar drift). */
function linearRegressionSlope(values, period) {
  if (values.length < period) return null;
  const window = values.slice(values.length - period);
  const n = window.length;
  const xMean = (n - 1) / 2;
  const yMean = window.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * (window[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Detect a crossover between two aligned series on the most recent bar.
 * @returns {'bullish'|'bearish'|null} bullish when `a` crosses above `b`.
 */
function crossover(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const a0 = a[n - 2];
  const a1 = a[n - 1];
  const b0 = b[n - 2];
  const b1 = b[n - 1];
  if ([a0, a1, b0, b1].some((v) => v == null)) return null;
  if (a0 <= b0 && a1 > b1) return 'bullish';
  if (a0 >= b0 && a1 < b1) return 'bearish';
  return null;
}

module.exports = {
  stddev,
  sma,
  ema,
  roc,
  rsi,
  macd,
  bollingerBands,
  trueRange,
  atr,
  stochastic,
  obv,
  vwap,
  adx,
  linearRegressionSlope,
  crossover,
};
