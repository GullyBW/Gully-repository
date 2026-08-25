'use strict';
// Phase 12, Parts 15 & 16 — readiness dependency analysis, and the engineering intelligence
// platform (test types, assurance coverage, governance maturity, history, forecasting).
const test = require('node:test');
const assert = require('node:assert');
const ec = require('../src/assurance/evidence-confidence');

const ALL_DIMENSIONS = Object.keys(ec.READINESS_DIMENSIONS);
const readiness = (unready = []) => ALL_DIMENSIONS.map((d) => ({ dimension: d, ready: !unready.includes(d), score: unready.includes(d) ? 0 : 1 }));

// --- Part 15: readiness dependency analysis -------------------------------------------------------

test('every readiness dimension declares its dependencies, including none', () => {
  for (const id of ALL_DIMENSIONS) {
    assert.ok(Array.isArray(ec.DIMENSION_DEPENDENCIES[id]), `${id} declares no dependency list`);
  }
  const graph = ec.readinessDependencyGraph();
  assert.strictEqual(graph.valid, true, graph.violations.join('; '));
  assert.strictEqual(graph.nodes.length, ALL_DIMENSIONS.length);
});

test('the dependency graph is acyclic and layered from foundational dimensions', () => {
  const graph = ec.readinessDependencyGraph();
  assert.strictEqual(graph.acyclic, true);
  assert.deepStrictEqual(graph.cycles, []);
  assert.deepStrictEqual(graph.roots, ['organisational', 'technical']);
  assert.strictEqual(graph.layers[0].layer, 0);
  // A dependency always sits in a strictly lower layer than what depends on it.
  const layerOf = Object.fromEntries(graph.nodes.map((n) => [n.dimension, n.layer]));
  for (const e of graph.edges) assert.ok(layerOf[e.to] < layerOf[e.from], `${e.from} → ${e.to}`);
});

test('every dependency edge states why it exists', () => {
  for (const e of ec.readinessDependencyGraph().edges) {
    assert.ok(e.because && e.because.length > 20, `${e.from} → ${e.to}`);
  }
});

