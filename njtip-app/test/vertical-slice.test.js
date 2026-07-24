'use strict';
// End-to-end vertical slice test (deterministic): Citizen → Report → Policy → Evidence
// → Audit → Investigator → Oversight → Governance → Evidence → Twin validation.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Workflow } = require('../src/workflow');
const { twinValidate } = require('../src/server');

function logicalClock(start = 1_700_000_000_000) { let t = start; return () => (t += 1000); }
function freshWf() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-wf-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  return { wf: new Workflow({ clock: logicalClock(), seed: 7, ledgerFile }), ledgerFile };
}

test('full vertical slice runs end to end', () => {
  const { wf, ledgerFile } = freshWf();
  // 1) Citizen anonymous report (police → must NOT route to police / CoI).
  const r = wf.submitReport({ category: 'police', content: 'observed irregular handling' });
  assert.ok(r.case_code.startsWith('NJ-'));
  assert.notStrictEqual(r.recipient, 'police');
  assert.strictEqual(r.coi, 'clear');
  // 2) Status by code only.
  assert.strictEqual(wf.status(r.case_code).status, 'received');
  // 3) Evidence + custody.
  const ev = wf.attachEvidence({ case_code: r.case_code, content: 'synthetic evidence blob' });
  assert.ok(ev.contentHash);
  assert.strictEqual(wf.evidence.verifyCustodyChain().ok, true);
  // 4) Investigator review (authorized).
  const rev = wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: 'escalate' });
  assert.strictEqual(rev.status, 'escalated');
  // 5) Oversight aggregates (non-attributable) + audit integrity.
  const d = wf.oversightDashboard();
  assert.strictEqual(d.totalReports, 1);
  assert.strictEqual(d.auditIntegrity, true);
  // 6) Governance decision — recorded human decision.
  const g = wf.governanceDecision({ reviewer: 'OB Chair', role: 'oversight-board', subject: 'MVP', verdict: 'defer', rationale: 'await legal opinion' });
  assert.strictEqual(g.recorded, true);
  assert.strictEqual(wf.ledger.verify().ok, true);
  // 7) Evidence generation.
  assert.ok(wf.generateEvidence().digest);
  try{fs.unlinkSync(ledgerFile);}catch(_){}
});

test('identity is rejected by construction (defense in depth)', () => {
  const { wf, ledgerFile } = freshWf();
  assert.throws(() => wf.submitReport({ category: 'courts', content: 'x', extra: { email: 'a@b.c' } }));
  assert.throws(() => wf.submitReport({ category: 'courts', content: 'x', extra: { omang: '123456789' } }));
  try{fs.unlinkSync(ledgerFile);}catch(_){}
});

test('investigator review requires authorization', () => {
  const { wf, ledgerFile } = freshWf();
  const r = wf.submitReport({ category: 'official', content: 'x' });
  // Unregistered principal → grant throws (unknown principal) → not authorized.
  assert.throws(() => wf.investigatorReview({ principal: 'ghost', case_code: r.case_code, disposition: 'reviewed' }));
  try{fs.unlinkSync(ledgerFile);}catch(_){}
});

test('governance decisions cannot be recorded without an accountable human + rationale', () => {
  const { wf, ledgerFile } = freshWf();
  assert.throws(() => wf.governanceDecision({ subject: 'x', verdict: 'y', rationale: 'z' })); // no reviewer
  assert.throws(() => wf.governanceDecision({ reviewer: 'A', subject: 'x', verdict: 'y' })); // no rationale
  try{fs.unlinkSync(ledgerFile);}catch(_){}
});

test('workflow evidence is deterministic given identical seeded inputs', () => {
  const run = () => {
    const { wf, ledgerFile } = freshWf();
    wf.submitReport({ category: 'prison', content: 'a' });
    wf.submitReport({ category: 'regulatory', content: 'b' });
    const dig = wf.generateEvidence().digest;
    try{fs.unlinkSync(ledgerFile);}catch(_){}
    return dig;
  };
  assert.strictEqual(run(), run());
});

test('the running product validates against the Digital Engineering Twin', () => {
  const v = twinValidate();
  assert.strictEqual(v.invariantsHeld, true, 'failing: ' + v.failing.join(', '));
  assert.strictEqual(v.passed, v.total);
});
