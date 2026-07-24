'use strict';
// v1.4 Phase 12 (policy-as-data ABAC/PBAC) + Phase 19 (Zero Trust: trust scoring,
// continuous authorization, device trust, break-glass emergency access).
const { test } = require('node:test');
const assert = require('node:assert');
const { PolicySet, DEFAULT_POLICIES } = require('../src/iam/policy-engine');
const zt = require('../src/iam/zero-trust');

test('policy engine: default-deny, deny-overrides, obligations, runtime reconfigurable', () => {
  const ps = new PolicySet(DEFAULT_POLICIES);
  // Investigator with MFA gets a permit + obligations.
  const ok = ps.evaluate({ action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' } });
  assert.strictEqual(ok.decision, 'permit');
  assert.ok(ok.obligations.includes('record-authz-audit'));
  // Same action, no MFA → default-deny (no matching permit).
  assert.strictEqual(ps.evaluate({ action: 'read-evidence', subject: { role: 'investigator' } }).decision, 'deny');
  // Deny-overrides: a suspended subject is denied even if a permit would match.
  assert.strictEqual(ps.evaluate({ action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2', suspended: true } }).decision, 'deny');
  // Geographic restriction.
  assert.strictEqual(ps.evaluate({ action: 'read-evidence', subject: { role: 'investigator', mfa: 'fido2' }, env: { geoAllowed: false } }).decision, 'deny');
  // Reconfigure WITHOUT code change: load a new policy set.
  ps.load([{ id: 'permit-all-admin', effect: 'permit', actions: '*', conditions: [{ attr: 'subject.role', op: 'eq', value: 'admin' }] }]);
  assert.strictEqual(ps.evaluate({ action: 'anything', subject: { role: 'admin' } }).decision, 'permit');
  assert.strictEqual(ps.evaluate({ action: 'anything', subject: { role: 'investigator' } }).decision, 'deny');
});

test('zero trust: trust score from signals; continuous authorization tiers', () => {
  const strong = zt.trustScore({ mfa: 'fido2', deviceTrusted: true, geoAllowed: true, freshAuthMs: 1000 });
  assert.ok(strong.score >= 90);
  assert.strictEqual(zt.continuousAuthz({ action: 'read-evidence', score: strong.score }).decision, 'allow');
  const medium = zt.trustScore({ mfa: 'otp', deviceTrusted: false, geoAllowed: true, freshAuthMs: 1000 });
  const d = zt.continuousAuthz({ action: 'read-evidence', score: medium.score });
  assert.ok(['step-up', 'deny'].includes(d.decision)); // sensitive action, not full trust
  const weak = zt.trustScore({ mfa: 'none', deviceTrusted: false, geoAllowed: false, riskLevel: 'high' });
  assert.strictEqual(zt.continuousAuthz({ action: 'read-evidence', score: weak.score }).decision, 'deny');
});

test('device trust registry: trust + revoke', () => {
  const dr = new zt.DeviceRegistry();
  dr.register('dev-1', { trusted: true });
  assert.strictEqual(dr.isTrusted('dev-1'), true);
  assert.strictEqual(dr.isTrusted('dev-unknown'), false);
  dr.revoke('dev-1');
  assert.strictEqual(dr.isTrusted('dev-1'), false);
});

test('break-glass: time-boxed, justification-bound, separation of duties, audited', () => {
  let now = 0;
  const bg = new zt.BreakGlass({ clock: () => now, ttlMs: 100 });
  assert.throws(() => bg.request({ principal: 'a', justification: '', approver: 'b' }), /justification/);
  assert.throws(() => bg.request({ principal: 'a', justification: 'urgent', approver: 'a' }), /separation of duties/);
  const g = bg.request({ principal: 'a', justification: 'urgent incident', approver: 'b' });
  assert.strictEqual(bg.active(g.id), true);
  now += 150; // expired
  assert.strictEqual(bg.active(g.id), false);
  // The grant is on the audit ledger.
  assert.strictEqual(bg.ledger()[0].approver, 'b');
});
