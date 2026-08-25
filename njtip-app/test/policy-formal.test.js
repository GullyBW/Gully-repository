'use strict';
// v1.6 Phase 41 (policy governance) + Phase 42 (formal verification).
const { test } = require('node:test');
const assert = require('node:assert');
const { PolicyRegistry } = require('../src/iam/policy-governance');
const { DEFAULT_POLICIES } = require('../src/iam/policy-engine');
const fv = require('../src/orchestration/formal-verification');
const { DEFAULT_WORKFLOW } = require('../src/orchestration/workflow-engine');

test('policy governance: versioning, validated activation, impact, rollback, certification', () => {
  const reg = new PolicyRegistry({ clock: () => 1 });
  reg.register('ac', { owner: 'sec', policies: DEFAULT_POLICIES });
  // Activation refused when the validation suite fails (Twin-guarded change control).
  assert.throws(() => reg.activate('ac', 1, { validationSuite: [{ request: { action: 'read-evidence', subject: { role: 'citizen' } }, expect: 'permit' }] }), /validation failed/);
  reg.activate('ac', 1, { validationSuite: [{ request: { action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } }, expect: 'permit' }] });
  assert.strictEqual(reg.active('ac').version, 1);
  // A new version's impact is analysed against the active one.
  reg.register('ac', { owner: 'sec', policies: [] }); // v2 permits nothing
  const impact = reg.impact('ac', 2, [{ action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } }]);
  assert.strictEqual(impact.changed, 1);
  assert.strictEqual(impact.changes[0].from, 'permit');
  assert.strictEqual(impact.changes[0].to, 'deny');
  // Compatibility catches a permit→deny regression.
  assert.strictEqual(reg.checkCompatibility('ac', 2, [{ action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } }]).compatible, false);
  // Activate v2, then rollback to v1.
  reg.activate('ac', 2);
  assert.strictEqual(reg.rollback('ac', 1).version, 1);
  assert.strictEqual(reg.certify('ac').certified, true);
  assert.ok(reg.auditTrail().some((a) => a.event === 'rolled-back'));
});

test('formal verification: default workflow is proven correct', () => {
  const proof = fv.proveCorrectness(DEFAULT_WORKFLOW);
  assert.strictEqual(proof.proven, true, JSON.stringify(proof.properties.filter((p) => !p.proven)));
  assert.strictEqual(fv.verifyDeadlockFree(DEFAULT_WORKFLOW).proven, true);
  assert.strictEqual(fv.verifyLiveness(DEFAULT_WORKFLOW).proven, true);
  assert.strictEqual(fv.verifyReachability(DEFAULT_WORKFLOW).proven, true);
});

test('formal verification: proofs reject deadlock, unreachable, SoD, and safety violations', () => {
  // Deadlock.
  const dead = { id: 'd', version: 1, start: 's', terminal: ['done'], states: { s: { on: { go: 'stuck' } }, stuck: { on: {} }, done: { on: {} } } };
  assert.strictEqual(fv.verifyDeadlockFree(dead).proven, false);
  assert.strictEqual(fv.proveCorrectness(dead).proven, false);
  // Undefined transition target.
  const malformed = { id: 'm', version: 1, start: 'a', terminal: [], states: { a: { on: { x: 'ghost' } } } };
  assert.strictEqual(fv.verifyStateMachine(malformed).proven, false);
  // Separation of duties: same sole approver twice on a path.
  const sod = { id: 'sod', version: 1, start: 'a', terminal: ['end'], states: { a: { on: { go: 'b' }, approvals: ['r'] }, b: { on: { go: 'end' }, approvals: ['r'] }, end: { on: {} } } };
  assert.strictEqual(fv.verifySoD(sod).proven, false);
  // Safety obligation.
  const unsafe = { id: 'u', version: 1, start: 'a', terminal: ['closed'], states: { a: { on: { skip: 'closed', proper: 'decision' } }, decision: { on: { close: 'closed' } }, closed: { on: {} } } };
  assert.strictEqual(fv.verifySafety(unsafe, { critical: 'closed', requiredBefore: 'decision' }).proven, false);
});
