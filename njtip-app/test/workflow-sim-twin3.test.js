'use strict';
// v1.5 Phase 27 (workflow simulation) + Phase 29 (Twin 3.0 Monte-Carlo / predictive ops).
const { test } = require('node:test');
const assert = require('node:assert');
const sim = require('../src/orchestration/workflow-simulator');
const { DEFAULT_WORKFLOW } = require('../src/orchestration/workflow-engine');
const twin3 = require('../src/twin2/monte-carlo');

test('static analysis: reachability, deadlocks, livelocks, escalation, bottlenecks', () => {
  const a = sim.analyze(DEFAULT_WORKFLOW);
  assert.ok(a.reachable.includes('closed'));
  assert.strictEqual(a.deadlocks.length, 0);
  assert.strictEqual(a.escalationIssues.length, 0);
  // A deadlock is detected.
  const bad = { id: 'b', version: 1, start: 's0', terminal: ['end'], states: { s0: { on: { go: 'stuck' } }, stuck: { on: {} }, end: { on: {} } } };
  assert.ok(sim.analyze(bad).deadlocks.includes('stuck'));
  assert.ok(sim.analyze(bad).unreachable.includes('end'));
  // A livelock (cycle that cannot reach terminal) is detected.
  const loop = { id: 'l', version: 1, start: 'a', terminal: ['done'], states: { a: { on: { x: 'b' } }, b: { on: { y: 'a' } }, done: { on: {} } } };
  assert.ok(sim.analyze(loop).livelocks.length >= 1);
});

test('activation gate: valid workflow passes, broken workflow blocked (fail-closed)', () => {
  assert.strictEqual(sim.validateForActivation(DEFAULT_WORKFLOW).ok, true);
  const bad = { id: 'b', version: 1, start: 's', terminal: ['done'], states: { s: { on: {} }, done: { on: {} } } };
  const g = sim.validateForActivation(bad);
  assert.strictEqual(g.ok, false);
  assert.ok(g.issues.join(' ').match(/deadlock|terminal/));
});

test('mass execution is deterministic; regression detects removed states', () => {
  const a = sim.simulate(DEFAULT_WORKFLOW, { runs: 200, seed: 3 });
  const b = sim.simulate(DEFAULT_WORKFLOW, { runs: 200, seed: 3 });
  assert.deepStrictEqual(a, b); // deterministic replay
  assert.ok(a.completionRate > 0);
  // Regression: dropping a state is flagged as breaking.
  const v2 = { ...DEFAULT_WORKFLOW, states: { ...DEFAULT_WORKFLOW.states } }; delete v2.states.oversight; v2.states.investigation = { on: { review: 'decision' } };
  const reg = sim.regression(DEFAULT_WORKFLOW, v2);
  assert.ok(reg.removedStates.includes('oversight') && reg.breaking === true);
});

test('Twin 3.0: deterministic Monte-Carlo forecasts + human-gated readiness', () => {
  const w = twin3.workloadForecast({ arrivalPerDay: 20, days: 30, investigators: 10, seed: 5 });
  assert.deepStrictEqual(w.perInvestigator, twin3.workloadForecast({ arrivalPerDay: 20, days: 30, investigators: 10, seed: 5 }).perInvestigator);
  assert.ok(w.perInvestigator.p95 >= w.perInvestigator.p50);
  assert.ok(twin3.staffingShortage({ demandMean: 200, capacity: 180, seed: 1 }).shortageProbability >= 0);
  assert.strictEqual(typeof twin3.budgetForecast({ seed: 1 }).withinBudgetP90, 'boolean');
  assert.strictEqual(twin3.incidentTrend({ months: 6, seed: 1 }).points.length, 6);
  // what-if compares scenarios.
  const wi = twin3.whatIf(twin3.staffingShortage, [{ name: 'lean', params: { capacity: 150, seed: 1 } }, { name: 'funded', params: { capacity: 250, seed: 1 } }]);
  assert.ok(wi[0].result.shortageProbability >= wi[1].result.shortageProbability);
  // Predictive readiness is advisory + human-gated.
  const pr = twin3.predictiveReadiness({ fitnessPassRate: 1, failureRisk: 0 });
  assert.strictEqual(pr.humanGate, true);
  assert.strictEqual(pr.band, 'ready-candidate');
});
