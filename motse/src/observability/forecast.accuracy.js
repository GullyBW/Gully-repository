'use strict';

const { leastSquaresSlope } = require('./runtime.intelligence');

const NOOP_METRICS = { setGauge() {} };

/**
 * Forecast accuracy validation (Phase 2). The capacity planner PREDICTS growth;
 * this validates whether those predictions are correct — the honest way to do
 * that without waiting months is BACKTESTING: fit the model on the first part
 * of the recorded history, predict the rest, and compare predictions to the
 * actual observed values.
 *
 * For each tracked field it computes forecast error (MAPE), an accuracy
 * percentage, trend-direction agreement, model stability (variance of the
 * slope across sub-windows) and drift, plus a confidence-vs-accuracy
 * CALIBRATION check. Infrastructure recommendations are gated on accuracy +
 * confidence, so the platform only advises expansion when its own forecasts
 * have proven trustworthy.
 *
 * Read-only over the capacity planner's history; it computes, changes nothing.
 */
const FIELDS = ['heap_used_bytes', 'rss_bytes', 'outbox_pending', 'store_rows'];

class ForecastAccuracy {
  constructor({ planner, metrics = null, clock, minSamples = 10, accuracyThreshold = 0.8 } = {}) {
    this.planner = planner;
    this.metrics = metrics || NOOP_METRICS;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.minSamples = minSamples;
    this.accuracyThreshold = accuracyThreshold;
  }

  /**
   * Hold-out backtest of one field: train on the first `splitRatio` of history,
   * predict each later point, compare to actual.
   */
  backtest(field, { splitRatio = 0.6 } = {}) {
    const history = this.planner.history;
    const n = history.length;
    if (n < this.minSamples) return { field, insufficient_data: true, samples: n };
    const splitIdx = Math.max(2, Math.floor(n * splitRatio));
    const train = history.slice(0, splitIdx);
    const test = history.slice(splitIdx);
    if (test.length < 2) return { field, insufficient_data: true, samples: n };

    // Fit slope + intercept on the training window (index-based, like the planner).
    const trainPts = train.map((h, i) => [i, num(h[field])]);
    const slope = leastSquaresSlope(trainPts);
    const meanX = (train.length - 1) / 2;
    const meanY = mean(trainPts.map((p) => p[1]));
    const intercept = meanY - slope * meanX;

    // Predict each test point and measure error.
    const errors = [];
    let predictedDir = 0;
    let actualDir = 0;
    const firstActual = num(test[0][field]);
    const lastActual = num(test[test.length - 1][field]);
    actualDir = Math.sign(lastActual - firstActual);
    test.forEach((h, j) => {
      const x = splitIdx + j;
      const predicted = slope * x + intercept;
      const actual = num(h[field]);
      const denom = Math.abs(actual) > 1 ? Math.abs(actual) : 1;
      errors.push(Math.abs(predicted - actual) / denom);
    });
    const predLast = slope * (n - 1) + intercept;
    predictedDir = Math.sign(predLast - firstActual);
    const mape = mean(errors); // mean absolute percentage error (fractional)
    const accuracy = Math.max(0, 1 - mape);

    return {
      field,
      samples: n,
      train_size: train.length,
      test_size: test.length,
      mape: round(mape),
      accuracy: round(accuracy),
      accuracy_pct: round(accuracy * 100),
      trend_direction_correct: predictedDir === actualDir || actualDir === 0,
      trustworthy: accuracy >= this.accuracyThreshold,
    };
  }

  /**
   * Model stability: variance of the fitted slope across rolling sub-windows —
   * a stable model has a consistent slope; a drifting one does not.
   */
  stability(field, { windows = 3 } = {}) {
    const history = this.planner.history;
    if (history.length < this.minSamples) return { field, insufficient_data: true };
    const size = Math.floor(history.length / windows);
    const slopes = [];
    for (let w = 0; w < windows; w += 1) {
      const seg = history.slice(w * size, (w + 1) * size);
      if (seg.length >= 2) slopes.push(leastSquaresSlope(seg.map((h, i) => [i, num(h[field])])));
    }
    const m = mean(slopes);
    const variance = mean(slopes.map((s) => (s - m) ** 2));
    const drift = slopes.length >= 2 ? slopes[slopes.length - 1] - slopes[0] : 0;
    // Normalize stability to 0..1 (low relative variance → high stability).
    const relVar = Math.abs(m) > 1e-9 ? Math.sqrt(variance) / Math.abs(m) : (variance === 0 ? 0 : 1);
    return {
      field, slopes: slopes.map(round), mean_slope: round(m),
      drift: round(drift), stability_score: round(Math.max(0, 1 - Math.min(1, relVar))),
    };
  }

  /**
   * Full accuracy report across the tracked fields, plus a confidence-vs-
   * accuracy CALIBRATION check against the planner's own confidence.
   */
  report({ splitRatio = 0.6 } = {}) {
    const fields = {};
    const accuracies = [];
    for (const field of FIELDS) {
      const bt = this.backtest(field, { splitRatio });
      const st = this.stability(field);
      fields[field] = { ...bt, stability: st };
      if (!bt.insufficient_data) accuracies.push(bt.accuracy);
    }
    const overall = accuracies.length ? mean(accuracies) : null;
    // Calibration: does the planner's stated confidence track measured accuracy?
    const forecast = this.planner.forecast ? this.planner.forecast() : { projections: {} };
    const calibration = this._calibration(fields, forecast);
    if (overall != null) this.metrics.setGauge('motse_forecast_accuracy', {}, round(overall));
    return {
      at: this.clock.nowIso(),
      overall_accuracy: overall != null ? round(overall) : null,
      overall_accuracy_pct: overall != null ? round(overall * 100) : null,
      fields,
      calibration,
      recommendation_gate: {
        threshold: this.accuracyThreshold,
        trustworthy: overall != null && overall >= this.accuracyThreshold,
        note: 'infrastructure expansion is advised only when overall accuracy clears the threshold',
      },
    };
  }

  /** Is the planner's confidence well-calibrated against measured accuracy? */
  _calibration(fields, forecast) {
    const rows = [];
    for (const [field, bt] of Object.entries(fields)) {
      if (bt.insufficient_data) continue;
      const proj = projectionFor(forecast, field);
      const statedConfidence = proj && proj.confidence ? proj.confidence.score : null;
      if (statedConfidence != null) {
        rows.push({ field, stated_confidence: statedConfidence, measured_accuracy: bt.accuracy, gap: round(Math.abs(statedConfidence - bt.accuracy)) });
      }
    }
    const avgGap = rows.length ? mean(rows.map((r) => r.gap)) : null;
    return {
      rows,
      avg_gap: avgGap != null ? round(avgGap) : null,
      well_calibrated: avgGap != null ? avgGap < 0.2 : null, // stated within 0.2 of measured
    };
  }
}

function projectionFor(forecast, field) {
  const map = {
    heap_used_bytes: 'heap', rss_bytes: 'rss', outbox_pending: 'outbox_backlog', store_rows: 'store_rows',
  };
  return forecast.projections ? forecast.projections[map[field]] : null;
}

function num(v) { return Number(v) || 0; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function round(n) { return Math.round(Number(n) * 10000) / 10000; }

module.exports = { ForecastAccuracy, FIELDS };
