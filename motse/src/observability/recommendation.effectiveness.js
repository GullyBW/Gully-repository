'use strict';

const { id } = require('../kernel/ids');

const NOOP_METRICS = { setGauge() {} };

/**
 * Recommendation effectiveness (FINAL Phase 2). The platform already GENERATES
 * recommendations (operational intelligence, governance analytics), but a
 * recommendation is only worth anything if it is CORRECT and ACTED ON. This
 * treats every recommendation as a measurable product with a lifecycle:
 *
 *   generated → accepted | rejected | ignored | overridden → resolved(outcome)
 *
 * and records real incidents that NO recommendation caught (false negatives).
 * From that history it computes the metrics that tell you whether the advisor
 * is trustworthy — precision, recall, usefulness, an operator-trust score and a
 * simple ROI — and, crucially, RECALIBRATES the confidence of future
 * recommendations from the measured track record of each signal (shrinkage
 * toward the stated confidence, pulled toward the observed hit-rate as evidence
 * accumulates — so confidence becomes statistically justified, not asserted).
 *
 * State is persisted in the platform Store (`recommendation_ledger`), so it is
 * durable and inspectable. Additive and side-effect-free with respect to the
 * advisors: it observes their output and operators' responses; it never changes
 * what they recommend.
 */
class RecommendationEffectiveness {
  constructor({ store, metrics = null, clock, priorWeight = 3, skipSignals = ['healthy'] } = {}) {
    this.recs = store ? store.collection('recommendation_ledger') : fallbackCollection();
    this.metrics = metrics || NOOP_METRICS;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    // Smoothing constant for confidence recalibration: how many resolved
    // samples it takes for observed hit-rate to weigh as much as the prior.
    this.priorWeight = priorWeight;
    this.skipSignals = new Set(skipSignals);
  }

  // ── Lifecycle: generation ──────────────────────────────────────────

  /**
   * Record a batch of recommendations as GENERATED. A still-open recommendation
   * with the same fingerprint (source+signal by default) is NOT re-counted —
   * one standing recommendation is one product, not one-per-cycle.
   */
  ingest(source, recommendations = [], { at } = {}) {
    const out = [];
    for (const rec of recommendations) {
      if (this.skipSignals.has(rec.signal)) continue;
      out.push(this.record({
        source,
        signal: rec.signal,
        urgency: rec.urgency,
        confidence: rec.confidence,
        fingerprint: rec.fingerprint || `${source}:${rec.signal}`,
        at,
      }));
    }
    return out;
  }

  /** Record a single recommendation as generated (deduped on open fingerprint). */
  record({ source, signal, urgency = 'medium', confidence = null, fingerprint, at } = {}) {
    const fp = fingerprint || `${source}:${signal}`;
    const open = this.recs.findOne((r) => r.fingerprint === fp && r.kind === 'recommendation' && !r.resolved_at);
    if (open) return open;
    return this.recs.insert({
      id: id('rec'),
      kind: 'recommendation',
      source: source || 'unknown',
      signal,
      urgency,
      stated_confidence: confidence,
      fingerprint: fp,
      status: 'generated',
      responded_by: null,
      reject_reason: null,
      note: null,
      outcome: null,
      incident_prevented: false,
      financial_exposure_minor: 0,
      generated_at: at || this.clock.nowIso(),
      responded_at: null,
      resolved_at: null,
    });
  }

  /** Convenience: pull live recommendations off the platform's own advisors. */
  ingestFromPlatform(platform, { at } = {}) {
    const results = [];
    if (platform.opsIntel) {
      results.push(...this.ingest('operational_intelligence', platform.opsIntel.advise().recommendations, { at }));
    }
    if (platform.governanceAnalytics) {
      results.push(...this.ingest('governance_analytics', platform.governanceAnalytics.recommend().recommendations, { at }));
    }
    return results;
  }

  // ── Lifecycle: operator response ───────────────────────────────────

  accept(recId, by = null) { return this._respond(recId, 'accepted', { by }); }
  reject(recId, by = null, reason = null) { return this._respond(recId, 'rejected', { by, reason }); }
  ignore(recId) { return this._respond(recId, 'ignored', {}); }
  override(recId, by = null, note = null) { return this._respond(recId, 'overridden', { by, note }); }

  _respond(recId, status, { by = null, reason = null, note = null }) {
    const rec = this._must(recId);
    return this.recs.update(recId, {
      status,
      responded_by: by,
      reject_reason: reason,
      note: note || rec.note,
      responded_at: this.clock.nowIso(),
    });
  }

  // ── Lifecycle: outcome ─────────────────────────────────────────────

