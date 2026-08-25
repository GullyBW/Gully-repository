'use strict';
// Phase 12, Parts 4, 5 & 6 — predictive SRE, the mission correlation chain, and the four-stage
// resilience contract.
const test = require('node:test');
const assert = require('node:assert');
const sre = require('../src/observability/sre');
const bus = require('../src/observability/business');
const chaos = require('../src/twin2/chaos');

const DAY = 24 * 3600_000;

// --- Part 4: predictive operations ----------------------------------------------------------------

test('lead-time banding covers imminent, near-term, distant, breached and unknown', () => {
  assert.strictEqual(sre.leadTime(3).urgency, 'imminent');
  assert.strictEqual(sre.leadTime(20).urgency, 'near-term');
  assert.strictEqual(sre.leadTime(200).urgency, 'distant');
  assert.strictEqual(sre.leadTime(-1).urgency, 'breached');
  assert.strictEqual(sre.leadTime(null).urgency, 'unknown');
  for (const b of sre.LEAD_TIME_BANDS) assert.ok(b.action);
});

test('an unmeasurable prediction reports unknown, never healthy', () => {
  const predictors = [
    sre.predictStorageExhaustion({}),
    sre.predictCertificateExpiry({}),
    sre.predictCapacity({}),
    sre.predictQueueSaturation({}),
    sre.predictDependencyDegradation({ latencyHistory: [] }),
    sre.predictBudgetExhaustion({ service: 'investigation' }),
  ];
  for (const p of predictors) {
    assert.strictEqual(p.predicted, false, p.predictor);
    assert.strictEqual(p.urgency, 'unknown', p.predictor);
    assert.strictEqual(p.daysUntilThreshold, null, p.predictor);
  }
});

test('storage alarms at the warn threshold, not at full capacity', () => {
  const s = sre.predictStorageExhaustion({ usedGb: 500, capacityGb: 1000, growthPctPerMonth: 10 });
  assert.ok(s.predicted);
  assert.ok(s.threshold < 1000, 'alarming at 100% leaves no time to act');
  assert.strictEqual(sre.predictStorageExhaustion({ usedGb: 950, capacityGb: 1000, growthPctPerMonth: 10 }).urgency, 'breached');
  assert.strictEqual(sre.predictStorageExhaustion({ usedGb: 100, capacityGb: 1000, growthPctPerMonth: 0 }).daysUntilThreshold, null);
});

test('certificates are ordered by expiry and flagged before they lapse', () => {
  const c = sre.predictCertificateExpiry({ certificates: [{ subject: 'b', notAfter: 200 * DAY }, { subject: 'a', notAfter: 5 * DAY }], now: 0 });
  assert.strictEqual(c.certificates[0].subject, 'a');
  assert.strictEqual(c.urgency, 'imminent');
  assert.ok(c.expiring.includes('a'));
  assert.ok(sre.predictCertificateExpiry({ certificates: [{ subject: 'x', notAfter: -1 }], now: 0 }).expired.includes('x'));
});

test('the capacity ceiling accounts for reserved surge headroom', () => {
  const cap = sre.predictCapacity({ currentRps: 100, monthlyGrowthPct: 20, maxReplicas: 12, rpsPerInstance: 25, headroomPct: 40 });
  assert.ok(cap.threshold < 12 * 25, 'the ceiling ignores reserved headroom');
  assert.ok(cap.predicted);
});

test('a queue whose arrivals exceed service has no steady state, whatever its depth', () => {
  const unstable = sre.predictQueueSaturation({ depth: 100, arrivalRate: 12, serviceRate: 10 });
  assert.strictEqual(unstable.stable, false);
  assert.ok(unstable.utilization > 1);
  assert.notStrictEqual(unstable.daysUntilThreshold, null);
  const stable = sre.predictQueueSaturation({ depth: 9000, arrivalRate: 5, serviceRate: 10 });
  assert.strictEqual(stable.stable, true);
  assert.strictEqual(stable.daysUntilThreshold, null);
});

test('dependency degradation and budget burn are both projected forward', () => {
  assert.notStrictEqual(sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [100, 150, 200, 250], budgetMs: 500 }).daysUntilThreshold, null);
  assert.strictEqual(sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [100, 100, 100], budgetMs: 500 }).daysUntilThreshold, null);
  assert.strictEqual(sre.predictDependencyDegradation({ service: 'kms', latencyHistory: [600, 610], budgetMs: 500 }).urgency, 'breached');
  assert.notStrictEqual(sre.predictBudgetExhaustion({ service: 'investigation', attained: 0.9975, elapsedDays: 3 }).daysUntilThreshold, null);
  assert.strictEqual(sre.predictBudgetExhaustion({ service: 'investigation', attained: 0.9, elapsedDays: 3 }).urgency, 'breached');
  assert.strictEqual(sre.predictBudgetExhaustion({ service: 'investigation', attained: 1, elapsedDays: 3 }).daysUntilThreshold, null);
});

