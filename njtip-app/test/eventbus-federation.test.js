'use strict';
// v1.5 Phase 28 (enterprise event bus) + Phase 34 (federated multi-tenant collaboration).
const { test } = require('node:test');
const assert = require('node:assert');
const { EnterpriseEventBus, makeEventBus } = require('../src/fabric/event-bus');
const { FederationRegistry } = require('../src/tenancy/federation');
const { TenantRegistry } = require('../src/tenancy/tenant');

test('event bus: topics, filtered pub/sub, ordering, replay, DLQ governance, federation', () => {
  let now = 0;
  const bus = new EnterpriseEventBus({ clock: () => (now += 1) });
  bus.registerTopic('case.events', { owner: 'case-context' });
  const seen = [];
  bus.subscribe('case.events', 'analytics', (p) => seen.push(p.caseCode), { filter: { category: 'police' } });
  bus.publish('case.events', { caseCode: 'NJ-1', category: 'police' });
  bus.publish('case.events', { caseCode: 'NJ-2', category: 'courts' }); // filtered out
  assert.deepStrictEqual(seen, ['NJ-1']);
  // Ordering + replay.
  assert.deepStrictEqual(bus.replay('case.events').map((e) => e.seq), [1, 2]);
  assert.strictEqual(bus.replay('case.events', { fromSeq: 1 }).length, 1);
  // PII-free enforced.
  assert.throws(() => bus.publish('case.events', { email: 'a@b.c' }), /refuses PII/);
  // Non-memory driver fails closed.
  assert.throws(() => makeEventBus({ eventBus: 'kafka' }), /drop-in/);
  // Cross-agency federation forwards events to another bus.
  const other = new EnterpriseEventBus({ clock: () => (now += 1) });
  const f = bus.federate('case.events', other, { targetTopic: 'federated.cases' });
  assert.strictEqual(f.forwarded, 2);
  assert.strictEqual(other.replay('federated.cases').length, 2);
});

test('federation: isolation by default; explicit SoD-authorized, time-boxed grants', () => {
  let now = 0;
  const reg = new TenantRegistry(); reg.register('dcec'); reg.register('courts');
  const fed = new FederationRegistry({ clock: () => now, registry: reg });
  // Default: not federated.
  assert.strictEqual(fed.isFederated('dcec', 'courts', 'cases'), false);
  // Requires explicit scopes + distinct approver.
  assert.throws(() => fed.authorize({ fromTenant: 'dcec', toTenant: 'courts', scopes: [], approver: 'a', requester: 'b' }), /explicit scopes/);
  assert.throws(() => fed.authorize({ fromTenant: 'dcec', toTenant: 'courts', scopes: ['cases'], approver: 'a', requester: 'a' }), /separation of duties/);
  const g = fed.authorize({ fromTenant: 'dcec', toTenant: 'courts', scopes: ['cases'], approver: 'chair', requester: 'lead', ttlMs: 100 });
  assert.strictEqual(fed.isFederated('dcec', 'courts', 'cases'), true);
  assert.strictEqual(fed.isFederated('dcec', 'courts', 'evidence'), false); // scope-limited
  // Expiry restores isolation.
  now += 150;
  assert.strictEqual(fed.isFederated('dcec', 'courts', 'cases'), false);
  // Audit trail records the grant.
  assert.ok(fed.auditTrail().some((a) => a.event === 'federation-authorized'));
});

test('federation: temporary collaboration space (PII-free refs) + federated search', () => {
  let now = 0;
  const reg = new TenantRegistry(); reg.register('a'); reg.register('b');
  const fed = new FederationRegistry({ clock: () => now, registry: reg });
  const space = fed.createSpace({ tenants: ['a', 'b'], reason: 'joint-investigation', ttlMs: 1000 });
  fed.shareRef(space.id, { caseCode: 'NJ-1', kind: 'referral' });
  assert.throws(() => fed.shareRef(space.id, { content: 'secret' }), /refuses field/);
  assert.strictEqual(fed.space(space.id).refs.length, 1);
  // Federated search respects isolation until authorized.
  const stores = { a: { searchCases: () => [{ case_code: 'A1' }] }, b: { searchCases: () => [{ case_code: 'B1' }] } };
  assert.strictEqual(fed.federatedSearch('a', 'cases', stores, 'x').length, 1); // only self
  fed.authorize({ fromTenant: 'a', toTenant: 'b', scopes: ['cases'], approver: 'chair', requester: 'lead' });
  assert.strictEqual(fed.federatedSearch('a', 'cases', stores, 'x').length, 2); // self + federated
});
