'use strict';
// v1.5 Phase 37 (API governance) + Phase 33 (operational decision support, advisory).
const { test } = require('node:test');
const assert = require('node:assert');
const { ApiRegistry } = require('../src/apigov/registry');
const openapi = require('../src/openapi');
const ds = require('../src/ai/decision-support');

test('API governance: seeded from OpenAPI, contract validation, lifecycle, certification', () => {
  const reg = new ApiRegistry();
  const n = reg.fromOpenApi(openapi.spec());
  assert.ok(n >= 30);
  // Contract validation: documented op ok, unknown fails closed.
  assert.strictEqual(reg.validate('GET', '/api/twin/validate').ok, true);
  assert.strictEqual(reg.validate('POST', '/api/does-not-exist').ok, false);
  // Certification requires an operationId.
  assert.strictEqual(reg.certify('GET', '/api/twin/validate').certified, true);
  // Lifecycle order enforced.
  reg.register('GET', '/api/tmp', { operationId: 'tmp' });
  assert.throws(() => reg.retire('GET', '/api/tmp'), /must be deprecated/);
  reg.deprecate('GET', '/api/tmp', { sunsetAt: 1 });
  assert.strictEqual(reg.retire('GET', '/api/tmp').status, 'retired');
  // Quality metrics.
  assert.ok(reg.qualityMetrics().documentedPct > 0);
});

test('API governance: per-consumer token-bucket rate limiting', () => {
  let now = 0;
  const reg = new ApiRegistry({ clock: () => now });
  assert.strictEqual(reg.allow('unknown').allowed, false); // unregistered
  reg.registerConsumer('agency-a', { ratePerMin: 60, burst: 2 });
  assert.strictEqual(reg.allow('agency-a').allowed, true);
  assert.strictEqual(reg.allow('agency-a').allowed, true);
  assert.strictEqual(reg.allow('agency-a').allowed, false); // burst exhausted
  now += 1000; // 1s → +1 token at 60/min
  assert.strictEqual(reg.allow('agency-a').allowed, true);
});

test('decision support: predictive, forecast, staffing — all advisory + explainable', () => {
  const kpi = ds.predictiveKpis({ openCases: 50, arrivalPerDay: 25, resolvedPerDay: 18, seed: 1 });
  assert.strictEqual(kpi.advisoryOnly, true);
  assert.ok(kpi.result.projectedBacklog > 50); // intake > resolution → grows
  assert.ok(kpi.explanation.length >= 1);
  const comp = ds.completionForecast({ openCases: 90, resolvedPerDay: 30 });
  assert.strictEqual(comp.result.days, 3);
  const staff = ds.resourceRecommendation({ demandMean: 260, capacity: 180, seed: 1 });
  assert.ok(staff.result.recommendedAdditionalInvestigators >= 1);
  assert.strictEqual(staff.autonomous, false);
  // Determinism.
  assert.deepStrictEqual(ds.predictiveKpis({ openCases: 50, arrivalPerDay: 25, resolvedPerDay: 18, seed: 1 }), kpi);
});
