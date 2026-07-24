'use strict';
// v1.4 Phase 17+24 (Twin 2.0 simulations), Phase 14 (data fabric), Phase 18 (DevSecOps),
// Phase 21 (executive intelligence).
const { test } = require('node:test');
const assert = require('node:assert');
const sim = require('../src/twin2/simulation');
const { SchemaRegistry, ServiceRegistry, DataLineage, MetadataCatalog, CANONICAL_MODEL } = require('../src/fabric/registry');
const devsecops = require('../scripts/devsecops');
const analytics = require('../src/analytics');

test('twin2: capacity, failure, recovery, deployment, failover simulations (deterministic)', () => {
  const cap = sim.capacityForecast({ perReplicaRps: 100, targetPeakRps: 500, hpaMax: 12 });
  assert.ok(cap.replicasNeeded >= 5 && cap.covered === true);
  assert.strictEqual(sim.capacityForecast({ perReplicaRps: 10, targetPeakRps: 10000, hpaMax: 12 }).covered, false);
  assert.strictEqual(sim.failurePrediction({ errorBudgetConsumed: 2, cpuSaturation: 1 }).risk, 'high');
  assert.strictEqual(sim.recoverySimulation({ backupIntervalMs: 1000, failoverMs: 500, rtoTargetMs: 1000, rpoTargetMs: 2000 }).pass, true);
  assert.strictEqual(sim.deploymentSimulation({ simulatedErrorRate: 0.5 }).promoted, false);
  assert.strictEqual(sim.deploymentSimulation({ simulatedErrorRate: 0 }).promoted, true);
  const fo = sim.failoverSimulation({ regions: ['a', 'b', 'c'], failed: ['a'] });
  assert.strictEqual(fo.quorum, true);
  assert.strictEqual(sim.failoverSimulation({ regions: ['a', 'b', 'c'], failed: ['a', 'b'] }).degraded, true);
});

test('data fabric: schema compatibility, service + catalog + lineage', () => {
  const sr = new SchemaRegistry();
  sr.register('Case', CANONICAL_MODEL.Case);
  // Additive change is compatible; a breaking change is refused.
  sr.register('Case', { fields: { ...CANONICAL_MODEL.Case.fields, priority: 'string' }, required: CANONICAL_MODEL.Case.required });
  assert.strictEqual(sr.latest('Case').version, 2);
  assert.throws(() => sr.register('Case', { fields: { caseCode: 'number' }, required: ['caseCode'] }), /not backward compatible/);
  const svc = new ServiceRegistry(); svc.register('intake', { endpoints: ['/api/reports'], zone: 'independent' });
  assert.strictEqual(svc.discover('intake').zone, 'independent');
  const lin = new DataLineage();
  lin.record('reports', 'projection', 'fold'); lin.record('projection', 'dashboard', 'aggregate');
  assert.ok(lin.trace('dashboard').some((t) => t.dataset === 'reports'));
  const cat = new MetadataCatalog(); cat.register('cases', { owner: 'independent', tags: ['non-identifying'] });
  assert.strictEqual(cat.search('non-identifying').length, 1);
});

test('DevSecOps: codebase is clean (no dangerous patterns, no secrets, zero deps)', () => {
  assert.strictEqual(devsecops.sast().filter((f) => f.severity === 'high').length, 0);
  assert.strictEqual(devsecops.secretScan().length, 0);
  const sbom = devsecops.sbom();
  assert.strictEqual(sbom.dependencies.length, 0);
  assert.strictEqual(devsecops.sca(sbom).knownVulnerabilities, 0);
  assert.ok(sbom.builtinsUsed.includes('crypto'));
});

test('executive scorecard: privacy-preserving governance-level intelligence', () => {
  const DAY = 24 * 3600_000;
  const rows = [
    { category: 'police', status: 'resolved', createdAt: 0, firstReviewedAt: DAY, region: 'south', slaBreached: false },
    { category: 'courts', status: 'received', createdAt: DAY, region: 'south', slaBreached: true },
  ];
  const sc = analytics.executiveScorecard(rows, 3 * DAY);
  assert.strictEqual(sc.nationalKpis.total, 2);
  assert.ok(sc.scorecard.grade);
  assert.ok(/non-attributable/.test(sc.note));
});