  /**
   * Resolve a recommendation with its measured outcome. `success` = the signal
   * was real and acting on it helped (a true positive); `false_positive` = it
   * was raised but was not a real problem. `incident_prevented` credits a
   * concrete incident that acting on the recommendation avoided.
   */
  resolve(recId, { success = null, false_positive = false, incident_prevented = false, financial_exposure_minor = 0, note = null } = {}) {
    const rec = this._must(recId);
    // Explicit resolution: a false positive wins; otherwise success===false is a
    // genuine failure (acted on, did not help), anything else is a success.
    const resolved = false_positive ? 'false_positive' : (success === false ? 'failure' : 'success');
    return this.recs.update(recId, {
      outcome: resolved,
      incident_prevented: !!incident_prevented,
      financial_exposure_minor: financial_exposure_minor || rec.financial_exposure_minor,
      note: note || rec.note,
      resolved_at: this.clock.nowIso(),
    });
  }

  /**
   * Record a real problem that NO recommendation caught — a false negative.
   * This is what makes RECALL measurable: without it we would only ever see the
   * problems the advisor did flag.
   */
  recordMiss({ signal, note = null, financial_exposure_minor = 0 } = {}) {
    return this.recs.insert({
      id: id('rec'),
      kind: 'miss',
      source: 'incident',
      signal: signal || 'unflagged_incident',
      urgency: 'high',
      stated_confidence: null,
      fingerprint: `miss:${signal || 'unflagged_incident'}:${id('m')}`,
      status: 'missed',
      responded_by: null,
      reject_reason: null,
      note,
      outcome: 'false_negative',
      incident_prevented: false,
      financial_exposure_minor,
      generated_at: this.clock.nowIso(),
      responded_at: null,
      resolved_at: this.clock.nowIso(),
    });
  }

  // ── Scoring ────────────────────────────────────────────────────────

  /** The full effectiveness report: counts, precision/recall, trust, ROI. */
  effectiveness() {
    const all = this.recs.find();
    const recs = all.filter((r) => r.kind === 'recommendation');
    const misses = all.filter((r) => r.kind === 'miss');

    const generated = recs.length;
    const byStatus = tally(recs, (r) => r.status);
    const accepted = byStatus.accepted || 0;
    const rejected = byStatus.rejected || 0;
    const ignored = byStatus.ignored || 0;
    const overridden = byStatus.overridden || 0;
    const pending = byStatus.generated || 0;
    const decided = accepted + rejected + ignored + overridden;

    const resolved = recs.filter((r) => r.outcome);
    const successes = resolved.filter((r) => r.outcome === 'success');
    const falsePositives = resolved.filter((r) => r.outcome === 'false_positive');
    const failures = resolved.filter((r) => r.outcome === 'failure');
    const tp = successes.length;
    const fp = falsePositives.length;
    const fn = misses.length;
    const incidentsPrevented = successes.filter((r) => r.incident_prevented).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = tp + fn > 0 ? tp / (tp + fn) : null;
    const acceptanceRate = decided > 0 ? accepted / decided : null;
    // Usefulness: when operators accepted a recommendation, how often did it
    // actually help? (successes among accepted-and-resolved).
    const acceptedResolved = resolved.filter((r) => r.status === 'accepted' || r.status === 'overridden');
    const acceptedSuccess = acceptedResolved.filter((r) => r.outcome === 'success').length;
    const usefulness = acceptedResolved.length > 0 ? acceptedSuccess / acceptedResolved.length : null;
    // Operator trust blends "do operators act on it" with "is it right".
    const trust = blendTrust(acceptanceRate, precision);

    if (precision != null) this.metrics.setGauge('motse_recommendation_precision', {}, round(precision));
    if (recall != null) this.metrics.setGauge('motse_recommendation_recall', {}, round(recall));
    if (trust != null) this.metrics.setGauge('motse_recommendation_trust_score', {}, round(trust));
    this.metrics.setGauge('motse_recommendation_generated', {}, generated);
    this.metrics.setGauge('motse_recommendation_incidents_prevented', {}, incidentsPrevented);

    return {
      at: this.clock.nowIso(),
      generated,
      lifecycle: { pending, accepted, rejected, ignored, overridden, decided },
      outcomes: {
        resolved: resolved.length,
        successes: tp,
        false_positives: fp,
        failures: failures.length,
        false_negatives: fn,
        incidents_prevented: incidentsPrevented,
      },
      precision: nn(precision),
      recall: nn(recall),
      acceptance_rate: nn(acceptanceRate),
      usefulness: nn(usefulness),
      operator_trust_score: nn(trust),
      roi: this._roi({ incidentsPrevented, fp, rejected, ignored, accepted, resolved }),
      by_signal: this.recalibration().signals,
    };
  }

