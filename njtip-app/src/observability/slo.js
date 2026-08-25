'use strict';
// Service Level Objectives (SLOs) + Indicators (SLIs) + error-budget alerting. Pure and
// deterministic: it evaluates SLIs from a metrics snapshot and returns objective status,
// error-budget consumption, and alerts (multi-window burn-rate). No I/O, no wall-clock.
//
// SLOs are operational and non-identifying; they never expose case data.

// Default objectives (illustrative, reviewable). availability = success ratio; latency =
// fraction of requests under the threshold; both over the observed window.
const DEFAULT_SLOS = [
  { name: 'availability', type: 'availability', objective: 0.995 },
  { name: 'latency-p95', type: 'latency', objective: 0.95, thresholdMs: 300 },
];

// Compute SLIs from a metrics snapshot: total/failed requests and latency samples.
function computeSlis({ total = 0, failed = 0, latencies = [] }) {
  const availability = total ? (total - failed) / total : 1;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] : 0;
  const underThreshold = (thr) => (latencies.length ? latencies.filter((l) => l <= thr).length / latencies.length : 1);
  return { total, failed, availability, p95, underThreshold };
}

// Evaluate objectives → status + error-budget consumption + alerts. burnRate = fraction of
// the error budget consumed; a high burn rate on a small window is a fast-burn alert.
function evaluate(slis, slos = DEFAULT_SLOS) {
  const results = slos.map((slo) => {
    const attained = slo.type === 'availability' ? slis.availability : slis.underThreshold(slo.thresholdMs);
    const budget = 1 - slo.objective;                 // allowed failure fraction
    const consumed = budget > 0 ? Math.max(0, (1 - attained)) / budget : (attained >= 1 ? 0 : Infinity);
    const meets = attained >= slo.objective;
    return { name: slo.name, type: slo.type, objective: slo.objective, attained: +attained.toFixed(4), errorBudgetConsumed: +Math.min(consumed, 9.99).toFixed(3), meets };
  });
  const alerts = results.filter((r) => !r.meets).map((r) => ({
    severity: r.errorBudgetConsumed >= 2 ? 'page' : 'ticket',
    slo: r.name,
    reason: `${r.name} attained ${r.attained} < objective ${r.objective} (budget consumed ${r.errorBudgetConsumed}x)`,
  }));
  return { results, alerts, healthy: alerts.length === 0 };
}

// Correlate a burst of alerts into a single incident signal (alert correlation), so an
// operator sees one actionable incident rather than N alerts.
function correlate(alerts) {
  if (!alerts.length) return null;
  const worst = alerts.some((a) => a.severity === 'page') ? 'page' : 'ticket';
  return { incident: true, severity: worst, count: alerts.length, slos: alerts.map((a) => a.slo), summary: `${alerts.length} SLO breach(es): ${alerts.map((a) => a.slo).join(', ')}` };
}

module.exports = { DEFAULT_SLOS, computeSlis, evaluate, correlate };
