'use strict';
// Independent evidence verification. Recomputes the deterministic content digest
// from the evidence bundle, verifies the Ed25519 signature, and verifies the
// immutable archive chain. Anyone with the public key can run this — evidence is
// independently verifiable, not "trust us."
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../src/util/hash');
const { verify } = require('../src/evidence/signing');
const { EvidenceArchive } = require('../src/evidence/archive');

const OUT = path.join(__dirname, '..', 'evidence-out');

function recomputeDigest(b) {
  const core = {
    verification: b.verification.map((v) => ({ id: v.id, pass: v.pass, violations: v.violations, severity: v.severity, refs: v.refs })),
    adversarial: b.adversarial.map((s) => ({ id: s.id, pass: s.pass, threats: s.threats, metrics: s.metrics })),
    formal: b.formal.map((f) => ({ id: f.id, pass: f.pass, statesExplored: f.statesExplored, counterexample: f.counterexample })),
    chaos: b.chaos.map((c) => ({ id: c.id, pass: c.pass, degraded: c.degraded, recovered: c.recovered })),
    traceabilityCoverage: b.traceability.coverage,
    compliance: b.compliance.frameworkSummary,
    drift: { drift: b.drift.drift, deviations: b.drift.deviations },
    maturity: { achievedLevel: b.maturity.achievedLevel, automatedCap: b.maturity.automatedCap },
    version: b.meta.version,
  };
  return sha256(core);
}

function main() {
  const bundle = JSON.parse(fs.readFileSync(path.join(OUT, 'evidence.json'), 'utf8'));
  const recomputed = recomputeDigest(bundle);
  const digestOk = recomputed === bundle.meta.contentDigest;
  const sigOk = verify(bundle.meta.contentDigest, bundle.signature);
  const archiveOk = new EvidenceArchive(path.join(OUT, 'archive.json')).verify().ok;

  console.log('=== Independent Evidence Verification ===');
  console.log(`Digest recomputation: ${digestOk ? 'MATCH' : 'MISMATCH'} (${recomputed.slice(0, 16)}…)`);
  console.log(`Signature (Ed25519):  ${sigOk ? 'VALID' : 'INVALID'}`);
  console.log(`Archive chain:        ${archiveOk ? 'VERIFIED' : 'BROKEN'}`);
  const ok = digestOk && sigOk && archiveOk;
  console.log(ok ? '\n✅ Evidence is authentic and reproducible.' : '\n❌ Evidence verification FAILED.');
  if (!ok) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { recomputeDigest };
