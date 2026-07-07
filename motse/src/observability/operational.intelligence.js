'use strict';

const { leastSquaresSlope } = require('./runtime.intelligence');

const NOOP_METRICS = { setGauge() {}, inc() {} };

/**
 * Operational intelligence (Phase 2). An evidence-based ADVISOR — not an
 * actuator. It records a small history of key operational counters each cycle
 * and, from OBSERVED TRENDS (not static thresholds), composes recommendations
 * that already-built subsystems supply the evidence for:
 *
 *   - runtime intelligence  → memory pressure, event-loop stalls, saturation
 *   - capacity planner      → trend-based scale-out/in, memory, queue consumers
 *   - resilience stats      → open breakers, bulkhead rejection, retry storms
 *   - dependency health     → degraded/failed dependencies
 *   - business observability→ the BUSINESS impact of a technical degradation
 *
 * Every recommendation carries supporting metrics, a confidence score, the
 * expected operational impact, the estimated business impact, an urgency, and
 * rollback considerations. It NEVER applies anything — the operator (or the
 * governance workflow) decides; this only surfaces what the evidence supports.
 */
class OperationalIntelligence {
  constructor({ platform, clock, metrics = null, historySize = 500 } = {}) {
    this.platform = platform;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    this.historySize = historySize;
    this.history = []; // observed operational snapshots (for trend detection)
  }

  /** Snapshot key counters so trends (not just levels) drive recommendations. */
  record() {
    const p = this.platform;
    const m = p.metrics;
    const outbox = p.outbox ? p.outbox.stats() : {};
    const rt = p.runtime && p.runtime.samples.length ? p.runtime.samples[p.runtime.samples.length - 1] : {};
    const s = {
      at_ms: this.clock.nowMs(),
      outbox_pending: outbox.pending || 0,
      retried_total: m ? m.counterTotal('foundation_outbox_retried_total') : 0,
      lock_contended: m ? m.counterValue('foundation_lock_total', { result: 'contended' }) : 0,
      lock_total: m ? m.counterTotal('foundation_lock_total') : 0,
      ratelimit_limited: m ? m.counterValue('foundation_ratelimit_total', { result: 'limited' }) : 0,
      event_loop_utilization: rt.event_loop_utilization || 0,
      heap_utilization: rt.heap_utilization || 0,
    };
    this.history.push(s);
    if (this.history.length > this.historySize) this.history.shift();
    return s;
  }

  /** Trend (per-sample slope) of a recorded field over the window. */
  _trend(field) {
    if (this.history.length < 3) return 0;
    return leastSquaresSlope(this.history.map((h, i) => [i, h[field]]));
  }

  _latest() { return this.history[this.history.length - 1] || {}; }

