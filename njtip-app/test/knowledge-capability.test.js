'use strict';
// v1.8 Phase 67 (knowledge & decision repository) + Phase 68 (capability marketplace).
const { test } = require('node:test');
const assert = require('node:assert');
const { KnowledgeRepository } = require('../src/knowledge/repository');
const { CapabilityMarketplace } = require('../src/devplatform/capability-marketplace');

test('knowledge repository: immutable, hash-chained, searchable, traceable, non-identifying', () => {
  const kr = new KnowledgeRepository({ clock: () => 1 });
  const a = kr.record({ type: 'adr', title: 'Freeze architecture', tags: ['architecture'] });
  const b = kr.record({ type: 'governance-decision', title: 'Approve pilot', tags: ['pilot'], refs: [a.id] });
  kr.record({ type: 'recovery-exercise', title: 'Region outage drill', tags: ['resilience'] });
  assert.throws(() => kr.record({ type: 'mystery', title: 'x' }), /unknown record type/);
  // Personal data refused (privacy, fail-closed).
  assert.throws(() => kr.record({ type: 'lesson-learned', title: 'x', attributes: { omang: '123' } }), /refuses personal-data/);
  // Tamper-evident chain + immutability.
  assert.strictEqual(kr.verify().ok, true);
  assert.ok(Object.isFrozen(kr._records[0]));
  // Search + typed retrieval.
  assert.ok(kr.search('architecture').some((r) => r.id === a.id));
  assert.strictEqual(kr.byType('governance-decision').length, 1);
  // Decision traceability follows refs.
  assert.deepStrictEqual(kr.trace(b.id).map((r) => r.id), [b.id, a.id]);
  // Lifecycle: supersession is tracked immutably (the old record is retained).
  kr.supersede(a.id, 'superseded by newer ADR');
  assert.strictEqual(kr.isSuperseded(a.id), true);
  assert.strictEqual(kr.get(a.id).title, 'Freeze architecture'); // retained
});

test('capability marketplace: register, certify, compatibility, human-approved publication', () => {
  const mkt = new CapabilityMarketplace({ clock: () => 1 });
  assert.throws(() => mkt.register('x', { type: 'spaceship', owner: 'o' }), /valid type/);
  mkt.register('anon-report-flow', { type: 'workflow', owner: 'independent', spec: { states: 5 }, compatibleWith: ['case-exchange'] });
  // Publication requires certification first.
  assert.throws(() => mkt.publish('anon-report-flow', { by: 'x', rationale: 'y' }), /certified before publication/);
  assert.strictEqual(mkt.certify('anon-report-flow').certified, true);
  // Compatibility validation.
  assert.strictEqual(mkt.checkCompatibility('anon-report-flow', 'case-exchange').compatible, true);
  // Publication requires a named human + rationale.
  assert.throws(() => mkt.publish('anon-report-flow', { by: 'x' }), /named human and a rationale/);
  // Not discoverable until published.
  assert.strictEqual(mkt.discover().length, 0);
  mkt.publish('anon-report-flow', { by: 'platform-steward', rationale: 'reviewed + certified' });
  assert.strictEqual(mkt.discover({ type: 'workflow' }).length, 1);
  assert.ok(mkt.auditTrail().some((e) => e.event === 'published'));
  // Versioning: a new version starts as draft (not published).
  mkt.register('anon-report-flow', { type: 'workflow', owner: 'independent', spec: { states: 6 } });
  assert.strictEqual(mkt.describe('anon-report-flow').version, 2);
  assert.strictEqual(mkt.describe('anon-report-flow').published, false);
});