test('the dependency analysis explains without changing a single score', () => {
  const dims = readiness(['technical']);
  const a = ec.readinessDependencyAnalysis({ dimensions: dims });
  for (const row of a.dimensions) {
    assert.strictEqual(row.ready, dims.find((d) => d.dimension === row.dimension).ready, row.dimension);
  }
  // No overall figure exists to be mistaken for a verdict.
  assert.strictEqual(Object.prototype.hasOwnProperty.call(a, 'overallReadiness'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(a, 'score'), false);
  assert.strictEqual(a.authorizes, false);
  assert.strictEqual(a.derivedFromReadiness, false);
});

test('a green dimension standing on a red one is named as such', () => {
  const a = ec.readinessDependencyAnalysis({ dimensions: readiness(['technical']) });
  assert.ok(a.restingOnUnready.includes('security'));
  assert.ok(a.restingOnUnready.includes('supplyChain'));
  const security = a.dimensions.find((d) => d.dimension === 'security');
  assert.strictEqual(security.ready, true);
  assert.strictEqual(security.restsOnUnready, true);
  assert.deepStrictEqual(security.unreadyDependencies, ['technical']);
  assert.match(security.note, /not ready/);
});

test('the root cause is distinguished from what it blocks, and the repair order starts there', () => {
  const a = ec.readinessDependencyAnalysis({ dimensions: readiness(['technical', 'security', 'privacy']) });
  // Only technical is unready with all its own dependencies ready.
  assert.deepStrictEqual(a.rootCauses, ['technical']);
  assert.strictEqual(a.suggestedOrder[0], 'technical');
  // The order is deterministic: layer, then name.
  assert.deepStrictEqual(a.suggestedOrder, ['technical', 'security', 'privacy']);
  assert.deepStrictEqual(
    ec.readinessDependencyAnalysis({ dimensions: readiness(['technical', 'security', 'privacy']) }).suggestedOrder,
    a.suggestedOrder,
  );
});

test('a fully ready model rests on nothing unready and still prints NOT AUTHORIZED', () => {
  const a = ec.readinessDependencyAnalysis({ dimensions: readiness([]) });
  assert.deepStrictEqual(a.restingOnUnready, []);
  assert.deepStrictEqual(a.rootCauses, []);
  assert.deepStrictEqual(a.suggestedOrder, []);
  assert.strictEqual(a.authorizationStatus, 'NOT AUTHORIZED');
});

test('the readiness model carries the analysis and still refuses to aggregate', () => {
  const m = ec.readinessModel({ sources: {} });
  assert.ok(m.dependencyAnalysis);
  assert.strictEqual(m.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(m.derivedFromReadiness, false);
  assert.strictEqual(m.dimensionCount, ALL_DIMENSIONS.length);
  // With no evidence at all, every dimension is unready — and none of them is a root cause of
  // another's failure, because they all failed for the same reason: nothing was supplied.
  assert.strictEqual(m.allDimensionsReady, false);
  assert.deepStrictEqual(m.dependencyAnalysis.rootCauses, ['organisational', 'technical']);
});

// --- Part 16: engineering intelligence ------------------------------------------------------------

test('the six test types are named, each with what it proves and what its absence means', () => {
  for (const t of ['unit', 'integration', 'contract', 'resilience', 'chaos', 'policy']) {
    assert.ok(ec.TEST_TYPES[t], t);
    assert.ok(ec.TEST_TYPES[t].proves);
    assert.ok(ec.TEST_TYPES[t].missingMeans);
  }
});

test('a test type nobody runs is reported unmeasured, not omitted', () => {
  const partial = ec.engineeringMetrics({ tests: { unit: 400, integration: 60 } });
  assert.deepStrictEqual(partial.tests.unmeasuredTypes, ['contract', 'resilience', 'chaos', 'policy']);
  assert.strictEqual(partial.tests.typeCoverage, 0.3333);
  assert.strictEqual(partial.tests.byType.chaos, null);
  // The type list always covers all six, whatever the caller passed.
  assert.strictEqual(partial.tests.types.length, 6);
  const full = ec.engineeringMetrics({ tests: Object.fromEntries(Object.keys(ec.TEST_TYPES).map((k) => [k, 5])) });
  assert.deepStrictEqual(full.tests.unmeasuredTypes, []);
  assert.strictEqual(full.tests.typeCoverage, 1);
  assert.strictEqual(full.tests.total, 30);
});

test('a caller-specific test bucket is kept alongside the six named types', () => {
  const m = ec.engineeringMetrics({ tests: { unit: 10, smoke: 3 } });
  assert.strictEqual(m.tests.byType.smoke, 3);
  assert.strictEqual(m.tests.total, 13);
  assert.ok(!m.tests.unmeasuredTypes.includes('smoke'));
});

test('no declared controls is undefined assurance coverage, not complete coverage', () => {
  const none = ec.assuranceCoverage({});
  assert.strictEqual(none.coverage, null);
  assert.strictEqual(none.complete, false);
  assert.match(none.reason, /undefined, not complete/);
});

test('a control with no executable check behind it is not covered', () => {
  const cov = ec.assuranceCoverage({
    controls: ['APP-FIT-AUTHZ', { id: 'quarterly-access-review', verifiedBy: ['APP-FIT-ACCESS-REVIEW'] }],
    executableCheckIds: ['APP-FIT-AUTHZ'],
  });
  assert.strictEqual(cov.coverage, 0.5);
  assert.strictEqual(cov.complete, false);
  assert.deepStrictEqual(cov.uncovered, ['quarterly-access-review']);
  assert.match(cov.controls[1].reason, /a documented procedure is not a control/);
  const full = ec.assuranceCoverage({ controls: ['A', 'B'], executableCheckIds: ['A', 'B', 'C'] });
  assert.strictEqual(full.complete, true);
  assert.strictEqual(full.coverage, 1);
});

test('governance maturity cannot inflate on unmeasured inputs', () => {
  const blind = ec.governanceMaturity({});
  assert.strictEqual(blind.level, 0);
  assert.strictEqual(blind.name, 'Unmeasured');
  assert.ok(blind.blockedBy.length > 0);
  assert.strictEqual(blind.authorizes, false);
  const declaredOnly = ec.governanceMaturity({ controlsDeclared: true });
  assert.strictEqual(declaredOnly.level, 1);
  assert.ok(declaredOnly.blockedBy.some((b) => /unmeasured/.test(b)));
});

test('governance maturity rises only as far as the evidence carries it', () => {
  const fullCov = ec.assuranceCoverage({ controls: ['A'], executableCheckIds: ['A'] });
  const partialCov = ec.assuranceCoverage({ controls: ['A', 'B'], executableCheckIds: ['A'] });
  const base = { controlsDeclared: true, adrCatalogueValid: true, adrCatalogueSound: true };
  assert.strictEqual(ec.governanceMaturity({ ...base }).level, 2);
  assert.strictEqual(ec.governanceMaturity({ ...base, assurance: partialCov }).level, 2);
  assert.strictEqual(ec.governanceMaturity({ ...base, assurance: fullCov }).level, 3);
  assert.strictEqual(ec.governanceMaturity({ ...base, assurance: fullCov, activeOwnershipComplete: true, structuralGaps: 0 }).level, 5);
  assert.strictEqual(ec.governanceMaturity({ ...base, assurance: fullCov, activeOwnershipComplete: false, structuralGaps: 2 }).level, 3);
  for (const l of ec.GOVERNANCE_MATURITY_LEVELS) assert.ok(l.requires);
});

test('an unlabelled snapshot is refused rather than filed under nothing', () => {
  assert.throws(() => ec.engineeringHistory({ snapshots: [{ coverage: 0.8 }] }), /must carry a period label/);
});

test('a period with no measurement is a gap, never an interpolated line', () => {
  const h = ec.engineeringHistory({ snapshots: [
    { period: '2026-Q1', coverage: 0.70, mutationScore: 0.55 },
    { period: '2026-Q2', coverage: 0.78 },
    { period: '2026-Q3', coverage: 0.86, mutationScore: 0.72 },
  ] });
  assert.deepStrictEqual(h.metrics.mutationScore.gaps, ['2026-Q2']);
  assert.strictEqual(h.metrics.mutationScore.measuredPeriods, 2);
  assert.strictEqual(h.metrics.mutationScore.points[1].value, null);
  assert.ok(h.completeness < 1);
  assert.strictEqual(h.metrics.coverage.direction, 'rising');
  assert.strictEqual(h.metrics.coverage.delta, 0.16);
});

test('a history series cannot be padded by re-submitting the same period', () => {
  const h = ec.engineeringHistory({ snapshots: [
    { period: 'P1', coverage: 0.5 }, { period: 'P1', coverage: 0.5 }, { period: 'P1', coverage: 0.5 },
  ] });
  assert.strictEqual(h.snapshots, 1);
  assert.strictEqual(h.metrics.coverage.direction, 'insufficient-data');
});

test('a projection from fewer than two points reports unknown, not a default', () => {
  const h = ec.engineeringHistory({ snapshots: [{ period: 'P1', coverage: 0.5 }] });
  const f = ec.engineeringForecast({ history: h });
  for (const m of f.metrics) {
    assert.strictEqual(m.projectable, false, m.metric);
    assert.strictEqual(m.direction, 'unknown');
    assert.strictEqual(m.projected, null);
    assert.match(m.reason, /a guess with a decimal point/);
  }
  assert.ok(f.unprojectable.includes('coverage'));
  assert.strictEqual(f.healthyClaim, null);
  assert.strictEqual(f.authorizes, false);
});

test('polarity is stated, so a falling change-failure rate reads as an improvement', () => {
  const h = ec.engineeringHistory({ snapshots: [
    { period: 'A', coverage: 0.70, changeFailureRate: 0.12, mttrHours: 6 },
    { period: 'B', coverage: 0.78, changeFailureRate: 0.09, mttrHours: 4 },
    { period: 'C', coverage: 0.86, changeFailureRate: 0.06, mttrHours: 2 },
  ] });
  const f = ec.engineeringForecast({ history: h, periodsAhead: 2 });
  const cov = f.metrics.find((m) => m.metric === 'coverage');
  assert.strictEqual(cov.direction, 'rising');
  assert.strictEqual(cov.improving, true);
  assert.ok(cov.projected > cov.latest);
  const cfr = f.metrics.find((m) => m.metric === 'changeFailureRate');
  assert.strictEqual(cfr.direction, 'falling');
  assert.strictEqual(cfr.improving, true);          // falling is better here, and it is declared
  assert.strictEqual(cfr.higherIsBetter, false);
  assert.deepStrictEqual(f.regressing, []);
});

test('a metric moving the wrong way is named as regressing and off-target', () => {
  const h = ec.engineeringHistory({ snapshots: [
    { period: 'A', coverage: 0.92, changeFailureRate: 0.02 },
    { period: 'B', coverage: 0.80, changeFailureRate: 0.07 },
    { period: 'C', coverage: 0.68, changeFailureRate: 0.12 },
  ] });
  const f = ec.engineeringForecast({ history: h });
  assert.ok(f.regressing.includes('coverage'));
  assert.ok(f.regressing.includes('changeFailureRate'));
  assert.ok(f.offTarget.includes('coverage'));
  assert.ok(f.offTarget.includes('changeFailureRate'));
  const cov = f.metrics.find((m) => m.metric === 'coverage');
  assert.strictEqual(cov.meetsTarget, false);
  assert.strictEqual(cov.periodsToTarget, null);    // moving away from it
  assert.match(cov.reason, /not moving toward the target/);
});

test('a target already met is reported as met rather than as a countdown', () => {
  const h = ec.engineeringHistory({ snapshots: [
    { period: 'A', coverage: 0.91 }, { period: 'B', coverage: 0.93 }, { period: 'C', coverage: 0.95 },
  ] });
  const cov = ec.engineeringForecast({ history: h }).metrics.find((m) => m.metric === 'coverage');
  assert.strictEqual(cov.meetsTarget, true);
  assert.match(cov.reason, /already at or past target/);
});

test('a caller-supplied target overrides the default', () => {
  const h = ec.engineeringHistory({ snapshots: [{ period: 'A', coverage: 0.70 }, { period: 'B', coverage: 0.75 }] });
  const strict = ec.engineeringForecast({ history: h, targets: { coverage: 0.99 } }).metrics.find((m) => m.metric === 'coverage');
  assert.strictEqual(strict.target, 0.99);
  assert.strictEqual(strict.meetsTarget, false);
  assert.ok(strict.periodsToTarget > 0);
});
