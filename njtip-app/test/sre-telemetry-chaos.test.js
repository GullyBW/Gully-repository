'use strict';
// Phase 10, Parts 4, 5 & 6 — reliability engineering, enterprise observability, and
// performance / resilience engineering.
const test = require('node:test');
const assert = require('node:assert');
const sre = require('../src/observability/sre');
const tel = require('../src/observability/telemetry');
const chaos = require('../src/twin2/chaos');

const HEALTHY = Object.fromEntries(Object.keys(sre.SERVICE_LEVELS).map((s) => [s, { availability: 1, latencyUnder: 1 }]));

// --- Part 4: SRE ---------------------------------------------------------------------------

test('SRE: every journey has availability, latency and recovery objectives with a rationale', () => {
  const levels = sre.serviceLevels();
  assert.ok(levels.length >= 5);
  for (const sl of levels) {
    assert.ok(sl.availability > 0.9 && sl.availability < 1, sl.id);
    assert.ok(sl.latencyMs > 0 && sl.latencyTarget > 0, sl.id);
    assert.strictEqual(typeof sl.rtoMinutes, 'number', sl.id);
    assert.strictEqual(typeof sl.rpoMinutes, 'number', sl.id);
    assert.ok(sl.rationale.length > 20, sl.id);
  }
  // The constitutional journey is the strictest and loses nothing.
  assert.strictEqual(sre.SERVICE_LEVELS['anonymous-reporting'].rpoMinutes, 0);
  assert.strictEqual(sre.SERVICE_LEVELS['governance-decision'].rpoMinutes, 0);
});

test('SRE: error budgets compute consumption, remaining and burn rate', () => {
  const healthy = sre.errorBudget({ objective: 0.999, attained: 0.9995, windowDays: 30, elapsedDays: 30 });
  assert.strictEqual(healthy.exhausted, false);
  assert.strictEqual(healthy.severity, 'healthy');
  assert.ok(healthy.remaining > 0 && healthy.remaining < 1);
  const exhausted = sre.errorBudget({ objective: 0.999, attained: 0.99, windowDays: 30, elapsedDays: 30 });
  assert.strictEqual(exhausted.exhausted, true);
  assert.strictEqual(exhausted.remaining, 0);
  assert.strictEqual(exhausted.severity, 'exhausted');
  // Burn rate is measured against elapsed window time, not the whole window.
  const early = sre.errorBudget({ objective: 0.999, attained: 0.9985, windowDays: 30, elapsedDays: 5 });
  assert.ok(early.burnRate > 1, 'spending half the budget in a sixth of the window is over pace');
});

test('SRE: the release gate FAILS when an SLO is violated', () => {
  const breached = { ...HEALTHY, 'anonymous-reporting': { availability: 0.90, latencyUnder: 0.5 } };
  const gate = sre.releaseGate({ measurements: breached });
  assert.strictEqual(gate.allow, false);
  assert.strictEqual(gate.failClosed, true);
  assert.strictEqual(gate.authorizes, false);
  assert.ok(gate.blockers.some((b) => b.service === 'anonymous-reporting'));
  // And it permits a release when reliability is healthy — not merely always closed.
  const ok = sre.releaseGate({ measurements: HEALTHY });
  assert.strictEqual(ok.allow, true);
  assert.strictEqual(ok.clean, true);
});

test('SRE: a release cannot be judged blind, and only a named human may accept the risk', () => {
  assert.strictEqual(sre.releaseGate({ measurements: {} }).allow, false);
  const breached = { ...HEALTHY, 'investigation': { availability: 0.5, latencyUnder: 0.5 } };
  assert.strictEqual(sre.releaseGate({ measurements: breached, riskAcceptedBy: 'ORB Chair' }).allow, false, 'a rationale is required');
  const overridden = sre.releaseGate({ measurements: breached, riskAcceptedBy: 'ORB Chair', riskRationale: 'security fix outweighs the budget' });
  assert.strictEqual(overridden.allow, true);
  assert.strictEqual(overridden.overridden, true);
  assert.strictEqual(overridden.riskAcceptedBy, 'ORB Chair');
  assert.match(overridden.note, /RECORDED risk acceptance/);
});

test('SRE: recovery compliance checks the chosen strategy against both objectives', () => {
  const bad = sre.recoveryCompliance({ service: 'anonymous-reporting', strategyRtoMinutes: 240, strategyRpoMinutes: 60 });
  assert.strictEqual(bad.compliant, false);
  assert.strictEqual(bad.rtoOk, false);
  assert.strictEqual(bad.rpoOk, false);
  const good = sre.recoveryCompliance({ service: 'anonymous-reporting', strategyRtoMinutes: 10, strategyRpoMinutes: 0 });
  assert.strictEqual(good.compliant, true);
});

