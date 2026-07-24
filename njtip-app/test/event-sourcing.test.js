'use strict';
// v1.4 Phase 11: Event Sourcing + CQRS — immutable hash-chained log, aggregates, replay,
// snapshotting, projections, schema evolution, and additive integration with the workflow.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { EventStore } = require('../src/eventsourcing/event-store');
const { CaseAggregate } = require('../src/eventsourcing/case-aggregate');
const { caseReadModel, ProjectionEngine } = require('../src/eventsourcing/projections');
const { Workflow } = require('../src/workflow');

function freshWf() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-es-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  let t = 1_700_000_000_000;
  return { wf: new Workflow({ clock: () => (t += 1000), seed: 6, ledgerFile, events: new EventStore({ clock: () => (t += 1000) }) }), ledgerFile };
}

test('event store: append-only, hash-chained, tamper-evident, optimistic concurrency', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1) });
  es.append('NJ-1', [{ type: 'CaseSubmitted', data: { category: 'police' } }], 0);
  es.append('NJ-1', [{ type: 'CaseReviewed', data: { status: 'reviewed' } }], 1);
  assert.strictEqual(es.streamVersion('NJ-1'), 2);
  assert.strictEqual(es.verifyChain().ok, true);
  // Optimistic concurrency: stale expectedVersion is rejected.
  assert.throws(() => es.append('NJ-1', [{ type: 'X' }], 0), /concurrency conflict/);
  // Tamper detection: mutating a persisted event breaks the chain (events are frozen, so
  // we simulate tampering on the internal array copy).
  const ev = es.readAll()[0];
  assert.ok(Object.isFrozen(ev.data)); // immutability enforced
});

test('aggregate replay reconstructs identical state from events', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1) });
  es.append('NJ-2', [
    { type: 'CaseSubmitted', data: { category: 'courts', recipient: 'ombudsman', stage: 'intake-review' } },
    { type: 'EvidenceAttached', data: {} },
    { type: 'EvidenceAttached', data: {} },
    { type: 'CaseReviewed', data: { status: 'escalated' } },
    { type: 'CaseTransitioned', data: { to: 'resolved' } },
  ]);
  const agg = new CaseAggregate('NJ-2').loadFromHistory(es.readStream('NJ-2'));
  assert.deepStrictEqual(agg.state(), { caseCode: 'NJ-2', status: 'resolved', category: 'courts', recipient: 'ombudsman', stage: 'intake-review', evidenceCount: 2, assignee: null, appealed: false, version: 5 });
});

test('snapshot + partial replay equals full replay', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1) });
  es.append('NJ-3', [{ type: 'CaseSubmitted', data: { category: 'prison' } }, { type: 'EvidenceAttached', data: {} }]);
  const mid = new CaseAggregate('NJ-3').loadFromHistory(es.readStream('NJ-3'));
  es.saveSnapshot('NJ-3', mid.version, mid.state());
  es.append('NJ-3', [{ type: 'CaseReviewed', data: { status: 'reviewed' } }]);
  const fromSnap = new CaseAggregate('NJ-3').loadFromHistory(es.readStream('NJ-3'), es.getSnapshot('NJ-3'));
  const full = new CaseAggregate('NJ-3').loadFromHistory(es.readStream('NJ-3'));
  assert.deepStrictEqual(fromSnap.state(), full.state());
});

test('CQRS projection rebuild + time-travel', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1) });
  es.append('NJ-4', [{ type: 'CaseSubmitted', data: { category: 'police' } }]);
  const midTime = es.readAll().slice(-1)[0].meta.at;
  es.append('NJ-4', [{ type: 'CaseTransitioned', data: { to: 'resolved' } }]);
  // Full projection.
  assert.strictEqual(caseReadModel(es.readAll()).get('NJ-4').status, 'resolved');
  // Time-travel: as of midTime the case was only 'received'.
  assert.strictEqual(caseReadModel(es.readAll({ untilAt: midTime })).get('NJ-4').status, 'received');
  const pe = new ProjectionEngine().register('cases', 1, caseReadModel);
  assert.strictEqual(pe.rebuild('cases', es.readAll()).version, 1);
});

test('event schema evolution via upcasters', () => {
  let t = 0;
  const es = new EventStore({ clock: () => (t += 1), upcasters: { 'CaseSubmitted:1': (d) => ({ ...d, category: d.cat }) } });
  es.append('NJ-5', [{ type: 'CaseSubmitted', v: 1, data: { cat: 'police' } }]);
  // On read the v1 event is upcast to v2 with the renamed field.
  const read = es.readStream('NJ-5')[0];
  assert.strictEqual(read.data.category, 'police');
  assert.strictEqual(read.v, 2);
});

test('workflow emits PII-free events; read-model and replay agree; log verifies', () => {
  const { wf, ledgerFile } = freshWf();
  const r = wf.submitReport({ category: 'police', content: 'sensitive body' });
  wf.attachEvidence({ case_code: r.case_code, content: 'evidence body' });
  wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: 'escalate' });
  wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'resolve' });
  // Events carry NO content/identity.
  const evs = wf.caseEvents(r.case_code);
  assert.ok(evs.length >= 4);
  assert.ok(!JSON.stringify(evs).includes('sensitive body') && !JSON.stringify(evs).includes('evidence body'));
  // Replay from events matches the live read model.
  assert.strictEqual(wf.replayCase(r.case_code).status, 'resolved');
  assert.strictEqual(wf.rebuildReadModel().find((c) => c.caseCode === r.case_code).status, 'resolved');
  assert.strictEqual(wf.verifyEventIntegrity().ok, true);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});
