'use strict';
// Cross-Domain Systems Intelligence (Phase 59). Holistic ecosystem intelligence: cross-
// bounded-context analytics, dependency intelligence, a governance correlation engine,
// operational/risk correlation, cross-domain forecasting, explainable system-health analysis,
// and systemic-risk indicators. Deterministic. NO automated operational decisions — human
// governance remains mandatory; all outputs are advisory and explainable.
const capabilityModel = require('../capability/model');

// Normalise a domain posture map into numeric health signals in [0,1].
function healthOf(domain) {
  if (domain == null) return null;
  if (typeof domain.healthy === 'boolean') return domain.healthy ? 1 : 0;
  if (typeof domain.pass === 'boolean') return domain.pass ? 1 : 0;
  if (typeof domain.health === 'number') return domain.health;
  if (typeof domain.overallCoverage === 'number') return domain.overallCoverage;
  return null;
}

// Governance correlation: which domains move together (both healthy / both degraded).
function correlate(domains) {
  const signals = Object.entries(domains).map(([name, d]) => ({ name, health: healthOf(d) })).filter((s) => s.health !== null);
  const degraded = signals.filter((s) => s.health < 1).map((s) => s.name);
  const healthy = signals.filter((s) => s.health >= 1).map((s) => s.name);
  return { signals, degraded, healthy, allHealthy: degraded.length === 0 };
}

// Dependency intelligence: from the capability map (fan-in / high-coupling capabilities).
function dependencyIntelligence() {
  const deps = capabilityModel.dependencies(); const fanIn = {};
  for (const on of Object.values(deps)) for (const d of on) fanIn[d] = (fanIn[d] || 0) + 1;
  const critical = Object.entries(fanIn).filter(([, n]) => n >= 2).map(([cap, n]) => ({ capability: cap, dependents: n }));
  return { fanIn, criticalCapabilities: critical.sort((a, b) => b.dependents - a.dependents) };
}

// Systemic-risk indicators: degraded domains + their explainable systemic weight.
function systemicRisk(domains) {
  const corr = correlate(domains);
  const weight = { engineering: 0.3, security: 0.25, privacy: 0.15, resilience: 0.15, operations: 0.1, compliance: 0.05 };
  let risk = 0; const contributors = [];
  for (const name of corr.degraded) { const w = weight[name] ?? 0.05; risk += w; contributors.push({ domain: name, weight: w }); }
  return { systemicRisk: +Math.min(1, risk).toFixed(3), band: risk >= 0.5 ? 'high' : risk >= 0.2 ? 'medium' : 'low', contributors, note: 'Advisory systemic-risk signal; no automated action.' };
}

// Explainable system-health analysis: aggregate score + reasons.
function explainableHealth(domains) {
  const corr = correlate(domains);
  const scores = corr.signals.map((s) => s.health);
  const overall = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : 1;
  const reasons = corr.degraded.length ? corr.degraded.map((d) => `${d} degraded`) : ['all readable domains healthy'];
  return { overall, healthyDomains: corr.healthy.length, degradedDomains: corr.degraded.length, reasons };
}

// Cross-domain forecast: transparent trend over recorded overall-health scores.
function forecast(history = []) {
  const scores = history.map((h) => h.overall ?? h.score).filter((x) => typeof x === 'number');
  if (scores.length < 2) return { direction: 'flat', slope: 0, basis: scores.length };
  const n = scores.length; const mx = (n - 1) / 2; const my = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mx) * (scores[i] - my); den += (i - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { direction: slope > 1e-6 ? 'improving' : slope < -1e-6 ? 'declining' : 'stable', slope: +slope.toFixed(5), basis: n };
}

module.exports = { correlate, dependencyIntelligence, systemicRisk, explainableHealth, forecast, healthOf };