test('SRE: autoscaling validation catches the classic mistakes', () => {
  assert.strictEqual(sre.validateAutoscaling(sre.DEFAULT_AUTOSCALING).valid, true);
  const flapping = sre.validateAutoscaling({ minReplicas: 3, maxReplicas: 12, targetCpuPct: 60, scaleUpCooldownS: 300, scaleDownCooldownS: 60 });
  assert.strictEqual(flapping.valid, false);
  assert.ok(flapping.violations.some((x) => /flap/.test(x)));
  const noHa = sre.validateAutoscaling({ minReplicas: 1, maxReplicas: 2, targetCpuPct: 95, scaleUpCooldownS: 60, scaleDownCooldownS: 300 });
  assert.ok(noHa.violations.some((x) => /high availability/.test(x)));
  assert.ok(noHa.violations.some((x) => /targetCpuPct/.test(x)));
});

test('SRE: capacity planning and resource forecasting are deterministic', () => {
  assert.deepStrictEqual(sre.capacityPlan(), sre.capacityPlan());
  const plan = sre.capacityPlan({ months: 6, currentRps: 10, monthlyGrowthPct: 10, rpsPerInstance: 25, headroomPct: 40 });
  assert.strictEqual(plan.plan.length, 7);
  assert.ok(plan.plan[6].projectedRps > plan.plan[0].projectedRps);
  assert.ok(plan.peakInstances >= 1);
  assert.deepStrictEqual(sre.resourceForecast(), sre.resourceForecast());
});

// --- Part 5: enterprise observability ---------------------------------------------------------

test('telemetry: the runtime topology is valid, acyclic and zone-isolated', () => {
  const res = tel.validate();
  assert.deepStrictEqual(res.violations, []);
  assert.deepStrictEqual(tel.cycles(), []);
  // No service depends directly on a service in another zone.
  for (const s of tel.serviceMap()) {
    for (const d of [...s.dependsOn, ...s.degradesOn]) assert.strictEqual(tel.TOPOLOGY[d].zone, s.zone, `${s.service} → ${d}`);
  }
  assert.ok(tel.runtimeTopology().eventFlows.every((f) => f.piiFree));
});

test('telemetry: spans carry only allow-listed semantic attributes', () => {
  const s = tel.span({ name: 'http.request', kind: 'server', traceId: 't', spanId: 's', attrs: { 'http.route': '/api/reports', 'http.status_code': 201, email: 'a@b.c', omang: '123' } });
  assert.strictEqual(s.attrs['http.route'], '/api/reports');
  assert.strictEqual(s.attrs.email, undefined);
  assert.ok(s.dropped.includes('email') && s.dropped.includes('omang'));
  assert.ok(s.resource['service.name']);
});

test('telemetry: business and audit events are correlated and identity-free', () => {
  const req = tel.span({ name: 'POST /api/reports', kind: 'server', traceId: 't1', spanId: 'a', durationMs: 40 });
  const be = tel.businessEvent({ traceId: 't1', spanId: 'b', name: 'case.submitted', caseCode: 'NJ-1', zone: 'independent' });
  const ae = tel.auditEvent({ traceId: 't1', spanId: 'c', name: 'governance.decided', actorRole: 'oversight-board', decision: 'defer' });
  const corr = tel.correlate({ traceId: 't1', spans: [req], logs: [{ traceId: 't1', level: 'info' }], events: [be, ae] });
  assert.strictEqual(corr.complete, true);
  assert.deepStrictEqual(corr.businessEvents, ['case.submitted']);
  assert.deepStrictEqual(corr.auditEvents, ['governance.decided']);
  assert.ok(!/@|omang/i.test(JSON.stringify(corr)));
});

test('telemetry: the trace tree computes self time and names the slowest span', () => {
  const tree = tel.traceTree([
    tel.span({ name: 'root', traceId: 't', spanId: 'a', durationMs: 100 }),
    tel.span({ name: 'db', traceId: 't', spanId: 'b', parentId: 'a', durationMs: 70 }),
    tel.span({ name: 'kms', traceId: 't', spanId: 'c', parentId: 'a', durationMs: 20, status: 'error' }),
  ]);
  assert.strictEqual(tree.slowest.name, 'db');
  assert.strictEqual(tree.spans.find((s) => s.spanId === 'a').selfMs, 10);
  assert.deepStrictEqual(tree.errors, ['kms']);
});

