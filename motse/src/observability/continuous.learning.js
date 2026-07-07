'use strict';

const { id } = require('../kernel/ids');
const { leastSquaresSlope } = require('./runtime.intelligence');

const NOOP_METRICS = { setGauge() {} };

/**
 * Continuous learning (FINAL Phase 4). Every operational outcome the platform
 * measures should become future knowledge. This service keeps a persisted,
 * time-series KNOWLEDGE BASE of the platform's own measured confidence signals
 * (recommendation trust, forecast accuracy, governance compliance/maturity, data
 * confidence, DR readiness, and the fused operational confidence), and learns
 * from it:
 *
 *   - TRENDS — is each signal improving, stable, or regressing over time?
 *   - a LEARNED FORECAST-CONFIDENCE multiplier — discount the planner's stated
 *     confidence by how accurate its forecasts have actually proven (calibration).
 *   - a LEARNED OPERATIONAL-MATURITY score — rewards a high, improving, and
 *     well-evidenced operational-confidence track record (a platform that has
 *     stayed confident over many observations is more mature than one that just
 *     looked good for a moment).
 *   - the recommendation-confidence model, which the effectiveness tracker already
 *     recalibrates from outcomes — surfaced here as the applied learning.
 *
 * It OBSERVES the executive briefing (a single source of truth for the fused
 * signals) into the knowledge base, and computes the learned model on demand.
 * Additive and read-only over every subsystem; it records knowledge and derives
 * adjustments, it never mutates the systems it learns from. The learned signals
 * are exposed for consumers (and gauges) to apply — the confidence they express
 * is justified by the accumulated evidence, never asserted.
 */
const TREND_FIELDS = ['operational_confidence', 'data_confidence', 'forecast_accuracy', 'recommendation_trust', 'governance_compliance'];

class ContinuousLearning {
  constructor({ platform, store, clock, metrics = null, maxSnapshots = 500, maturitySamples = 20 } = {}) {
    this.platform = platform || {};
    this.snapshots = store ? store.collection('learning_snapshots') : fallbackCollection();
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    this.maxSnapshots = maxSnapshots;
    // Observations before the evidence factor saturates to 1 (a mature memory).
    this.maturitySamples = maturitySamples;
  }

  // ── Knowledge base ─────────────────────────────────────────────────

  /** Capture the current measured evidence into the persisted knowledge base. */
  observe() {
    const s = this._sample();
    const row = this.snapshots.insert({ id: id('lrn'), ...s });
    // Bound the memory: drop the oldest observations past the cap.
    const all = this.snapshots.find().sort((a, b) => a.at_ms - b.at_ms);
    for (let i = 0; i < all.length - this.maxSnapshots; i += 1) this.snapshots.delete(all[i].id);
    this.metrics.setGauge('motse_learning_samples', {}, this.snapshots.find().length);
    return row;
  }

  /** One evidence sample, read from the executive briefing (single source). */
  _sample() {
    const at = this.clock.nowIso();
    const at_ms = this.clock.nowMs();
    const exec = this.platform.executive ? this.platform.executive.report() : null;
    if (!exec) {
      return { at, at_ms, operational_confidence: null, data_confidence: null, forecast_accuracy: null,
        recommendation_trust: null, recommendation_precision: null, governance_compliance: null,
        governance_maturity: null, dr_recovery_confidence: null };
    }
    const d = exec.domains;
    return {
      at, at_ms,
      operational_confidence: exec.operational_confidence,
      data_confidence: d.business_validation.data_confidence,
      forecast_accuracy: d.forecast_accuracy.overall_accuracy,
      recommendation_trust: d.recommendation_quality.operator_trust_score,
      recommendation_precision: d.recommendation_quality.precision,
      governance_compliance: d.governance.compliance_score,
      governance_maturity: d.governance.operational_maturity_score,
      dr_recovery_confidence: d.disaster_recovery.recovery_confidence,
    };
  }

  /** The raw knowledge base (admin/inspection), oldest first. */
  knowledge() { return this.snapshots.find().sort((a, b) => a.at_ms - b.at_ms); }

  // ── Learning ───────────────────────────────────────────────────────

  /** Per-signal trend (slope + direction) over the knowledge base. */
  trends() {
    const snaps = this.knowledge();
    const out = {};
    for (const field of TREND_FIELDS) out[field] = trendOf(snaps, field);
    return out;
  }

  /**
   * Learned forecast confidence: discount a prior confidence by how accurate the
   * planner's forecasts have actually proven (measured/stated, never inflated).
   */
  learnedForecastConfidence(priorConfidence) {
    const m = this._forecastMultiplier();
    if (m == null || priorConfidence == null) return priorConfidence;
    return round(priorConfidence * m);
  }

