'use strict';
// v1.7 Phase 53 (digital legislation & regulatory governance) + Phase 55 (data marketplace).
const { test } = require('node:test');
const assert = require('node:assert');
const { LegislativeRegistry } = require('../src/legislation/registry');
const { DataMarketplace } = require('../src/fabric/marketplace');

test('legislation: versioning, change tracking, dependency graph, impact, simulation, enactment', () => {
  const leg = new LegislativeRegistry({ clock: () => 1 });
  leg.register('act', { title: 'Anti-Corruption Act', type: 'act', mapsToControls: ['FIT-GOVERNANCE'], mapsToSystems: ['case'] });
  leg.register('reg', { title: 'Reporting Regulation', dependsOn: ['act'], mapsToControls: ['FIT-IDENTITY-MINIMIZATION'] });
  // Change tracking (versions).
  leg.amend('act', { summary: 'expand scope' });
  assert.strictEqual(leg.history('act').length, 2);
  // Dependency graph + impact.
  assert.deepStrictEqual(leg.dependencyGraph().reg, ['act']);
  assert.ok(leg.impact('act').affectedInstruments.includes('reg'));
  // Simulation flags a breaking change (removed control) BEFORE implementation.
  const sim = leg.simulate('act', { proposedControls: [] });
  assert.strictEqual(sim.simulatable, true);
  assert.strictEqual(sim.compatibility.breaking, true);
  // Enactment requires a named human; compliance traceability.
  assert.throws(() => leg.enact('act', {}), /named human/);
  assert.strictEqual(leg.enact('act', { by: 'Parliament' }).status, 'in-force');
  assert.deepStrictEqual(leg.traceControl('FIT-GOVERNANCE'), ['act']);
});

test('marketplace: privacy-by-design, approval workflow, classification enforcement, agreements', () => {
  const mkt = new DataMarketplace({ clock: () => 1 });
  // Identity fields refused (privacy-by-design, fail-closed).
  assert.throws(() => mkt.register('bad', { owner: 'o', schemaFields: ['name'] }), /refuses identity fields/);
  mkt.register('cases-agg', { owner: 'independent', classification: 'public', schemaFields: ['category', 'status'], tags: ['analytics'] });
  // Unapproved → not discoverable.
  assert.strictEqual(mkt.discover().length, 0);
  assert.throws(() => mkt.approve('cases-agg', { by: 'x' }), /rationale/);
  mkt.approve('cases-agg', { by: 'data-steward', rationale: 'non-identifying aggregate' });
  assert.strictEqual(mkt.discover({ tag: 'analytics' }).length, 1);
  // Restricted/secret datasets are never publicly listed.
  mkt.register('evidence-meta', { owner: 'executive', classification: 'secret', schemaFields: ['contentHash'] });
  mkt.approve('evidence-meta', { by: 'data-steward', rationale: 'internal' });
  assert.strictEqual(mkt.discover().some((d) => d.id === 'evidence-meta'), false);
  assert.strictEqual(mkt.ownerCatalogue('executive').length, 1);
  // Exchange of a secret dataset requires a purpose + human approver.
  assert.throws(() => mkt.requestExchange({ datasetId: 'evidence-meta', consumer: 'courts' }), /purpose and a human approver/);
  const dua = mkt.requestExchange({ datasetId: 'evidence-meta', consumer: 'courts', purpose: 'joint-case', approver: 'oversight' });
  assert.ok(dua.id.startsWith('DUA-'));
  assert.strictEqual(mkt.agreements().length, 1);
});