test('predictions are ordered by remaining time and produce maintenance recommendations', () => {
  const ops = sre.predictiveOperations({
    storage: { usedGb: 900, capacityGb: 1000, growthPctPerMonth: 20 },
    certificates: { certificates: [{ subject: 'a', notAfter: 400 * DAY }], now: 0 },
  });
  assert.strictEqual(ops.healthy, false);
  assert.ok(ops.breached.includes('storage-exhaustion'));
  for (let i = 1; i < ops.predictions.length; i++) {
    const a = ops.predictions[i - 1].daysUntilThreshold ?? Infinity;
    const b = ops.predictions[i].daysUntilThreshold ?? Infinity;
    assert.ok(a <= b, 'predictions are not ordered by remaining time');
  }
  assert.ok(ops.maintenanceRecommendations.length > 0);
  assert.strictEqual(ops.authorizes, false);
  assert.deepStrictEqual(sre.predictiveOperations({}), sre.predictiveOperations({}));
});

test('the release gate blocks on a breached prediction and warns on a near-term one', () => {
  const healthy = Object.fromEntries(Object.keys(sre.SERVICE_LEVELS).map((s) => [s, { availability: 1, latencyUnder: 1 }]));
  const history = new sre.SloComplianceHistory();
  for (const s of Object.keys(sre.SERVICE_LEVELS)) for (let p = 0; p < 4; p++) history.record({ service: s, period: p, availability: 1, latencyUnder: 1 });

  const quiet = sre.predictiveOperations({ storage: { usedGb: 10, capacityGb: 1000, growthPctPerMonth: 1 } });
  assert.strictEqual(sre.predictiveReleaseGate({ measurements: healthy, history, predictions: quiet }).ready, true);

  const breached = sre.predictiveOperations({ storage: { usedGb: 900, capacityGb: 1000, growthPctPerMonth: 20 } });
  const blocked = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: breached });
  assert.strictEqual(blocked.ready, false);
  assert.ok(blocked.predictiveBlockers.length > 0);
  assert.strictEqual(blocked.failClosed, true);
  assert.strictEqual(blocked.authorizes, false);

  const overridden = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: breached, riskAcceptedBy: 'ORB Chair', riskRationale: 'expansion already provisioned' });
  assert.strictEqual(overridden.ready, true);
  assert.strictEqual(overridden.overridden, true);

  const nearTerm = sre.predictiveOperations({ storage: { usedGb: 830, capacityGb: 1000, growthPctPerMonth: 5 } });
  const warned = sre.predictiveReleaseGate({ measurements: healthy, history, predictions: nearTerm });
  assert.strictEqual(warned.ready, true, 'a near-term prediction must warn, not block');
  assert.ok(warned.predictiveWarnings.length > 0);
});

// --- Part 5: the mission correlation chain ---------------------------------------------------------

test('the chain has four forward layers, every link states a mechanism, and it validates', () => {
  assert.deepStrictEqual(bus.CHAIN_LAYERS, ['infrastructure', 'application', 'business', 'mission']);
  const v = bus.validateChain();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  for (const l of bus.chainLinks()) {
    assert.ok(l.mechanism, `${l.from} → ${l.to}`);
    assert.ok(bus.CHAIN_LAYERS.indexOf(l.toLayer) > bus.CHAIN_LAYERS.indexOf(l.fromLayer));
  }
});

test('every business metric reaches the mission and every outcome is reachable', () => {
  for (const metric of Object.keys(bus.BUSINESS_METRICS)) {
    assert.ok(bus.chainLinks().some((l) => l.from === metric && l.toLayer === 'mission'), `${metric} reaches no outcome`);
  }
  for (const outcome of Object.keys(bus.MISSION_OUTCOMES)) {
    assert.ok(bus.chainLinks().some((l) => l.to === outcome), `${outcome} is unreachable`);
    assert.ok(bus.MISSION_OUTCOMES[outcome].board);
  }
});

test('a technical failure traces to the mission in the board\'s language', () => {
  const intake = bus.impactOf({ failed: ['persistence-ind'] });
  assert.strictEqual(intake.constitutionalImpact, true);
  assert.ok(intake.missionOutcomes.some((m) => m.id === 'reports-can-be-filed'));
  assert.match(intake.boardSummary, /constitutional/i);
  assert.ok(intake.paths.every((p) => p.mechanisms.length > 0));
  assert.ok(intake.infrastructure.includes('persistence-ind'));
  assert.ok(!intake.applications.includes('persistence-ind'));

  assert.ok(bus.impactOf({ failed: ['kms'] }).missionOutcomes.some((m) => m.id === 'evidence-is-admissible'));
  const nothing = bus.impactOf({ failed: [] });
  assert.strictEqual(nothing.missionOutcomes.length, 0);
  assert.strictEqual(nothing.constitutionalImpact, false);
});

