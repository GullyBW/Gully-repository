'use strict';
// Phase 10 — Controlled Operational Readiness Assessment (HUMAN-GATED).
// Computes automated readiness SIGNALS across several dimensions, then STOPS: it never
// authorizes production deployment. Consistent with the maturity model, automation is
// capped (levels 7-10 require human attestation), so the final go/no-go is a recorded
// HUMAN governance decision — this script only informs it.
//
// Usage:
//   node scripts/readiness.js                       # print the readiness assessment
//   node scripts/readiness.js --attestations F.json # fold in human attestations (names + rationale)
//
// The output ALWAYS ends in "HUMAN AUTHORIZATION REQUIRED". There is no flag, input, or
// code path that makes this script return an authorization. Evidence ≠ authorization.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runTwin, runApp, runInfra } = require('../src/twin-validate');
const { Workflow } = require('../src/workflow');
const configMod = require('../src/config');

// Attestations that ONLY a named, accountable human can make (never automated).
const REQUIRED_ATTESTATIONS = [
  { id: 'ATT-CRYPTO', who: 'ISRB + cryptographic authority', what: '🔒 KMS/HSM + threshold key custody is human-built and ISRB-signed (not machine-generated)' },
  { id: 'ATT-DPIA', who: 'Data Protection Authority', what: 'Data Protection Impact Assessment approved for the anonymity model' },
  { id: 'ATT-PENTEST', who: 'Independent security assessor', what: 'Independent penetration test completed with no unresolved critical findings' },
  { id: 'ATT-ASSURANCE', who: 'Independent assurance body', what: 'Independent review of the assurance evidence package completed' },
  { id: 'ATT-OPS', who: 'Operations lead', what: 'Runbooks, DR/failover, and on-call verified in a staging exercise' },
  { id: 'ATT-GOVERNANCE', who: 'Oversight board (M-of-N)', what: 'Recorded governance decision authorizing controlled deployment' },
];

function fitnessDimension() {
  const results = [...runTwin(), ...runApp(), ...runInfra()];
  const failing = results.filter((r) => !r.pass);
  return { name: 'architecture-invariants', pass: failing.length === 0, detail: `${results.length - failing.length}/${results.length} invariants hold`, failing: failing.map((f) => f.id) };
}

function functionalDimension() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-readiness-${process.pid}.json`);
  let t = 1_700_000_000_000;
  const wf = new Workflow({ clock: () => (t += 1000), seed: 11, ledgerFile });
  const problems = [];
  try {
    const r = wf.submitReport({ category: 'police', content: 'x' });
    if (wf.status(r.case_code).status !== 'received') problems.push('submit/status broken');
    const ev = wf.attachEvidence({ case_code: r.case_code, content: 'blob' });
    if (ev.state !== 'ingested') problems.push('evidence intake broken');
    wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'escalate' });
    if (!wf.evidence.verifyCustodyChain().ok) problems.push('custody chain broken');
    if (!wf.audit.verifyIntegrity().ok) problems.push('audit integrity broken');
  } catch (e) { problems.push('functional smoke threw: ' + e.message); }
  finally { try { fs.unlinkSync(ledgerFile); } catch (_) {} }
  return { name: 'functional-smoke', pass: problems.length === 0, detail: problems.length ? problems.join('; ') : 'core workflow + integrity verified', failing: problems };
}

function adapterDimension() {
  const cfg = configMod.load({ NJTIP_PERSISTENCE: 'memory' });
  // Production drivers are intentionally not bundled; using reference drivers is NOT
  // production-ready on its own — each must be provisioned and HUMAN-verified.
  const usingReference = { persistence: cfg.persistence !== 'sql' || true, kms: cfg.kms === 'synthetic', objectStore: cfg.objectStore === 'memory', broker: cfg.broker === 'memory' };
  const notes = Object.entries(usingReference).filter(([, ref]) => ref).map(([p]) => p);
  return { name: 'production-adapters', pass: false, blocking: true, detail: `reference drivers in use for: ${notes.join(', ')} — production drivers must be provisioned + human-verified before go-live`, failing: notes };
}

function attestationDimension(attestations) {
  const signed = new Map((attestations || []).map((a) => [a.id, a]));
  const rows = REQUIRED_ATTESTATIONS.map((a) => {
    const s = signed.get(a.id);
    const ok = !!(s && s.by && s.rationale);
    return { id: a.id, who: a.who, what: a.what, signed: ok, by: ok ? s.by : null };
  });
  return { name: 'human-attestations', pass: rows.every((r) => r.signed), detail: `${rows.filter((r) => r.signed).length}/${rows.length} human attestations recorded`, rows };
}

function assess(attestations) {
  const dims = [fitnessDimension(), functionalDimension(), adapterDimension(), attestationDimension(attestations)];
  const automatedPass = fitnessDimension().pass && functionalDimension().pass;
  return {
    platform: 'NJTIP',
    version: configMod.load({ NJTIP_PERSISTENCE: 'memory' }).version,
    dimensions: dims,
    automatedChecksPass: automatedPass,
    // Automation ceiling: even with everything green, the script cannot exceed "prepared".
    automatedReadinessLevel: automatedPass ? 6 : 3,
    automatedReadinessCeiling: 6,
    decision: 'NOT AUTHORIZED — HUMAN AUTHORIZATION REQUIRED',
    humanGate: {
      required: true,
      reason: 'Production deployment is a recorded human governance decision. This script informs it; it never grants it.',
      outstanding: dims.filter((d) => !d.pass).map((d) => d.name),
    },
    note: 'Evidence ≠ authorization. No flag or input makes this assessment authorize deployment.',
  };
}

function main() {
  const argv = process.argv.slice(2);
  const ai = argv.indexOf('--attestations');
  let attestations = [];
  if (ai !== -1) { try { attestations = JSON.parse(fs.readFileSync(argv[ai + 1], 'utf8')); } catch (e) { console.error('could not read attestations: ' + e.message); } }
  const report = assess(attestations);
  console.log(JSON.stringify(report, null, 2));
  console.log('\n' + '='.repeat(72));
  console.log(report.automatedChecksPass ? '✅ Automated readiness checks PASS (capped at "prepared", level 6/10).' : '❌ Automated readiness checks did NOT pass.');
  console.log('🔒 DECISION: NOT AUTHORIZED — production go-live requires a recorded HUMAN governance decision.');
  console.log('   Outstanding human items: ' + (report.humanGate.outstanding.join(', ') || 'none automatable; human attestation still required'));
  // Exit reflects automated checks only; it NEVER signals authorization.
  process.exitCode = report.automatedChecksPass ? 0 : 1;
}
if (require.main === module) main();

module.exports = { assess, REQUIRED_ATTESTATIONS };
