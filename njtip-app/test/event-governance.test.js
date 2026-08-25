'use strict';
// v1.5 Phase 26: Enterprise Event Governance — registry/catalog, ownership, versioning,
// compatibility, lifecycle, deprecation, dependency mapping, retention, discovery, docs.
const { test } = require('node:test');
const assert = require('node:assert');
const { EventRegistry, seedCaseEvents } = require('../src/eventsourcing/event-governance');
const { EventStore } = require('../src/eventsourcing/event-store');

test('registry: catalog, ownership, discovery, dependency map, docs', () => {
  const reg = seedCaseEvents(new EventRegistry());
  assert.strictEqual(reg.catalog().length, 7);
  assert.ok(reg.catalog().every((e) => e.owner === 'case-context' && e.status === 'active'));
  assert.deepStrictEqual(reg.discover({ status: 'active' }).length, 7);
  assert.deepStrictEqual(reg.dependencyMap().EvidenceAttached, ['CaseSubmitted']);
  assert.ok(reg.generateDocs().includes('| CaseSubmitted | case-context |'));
});

test('compatibility: additive evolution allowed, breaking change refused', () => {
  const reg = new EventRegistry();
  reg.register('E', { owner: 'o', schema: { fields: { a: 'string' }, required: ['a'] } });
  // Additive field is compatible.
  assert.strictEqual(reg.checkCompatibility('E', { fields: { a: 'string', b: 'string' }, required: ['a'] }).compatible, true);
  reg.evolve('E', { fields: { a: 'string', b: 'string' }, required: ['a'] });
  assert.strictEqual(reg.describe('E').version, 2);
  // Type change is breaking.
  assert.strictEqual(reg.checkCompatibility('E', { fields: { a: 'number' }, required: ['a'] }).compatible, false);
  assert.throws(() => reg.evolve('E', { fields: { a: 'number' }, required: ['a'] }), /incompatible/);
});

test('lifecycle: active → deprecated → retired (order enforced)', () => {
  const reg = new EventRegistry();
  reg.register('E', { owner: 'o' });
  assert.throws(() => reg.retire('E'), /must be deprecated/);
  reg.deprecate('E', { replacedBy: 'E2' });
  assert.strictEqual(reg.describe('E').status, 'deprecated');
  assert.strictEqual(reg.describe('E').replacedBy, 'E2');
  assert.strictEqual(reg.retire('E').status, 'retired');
});

test('retention governance + integrity validation over the live log', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1) });
  const reg = seedCaseEvents(new EventRegistry({ clock: () => t }));
  es.append('NJ-1', [{ type: 'CaseSubmitted', data: { category: 'police' } }]);
  // Validate: chain ok + all types registered.
  assert.strictEqual(reg.validate(es).ok, true);
  // An unregistered type is flagged.
  es.append('NJ-1', [{ type: 'MysteryEvent', data: {} }]);
  const val = reg.validate(es);
  assert.strictEqual(val.ok, false);
  assert.ok(val.unknownTypes.includes('MysteryEvent'));
  // Retention report is advisory (never purges).
  const rep = reg.retentionReport(es.readAll(), t + 3651 * 24 * 3600_000);
  assert.ok(rep.pastRetention >= 1);
  assert.ok(/never auto-purged/.test(rep.note));
});
