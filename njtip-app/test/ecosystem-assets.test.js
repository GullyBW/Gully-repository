'use strict';
// v1.8 Phase 61 (ecosystem federation) + Phase 62 (digital asset governance).
const { test } = require('node:test');
const assert = require('node:assert');
const { EcosystemFederation } = require('../src/tenancy/ecosystem-federation');
const { AssetRegistry } = require('../src/governance/asset-governance');

test('ecosystem federation: typed members, explicit SoD agreements, service discovery, identity trust', () => {
  let now = 0;
  const ef = new EcosystemFederation({ clock: () => now });
  ef.registerMember('national-gov', { type: 'government', trustTier: 'sovereign' });
  ef.registerMember('city', { type: 'municipality' });
  ef.registerMember('utility', { type: 'soe' });
  assert.throws(() => ef.registerMember('x', { type: 'alien' }), /valid type/);
  // Isolation by default.
  assert.strictEqual(ef.isFederated('national-gov', 'city', 'services'), false);
  // Explicit, scoped, SoD-authorised, time-boxed.
  assert.throws(() => ef.establishAgreement({ from: 'national-gov', to: 'city', scopes: [], approver: 'a', requester: 'b' }), /explicit scopes/);
  assert.throws(() => ef.establishAgreement({ from: 'national-gov', to: 'city', scopes: ['services'], approver: 'a', requester: 'a' }), /separation of duties/);
  ef.establishAgreement({ from: 'national-gov', to: 'city', scopes: ['services', 'identity'], approver: 'minister', requester: 'cto', ttlMs: 100 });
  assert.strictEqual(ef.isFederated('national-gov', 'city', 'services'), true);
  // Federated service discovery respects agreements.
  ef.registerService('city', 'permits-api'); ef.registerService('utility', 'billing-api');
  const disc = ef.discoverServices('national-gov', 'services');
  assert.ok(disc.some((d) => d.member === 'city'));
  assert.ok(!disc.some((d) => d.member === 'utility')); // no agreement with utility
  // Federated identity trust.
  assert.strictEqual(ef.acceptsIdentityFrom('national-gov', 'city'), true);
  assert.strictEqual(ef.acceptsIdentityFrom('national-gov', 'utility'), false);
  // Expiry restores isolation.
  now += 150;
  assert.strictEqual(ef.isFederated('national-gov', 'city', 'services'), false);
  assert.ok(ef.auditTrail().some((a) => a.event === 'agreement-established'));
});

test('digital asset governance: all types, lifecycle, versioning, dependency, health, traceability', () => {
  const ar = new AssetRegistry({ clock: () => 1 });
  ar.register('api1', { type: 'api', owner: 'independent', riskClass: 'medium' });
  ar.register('model1', { type: 'ai-model', owner: 'analytics', riskClass: 'high', dependsOn: ['api1'] });
  assert.throws(() => ar.register('bad', { type: 'spaceship', owner: 'o' }), /valid type/);
  // Version governance + traceability (immutable history).
  ar.activate('api1'); ar.amend('api1', { summary: 'add field' });
  assert.strictEqual(ar.describe('api1').version, 2);
  assert.ok(ar.trace('api1').length >= 3);
  // Dependency mapping + impact.
  assert.deepStrictEqual(ar.dependencyMap().model1, ['api1']);
  assert.deepStrictEqual(ar.impact('api1'), ['model1']);
  // Lifecycle order: retire requires deprecate.
  assert.throws(() => ar.retire('api1'), /must be deprecated/);
  ar.deprecate('api1'); ar.retire('api1');
  assert.strictEqual(ar.describe('api1').status, 'retired');
  // Health scoring reflects status + risk.
  assert.ok(ar.health('api1').health < ar.health('model1').health || ar.health('model1').band !== 'healthy');
  const ph = ar.portfolioHealth();
  assert.ok(ph.assets === 2 && typeof ph.averageHealth === 'number');
});
