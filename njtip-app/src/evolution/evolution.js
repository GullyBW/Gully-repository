'use strict';
// Platform Evolution Intelligence (Phase 49). Continuously evaluates architectural evolution:
// architectural drift, dependency health, technical-debt analytics, evolution forecasting,
// refactoring impact analysis, an architecture-decision log, and capability lifecycle
// tracking. Provides ADVISORY recommendations while PRESERVING architectural stability —
// it never changes architecture, it observes and advises. Deterministic.
const capabilityModel = require('../capability/model');

// Architecture Decision Log (ADR history) — an append-only record of decisions.
class ArchitectureDecisionLog {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._adrs = []; }
  record({ id, title, status = 'accepted', rationale }) { if (!id || !title || !rationale) throw new Error('ADR requires id, title, and rationale'); this._adrs.push({ id, title, status, rationale, at: this._clock() }); return { id, status }; }
  history() { return this._adrs.map((a) => ({ ...a })); }
}

// Dependency health from the capability map: fan-in/fan-out + coupling signal.
function dependencyHealth() {
  const deps = capabilityModel.dependencies();
  const fanOut = {}; const fanIn = {};
  for (const [cap, on] of Object.entries(deps)) { fanOut[cap] = on.length; for (const d of on) fanIn[d] = (fanIn[d] || 0) + 1; }
  const highCoupling = Object.entries(fanIn).filter(([, n]) => n >= 3).map(([cap, n]) => ({ cap, dependents: n }));
  return { fanOut, fanIn, highCoupling, note: 'Coupling signal from the capability map; advisory.' };
}

// Technical-debt analytics from the live fitness results (failing invariants = debt).
function technicalDebt(fitnessResults) {
  const failing = fitnessResults.filter((r) => !r.pass);
  return { openInvariantFailures: failing.length, items: failing.map((f) => f.id), debtRatio: fitnessResults.length ? +(failing.length / fitnessResults.length).toFixed(3) : 0 };
}

// Refactoring impact: which capabilities (transitively) depend on the target → blast radius.
function refactoringImpact(target) {
  const deps = capabilityModel.dependencies();
  const dependents = new Set(); const stack = [target];
  while (stack.length) { const cur = stack.pop(); for (const [cap, on] of Object.entries(deps)) if (on.includes(cur) && !dependents.has(cap)) { dependents.add(cap); stack.push(cap); } }
  return { target, impactedCapabilities: [...dependents].sort(), blastRadius: dependents.size, note: 'Advisory impact analysis; change control remains human-governed.' };
}

// Evolution forecast: a transparent linear trend over recorded health scores.
function evolutionForecast(healthHistory = []) {
  const scores = healthHistory.map((h) => h.score);
  if (scores.length < 2) return { direction: 'flat', slope: 0, basis: scores.length };
  const n = scores.length; const mx = (n - 1) / 2; const my = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mx) * (scores[i] - my); den += (i - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { direction: slope > 1e-6 ? 'improving' : slope < -1e-6 ? 'declining' : 'stable', slope: +slope.toFixed(5), basis: n };
}

// Capability lifecycle tracking (proposed → active → deprecated → retired).
class CapabilityLifecycle {
  constructor() { this._states = new Map(Object.keys(capabilityModel.capabilityMap()).map((c) => [c, 'active'])); }
  set(cap, state) { if (!['proposed', 'active', 'deprecated', 'retired'].includes(state)) throw new Error('invalid lifecycle state'); this._states.set(cap, state); return { cap, state }; }
  status() { return Object.fromEntries(this._states); }
}

// Advisory evolution recommendations (never applied automatically).
function recommendations(fitnessResults) {
  const debt = technicalDebt(fitnessResults); const dep = dependencyHealth();
  const recs = [];
  if (debt.openInvariantFailures > 0) recs.push({ priority: 'high', action: 'resolve failing invariants', detail: debt.items });
  for (const hc of dep.highCoupling) recs.push({ priority: 'medium', action: 'review high-coupling capability', detail: hc });
  return { recommendations: recs, advisoryOnly: true, note: 'Advisory — preserves architectural stability; a human decides.' };
}

module.exports = { ArchitectureDecisionLog, dependencyHealth, technicalDebt, refactoringImpact, evolutionForecast, CapabilityLifecycle, recommendations };