test('telemetry: failure propagation distinguishes down from degraded', () => {
  const notif = tel.failurePropagation(['notification-service']);
  assert.deepStrictEqual(notif.impacted, ['notification-service']);
  assert.ok(notif.degraded.includes('intake-api'));
  assert.strictEqual(notif.criticalPathBroken, false);
  assert.match(notif.constitutionalImpact, /survives/);

  const store = tel.failurePropagation(['persistence-ind']);
  assert.strictEqual(store.criticalPathBroken, true);
  assert.match(store.constitutionalImpact, /constitutional guarantee is broken/);
  assert.deepStrictEqual(Object.keys(store.byZone), ['independent'], 'a single-zone failure stays in its zone');

  assert.ok(tel.singlePointsOfFailure().includes('persistence-ind'));
  assert.ok(!tel.singlePointsOfFailure().includes('notification-service'));
});

test('telemetry: alerts route to an accountable team and board', () => {
  const sec = tel.alertRoute({ domain: 'security', severity: 'page' });
  assert.strictEqual(sec.routed, true);
  assert.strictEqual(sec.board, 'ISRB');
  assert.strictEqual(sec.page, true);
  assert.strictEqual(tel.alertRoute({ domain: 'governance', severity: 'page' }).page, false, 'not every domain pages');
  const unknown = tel.alertRoute({ domain: 'nonsense' });
  assert.strictEqual(unknown.routed, false);
  assert.ok(unknown.fallback.team);
});

test('telemetry: the health score is measured, weighted and honest about coverage', () => {
  const full = tel.healthScore({ architecture: 1, reliability: 1, security: 1, privacy: 1, infrastructure: 1, governance: 1 });
  assert.strictEqual(full.score, 1);
  assert.strictEqual(full.coverage, 1);
  assert.strictEqual(full.band, 'healthy');
  const partial = tel.healthScore({ architecture: 1, reliability: false });
  assert.ok(partial.coverage < 1);
  assert.ok(partial.score < 1);
  assert.ok(partial.contributions.some((c) => c.status === 'unmeasured' && c.contribution === 0));
});

// --- Part 6: performance & resilience -----------------------------------------------------------

test('resilience: load, stress, spike, soak and recovery all hold', () => {
  assert.strictEqual(chaos.loadTest({ iterations: 60 }).pass, true);
  assert.strictEqual(chaos.stressTest({ iterations: 120 }).pass, true);
  assert.strictEqual(chaos.spikeTest({ baseline: 5, spike: 60 }).pass, true);
  assert.strictEqual(chaos.soakTest({ cycles: 60 }).pass, true);
  const recovery = chaos.recoveryTest({ cases: 10 });
  assert.strictEqual(recovery.pass, true);
  assert.strictEqual(recovery.after, recovery.before, 'rebuild from the log loses nothing');
});

test('resilience: every fault class is injected and every experiment states a hypothesis', () => {
  const faults = chaos.experiments();
  for (const required of ['dependency-failure', 'network-partition', 'database-failure', 'storage-failure', 'identity-failure', 'key-management-failure', 'clock-skew']) {
    assert.ok(faults.some((f) => f.id === required), required);
  }
  for (const f of faults) { assert.ok(f.hypothesis.length > 20, f.id); assert.ok(f.fault.length > 10, f.id); }
});

test('resilience: a network partition retains every event and replays it on recovery', () => {
  const r = chaos.runExperiment('network-partition');
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.observed.retainedDuringPartition, 2);
  assert.strictEqual(r.observed.lost, 0);
  assert.strictEqual(r.observed.pendingAfterRecovery, 0);
  assert.strictEqual(r.observed.deadLettered, 0);
});

test('resilience: database, storage and identity failures all fail closed', () => {
  const db = chaos.runExperiment('database-failure');
  assert.strictEqual(db.observed.errorSurfaced, true);
  assert.strictEqual(db.observed.after, db.observed.before, 'no partial write survived');
  const storage = chaos.runExperiment('storage-failure');
  assert.strictEqual(storage.observed.plaintextRefused, true);
  const idp = chaos.runExperiment('identity-failure');
  assert.strictEqual(idp.observed.forgedRejected, true);
  assert.strictEqual(idp.observed.tamperedRejected, true);
  assert.strictEqual(idp.observed.validAccepted, true);
});

test('resilience: a dependency failure opens the breaker, fails fast, then probes again', () => {
  const r = chaos.runExperiment('dependency-failure');
  assert.strictEqual(r.observed.opened, true);
  assert.strictEqual(r.observed.fastFail, true);
  assert.strictEqual(r.observed.probesAfterCooldown, true, 'the breaker must not stay open forever');
});

test('resilience: the whole suite runs as one CI-executable, fail-closed gate', () => {
  const suite = chaos.runSuite({ light: true });
  assert.strictEqual(suite.pass, true, JSON.stringify(suite.failed));
  assert.strictEqual(suite.failClosed, true);
  assert.strictEqual(suite.authorizes, false);
  assert.ok(suite.tests >= 12);
});
