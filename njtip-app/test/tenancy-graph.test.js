'use strict';
// v1.4 Phase 22 (multi-tenant isolation + cross-agency collaboration) and Phase 23
// (privacy-preserving knowledge graph: link analysis + pattern detection).
const { test } = require('node:test');
const assert = require('node:assert');
const { TenantRegistry, TenantScopedStore, CollaborationBroker } = require('../src/tenancy/tenant');
const { KnowledgeGraph } = require('../src/graph/graph');
const { MemoryStore } = require('../src/adapters/store');

test('tenant registry: slugs, per-tenant key ref + policy set', () => {
  const reg = new TenantRegistry();
  const t = reg.register('police-service', { name: 'Police Service' });
  assert.strictEqual(t.keyRef, 'synthetic-kms://tenant/police-service');
  assert.ok(t.policies);
  assert.throws(() => reg.register('BadSlug!'), /slug/);
  assert.throws(() => reg.register('police-service'), /already registered/);
});

test('tenant-scoped store: cross-tenant access is fail-closed', () => {
  const inner = new MemoryStore('independent');
  const a = new TenantScopedStore(inner, 'agency-a');
  const b = new TenantScopedStore(inner, 'agency-b');
  a.put('case-1', { status: 'open' });
  b.put('case-1', { status: 'different' });
  // Same logical key, different tenants → isolated values.
  assert.deepStrictEqual(a.get('case-1'), { status: 'open' });
  assert.deepStrictEqual(b.get('case-1'), { status: 'different' });
  // A tenant cannot enumerate another's keys.
  assert.deepStrictEqual(a.keys(), ['case-1']);
  assert.strictEqual(a.size(), 1);
  // Deleting in one tenant does not affect the other.
  a.delete('case-1');
  assert.strictEqual(a.get('case-1'), null);
  assert.deepStrictEqual(b.get('case-1'), { status: 'different' });
});

test('cross-agency collaboration: explicit, PII-free, accept flow', () => {
  const reg = new TenantRegistry(); reg.register('dcec'); reg.register('courts');
  const cb = new CollaborationBroker(reg);
  const s = cb.share({ fromTenant: 'dcec', toTenant: 'courts', ref: { caseCode: 'NJ-1', kind: 'referral' }, reason: 'jurisdiction' });
  assert.strictEqual(s.accepted, false);
  assert.throws(() => cb.share({ fromTenant: 'dcec', toTenant: 'courts', ref: { content: 'secret' } }), /refuses field/);
  assert.throws(() => cb.share({ fromTenant: 'dcec', toTenant: 'dcec', ref: {} }), /share to self/);
  const accepted = cb.accept(s.id, 'courts');
  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(cb.inbox('courts').length, 1);
});

test('knowledge graph: privacy-preserving, link analysis, pattern detection', () => {
  const g = new KnowledgeGraph();
  g.addNode('inv-1', 'Investigation');
  g.addNode('org-1', 'Organization', { sector: 'procurement' });
  g.addNode('asset-1', 'Asset', { kind: 'account' });
  g.addNode('loc-1', 'Location', { region: 'south' });
  // Identifying properties are refused (privacy by design).
  assert.throws(() => g.addNode('p-1', 'Person', { name: 'Real Person' }), /identifying property/);
  g.addNode('p-1', 'Person', { role: 'signatory' });
  g.addEdge('inv-1', 'org-1', 'investigates');
  g.addEdge('org-1', 'asset-1', 'controls');
  g.addEdge('p-1', 'org-1', 'director-of');
  g.addEdge('p-1', 'asset-1', 'beneficiary');
  // Link analysis: shortest relationship path.
  assert.deepStrictEqual(g.shortestPath('inv-1', 'asset-1'), ['inv-1', 'org-1', 'asset-1']);
  // Component (investigation network).
  assert.ok(g.component('inv-1').includes('p-1'));
  // Pattern detection: org-1 is a hub; p-1/org-1/asset-1 form a triangle.
  assert.strictEqual(g.hubs(3)[0].id, 'org-1');
  assert.ok(g.triangles().some((t) => t.includes('p-1') && t.includes('org-1') && t.includes('asset-1')));
});
