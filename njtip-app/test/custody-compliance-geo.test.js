'use strict';
// v1.4 Phase 16 (signed chain of custody), Phase 25 (compliance automation), Phase 15 (GIS).
const { test } = require('node:test');
const assert = require('node:assert');
const { CustodyLedger } = require('../src/custody/ledger');
const compliance = require('../src/compliance/compliance');
const { SpatialIndex, geohash, regionalAnalytics } = require('../src/geo/gis');

test('custody ledger: signed, timestamped, hash-chained, tamper-evident, archivable', () => {
  let t = 0;
  const cl = new CustodyLedger({ clock: () => (t += 1) });
  cl.record({ evidenceId: 'EV-1', action: 'ingested', actor: 'inv-001', contentHash: 'h1', witness: 'wit-1' });
  cl.record({ evidenceId: 'EV-1', action: 'sealed', actor: 'inv-001', contentHash: 'h1' });
  const res = cl.verify();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(cl.witnessVerified(1), true);
  assert.strictEqual(cl.witnessVerified(2), false);
  // Every entry is signed + timestamped.
  const e = cl.entries('EV-1')[0];
  assert.ok(e.signature && e.timestampToken);
  // Archive is a verifiable, signed preservation digest.
  const a = cl.archive();
  assert.strictEqual(a.verified, true);
  assert.ok(a.digest && a.signature);
  // Missing required fields fail closed.
  assert.throws(() => cl.record({ evidenceId: 'x' }), /required/);
});

test('compliance: maps controls to standards; met only when supporting fitness pass; human-gated', () => {
  // All controls passing → full coverage.
  const allIds = new Set();
  for (const clauses of Object.values(compliance.STANDARDS)) for (const ids of Object.values(clauses)) ids.forEach((i) => allIds.add(i));
  const allPass = [...allIds].map((id) => ({ id, pass: true }));
  const full = compliance.assess(allPass);
  assert.strictEqual(full.standards['ISO/IEC 27001'].coverage, 1);
  assert.strictEqual(full.overallCoverage, 1);
  assert.strictEqual(full.humanGate.required, true);
  assert.ok(/never authorizes/i.test(full.humanGate.note));
  // A failing control drops the coverage of the standards that depend on it.
  const oneFails = [...allIds].map((id) => ({ id, pass: id !== 'FIT-IDENTITY-MINIMIZATION' }));
  const partial = compliance.assess(oneFails);
  assert.ok(partial.standards['National privacy law'].coverage < 1);
});

test('GIS: coarsened geohash (privacy), heatmap suppression, regional analytics', () => {
  assert.strictEqual(geohash(-24.6541, 25.9087, 5).length, 5);
  const si = new SpatialIndex({ precision: 5 });
  // Two nearby incidents share a coarse cell; the raw coordinates are not stored.
  const c1 = si.add('i1', -24.6541, 25.9087);
  si.add('i2', -24.6540, 25.9088);
  assert.strictEqual(si.cell('x', -24.6541, 25.9087), c1);
  const hm = si.heatmap({ k: 5 });
  assert.strictEqual(hm.cells[c1].suppressed, true); // 2 < 5 → suppressed
  // No raw decimal coordinates anywhere in the heatmap output.
  assert.strictEqual(JSON.stringify(hm).match(/25\.908/), null);
  // Regional analytics counts by jurisdiction prefix.
  const region = regionalAnalytics(si, { 'test-region': c1.slice(0, 3) });
  assert.ok(region['test-region'] >= 2);
});
