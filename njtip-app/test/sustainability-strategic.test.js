'use strict';
// v1.8 Phase 69 (sustainability & lifecycle) + Phase 70 (national strategic digital twin 5.0).
const { test } = require('node:test');
const assert = require('node:assert');
const { LifecycleRegistry } = require('../src/sustainability/lifecycle');
const st = require('../src/twin2/strategic-twin');

test('sustainability: lifecycle status, obsolescence, roadmap, metrics, longevity (human-gated)', () => {
  const YEAR = 365 * 24 * 3600_000;
  const lc = new LifecycleRegistry({ clock: () => 0 });
  lc.register('runtime', { category: 'runtime', adoptedAt: 0, eolAt: 10 * YEAR, criticality: 'high' });
  lc.register('legacy-db', { category: 'database', adoptedAt: 0, eolAt: 1 * YEAR, criticality: 'critical' });
  // Status derivation over time.
  assert.strictEqual(lc.describe('runtime', 0).status, 'emerging');
  assert.strictEqual(lc.describe('legacy-db', 2 * YEAR).status, 'end-of-life');
  // Obsolescence monitoring.
  assert.ok(lc.obsolescence(2 * YEAR).some((d) => d.id === 'legacy-db'));
  // Modernization roadmap prioritises critical EOL tech.
  const rm = lc.modernizationRoadmap(2 * YEAR);
  assert.strictEqual(rm[0].technology, 'legacy-db');
  assert.strictEqual(rm[0].action, 'replace-now');
  // Sustainability metrics + longevity assessment (advisory + human-gated).
  const m = lc.sustainabilityMetrics(2 * YEAR);
  assert.ok(m.sustainabilityScore >= 0 && m.sustainabilityScore <= 1);
  assert.strictEqual(lc.longevityAssessment(2 * YEAR).humanGate, true);
});

test('strategic twin 5.0: deterministic, explainable, confidence + assumptions, never authorizes', () => {
  const p = st.demographicChange({ population: 2_600_000, growthRate: 0.02, years: 10 });
  assert.strictEqual(p.informationalOnly, true);
  assert.strictEqual(p.authorizes, false);
  assert.ok(typeof p.confidence === 'number' && p.assumptions.length >= 1);
  assert.strictEqual(p.points.length, 10);
  // Determinism.
  assert.deepStrictEqual(st.economicDevelopment({ years: 5 }), st.economicDevelopment({ years: 5 }));
  // Adoption curves are bounded by the ceiling.
  assert.ok(st.digitalInclusion({ years: 30 }).points.every((x) => x.value <= 0.98));
  // Cross-sector dependency propagation.
  const cs = st.crossSectorDependency({ sectors: { finance: ['telecom'], health: ['telecom', 'power'], telecom: ['power'] }, shockedSector: 'power' });
  assert.ok(cs.impactedSectors.includes('telecom') && cs.impactedSectors.includes('health'));
  // Scenario comparison + executive report are informational only.
  const cmp = st.compareScenarios(st.technologyAdoption, [{ name: 'slow', params: { rate: 0.2, years: 10 } }, { name: 'fast', params: { rate: 0.6, years: 10 } }]);
  assert.ok(cmp[1].projection.points[9].value >= cmp[0].projection.points[9].value);
  assert.strictEqual(st.executiveReport().informationalOnly, true);
});
