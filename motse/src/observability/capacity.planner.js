'use strict';

const { leastSquaresSlope } = require('./runtime.intelligence');

/**
 * Predictive capacity planning (Mission 9). Consumes runtime-intelligence
 * samples plus event-platform and store growth to forecast resource
 * exhaustion and scaling needs — evidence-based (measured trend), never a
 * static threshold. Keeps its own coarse history ring (sampled on a cadence)
 * so growth is measured over a long horizon independent of the fine-grained
 * runtime buffer.
 *
 * Every forecast carries a CONFIDENCE (from the fit quality R² and sample
 * count) and its ASSUMPTIONS (linear trend, current workload mix), because a
 * projection without stated uncertainty is a guess, not a plan.
 *
 * Additive: `record()` is called on a cadence (health cycle / timer); nothing
 * samples on its own until asked.
 */
class CapacityPlanner {
  constructor({ clock, platform = null, historySize = 2000 } = {}) {
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.platform = platform;
    this.historySize = historySize;
    this.history = []; // coarse growth samples
  }

  /** Snapshot the current resource counters into the growth history. */
  record() {
    const p = this.platform;
    const rt = p && p.runtime && p.runtime.samples.length ? p.runtime.samples[p.runtime.samples.length - 1] : {};
    const outbox = p && p.outbox ? p.outbox.stats() : {};
    const storeRows = p && p.store ? [...p.store.collections.values()].reduce((n, c) => n + c.rows.size, 0) : 0;
    const s = {
      at_ms: this.clock.nowMs(),
      at: this.clock.nowIso(),
      heap_used_bytes: rt.heap_used_bytes || 0,
      heap_limit_bytes: rt.heap_limit_bytes || 0,
      rss_bytes: rt.rss_bytes || 0,
      event_loop_utilization: rt.event_loop_utilization || 0,
      outbox_pending: outbox.pending || 0,
      outbox_total: outbox.total || 0,
      archive_rows: outbox.archived || 0,
      store_rows: storeRows,
    };
    this.history.push(s);
    if (this.history.length > this.historySize) this.history.shift();
    return s;
  }

  /**
   * Project a metric to a limit using the measured per-ms slope.
   * Returns { current, slope_per_day, forecast{30,90,180,365}, time_to_limit_days, confidence, assumptions }.
   */
  project(field, { limitField = null, limitValue = null, capacityLabel = 'limit' } = {}) {
    const pts = this.history.map((h, i) => [i, h[field]]);
    const n = pts.length;
    if (n < 3) return { field, insufficient_data: true, samples: n };
    const slopePerSample = leastSquaresSlope(pts);
    const spanMs = this.history[n - 1].at_ms - this.history[0].at_ms || 1;
    const msPerSample = spanMs / (n - 1);
    const slopePerMs = msPerSample > 0 ? slopePerSample / msPerSample : 0;
    const perDay = slopePerMs * 86400000;
    const current = this.history[n - 1][field];
    const limit = limitValue != null ? limitValue : (limitField ? this.history[n - 1][limitField] : null);
    const forecast = {
      '30d': current + perDay * 30,
      '90d': current + perDay * 90,
      '180d': current + perDay * 180,
      '365d': current + perDay * 365,
    };
    let timeToLimitDays = null;
    if (limit != null && perDay > 0 && current < limit) timeToLimitDays = round((limit - current) / perDay);
    else if (limit != null && current >= limit) timeToLimitDays = 0;
    return {
      field,
      current,
      limit,
      capacity_label: capacityLabel,
      slope_per_day: round(perDay),
      forecast: mapVals(forecast, round),
      time_to_limit_days: timeToLimitDays,
      confidence: confidence(pts, n),
      assumptions: ['linear trend over the observed window', 'current workload mix persists'],
    };
  }

