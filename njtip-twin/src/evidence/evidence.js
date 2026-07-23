'use strict';
// Evidence Generation Pipeline (blueprint phase8/06). Packages verification +
// adversarial results into a machine-verifiable, traceable, review-ready bundle.
// Deterministic content digest (excludes timestamps) so evidence is reproducible.
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../util/hash');

// Domains that AUTOMATION MUST NOT DECIDE — evidence supports the human, never replaces.
const HUMAN_REVIEW_REQUIRED = [
  'Cryptography & key custody', 'Anonymity mechanisms', 'Evidence integrity / admissibility',
  'Legal compliance', 'Constitutional interpretation', 'Judicial procedure',
  'AI decision boundaries', 'Governance policy', 'Procurement', 'Production go-live approval',
];

function buildBundle({ verification, adversarial }) {
  const critFails = verification.filter((v) => !v.pass && v.severity === 'critical');
  const simFails = adversarial.filter((s) => !s.pass);

  // Deterministic core: only the pass/fail + refs + violations (NO timestamps).
  const core = {
    verification: verification.map((v) => ({ id: v.id, pass: v.pass, violations: v.violations, refs: v.refs, severity: v.severity })),
    adversarial: adversarial.map((s) => ({ id: s.id, pass: s.pass, threats: s.threats, metrics: s.metrics })),
  };
  const contentDigest = sha256(core);

  const traceability = verification.map((v) => ({
    fitness: v.id,
    ddr: (v.refs && v.refs.ddr) || [], decision: (v.refs && v.refs.decision) || [],
    threats: (v.refs && v.refs.threats) || [], risks: (v.refs && v.refs.risks) || [],
    verified: v.pass,
  }));

  return {
    meta: {
      artifact: 'NJTIP Digital Engineering Twin — Verification Evidence Bundle',
      synthetic: true,
      dataClassification: 'SYNTHETIC — no production data, no real individuals/institutions',
      generatedAt: new Date().toISOString(), // metadata only; excluded from digest
      contentDigest,
    },
    verdict: {
      allCriticalInvariantsHold: critFails.length === 0,
      allAdversarialScenariosResisted: simFails.length === 0,
      statement:
        'EVIDENCE ONLY — NOT A GO-LIVE DECISION. A green twin demonstrates the design and controls ' +
        'are internally consistent and hold under synthetic simulation. It does NOT certify real-world ' +
        'anonymity vs a global adversary, legal admissibility, or that governance/legal/funding conditions ' +
        'are met. Production go-live remains an Oversight Board decision behind the readiness gates.',
    },
    summary: {
      fitnessTotal: verification.length,
      fitnessPassed: verification.filter((v) => v.pass).length,
      criticalFailures: critFails.length,
      adversarialTotal: adversarial.length,
      adversarialResisted: adversarial.filter((s) => s.pass).length,
      adversarialFailures: simFails.length,
    },
    verification,
    adversarial,
    traceability,
    humanReviewRequired: HUMAN_REVIEW_REQUIRED,
  };
}

function renderMarkdown(b) {
  const L = [];
  L.push('# NJTIP Digital Engineering Twin — Verification Evidence Report', '');
  L.push('> **SYNTHETIC DATA ONLY.** No production systems or real justice-sector data. This report is');
  L.push('> **evidence for human review**, not an approval. ' + b.verdict.statement.replace(/\s+/g, ' '), '');
  L.push(`**Content digest (deterministic):** \`${b.meta.contentDigest}\``);
  L.push(`**Generated:** ${b.meta.generatedAt}`, '');
  L.push('## Verdict', '');
  L.push(`- All critical architecture invariants hold: **${b.verdict.allCriticalInvariantsHold ? 'YES' : 'NO'}**`);
  L.push(`- All adversarial scenarios resisted: **${b.verdict.allAdversarialScenariosResisted ? 'YES' : 'NO'}**`, '');
  L.push('## Summary', '');
  L.push('| Metric | Value |', '|---|---|');
  L.push(`| Fitness checks passed | ${b.summary.fitnessPassed}/${b.summary.fitnessTotal} |`);
  L.push(`| Critical failures | ${b.summary.criticalFailures} |`);
  L.push(`| Adversarial scenarios resisted | ${b.summary.adversarialResisted}/${b.summary.adversarialTotal} |`, '');
  L.push('## Architecture conformance (fitness functions)', '');
  L.push('| Check | Result | DDR | Threats | Violations |', '|---|---|---|---|---|');
  for (const v of b.verification) {
    L.push(`| ${v.id} | ${v.pass ? '✅ PASS' : '❌ FAIL'} | ${(v.refs.ddr || []).join(', ')} | ${(v.refs.threats || []).join(', ')} | ${v.violations.join('; ') || '—'} |`);
  }
  L.push('', '## Adversarial simulation', '');
  L.push('| Scenario | Result | Threats | Metrics |', '|---|---|---|---|');
  for (const s of b.adversarial) {
    L.push(`| ${s.id} | ${s.pass ? '✅ RESISTED' : '❌ FAILED'} | ${s.threats.join(', ')} | ${JSON.stringify(s.metrics)} |`);
  }
  L.push('', '## Traceability matrix (invariant → decision/threat/risk)', '');
  L.push('| Fitness | Decision | Threats | Risks | Verified |', '|---|---|---|---|---|');
  for (const t of b.traceability) {
    L.push(`| ${t.fitness} | ${t.decision.join(', ')} | ${t.threats.join(', ')} | ${t.risks.join(', ')} | ${t.verified ? 'yes' : 'NO'} |`);
  }
  L.push('', '## 🔒 Human review required (automation supports, never replaces)', '');
  for (const h of b.humanReviewRequired) L.push(`- ${h}`);
  L.push('');
  return L.join('\n');
}

function writeBundle(b, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(b, null, 2));
  fs.writeFileSync(path.join(dir, 'REVIEW-REPORT.md'), renderMarkdown(b));
  return { json: path.join(dir, 'evidence.json'), md: path.join(dir, 'REVIEW-REPORT.md') };
}

module.exports = { buildBundle, renderMarkdown, writeBundle, HUMAN_REVIEW_REQUIRED };