test('chain validation bites: an orphaned metric and an undeclared outcome both fail', () => {
  const original = [...bus.CHAIN_LINKS];
  try {
    bus.CHAIN_LINKS.splice(bus.CHAIN_LINKS.findIndex((l) => l.from === 'compliance-rate'), 1);
    const bad = bus.validateChain();
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.violations.some((x) => /why is it measured/.test(x)));
  } finally { bus.CHAIN_LINKS.length = 0; bus.CHAIN_LINKS.push(...original); }
  try {
    bus.CHAIN_LINKS.push({ from: 'case-throughput', fromLayer: 'business', to: 'not-an-outcome', toLayer: 'mission', mechanism: 'crafted' });
    assert.strictEqual(bus.validateChain().valid, false);
  } finally { bus.CHAIN_LINKS.length = 0; bus.CHAIN_LINKS.push(...original); }
});

test('executive analytics derive from measured evidence, and unknown is not on-track', () => {
  const blind = bus.executiveAnalytics({ events: [] });
  for (const o of blind.missionOutcomes) {
    if (o.measuredInputs === 0) assert.notStrictEqual(o.status, 'on-track');
    if (o.status === 'unknown') assert.match(o.reason, /not the same as fine/);
  }
  const H = 3600_000;
  const events = [
    { type: 'CaseCreated', correlationId: 'C1', at: 0 },
    { type: 'CaseTransitioned', correlationId: 'C1', to: 'closed', at: 10 * H },
  ];
  const ea = bus.executiveAnalytics({ events });
  assert.strictEqual(ea.derivedFromVerifiedEvidence, true);
  assert.strictEqual(ea.authorizes, false);
  assert.strictEqual(ea.chainValidation.valid, true);
  assert.deepStrictEqual(bus.executiveAnalytics({ events }), ea);
});

// --- Part 6: the four-stage resilience contract ------------------------------------------------------

test('every experiment states all four stages explicitly', () => {
  assert.deepStrictEqual(chaos.RESILIENCE_STAGES, ['detected', 'contained', 'recovered', 'verified']);
  for (const id of chaos.experiments().map((e) => e.id)) {
    const r = chaos.runExperiment(id);
    assert.strictEqual(r.error, null, `${id}: ${r.error}`);
    for (const stage of chaos.RESILIENCE_STAGES) {
      assert.notStrictEqual(r.observed[stage], undefined, `${id} does not report '${stage}' — deriving it would make it tautological`);
      assert.strictEqual(r.stages[stage], true, `${id}: '${stage}' not demonstrated`);
    }
    assert.strictEqual(r.pass, true, r.contractViolations.join('; '));
  }
});

test('the contract bites once per stage, and the Phase 11 contract alone no longer suffices', () => {
  const original = chaos.EXPERIMENTS['dns-failure'];
  try {
    for (const omitted of chaos.RESILIENCE_STAGES) {
      const observed = { pass: true };
      for (const s of chaos.RESILIENCE_STAGES) if (s !== omitted) observed[s] = true;
      chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: `omits ${omitted}`, run: () => ({ ...observed }) };
      const r = chaos.runExperiment('dns-failure');
      assert.strictEqual(r.pass, false, `omitting ${omitted} still passed`);
      assert.ok(r.missingStages.includes(omitted));
    }
    chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'detect + recover only', run: () => ({ pass: true, detected: true, recovered: true }) };
    const halfway = chaos.runExperiment('dns-failure');
    assert.strictEqual(halfway.pass, false);
    assert.strictEqual(halfway.contractViolations.length, 2);
  } finally { chaos.EXPERIMENTS['dns-failure'] = original; }
});

test('the resilience scorecard grades a partial result as partial', () => {
  const sc = chaos.resilienceScorecard();
  assert.strictEqual(sc.allComplete, true, JSON.stringify(sc.incomplete));
  assert.strictEqual(sc.overallScore, 1);
  for (const stage of chaos.RESILIENCE_STAGES) assert.strictEqual(sc.byStage[stage], sc.count);
  assert.strictEqual(sc.authorizes, false);

  const original = chaos.EXPERIMENTS['dns-failure'];
  try {
    chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'two of four', run: () => ({ pass: true, detected: true, recovered: true, contained: false, verified: false }) };
    const partial = chaos.resilienceScorecard();
    assert.strictEqual(partial.allComplete, false);
    const row = partial.experiments.find((r) => r.experiment === 'dns-failure');
    assert.strictEqual(row.score, 0.5);
    assert.notStrictEqual(row.grade, 'complete');
    assert.ok(partial.overallScore < 1);
  } finally { chaos.EXPERIMENTS['dns-failure'] = original; }
});

test('the suite reports all four stages and carries the scorecard', () => {
  const suite = chaos.runSuite({ light: true });
  assert.strictEqual(suite.pass, true);
  for (const stage of chaos.RESILIENCE_STAGES) assert.strictEqual(suite[stage], suite.chaos.length, stage);
  assert.strictEqual(suite.scorecard.allComplete, true);
});