  /**
   * Produce evidence-based recommendations. Composes the trend-aware sources;
   * each item is actionable and cites its metrics + confidence.
   */
  advise() {
    const recs = [];
    const p = this.platform;
    const now = this._latest();

    // ── Runtime pressure (trend-based, from runtime intelligence) ──────
    if (p.runtime) {
      for (const insight of p.runtime.insights()) {
        if (insight.kind === 'memory_leak_suspected') {
          recs.push(this._rec({
            signal: 'memory_pressure', resource: 'memory', action: 'increase_memory_or_investigate_leak',
            urgency: insight.severity === 'critical' ? 'critical' : 'high',
            evidence: { detail: insight.detail, heap_utilization: insight.heap_utilization },
            confidence: 0.8, operational_impact: 'risk of OOM restart and dropped in-flight requests',
            business_impact: this._worstBusinessImpact(),
            rollback: 'a memory increase is a deploy-time change; revert the manifest to roll back',
          }));
        }
        if (insight.kind === 'event_loop_stall' || insight.kind === 'resource_exhaustion') {
          recs.push(this._rec({
            signal: insight.kind, resource: 'compute', action: 'scale_out_application_instances',
            urgency: insight.severity === 'critical' ? 'critical' : 'high',
            evidence: { detail: insight.detail, event_loop_utilization: now.event_loop_utilization },
            confidence: 0.75, operational_impact: 'rising request latency; load shedding will engage',
            business_impact: this._worstBusinessImpact(),
            rollback: 'scale the replica count back down once utilization normalizes',
          }));
        }
      }
    }

    // ── Event backlog / queue growth (observed trend) ──────────────────
    const pendingTrend = this._trend('outbox_pending');
    if (now.outbox_pending > 100 && pendingTrend > 0) {
      recs.push(this._rec({
        signal: 'queue_growth', resource: 'queue_consumers', action: 'increase_queue_workers',
        urgency: now.outbox_pending > 1000 ? 'critical' : 'medium',
        evidence: { outbox_pending: now.outbox_pending, pending_slope_per_sample: round(pendingTrend) },
        confidence: 0.7, operational_impact: 'delayed event delivery; downstream projections lag',
        business_impact: 'notifications and settlements may be delayed for affected members',
        rollback: 'scaling consumers is reversible; reduce worker count when backlog clears',
      }));
    }

    // ── Retry storm (rising retry rate) ────────────────────────────────
    const retryTrend = this._trend('retried_total');
    if (retryTrend > 5 && this.history.length >= 3) {
      recs.push(this._rec({
        signal: 'retry_storm', resource: 'retry_policy', action: 'reduce_retry_budget_or_investigate_dependency',
        urgency: 'high',
        evidence: { retries_slope_per_sample: round(retryTrend), latest_retries: now.retried_total },
        confidence: 0.65, operational_impact: 'retries amplifying load on a struggling dependency',
        business_impact: 'a degraded dependency is slowing the business flows that use it',
        rollback: 'restore the retry budget via config governance rollback',
      }));
    }

    // ── Lock contention (observed ratio) ───────────────────────────────
    if (now.lock_total > 0) {
      const contentionRatio = now.lock_contended / now.lock_total;
      if (contentionRatio > 0.2) {
        recs.push(this._rec({
          signal: 'lock_contention', resource: 'concurrency', action: 'reduce_concurrency_on_hot_resource',
          urgency: contentionRatio > 0.5 ? 'high' : 'medium',
          evidence: { contention_ratio: round(contentionRatio), contended: now.lock_contended },
          confidence: 0.7, operational_impact: 'a hot resource is serializing work and adding latency',
          business_impact: 'throughput on the contended workflow is capped',
          rollback: 'concurrency changes are config-governed and reversible',
        }));
      }
    }

    // ── Dependency degradation (observed health state) ─────────────────
    if (p.dependencies) {
      const v = p.dependencies.verdict();
      if (v.failed.length > 0) {
        recs.push(this._rec({
          signal: 'dependency_failure', resource: 'incident', action: 'trigger_incident_response',
          urgency: 'critical', evidence: { failed: v.failed, attention: v.attention },
          confidence: 0.95, operational_impact: 'a critical dependency is down; readiness is failing',
          business_impact: this._worstBusinessImpact(),
          rollback: 'n/a — this is a call to investigate, not a change',
        }));
      } else if (v.degraded) {
        recs.push(this._rec({
          signal: 'dependency_degraded', resource: 'investigation', action: 'investigate_service_degradation',
          urgency: 'medium', evidence: { attention: v.attention },
          confidence: 0.6, operational_impact: 'a dependency is degraded but not failed',
          business_impact: 'no direct customer impact yet; watch the trend',
          rollback: 'n/a',
        }));
      }
    }

    // ── Open circuit breaker → suggest safe mode if broadly degraded ───
    if (p.resilience) {
      const open = p.resilience.stats().breakers.filter((b) => b.state === 'open');
      if (open.length > 0) {
        recs.push(this._rec({
          signal: 'circuit_open', resource: 'safe_mode', action: 'consider_enabling_safe_mode',
          urgency: 'high', evidence: { open_breakers: open.map((b) => b.name) },
          confidence: 0.7, operational_impact: 'a dependency is being shielded; some calls fast-fail',
          business_impact: this._worstBusinessImpact(),
          rollback: 'safe mode is reversible via config governance (kill switch off)',
        }));
      }
    }

    // ── Business SLA breach (customer-impact framing) ──────────────────
    if (p.business) {
      const ops = p.business.operationsView();
      for (const cap of ops.degraded) {
        const impact = p.business.impactOf(cap);
        recs.push(this._rec({
          signal: 'business_sla_breach', resource: 'investigation', action: `investigate_${cap}_degradation`,
          urgency: impact.customers_affected > 100 ? 'high' : 'medium',
          evidence: { capability: cap, sla: impact.sla, failures: impact.failures },
          confidence: 0.8, operational_impact: `${impact.product} is below its SLA target`,
          business_impact: `${impact.customers_affected} customers affected; ${impact.value_at_risk_minor} minor at risk`,
          rollback: 'n/a — investigate the failing capability',
        }));
      }
    }

    recs.sort((a, b) => URGENCY[b.urgency] - URGENCY[a.urgency] || b.confidence - a.confidence);
    this.metrics.setGauge('motse_opsintel_recommendations', {}, recs.length);
    return { at: this.clock.nowIso(), samples: this.history.length, recommendations: recs };
  }

  /** Convenience: the worst current business impact, for cross-cutting signals. */
  _worstBusinessImpact() {
    if (!this.platform.business) return 'business impact unknown (business observability not wired)';
    const degraded = this.platform.business.operationsView().degraded;
    if (degraded.length === 0) return 'no business capability is currently breaching SLA';
    const worst = degraded
      .map((c) => this.platform.business.impactOf(c))
      .sort((a, b) => b.customers_affected - a.customers_affected)[0];
    return `${worst.product}: ${worst.customers_affected} customers affected, ${worst.value_at_risk_minor} minor at risk`;
  }

  _rec(r) {
    return { id: `oir-${this.history.length}-${r.signal}`, evidence_at: this.clock.nowIso(), ...r };
  }
}

const URGENCY = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
function round(n) { return Math.round(Number(n) * 1000) / 1000; }

module.exports = { OperationalIntelligence };
