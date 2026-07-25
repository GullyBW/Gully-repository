'use strict';
// v1.7 Phase 57 (quantum-resilient transition) + Phase 58 (national performance observatory).
const { test } = require('node:test');
const assert = require('node:assert');
const { QuantumMigrationRegistry, ROADMAP_PHASES } = require('../src/adapters/quantum-transition');
const observatory = require('../src/observatory/performance');

test('quantum transition: compatibility-gated planning, hybrid-gated roadmap, human-gated readiness', () => {
  const q = new QuantumMigrationRegistry({ clock: () => 1 });
  // Non-PQ target refused (fail-closed).
  assert.throws(() => q.plan('m', { purpose: 'signature', fromAlgo: 'ed25519', toAlgo: 'ecdsa-p256' }), /refused/);
  q.plan('m', { purpose: 'signature', fromAlgo: 'ed25519', toAlgo: 'ml-dsa-65' });
  assert.strictEqual(q.describe('m').phase, 'assess');
  q.advance('m'); // → hybrid-deploy
  // Cannot migrate before hybrid verification.
  assert.throws(() => q.advance('m'), /hybrid verification/);
  q.markHybridTested('m');
  assert.strictEqual(q.advance('m').phase, 'migrate');
  // Readiness is advisory + human-gated.
  const r = q.readiness('m');
  assert.strictEqual(r.humanGate, true);
  assert.strictEqual(r.ready, true); // PQ available + hybrid tested
  assert.deepStrictEqual(ROADMAP_PHASES[0], 'assess');
  // Simulation is deterministic.
  assert.deepStrictEqual(q.simulate('m'), q.simulate('m'));
});

test('observatory: KPIs, cross-agency (suppressed), benchmarking, informational report', () => {
  const rows = [
    ...Array(6).fill(0).map(() => ({ category: 'police', status: 'resolved', recipient: 'ombudsman', createdAt: 0, slaBreached: false })),
    { category: 'courts', status: 'received', recipient: 'lone-agency', createdAt: 0, slaBreached: true },
  ];
  const kpis = observatory.digitalGovKpis(rows, 1);
  assert.strictEqual(kpis.total, 7);
  // Cross-agency small cells are suppressed (privacy).
  const ca = observatory.crossAgency(rows);
  assert.strictEqual(ca['ombudsman'].cases, 6);
  assert.strictEqual(ca['lone-agency'].suppressed, true);
  // Benchmarking vs national.
  const bm = observatory.benchmarking(rows);
  assert.ok('nationalResolutionRate' in bm);
  // Deterministic service forecast.
  assert.deepStrictEqual(observatory.serviceForecast({ seed: 1 }), observatory.serviceForecast({ seed: 1 }));
  // Executive report is informational only.
  const rep = observatory.executiveReport(rows, { now: 1 });
  assert.strictEqual(rep.informationalOnly, true);
  assert.ok(/informational/.test(rep.note));
});