  /**
   * A full capacity report: memory, storage, backlog, plus autoscaling
   * recommendations derived from observed workload trend (not static rules).
   */
  forecast() {
    const projections = {
      heap: this.project('heap_used_bytes', { limitField: 'heap_limit_bytes', capacityLabel: 'V8 heap limit' }),
      rss: this.project('rss_bytes', { capacityLabel: 'container memory' }),
      store_rows: this.project('store_rows', { capacityLabel: 'row count' }),
      archive_rows: this.project('archive_rows', { capacityLabel: 'archive rows' }),
      outbox_backlog: this.project('outbox_pending', { limitValue: 1000, capacityLabel: 'backlog alert threshold' }),
    };
    return {
      generated_at: this.clock.nowIso(),
      samples: this.history.length,
      projections,
      recommendations: this._recommendations(projections),
    };
  }

  /** Autoscaling recommendations from observed trend + current saturation. */
  _recommendations(projections) {
    const recs = [];
    const p = this.platform;
    const rt = p && p.runtime && p.runtime.samples.length ? p.runtime.samples[p.runtime.samples.length - 1] : {};
    const elu = rt.event_loop_utilization || 0;

    // Compute headroom: sustained high event-loop utilization → scale out.
    if (elu > 0.7) {
      recs.push({ resource: 'compute', action: 'scale_out', urgency: elu > 0.85 ? 'high' : 'medium',
        rationale: `event-loop utilization ${round(elu)} — add instances to restore headroom`, suggested_replicas_delta: elu > 0.85 ? 2 : 1 });
    } else if (elu > 0 && elu < 0.25 && this.history.length > 20) {
      recs.push({ resource: 'compute', action: 'scale_in', urgency: 'low',
        rationale: `event-loop utilization ${round(elu)} sustained low — a replica may be reclaimable`, suggested_replicas_delta: -1 });
    }

    // Memory exhaustion risk.
    const heap = projections.heap;
    if (heap && heap.time_to_limit_days != null && heap.time_to_limit_days < 90) {
      recs.push({ resource: 'memory', action: 'increase_limit', urgency: heap.time_to_limit_days < 30 ? 'high' : 'medium',
        rationale: `heap projected to reach the limit in ~${heap.time_to_limit_days}d`, confidence: heap.confidence });
    }

    // Backlog growth → add queue consumers.
    const backlog = projections.outbox_backlog;
    if (backlog && backlog.slope_per_day > 0 && backlog.time_to_limit_days != null && backlog.time_to_limit_days < 30) {
      recs.push({ resource: 'queue_consumers', action: 'scale_out', urgency: 'high',
        rationale: `outbox backlog trending toward the alert threshold in ~${backlog.time_to_limit_days}d`, confidence: backlog.confidence });
    }

    // Storage growth is informational unless steep.
    const store = projections.store_rows;
    if (store && store.slope_per_day > 0) {
      recs.push({ resource: 'storage', action: 'monitor', urgency: 'low',
        rationale: `store growing ~${store.slope_per_day} rows/day; 365d projection ${store.forecast['365d']} rows` });
    }
    if (recs.length === 0) recs.push({ resource: 'none', action: 'hold', urgency: 'none', rationale: 'no capacity pressure detected in the observed window' });
    return recs;
  }
}

/** Confidence from fit quality (R²) scaled by how much data backs it. */
function confidence(pts, n) {
  const r2 = rSquared(pts);
  const dataFactor = Math.min(1, n / 60); // ≥60 samples → full weight
  const score = r2 * dataFactor;
  return { score: round(score), r_squared: round(r2), samples: n, level: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low' };
}

function rSquared(pts) {
  const n = pts.length;
  if (n < 2) return 0;
  const slope = leastSquaresSlope(pts);
  const meanX = pts.reduce((a, [x]) => a + x, 0) / n;
  const meanY = pts.reduce((a, [, y]) => a + y, 0) / n;
  const intercept = meanY - slope * meanX;
  let ssRes = 0; let ssTot = 0;
  for (const [x, y] of pts) {
    const pred = slope * x + intercept;
    ssRes += (y - pred) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  if (ssTot === 0) return 1; // perfectly flat series is a perfect (if trivial) fit
  return Math.max(0, 1 - ssRes / ssTot);
}

function round(n) { return Math.round(Number(n) * 100) / 100; }
function mapVals(obj, fn) { const out = {}; for (const [k, v] of Object.entries(obj)) out[k] = fn(v); return out; }

module.exports = { CapacityPlanner, rSquared };
