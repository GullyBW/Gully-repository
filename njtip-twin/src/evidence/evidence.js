'use strict';
// Evidence assembler (v0.2). Packages verification + adversarial + formal + chaos +
// traceability + compliance + drift + maturity into one bundle with a DETERMINISTIC
// content digest (excludes timestamps, signatures, and non-deterministic perf).
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../util/hash');

const HUMAN_REVIEW_REQUIRED = [
  'Cryptography & key custody', 'Anonymity mechanisms', 'Evidence integrity / admissibility',
  'Legal compliance', 'Constitutional interpretation', 'Judicial procedure',
  'AI decision boundaries', 'Governance policy', 'Procurement', 'Production go-live approval',
];

function buildBundle(inp) {
  const { verification, adversarial, formal, chaos, traceability, compliance, drift, maturity, version } = inp;
  const critFails = verification.filter((v) => !v.pass && v.severity === 'critical');

  // Deterministic core (no timestamps / signatures / perf).
  const core = {
    verification: verification.map((v) => ({ id: v.id, pass: v.pass, violations: v.violations, severity: v.severity, refs: v.refs })),
    adversarial: adversarial.map((s) => ({ id: s.id, pass: s.pass, threats: s.threats, metrics: s.metrics })),
    formal: formal.map((f) => ({ id: f.id, pass: f.pass, statesExplored: f.statesExplored, counterexample: f.counterexample })),
    chaos: chaos.map((c) => ({ id: c.id, pass: c.pass, degraded: c.degraded, recovered: c.recovered })),
    traceabilityCoverage: traceability.coverage,
    compliance: compliance.frameworkSummary,
    drift: { drift: drift.drift, deviations: drift.deviations },
    maturity: { achievedLevel: maturity.achievedLevel, automatedCap: maturity.automatedCap },
    version,
  };
  const contentDigest = sha256(core);

  const summary = {
    fitnessTotal: verification.length, fitnessPassed: verification.filter((v) => v.pass).length, criticalFailures: critFails.length,
    adversarialTotal: adversarial.length, adversarialResisted: adversarial.filter((s) => s.pass).length, adversarialFailures: adversarial.filter((s) => !s.pass).length,
    formalTotal: formal.length, formalPassed: formal.filter((f) => f.pass).length,
    chaosTotal: chaos.length, chaosPassed: chaos.filter((c) => c.pass).length,
  };

  const blocked = summary.criticalFailures > 0 || summary.adversarialFailures > 0 ||
    formal.some((f) => !f.pass) || chaos.some((c) => !c.pass) || drift.drift ||
    traceability.coverage.percentCovered < 100;

  return {
    meta: { artifact: 'NJTIP Digital Engineering Twin — Assurance Evidence Bundle', synthetic: true, version,
      dataClassification: 'SYNTHETIC — no production data', generatedAt: new Date().toISOString(), contentDigest },
    verdict: {
      invariantsHold: summary.criticalFailures === 0, adversarialResisted: summary.adversarialFailures === 0,
      formalProofsHold: summary.formalPassed === summary.formalTotal, chaosResilient: summary.chaosPassed === summary.chaosTotal,
      driftFree: !drift.drift, traceabilityComplete: traceability.coverage.percentCovered === 100, blocked,
      statement: 'EVIDENCE ONLY — NOT A GO-LIVE DECISION. A green run demonstrates internal consistency under synthetic simulation; it does not certify real-world anonymity vs a global adversary, legal admissibility, or that governance/legal/funding conditions are met.',
    },
    summary, verification, adversarial, formal, chaos, traceability, compliance, drift, maturity,
    humanReviewRequired: HUMAN_REVIEW_REQUIRED,
  };
}

function renderMarkdown(b) {
  const L = [];
  L.push('# NJTIP Twin — Assurance Evidence (summary)', '', '> **SYNTHETIC ONLY. Evidence for human review, not approval.** ' + b.verdict.statement, '');
  L.push(`**Digest:** \`${b.meta.contentDigest}\` · **Version:** ${b.meta.version} · **Generated:** ${b.meta.generatedAt}`, '');
  L.push('| Dimension | Result |', '|---|---|');
  L.push(`| Fitness | ${b.summary.fitnessPassed}/${b.summary.fitnessTotal} (crit fails ${b.summary.criticalFailures}) |`);
  L.push(`| Adversarial | ${b.summary.adversarialResisted}/${b.summary.adversarialTotal} |`);
  L.push(`| Formal | ${b.summary.formalPassed}/${b.summary.formalTotal} |`);
  L.push(`| Chaos | ${b.summary.chaosPassed}/${b.summary.chaosTotal} |`);
  L.push(`| Traceability coverage | ${b.traceability.coverage.percentCovered}% (enforced ${b.traceability.coverage.percentEnforced}%) |`);
  L.push(`| Drift | ${b.drift.drift ? 'DETECTED' : 'none'} |`);
  L.push(`| Maturity | Level ${b.maturity.achievedLevel}/10 (automated cap ${b.maturity.automatedCap}) |`, '');
  L.push('## 🔒 Human review required', ...b.humanReviewRequired.map((h) => `- ${h}`), '');
  return L.join('\n');
}

function writeJSON(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

module.exports = { buildBundle, renderMarkdown, writeJSON, HUMAN_REVIEW_REQUIRED };
