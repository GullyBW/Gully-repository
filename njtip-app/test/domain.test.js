'use strict';
// Tests for v1.2 business capabilities: RBAC+ABAC authorization and the case/evidence
// lifecycle state machines — plus their integration into the workflow.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const authz = require('../src/authz');
const caseLc = require('../src/domain/case-lifecycle');
const evLc = require('../src/domain/evidence-lifecycle');
const { Workflow } = require('../src/workflow');

function freshWf() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-dom-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  let t = 1_700_000_000_000;
  return { wf: new Workflow({ clock: () => (t += 1000), seed: 3, ledgerFile }), ledgerFile };
}

test('authz: default-deny RBAC + MFA step-up + ABAC zone/matter/accountability', () => {
  // RBAC ceiling.
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'list-reports' }).allow, true);
  assert.strictEqual(authz.authorize({ role: 'citizen', action: 'list-reports' }).allow, false);
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'admin-config' }).allow, false);
  // Unknown action → default-deny.
  assert.strictEqual(authz.authorize({ role: 'admin', action: 'nuke' }).allow, false);
  // MFA step-up: review-case requires FIDO2.
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'review-case' }).allow, false);
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'review-case', attributes: { mfa: 'fido2' } }).allow, true);
  // ABAC zone confinement.
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'transition-case', attributes: { principalZone: 'executive', resourceZone: 'judiciary' } }).allow, false);
  // ABAC matter scoping.
  assert.strictEqual(authz.authorize({ role: 'investigator', action: 'read-evidence', attributes: { mfa: 'fido2', matter: 'A', caseCode: 'B' } }).allow, false);
  // Accountability for governance decisions.
  assert.strictEqual(authz.authorize({ role: 'oversight-board', action: 'record-governance-decision', attributes: { mfa: 'fido2' } }).allow, false);
  assert.strictEqual(authz.authorize({ role: 'oversight-board', action: 'record-governance-decision', attributes: { mfa: 'fido2', reviewer: 'X', rationale: 'Y' } }).allow, true);
});

test('case lifecycle: legal transitions accepted, illegal rejected, terminal is closed', () => {
  assert.deepStrictEqual(caseLc.apply('received', 'escalate'), { ok: true, to: 'escalated' });
  assert.deepStrictEqual(caseLc.apply('received', 'review'), { ok: true, to: 'reviewed' });
  assert.strictEqual(caseLc.apply('received', 'resolve').ok, false); // must review/escalate first
  assert.strictEqual(caseLc.apply('closed', 'review').ok, false);    // terminal
  assert.strictEqual(caseLc.apply('escalated', 'boom').ok, false);   // unknown event
  assert.ok(caseLc.isTerminal('closed') && !caseLc.isTerminal('received'));
  assert.deepStrictEqual(caseLc.allowedEvents('reviewed').sort(), ['close', 'escalate', 'resolve']);
});

test('evidence lifecycle: ingested→sealed→under-review→admitted→purged', () => {
  assert.deepStrictEqual(evLc.apply('ingested', 'seal'), { ok: true, to: 'sealed' });
  assert.strictEqual(evLc.apply('ingested', 'admit').ok, false);     // cannot admit before review
  assert.deepStrictEqual(evLc.apply('under-review', 'admit'), { ok: true, to: 'admitted' });
  assert.deepStrictEqual(evLc.apply('under-review', 'exclude'), { ok: true, to: 'excluded' });
  assert.strictEqual(evLc.apply('purged', 'seal').ok, false);        // terminal
});

test('workflow: case transitions are guarded end-to-end', () => {
  const { wf, ledgerFile } = freshWf();
  const r = wf.submitReport({ category: 'police', content: 'x' });
  assert.strictEqual(wf.status(r.case_code).status, 'received');
  // Illegal: resolve directly from received.
  assert.throws(() => wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'resolve' }), /case lifecycle/);
  // Legal path: escalate → resolve → close.
  assert.strictEqual(wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'escalate' }).status, 'escalated');
  assert.strictEqual(wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'resolve' }).status, 'resolved');
  const closed = wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'close' });
  assert.strictEqual(closed.status, 'closed');
  assert.deepStrictEqual(closed.allowed, []); // terminal
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});

test('workflow: evidence transitions are guarded and durable on the case projection', () => {
  const { wf, ledgerFile } = freshWf();
  const r = wf.submitReport({ category: 'courts', content: 'x' });
  const ev = wf.attachEvidence({ case_code: r.case_code, content: 'blob' });
  assert.strictEqual(ev.state, 'ingested');
  // Illegal: admit before review.
  assert.throws(() => wf.evidenceTransition({ case_code: r.case_code, evidenceId: ev.evidenceId, event: 'admit' }), /evidence lifecycle/);
  // Legal path: seal → open → admit.
  assert.strictEqual(wf.evidenceTransition({ case_code: r.case_code, evidenceId: ev.evidenceId, event: 'seal' }).state, 'sealed');
  assert.strictEqual(wf.evidenceTransition({ case_code: r.case_code, evidenceId: ev.evidenceId, event: 'open' }).state, 'under-review');
  assert.strictEqual(wf.evidenceTransition({ case_code: r.case_code, evidenceId: ev.evidenceId, event: 'admit' }).state, 'admitted');
  // Custody chain integrity is unaffected by handling-state changes.
  assert.strictEqual(wf.evidence.verifyCustodyChain().ok, true);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});
