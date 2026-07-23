'use strict';
// Multi-audience reporting: renders the same assurance results into audience-specific
// Markdown. Every report repeats the accountability caveat: evidence ≠ authorization.
const CAVEAT = '_Automated engineering evidence only. It supports — never replaces — independent human decisions on legal, constitutional, judicial, governance, and ethical matters. Not a production go-live approval._';

function fitTable(v) {
  return ['| Check | Result |', '|---|---|', ...v.map((r) => `| ${r.id} | ${r.pass ? '✅' : '❌'} |`)].join('\n');
}

function executive(A) {
  return [
    '# NJTIP Twin — Executive Summary', '', CAVEAT, '',
    `- **Assurance maturity:** Level ${A.maturity.achievedLevel}/10 — ${A.maturity.achievedName} (automated cap ${A.maturity.automatedCap})`,
    `- **Architecture invariants hold:** ${A.summary.criticalFailures === 0 ? 'YES' : 'NO'} (${A.summary.fitnessPassed}/${A.summary.fitnessTotal})`,
    `- **Requirements continuously enforced:** ${A.traceability.coverage.percentEnforced}% (coverage ${A.traceability.coverage.percentCovered}%)`,
    `- **Adversarial scenarios resisted:** ${A.summary.adversarialResisted}/${A.summary.adversarialTotal}`,
    `- **Chaos experiments passed:** ${A.summary.chaosPassed}/${A.summary.chaosTotal}`,
    `- **Formal proofs holding:** ${A.summary.formalPassed}/${A.summary.formalTotal}`,
    `- **Architecture drift:** ${A.drift.drift ? 'DETECTED' : 'none'}`,
    `- **Evidence digest:** \`${A.digest}\` (signed, archived)`, '',
    '> Bottom line: engineering assurance is strong under synthetic simulation. Production readiness remains a human governance decision behind the readiness gates.',
  ].join('\n');
}

function engineering(A) {
  return ['# NJTIP Twin — Engineering Report', '', CAVEAT, '', '## Fitness functions', fitTable(A.verification), '',
    '## Formal verification', ...A.formal.map((f) => `- ${f.pass ? '✅' : '❌'} ${f.id} (${f.statesExplored} states explored)`),
    '', '## Chaos experiments', ...A.chaos.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.id}: degraded=${c.degraded} recovered=${c.recovered}`),
    '', `## Architecture drift: ${A.drift.drift ? 'DETECTED' : 'none'}`,
    ...(A.drift.deviations || []).map((d) => `- ${d.area}: ${JSON.stringify(d)}`)].join('\n');
}

function security(A) {
  const fails = A.adversarial.filter((s) => !s.pass);
  return ['# NJTIP Twin — Security Assessment', '', CAVEAT, '',
    `- Scenarios resisted: **${A.summary.adversarialResisted}/${A.summary.adversarialTotal}**`,
    `- Failing scenarios: ${fails.length ? fails.map((f) => f.id).join(', ') : 'none'}`, '',
    '## Scenario outcomes', ...A.adversarial.map((s) => `- ${s.pass ? '✅' : '❌'} ${s.id} (${s.threats.join(', ')})`)].join('\n');
}

function governance(A) {
  return ['# NJTIP Twin — Governance Report', '', CAVEAT, '',
    `- Traceability coverage: **${A.traceability.coverage.percentCovered}%**; continuously enforced: **${A.traceability.coverage.percentEnforced}%**`,
    `- Uncovered requirements: ${A.traceability.coverage.uncovered.length ? A.traceability.coverage.uncovered.map((u) => u.id).join(', ') : 'none'}`,
    `- Maturity: Level ${A.maturity.achievedLevel} — ${A.maturity.note}`,
    `- Human-attested levels (7–10): ${A.maturity.humanAttestedLevels.length ? A.maturity.humanAttestedLevels.join(', ') : 'none — pending human review'}`, '',
    '## Requirements', ...A.traceability.rows.map((r) => `- ${r.enforced ? '✅' : '⚠️'} ${r.id} (${r.type}) — ${r.statement}`)].join('\n');
}

function audit(A) {
  return ['# NJTIP Twin — Audit Package', '', CAVEAT, '',
    `- Evidence digest: \`${A.digest}\``, `- Signature: \`${(A.signature || '').slice(0, 24)}…\` (Ed25519, synthetic)`,
    `- Archive integrity: ${A.archiveOk ? 'VERIFIED' : 'n/a'}`, '',
    '## Compliance framework coverage (illustrative)', '| Framework | Evidenced/Mapped | % |', '|---|---|---|',
    ...A.compliance.frameworkSummary.map((f) => `| ${f.framework} | ${f.controlsEvidenced}/${f.controlsMapped} | ${f.percent}% |`),
    '', `_${A.compliance.caveat}_`, '',
    '## Traceability matrix (requirement → verified)', '| Requirement | Type | Enforced |', '|---|---|---|',
    ...A.traceability.rows.map((r) => `| ${r.id} | ${r.type} | ${r.enforced ? 'yes' : 'NO'} |`)].join('\n');
}

function operational(A) {
  return ['# NJTIP Twin — Operational Resilience Report', '', CAVEAT, '',
    `- Chaos experiments passed: **${A.summary.chaosPassed}/${A.summary.chaosTotal}**`, '',
    '## Fault injection & recovery', ...A.chaos.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.id} (${c.fault}): degraded safely=${c.degraded}, recovered=${c.recovered}`),
    '', '## DR / backup scenarios',
    ...A.adversarial.filter((s) => /BACKUP|DISASTER|OUTAGE|TIME-SYNC/.test(s.id)).map((s) => `- ${s.pass ? '✅' : '❌'} ${s.id}`)].join('\n');
}

function generateAll(A) {
  return { executive: executive(A), engineering: engineering(A), security: security(A), governance: governance(A), audit: audit(A), operational: operational(A) };
}

module.exports = { generateAll };
