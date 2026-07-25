'use strict';
// National Governance Operations Center (Phase 50). A UNIFIED, read-only oversight capability
// that aggregates posture across every governance domain into one executive view. Every
// dashboard is ADVISORY; operational decisions remain human-approved. It reads existing
// subsystems through injected source functions (no new authority) and never mutates state.
// Deterministic given its inputs.
class GovernanceOpsCenter {
  // sources: { fitness, slo, security, privacy, compliance, ai, policy, api, events,
  //            maturity, resilience } — each a nullable function returning a small summary.
  constructor(sources = {}) { this._s = sources; }

  snapshot() {
    const s = this._s;
    const domains = {
      engineering: safe(s.fitness),
      operations: safe(s.slo),
      security: safe(s.security),
      privacy: safe(s.privacy),
      compliance: safe(s.compliance),
      ai: safe(s.ai),
      policy: safe(s.policy),
      api: safe(s.api),
      events: safe(s.events),
      maturity: safe(s.maturity),
      resilience: safe(s.resilience),
    };
    // Coarse advisory posture — GREEN only if the load-bearing domains are healthy.
    const green = !!(domains.engineering && domains.engineering.healthy)
      && (!domains.operations || domains.operations.healthy !== false)
      && !!(domains.resilience && domains.resilience.pass);
    return {
      generatedAt: new Date().toISOString(),
      domains,
      advisoryPosture: green ? 'green' : 'attention',
      humanGate: { required: true, note: 'All dashboards are ADVISORY. Operational and deployment decisions remain human-approved. Evidence ≠ authorization.' },
    };
  }

  // Strategic readiness view — explicitly human-gated. The center informs; it never authorizes.
  strategicReadiness() { return { decision: 'NOT AUTHORIZED — human governance decision required', humanGate: true, note: 'The operations center informs; it never authorizes.' }; }
}

function safe(fn) { try { return typeof fn === 'function' ? fn() : null; } catch (_) { return null; } }

module.exports = { GovernanceOpsCenter };
