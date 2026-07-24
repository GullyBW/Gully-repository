'use strict';
// Platform Maturity Intelligence (Phase 40). Extends engineering health into ORGANISATIONAL
// MATURITY: architecture, security, testing, compliance, operational, and documentation
// maturity, technical-debt signals, and readiness — from deterministic inputs (fitness
// results + counts). Produces an executive maturity dashboard. NEVER an authorization.
//
// Maturity is capped at level 6 by automation (levels 7-10 require human attestation) —
// consistent with the governance maturity model established for the Twin.
const AUTOMATION_CAP = 6;

// Score a dimension from a pass-rate (0..1) → level 0..6 (automation ceiling).
function level(passRate) { return Math.min(AUTOMATION_CAP, Math.round(passRate * AUTOMATION_CAP)); }

function assess({ twin = [], app = [], infra = [], docs = 0 } = {}) {
  const all = [...twin, ...app, ...infra];
  const rate = (subset) => subset.length ? subset.filter((r) => r.pass).length / subset.length : 1;
  const byPrefix = (pfx) => all.filter((r) => r.id.startsWith(pfx));

  const dimensions = {
    architecture: level(rate([...byPrefix('FIT-ZONE'), ...byPrefix('FIT-SECURE'), ...app.filter((r) => /PERSISTENCE|EVENT-SOURCING/.test(r.id))])),
    security: level(rate([...byPrefix('FIT-ZERO'), ...byPrefix('FIT-ENCRYPTION'), ...app.filter((r) => /AUTHZ|CREDENTIAL|CIPHERTEXT|THREAT|POLICY/.test(r.id)), ...infra.filter((r) => /HARDENING|NETWORK|DEVSECOPS/.test(r.id))])),
    // Testing maturity: breadth of continuously-verified invariants + their pass rate.
    testing: level(rate(all) * Math.min(1, all.length / 50)),
    compliance: level(rate([...byPrefix('FIT-AUDIT'), ...byPrefix('FIT-GOVERNANCE'), ...app.filter((r) => /EVENT-GOVERNANCE|API-GOVERNANCE/.test(r.id))])),
    operational: level(rate(infra)),
    documentation: level(Math.min(1, docs / 15)),
    privacy: level(rate(app.filter((r) => /PRIVACY|ANONYMITY|ANALYTICS-PRIVACY|GRAPH-PRIVACY/.test(r.id)))),
  };

  // Technical-debt signal: any failing invariant is debt (transparent, not punitive).
  const failing = all.filter((r) => !r.pass);
  const technicalDebt = { openInvariantFailures: failing.length, items: failing.map((f) => f.id) };

  const overall = +(Object.values(dimensions).reduce((a, b) => a + b, 0) / Object.keys(dimensions).length).toFixed(2);
  return {
    dimensions, technicalDebt,
    overallLevel: overall, automationCap: AUTOMATION_CAP,
    grade: overall >= 6 ? 'A' : overall >= 5 ? 'B' : overall >= 4 ? 'C' : 'D',
    humanGate: { required: true, note: 'Maturity levels 7-10 require human attestation. This report informs governance; it never authorizes deployment.' },
  };
}

module.exports = { assess, level, AUTOMATION_CAP };
