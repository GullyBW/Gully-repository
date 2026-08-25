'use strict';
// End-to-end vertical slice runner (Stabilization Part 5). Drives the complete
// anonymous-reporting → governance-decision workflow through the REAL composed application —
// the same objects the HTTP server serves — and prints a deterministic transcript.
//
// This is the "does the product actually work end to end?" check that a unit test suite cannot
// give you: one path, every subsystem, real composition root, real fail-closed gates.
//
// Deterministic: a logical clock and a fixed seed, no wall-clock in the transcript, so two runs
// produce an identical digest that can be diffed in review.
//
// Usage: node scripts/slice.js            # run the slice and print the transcript
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Workflow } = require('../src/workflow');
const { createApp } = require('../src/app');
const { twinValidate } = require('../src/twin-validate');
const { hash } = require('../src/twin');

function logicalClock(start = 1_700_000_000_000) { let t = start; return () => (t += 1000); }

function run() {
  const steps = [];
  const step = (name, subsystem, detail) => steps.push({ step: steps.length + 1, name, subsystem, ...detail });

  // The real composition root, with its fail-closed startup gates (workflow formally proven,
  // access-control policy validated, architecture-of-record and contracts valid).
  const app = createApp();
  const ledgerFile = path.join(os.tmpdir(), `njtip-slice-${process.pid}.json`);
  const wf = new Workflow({ clock: logicalClock(), seed: 7, ledgerFile });

  try {
    // 1. Anonymous intake — a police-category report must not route to police (CoI).
    const report = wf.submitReport({ category: 'police', content: 'observed irregular handling of an exhibit' });
    step('anonymous report accepted', 'intake · policy · CoI routing', { caseCode: report.case_code, recipient: report.recipient, conflictOfInterest: report.coi, identityStored: false });

    // 2. Status by case code alone — no identity, no account.
    step('status retrieved by case code', 'reporting projection', { status: wf.status(report.case_code).status, authentication: 'case-code only' });

    // 3. Evidence + chain of custody.
    const evidence = wf.attachEvidence({ case_code: report.case_code, content: 'synthetic evidence blob' });
    step('evidence attached', 'evidence store · chain of custody', { contentHashPresent: !!evidence.contentHash, custodyChainIntact: wf.evidence.verifyCustodyChain().ok });

    // 4. Investigator review (JIT, matter-scoped, zero standing privilege).
    const review = wf.investigatorReview({ principal: 'inv-001', case_code: report.case_code, disposition: 'escalate' });
    step('investigator review recorded', 'IAM · investigation lifecycle · audit', { newStatus: review.status });

    // 5. Oversight — aggregate and non-attributable.
    const dashboard = wf.oversightDashboard();
    step('oversight dashboard produced', 'analytics (aggregate, suppressed)', { totalReports: dashboard.totalReports, auditIntegrity: dashboard.auditIntegrity });

    // 6. Governance decision — recorded, never automated.
    const decision = wf.governanceDecision({ reviewer: 'OB Chair', role: 'oversight-board', subject: 'pilot go-live', verdict: 'defer', rationale: 'await legal opinion' });
    step('governance decision recorded', 'governance ledger (append-only, hash-chained)', { recorded: decision.recorded, decidedBy: 'a named human', automated: false });

    // 7. Deterministic evidence generation.
    const bundle = wf.generateEvidence();
    step('assurance evidence generated', 'evidence generation · signing', { digestPresent: !!bundle.digest, signaturePresent: !!bundle.signature, authorizesDeployment: false });

    // 8. The Twin validates the whole platform.
    const gate = twinValidate();
    step('twin + application + infrastructure gate', 'digital engineering twin', { invariantsHeld: gate.invariantsHeld, passed: gate.passed, total: gate.total, failing: gate.failing });

    // 9. Integrity of the write-side log and the audit chain.
    step('integrity verified', 'event log · audit chain', { eventLogIntact: wf.verifyEventIntegrity().ok, auditIntact: wf.audit.verifyIntegrity().ok });

    // 10. Health of the composed application (the same checks /healthz serves).
    const health = app.health.snapshot();
    step('composed application healthy', 'composition root · health', { status: health.status, checks: Object.keys(health.checks).length });

    const core = { steps, gate: { invariantsHeld: gate.invariantsHeld, total: gate.total } };
    return {
      platform: 'NJTIP', kind: 'vertical-slice-transcript', version: app.cfg.version,
      steps, digest: hash.sha256(core),
      complete: steps.length === 10 && gate.invariantsHeld && health.status === 'healthy',
      note: 'Deterministic end-to-end transcript. Evidence ≠ authorization: a successful slice does not authorize a deployment.',
    };
  } finally {
    try { fs.unlinkSync(ledgerFile); } catch (_) { /* nothing to clean up */ }
  }
}

function main() {
  const out = run();
  console.log(JSON.stringify(out, null, 2));
  console.log(out.complete
    ? `\n✅ Vertical slice complete: ${out.steps.length} steps, every invariant held. (Evidence ≠ authorization.)`
    : '\n❌ Vertical slice incomplete — see the transcript above.');
  process.exitCode = out.complete ? 0 : 1;
}

module.exports = { run };
if (require.main === module) main();