  /**
   * ROI, expressed only from evidence we hold: value = incidents prevented;
   * cost = false alarms and reviews that went nowhere. No fabricated currency.
   */
  _roi({ incidentsPrevented, fp, rejected, ignored, accepted, resolved }) {
    const wastedReviews = fp + rejected + ignored;
    const exposurePrevented = resolved
      .filter((r) => r.outcome === 'success' && r.incident_prevented)
      .reduce((s, r) => s + (r.financial_exposure_minor || 0), 0);
    return {
      incidents_prevented: incidentsPrevented,
      financial_exposure_prevented_minor: exposurePrevented,
      false_alarms: fp,
      wasted_reviews: wastedReviews,
      prevention_yield: accepted > 0 ? round(incidentsPrevented / accepted) : null,
      net_signal: incidentsPrevented - fp,
      note: 'value = incidents (and exposure) prevented by accepted recommendations; cost = false alarms + reviews that led nowhere',
    };
  }

  // ── Confidence recalibration ───────────────────────────────────────

  /**
   * Per-signal recalibration: for each signal, the observed hit-rate (precision)
   * and a confidence recalibrated by shrinking the stated confidence toward that
   * hit-rate as resolved evidence accumulates.
   */
  recalibration() {
    const bySignal = new Map();
    for (const r of this.recs.find((x) => x.kind === 'recommendation')) {
      if (!bySignal.has(r.signal)) bySignal.set(r.signal, []);
      bySignal.get(r.signal).push(r);
    }
    const signals = [];
    for (const [signal, rows] of bySignal) {
      const resolved = rows.filter((r) => r.outcome);
      const tp = resolved.filter((r) => r.outcome === 'success').length;
      const fp = resolved.filter((r) => r.outcome === 'false_positive').length;
      const observed = tp + fp > 0 ? tp / (tp + fp) : null;
      const stated = meanOrNull(rows.map((r) => r.stated_confidence).filter((c) => c != null));
      const calibrated = this._shrink(stated, observed, tp + fp);
      signals.push({
        signal,
        generated: rows.length,
        resolved: resolved.length,
        observed_hit_rate: nn(observed),
        mean_stated_confidence: nn(stated),
        calibrated_confidence: nn(calibrated),
        adjustment: stated != null && calibrated != null ? round(calibrated - stated) : null,
      });
    }
    signals.sort((a, b) => b.generated - a.generated);
    return { at: this.clock.nowIso(), signals };
  }

  /**
   * Confidence recalibrated for a NEW recommendation of `signal`, given the
   * caller's prior (stated) confidence and this signal's measured track record.
   * Statistically: shrinkage toward the prior, weight `priorWeight` samples.
   */
  calibratedConfidence(signal, priorConfidence) {
    const rows = this.recs.find((r) => r.kind === 'recommendation' && r.signal === signal && r.outcome);
    const tp = rows.filter((r) => r.outcome === 'success').length;
    const fp = rows.filter((r) => r.outcome === 'false_positive').length;
    const observed = tp + fp > 0 ? tp / (tp + fp) : null;
    const calibrated = this._shrink(priorConfidence, observed, tp + fp);
    return calibrated == null ? priorConfidence : round(calibrated);
  }

  _shrink(prior, observed, n) {
    if (observed == null) return prior; // no evidence yet → keep the prior
    if (prior == null) return observed; // no prior → trust the evidence
    const k = this.priorWeight;
    return (prior * k + observed * n) / (k + n);
  }

  /** Read the underlying lifecycle records (admin/inspection). */
  ledger() { return this.recs.find(); }

  _must(recId) {
    const rec = this.recs.get(recId);
    if (!rec) throw new Error(`recommendation_ledger: no record ${recId}`);
    return rec;
  }
}

function tally(rows, keyFn) {
  const out = {};
  for (const r of rows) { const k = keyFn(r); out[k] = (out[k] || 0) + 1; }
  return out;
}
function blendTrust(acceptanceRate, precision) {
  if (acceptanceRate == null && precision == null) return null;
  if (acceptanceRate == null) return precision;
  if (precision == null) return acceptanceRate;
  return 0.5 * acceptanceRate + 0.5 * precision;
}
function meanOrNull(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function nn(v) { return v == null ? null : round(v); }
function round(n) { return Math.round(Number(n) * 10000) / 10000; }

/** Minimal in-memory collection so the module runs without a Store (tests). */
function fallbackCollection() {
  const rows = new Map();
  return {
    insert(row) { rows.set(row.id, { ...row }); return { ...row }; },
    get(id2) { const r = rows.get(id2); return r ? { ...r } : null; },
    update(id2, patch) { const r = rows.get(id2); const next = { ...r, ...patch }; rows.set(id2, next); return { ...next }; },
    find(pred = () => true) { return [...rows.values()].filter(pred).map((r) => ({ ...r })); },
    findOne(pred) { const hit = [...rows.values()].find(pred); return hit ? { ...hit } : null; },
  };
}

module.exports = { RecommendationEffectiveness };
