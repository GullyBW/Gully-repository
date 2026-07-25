'use strict';
// v1.6 Phase 44 (Twin 4.0 strategic national simulation) + Phase 45 (resilience validation).
const { test } = require('node:test');
const assert = require('node:assert');
const twin4 = require('../src/twin2/national-sim');
const res = require('../src/twin2/resilience-validation');

test('Twin 4.0: strategic national simulations are deterministic + advisory + human-gated', () => {
  const budget = twin4.budgetReduction({ currentBudget: 200000, reductionPct: 20, perCaseCost: 500, intakePerDay: 100, horizonDays: 90 });
  assert.strictEqual(budget.advisoryOnly, true);
  assert.strictEqual(budget.humanGate, true);
  assert.strictEqual(budget.result.newBudget, 160000);
  // A merge redistributes workload.
  const restr = twin4.agencyRestructuring({ agencyLoads: { a: 10, b: 5, c: 3 }, merges: [{ from: 'b', into: 'a' }] });
  assert.strictEqual(restr.result.redistributedLoads.a, 15);
  assert.ok(!('b' in restr.result.redistributedLoads));
  // Emergency absorption.
  assert.strictEqual(twin4.emergencyResponse({ surgeMultiplier: 3, baseIntakePerDay: 100, capacityPerDay: 110, headroomPct: 30 }).result.absorbed, false);
  // Deterministic long-term + transformation curves.
  assert.deepStrictEqual(twin4.longTermCapacity({ years: 3 }), twin4.longTermCapacity({ years: 3 }));
  assert.strictEqual(twin4.nationalTransformation({ years: 5 }).result.points.length, 5);
  // Legislative reform recommends additional capacity.
  assert.ok(twin4.legislativeReform({ addedVolumePerDay: 40, capacityPerDay: 110, currentIntakePerDay: 100 }).result.recommendedAdditionalInvestigators >= 1);
});

test('resilience validation: default suite passes; validators can fail; gate is human-gated', () => {
  const suite = res.validateResilience();
  assert.strictEqual(suite.pass, true, JSON.stringify(suite.results.filter((r) => !r.pass)));
  assert.strictEqual(suite.humanGate, true);
  assert.ok(/never authorizes/.test(suite.note));
  // Individual validators reject genuine failures.
  assert.strictEqual(res.validateRegionalOutage({ regions: ['a', 'b', 'c'], failed: ['a', 'b'] }).pass, false); // no quorum
  assert.strictEqual(res.validateCyberIncident({ compromised: ['keys'], critical: ['keys'] }).pass, false);
  assert.strictEqual(res.validateNationalDisruption({ services: { api: 1 }, disrupted: ['api'] }).pass, false); // single replica
  assert.strictEqual(res.validateSurge({ baseline: 100, surgeMultiplier: 10, maxCapacity: 400 }).pass, false);
  assert.strictEqual(res.validateDegradation({ nominalCapacity: 100, degradedPct: 60, demand: 55 }).pass, false);
  // Comms failure retains events in the durable outbox.
  assert.strictEqual(res.validateCommsFailure({ pendingEvents: 5, outboxDurable: true }).retainedEvents, 5);
});
