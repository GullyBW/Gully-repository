'use strict';
// Sovereign Digital Government Command Center (Phase 60). The unified STRATEGIC oversight
// capability, aggregating posture across EVERY governance domain (identity, policy, event,
// API, privacy, security, AI, infrastructure, compliance, data, evolution, readiness,
// national performance, the Twin, and resilience). Provides executive dashboards, strategic
// advisory reports, national readiness SCORING, governance-posture visualization, long-term
// trend analysis, scenario comparison, and decision-support summaries.
//
// The Command Center is ADVISORY. Every operational decision requires explicit human
// approval. It reads existing subsystems through injected source functions; it never mutates
// state and never authorizes. Deterministic given its inputs.
const crossDomain = require('../intelligence/cross-domain');

class CommandCenter {
  // sources: a map of domain → nullable function returning a small posture summary.
  constructor(sources = {}) { this._s = sources; }

  _domains() {
    const out = {};
    for (const [name, fn] of Object.entries(this._s)) { try { out[name] = typeof fn === 'function' ? fn() : null; } catch (_) { out[name] = null; } }
    return out;
  }

  // The strategic snapshot across all domains + cross-domain analysis.
  snapshot() {
    const domains = this._domains();
    const health = crossDomain.explainableHealth(domains);
    const risk = crossDomain.systemicRisk(domains);
    return {
      generatedAt: new Date().toISOString(),
      domains,
      systemHealth: health,
      systemicRisk: risk,
      posture: health.degradedDomains === 0 ? 'green' : risk.band === 'high' ? 'red' : 'amber',
      humanGate: { required: true, note: 'The Command Center is ADVISORY. Every operational decision requires explicit human approval. Evidence ≠ authorization.' },
    };
  }

  // National readiness scoring — a composite, explicitly human-gated advisory score (0..1).
  // No score, at any value, authorizes deployment.
  nationalReadinessScore() {
    const health = crossDomain.explainableHealth(this._domains());
    return { score: health.overall, band: health.overall >= 0.95 ? 'strong' : health.overall >= 0.8 ? 'developing' : 'attention', reasons: health.reasons, humanGate: true, note: 'Advisory national-readiness score — a human governance decision authorizes any go-live.' };
  }

  // Strategic advisory report — a single informational digest for executive oversight.
  strategicReport() {
    const snap = this.snapshot();
    return {
      posture: snap.posture,
      readiness: this.nationalReadinessScore(),
      systemicRisk: snap.systemicRisk,
      dependencyIntelligence: crossDomain.dependencyIntelligence(),
      advisoryOnly: true,
      note: 'Strategic advisory report — informational; operational decisions remain human-approved.',
    };
  }

  // Scenario comparison — compare posture/readiness across supplied domain-posture scenarios.
  compareScenarios(scenarios = []) {
    return scenarios.map((sc) => ({ name: sc.name, health: crossDomain.explainableHealth(sc.domains).overall, systemicRisk: crossDomain.systemicRisk(sc.domains).systemicRisk }));
  }

  // Decision-support summary — a compact, advisory summary for a human decision-maker.
  decisionSupportSummary() {
    const snap = this.snapshot();
    return { posture: snap.posture, degradedDomains: snap.systemHealth.reasons, systemicRiskBand: snap.systemicRisk.band, decision: 'HUMAN APPROVAL REQUIRED', note: 'Summary informs a human decision; it is not a decision.' };
  }
}

module.exports = { CommandCenter };