  _forecastMultiplier() {
    if (!this.platform.forecastAccuracy) return null;
    const rows = this.platform.forecastAccuracy.report().calibration.rows;
    if (!rows.length) return null;
    const stated = mean(rows.map((r) => r.stated_confidence));
    const measured = mean(rows.map((r) => r.measured_accuracy));
    if (!stated) return null;
    return clamp01(measured / stated); // only discount over-confidence, never inflate
  }

  /**
   * Learned operational maturity: rewards a high, improving, well-evidenced
   * operational-confidence track record. A momentary high confidence on a thin
   * memory is NOT maturity — evidence volume gates the score.
   */
  _learnedMaturity(snaps) {
    const ocs = snaps.map((s) => s.operational_confidence).filter((v) => v != null);
    if (!ocs.length) return { score: null, base_confidence: null, evidence_factor: 0, trend: 'unknown', samples: 0 };
    const base = mean(ocs.slice(-5)); // recent confidence level
    const evidenceFactor = clamp01(ocs.length / this.maturitySamples);
    const slope = ocs.length >= 3 ? leastSquaresSlope(ocs.map((v, i) => [i, v])) : 0;
    const trendBonus = clamp(slope * 5, -0.1, 0.1); // reward improvement, penalise regression
    // Maturity blends the confidence level (evidence-weighted) with the trend.
    const score = clamp01(base * (0.6 + 0.4 * evidenceFactor) + trendBonus);
    return { score: round(score), base_confidence: round(base), evidence_factor: round(evidenceFactor), trend: direction(slope), samples: ocs.length };
  }

  /** The full learning report: trends + learned model + knowledge stats. */
  learn() {
    const snaps = this.knowledge();
    const trends = this.trends();
    const maturity = this._learnedMaturity(snaps);
    const multiplier = this._forecastMultiplier();
    const forecastConfidence = {
      multiplier: multiplier == null ? null : round(multiplier),
      example_prior: 0.8,
      example_adjusted: this.learnedForecastConfidence(0.8),
      note: 'discounts the planner\'s stated confidence by measured backtest accuracy (never inflates)',
      source: 'forecast.accuracy.report().calibration',
    };
    const recommendationModel = this.platform.recommendationEffectiveness
      ? this.platform.recommendationEffectiveness.recalibration().signals
      : [];
    const evidenceFactor = maturity.evidence_factor;

    if (maturity.score != null) this.metrics.setGauge('motse_learning_operational_maturity', {}, maturity.score);
    if (multiplier != null) this.metrics.setGauge('motse_learning_forecast_confidence', {}, round(multiplier));
    this.metrics.setGauge('motse_learning_confidence', {}, round(evidenceFactor));
    this.metrics.setGauge('motse_learning_samples', {}, snaps.length);

    const window = snaps.length ? snaps[snaps.length - 1].at_ms - snaps[0].at_ms : 0;
    return {
      at: this.clock.nowIso(),
      samples: snaps.length,
      window_ms: window,
      learning_confidence: round(evidenceFactor),
      improving: trends.operational_confidence.direction,
      learned_operational_maturity: maturity,
      learned_forecast_confidence: forecastConfidence,
      recommendation_confidence_model: recommendationModel,
      trends,
      sources: {
        knowledge_base: 'learning_snapshots (observed executive briefings)',
        recommendation_confidence: 'recommendation.effectiveness.recalibration',
        forecast_confidence: 'forecast.accuracy calibration',
      },
    };
  }
}

/** Trend of a nullable field across snapshots: slope + a plain-language direction. */
function trendOf(snaps, field) {
  const pts = [];
  for (const s of snaps) if (s[field] != null) pts.push(s[field]);
  if (pts.length < 3) return { direction: 'insufficient_data', slope: 0, samples: pts.length, latest: pts.length ? round(pts[pts.length - 1]) : null };
  const slope = leastSquaresSlope(pts.map((v, i) => [i, v]));
  return { direction: direction(slope), slope: round(slope), samples: pts.length, latest: round(pts[pts.length - 1]) };
}

const EPS = 1e-4;
function direction(slope) { return slope > EPS ? 'improving' : slope < -EPS ? 'regressing' : 'stable'; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clamp01(v) { return clamp(v, 0, 1); }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function round(n) { return Math.round(Number(n) * 10000) / 10000; }

/** Minimal in-memory collection so the module runs without a Store (tests). */
function fallbackCollection() {
  const rows = new Map();
  return {
    insert(row) { rows.set(row.id, { ...row }); return { ...row }; },
    delete(id2) { return rows.delete(id2); },
    find(pred = () => true) { return [...rows.values()].filter(pred).map((r) => ({ ...r })); },
  };
}

module.exports = { ContinuousLearning, TREND_FIELDS };
