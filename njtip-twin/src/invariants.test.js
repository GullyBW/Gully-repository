'use strict';
// Unit tests for the runtime invariants of the core modules.
const { test } = require('node:test');
const assert = require('node:assert');
const { logicalClock } = require('./util/rng');
const { ReportStore, IdentityMinimizationError } = require('./model/report-store');
const { AuditLog } = require('./model/audit-log');
const { EvidenceStore } = require('./model/evidence-store');
const { ThresholdCustody } = require('./model/governance');
const { EventBus } = require('./platform/event-bus');
const { ZONES } = require('./zones');
const { isCiphertext } = require('./platform/crypto');

test('report store rejects identity fields at write time', () => {
  const s = new ReportStore(logicalClock());
  assert.throws(() => s.submit({ case_code: 'A', category: 'police', content: 'x', omang: '123' }), IdentityMinimizationError);
  assert.throws(() => s.submit({ case_code: 'A', category: 'police', content: 'x', ip: '1.1.1.1' }), IdentityMinimizationError);
});

test('report content is ciphertext at rest', () => {
  const s = new ReportStore(logicalClock());
  s.submit({ case_code: 'A', category: 'police', content: 'secret' });
  assert.ok(isCiphertext(s._rawRow('A').content_cipher));
});

test('audit log is tamper-evident', () => {
  const a = new AuditLog(logicalClock());
  a.append({ actor: 'x', action: 'a', purpose: 'p', zone: 'independent' });
  a.append({ actor: 'y', action: 'b', purpose: 'p', zone: 'independent' });
  assert.strictEqual(a.verifyIntegrity().ok, true);
  a._entries[0].record.action = 'TAMPERED';
  assert.strictEqual(a.verifyIntegrity().ok, false);
});

test('evidence tampering is detected', () => {
  const e = new EvidenceStore(ZONES.EXECUTIVE, logicalClock());
  e.ingest({ id: 'E1', actor: 'i', role: 'investigate', content: 'orig', matter: 'M' });
  assert.strictEqual(e.verifyObject('E1', 'orig').ok, true);
  e._forceTamper('E1');
  assert.strictEqual(e.verifyObject('E1', 'orig').ok, false);
});

test('threshold custody blocks single-party de-anonymization', () => {
  const t = new ThresholdCustody({ M: 3, custodians: ['c1', 'c2', 'c3', 'c4'] });
  assert.throws(() => t.authorize('de-anonymize', ['c1']));
  assert.throws(() => t.authorize('de-anonymize', ['c1', 'c1', 'c1'])); // not distinct
  assert.strictEqual(t.authorize('de-anonymize', ['c1', 'c2', 'c3']).ok, true);
});

test('event bus blocks PII crossing zones', () => {
  const bus = new EventBus();
  assert.throws(() => bus.publish({ type: 'X', sourceZone: ZONES.INDEPENDENT, targetZone: ZONES.EXECUTIVE, payload: { email: 'a@b.c' } }));
  const ok = bus.publish({ type: 'X', sourceZone: ZONES.EXECUTIVE, targetZone: ZONES.JUDICIARY, payload: { case_ref: 'C1' } });
  assert.ok(ok);
});
