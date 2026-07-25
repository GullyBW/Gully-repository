'use strict';
// v1.7 Phase 51 (national digital identity & trust) + Phase 52 (infrastructure governance).
const { test } = require('node:test');
const assert = require('node:assert');
const { IdentityRegistry } = require('../src/iam/digital-identity');
const { InfrastructureRegistry } = require('../src/infra/infra-governance');

test('digital identity: governed principals only (personal data refused), assurance levels', () => {
  const reg = new IdentityRegistry({ clock: () => 1 });
  assert.throws(() => reg.register('p', { type: 'person', attributes: { omang: '123' } }), /refuses personal-data/);
  assert.throws(() => reg.register('s', { type: 'service', assuranceLevel: 'IAL9' }), /assurance level/);
  reg.register('svc:api', { type: 'service', assuranceLevel: 'IAL3', attributes: { zone: 'independent' } });
  assert.strictEqual(reg.describe('svc:api').assuranceLevel, 'IAL3');
  // Assurance downgrade is flagged (compatibility validation).
  assert.strictEqual(reg.checkAssuranceChange('svc:api', 'IAL1').downgrade, true);
  assert.strictEqual(reg.checkAssuranceChange('svc:api', 'IAL3').ok, true);
});

test('digital identity: verifiable credential lifecycle, trust chain, revocation', () => {
  const reg = new IdentityRegistry({ clock: () => 1000 });
  reg.register('svc:api', { type: 'service', assuranceLevel: 'IAL2' });
  // Untrusted issuer refused (fail-closed).
  assert.throws(() => reg.issueCredential({ credId: 'c1', subject: 'svc:api', issuer: 'rogue' }), /trust registry/);
  reg.registerIssuer('national-ca', { trustLevel: 'sovereign' });
  reg.issueCredential({ credId: 'c1', subject: 'svc:api', issuer: 'national-ca', claims: { role: 'intake' } });
  // Personal-data claims refused.
  assert.throws(() => reg.issueCredential({ credId: 'c2', subject: 'svc:api', issuer: 'national-ca', claims: { email: 'a@b.c' } }), /refuses personal-data/);
  // Verify + trust chain.
  assert.strictEqual(reg.verifyCredential('c1').valid, true);
  assert.strictEqual(reg.validateTrustChain('c1').ok, true);
  // Revocation.
  reg.revoke('c1');
  assert.strictEqual(reg.verifyCredential('c1').valid, false);
  assert.strictEqual(reg.verifyCredential('c1').reason, 'revoked');
  assert.ok(reg.auditTrail().some((a) => a.event === 'credential-revoked'));
});

test('infrastructure governance: residency, compliance, drift, lifecycle, readiness', () => {
  const infra = new InfrastructureRegistry({ clock: () => 1 });
  infra.setPolicy({ allowedRegions: ['bw-central', 'bw-south'], allowedProviders: ['sovereign-cloud'], residency: { secret: 'bw-central' } });
  infra.register('storage:evidence', { kind: 'storage', region: 'bw-central', provider: 'sovereign-cloud', dataClassification: 'secret' });
  assert.strictEqual(infra.validateCompliance().compliant, true);
  infra.recordBaseline();
  // Residency + provider violations detected.
  infra.register('storage:bad', { kind: 'storage', region: 'off-shore', provider: 'foreign-cloud', dataClassification: 'secret' });
  const c = infra.validateCompliance();
  assert.strictEqual(c.compliant, false);
  assert.ok(c.violations.some((x) => x.rule === 'residency'));
  assert.ok(c.violations.some((x) => x.rule === 'provider'));
  // Drift detected after the new resource.
  assert.strictEqual(infra.detectDrift().drift, true);
  // Lifecycle governance.
  assert.strictEqual(infra.transition('storage:evidence', 'draining').state, 'draining');
  assert.throws(() => infra.transition('storage:evidence', 'bogus'), /invalid state/);
  // Readiness is human-gated + reflects compliance.
  const r = infra.readiness();
  assert.strictEqual(r.humanGate, true);
  assert.strictEqual(r.ready, false);
});
