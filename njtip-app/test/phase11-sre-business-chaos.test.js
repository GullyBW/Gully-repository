'use strict';
// Phase 11, Parts 4, 5 & 6 — advanced SRE (burn-rate alerting, forecasting, dependency risk,
// scorecards), business observability, and the chaos detect-and-recover contract.
const test = require('node:test');
const assert = require('node:assert');
const sre = require('../src/observability/sre');
const bus = require('../src/observability/business');
const chaos = require('../src/twin2/chaos');

const H = 3600_000;
const HEALTHY = Object.fromEntries(Object.keys(sre.SERVICE_LEVELS).map((s) => [s, { availability: 1, latencyUnder: 1 }]));
const fullHistory = () => {
  const h = new sre.SloComplianceHistory();
  for (const s of Object.keys(sre.SERVICE_LEVELS)) for (let p = 0; p < 4; p++) h.record({ service: s, period: p, availability: 1, latencyUnder: 1 });
  return h;
};

// --- Part 4: multi-window burn-rate alerting -------------------------------------------------

test('burn-rate: both windows must burn before an alert pages', () => {
  // Objective 0.999 → budget 0.001. Attained 0.9856 is a 14.4× burn.
  const both = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: { 'fast-burn': 0.9856 }, shortWindowAttained: { 'fast-burn': 0.98 } });
  assert.equal(both.page, true);
  assert.deepEqual(both.firing, ['fast-burn']);
  assert.equal(both.worst, 'fast-burn');
});

test('burn-rate: a recovered incident stops paging even though the long window still burns', () => {
  const recovered = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: { 'fast-burn': 0.9856 }, shortWindowAttained: { 'fast-burn': 1 } });
  assert.equal(recovered.page, false);
  assert.equal(recovered.alerts[0].longBurning, true);
  assert.equal(recovered.alerts[0].shortBurning, false);
  assert.equal(recovered.alerts[0].suppressed, true);
});

test('burn-rate: a healthy service fires nothing, and every severity is represented', () => {
  const windows = { 'fast-burn': 0.9999, 'medium-burn': 0.9999, 'slow-burn': 0.9999 };
  const quiet = sre.burnRateAlerts({ service: 'anonymous-reporting', longWindowAttained: windows, shortWindowAttained: windows });
  assert.deepEqual(quiet.firing, []);
  assert.equal(quiet.page, false);
  assert.ok(sre.BURN_ALERTS.some((a) => a.severity === 'page'));
  assert.ok(sre.BURN_ALERTS.some((a) => a.severity === 'ticket'));
  for (const a of sre.BURN_ALERTS) assert.ok(a.shortWindowMinutes < a.longWindowHours * 60, `${a.id}: short window is not shorter`);
});

test('burn-rate: an unknown service with no objective is refused rather than guessed', () => {
  assert.throws(() => sre.burnRateAlerts({ service: 'not-a-service' }), /unknown service/);
});

// --- Part 4: trends and forecasting ------------------------------------------------------------

test('trend: direction is derived, deterministic, and refuses to read a single point', () => {
  assert.equal(sre.trend([1, 2, 3, 4]).direction, 'improving');
  assert.equal(sre.trend([4, 3, 2, 1]).direction, 'degrading');
  assert.equal(sre.trend([2, 2, 2]).direction, 'flat');
  assert.equal(sre.trend([1]).direction, 'insufficient-data');
  assert.deepEqual(sre.trend([0.99, 0.98, 0.97]), sre.trend([0.99, 0.98, 0.97]));
});

test('reliability forecast: a degrading trend predicts a breach; a steady one does not', () => {
  const degrading = sre.reliabilityForecast({ service: 'case-status', history: [0.999, 0.998, 0.996, 0.995], periodsAhead: 4 });
  assert.equal(degrading.breachExpected, true);
  assert.equal(degrading.trend.direction, 'degrading');
  assert.ok(degrading.periodsToBreach >= 1);
  assert.equal(degrading.authorizes, false);

  const steady = sre.reliabilityForecast({ service: 'case-status', history: [0.999, 0.999, 0.999, 0.999], periodsAhead: 6 });
  assert.equal(steady.breachExpected, false);
});

test('recovery forecast: restore time scales with volume while the RTO does not move', () => {
  const growing = sre.recoveryForecast({ service: 'investigation', restoreMinutesPerGb: 0.5, dataGbNow: 100, monthlyGrowthPct: 6, months: 24 });
  assert.equal(growing.currentlyMeetsRto, true);
  assert.equal(growing.breachExpected, true);
  assert.equal(typeof growing.breachAtMonth, 'number');
  assert.match(growing.remedy, /Parallelise restore/);

  const flat = sre.recoveryForecast({ service: 'investigation', restoreMinutesPerGb: 0.05, dataGbNow: 10, monthlyGrowthPct: 0, months: 24 });
  assert.equal(flat.breachExpected, false);
});

// --- Part 4: dependency risk -------------------------------------------------------------------

test('dependency risk: scores are derived from the topology, ordered and reproducible', () => {
  const risk = sre.dependencyRisk();
  assert.ok(risk.services.length > 0);
  assert.deepEqual(sre.dependencyRisk(), risk);
  for (let i = 1; i < risk.services.length; i++) assert.ok(risk.services[i - 1].score >= risk.services[i].score);
  for (const r of risk.services) {
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(['severe', 'high', 'moderate', 'low'].includes(r.band));
  }
  assert.ok(risk.singlePointsOfFailure.includes('persistence-ind'));
  const by = Object.fromEntries(risk.services.map((r) => [r.service, r]));
  assert.ok(by['persistence-ind'].score > by['analytics'].score, 'a constitutional SPOF must outrank a leaf analytics service');
});

// --- Part 4: SLO compliance history & scorecards -----------------------------------------------

test('SLO compliance history is append-only and refuses an unknown service', () => {
  const h = new sre.SloComplianceHistory();
  h.record({ service: 'investigation', period: 0, availability: 0.996, latencyUnder: 0.96 });
  h.record({ service: 'investigation', period: 1, availability: 0.994, latencyUnder: 0.96 });
  assert.throws(() => h.record({ service: 'investigation', period: 1, availability: 1 }), /append-only/);
  assert.throws(() => h.record({ service: 'nope', period: 0, availability: 1 }), /unknown service level/);

  const c = h.compliance('investigation');
  assert.equal(c.periods, 2);
  assert.equal(c.complianceRate, 0.5);
  assert.equal(c.consecutiveBreaches, 1);
  assert.equal(c.trend.direction, 'degrading');
});

test('scorecard: a healthy platform grades A; an unmeasured service scores F, never a free pass', () => {
  const good = sre.scorecard({ measurements: HEALTHY, history: fullHistory() });
  assert.equal(good.overallGrade, 'A');
  assert.equal(good.authorizes, false);

  const bad = sre.scorecard({ measurements: { 'anonymous-reporting': { availability: 0.9, latencyUnder: 0.5 } } });
  assert.notEqual(bad.overallGrade, 'A');
  const unmeasured = bad.services.find((s) => !s.measured);
  assert.equal(unmeasured.score, 0);
  assert.equal(unmeasured.grade, 'F');
  assert.ok(bad.services.find((s) => s.service === 'anonymous-reporting').reasons.length > 0);
});

test('release readiness stays fail-closed and still warns on a degrading-but-compliant trend', () => {
  const ready = sre.releaseReadiness({ measurements: HEALTHY, history: fullHistory() });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.gate.blockers, []);

  const blocked = sre.releaseReadiness({ measurements: { 'anonymous-reporting': { availability: 0.9, latencyUnder: 0.5 } } });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.failClosed, true);
  assert.equal(blocked.authorizes, false);

  const drifting = new sre.SloComplianceHistory();
  for (const [p, a] of [[0, 1], [1, 0.9999], [2, 0.9997], [3, 0.9995]]) drifting.record({ service: 'anonymous-reporting', period: p, availability: a, latencyUnder: 1 });
  const warned = sre.releaseReadiness({ measurements: HEALTHY, history: drifting });
  assert.equal(warned.ready, true, 'a compliant platform is not blocked by a trend');
  assert.ok(warned.warnings.some((w) => w.service === 'anonymous-reporting' && /degrading/.test(w.warning)));
});

// --- Part 5: business observability ------------------------------------------------------------

const EVENTS = [
  { type: 'CaseCreated', correlationId: 'C1', at: 0 },
  { type: 'CaseTransitioned', correlationId: 'C1', to: 'closed', at: 100 * H },
  { type: 'CaseCreated', correlationId: 'C2', at: 0 },
  { type: 'CaseTransitioned', correlationId: 'C2', to: 'closed', at: 200 * H },
  { type: 'CaseCreated', correlationId: 'C3', at: 0 },
  { type: 'EvidenceIngested', correlationId: 'E1', at: 0 },
  { type: 'EvidenceAdmitted', correlationId: 'E1', at: 10 * H },
  { type: 'ApprovalRequested', correlationId: 'A1', at: 0 },
  { type: 'ApprovalGranted', correlationId: 'A1', at: 20 * H },
  { type: 'AuditScheduled', correlationId: 'AU1', at: 0 },
  { type: 'AuditCompleted', correlationId: 'AU1', at: 1 * H },
  { type: 'ComplianceChecked', correlationId: 'X', outcome: 'ok', at: 0 },
];

test('business observability refuses identity-bearing events rather than stripping them', () => {
  assert.throws(() => bus.derive([{ type: 'CaseCreated', correlationId: 'C1', at: 0, name: 'a person' }]), /refuses identity-bearing events/);
  assert.throws(() => bus.derive([{ type: 'CaseCreated', correlationId: 'C1', at: 0, omang: '123' }]), /refuses identity-bearing events/);
  assert.equal(bus.assertPiiFree(EVENTS), true);
});

test('business metrics are derived from events and are deterministic', () => {
  const d = bus.derive(EVENTS, { periods: 1 });
  assert.equal(d['case-throughput'], 2);
  assert.equal(d['investigation-latency'], 100);
  assert.equal(d['evidence-processing-time'], 10);
  assert.equal(d['approval-delay'], 20);
  assert.equal(d['audit-completion-rate'], 1);
  assert.deepEqual(bus.derive(EVENTS), d);
});

test('an in-flight case counts as open — a growing backlog cannot hide behind completed work', () => {
  const dwell = bus.dwellTimes(EVENTS, 'investigation-latency');
  assert.equal(dwell.completed, 2);
  assert.equal(dwell.open, 1);
  assert.equal(dwell.median, 100);
  assert.equal(dwell.max, 200);
});

test('a metric with no evidence reports no-evidence, never met', () => {
  const empty = bus.dashboard({ events: [], periods: 1 });
  assert.equal(empty.healthy, false);
  for (const m of empty.metrics) assert.notEqual(m.status, 'met');
  assert.equal(bus.assess('approval-delay', null).status, 'no-evidence');
});

test('objective assessment respects each metric\'s polarity', () => {
  assert.equal(bus.assess('case-throughput', 30).status, 'met');
  assert.equal(bus.assess('case-throughput', 5).status, 'breached');
  assert.equal(bus.assess('approval-delay', 24).status, 'met');
  assert.equal(bus.assess('approval-delay', 400).status, 'breached');
});

test('trend movement is read against the metric, so a rising duration is worsening', () => {
  const d = bus.dashboard({ events: EVENTS, periods: 1, businessHistory: { 'approval-delay': [10, 20, 30, 40], 'case-throughput': [30, 28, 26, 24] } });
  assert.ok(d.worsening.includes('approval-delay'));
  assert.ok(d.worsening.includes('case-throughput'));
  const better = bus.dashboard({ events: EVENTS, periods: 1, businessHistory: { 'approval-delay': [40, 30, 20, 10] } });
  assert.ok(!better.worsening.includes('approval-delay'));
});

test('correlation is a hypothesis: it flags an unexpected direction and never claims cause', () => {
  assert.equal(bus.correlation([1, 2], [1, 2]), null, 'fewer than three points is not a correlation');
  assert.equal(bus.correlation([1, 1, 1], [1, 2, 3]), null, 'a constant series has no correlation');

  const aligned = bus.correlateWithReliability({ businessHistory: { 'case-throughput': [10, 12, 14, 16] }, technicalHistory: { 'case-status': [0.99, 0.992, 0.995, 0.999] } });
  assert.equal(aligned.causal, false);
  assert.equal(aligned.authorizes, false);
  const f = aligned.findings.find((x) => x.metric === 'case-throughput' && x.service === 'case-status');
  assert.equal(f.strength, 'strong');
  assert.equal(f.aligned, true);

  const inverted = bus.correlateWithReliability({ businessHistory: { 'case-throughput': [16, 14, 12, 10] }, technicalHistory: { 'case-status': [0.99, 0.992, 0.995, 0.999] } });
  const inv = inverted.findings.find((x) => x.metric === 'case-throughput' && x.service === 'case-status');
  assert.equal(inv.aligned, false);
  assert.match(inv.hypothesis, /UNEXPECTED/);
});

test('every business metric correlates against a real service level and names an owning board', () => {
  for (const m of bus.catalogue()) {
    assert.ok(m.board, `${m.id}: no owning board`);
    assert.ok(m.correlatesWith.length > 0, `${m.id}: nothing to correlate against`);
    for (const s of m.correlatesWith) assert.ok(sre.SERVICE_LEVELS[s], `${m.id}: unknown service level ${s}`);
  }
});

// --- Part 6: the chaos detect-and-recover contract ---------------------------------------------

test('every chaos scenario proves both detection and recovery', () => {
  for (const id of chaos.experiments().map((e) => e.id)) {
    const r = chaos.runExperiment(id);
    assert.equal(r.error, null, `${id}: ${r.error}`);
    assert.equal(r.detected, true, `${id}: detection not proven`);
    assert.equal(r.recovered, true, `${id}: recovery not proven`);
    assert.deepEqual(r.contractViolations, [], `${id}: contract violated`);
    assert.equal(r.pass, true, `${id}: hypothesis did not hold`);
  }
});

test('all twelve Part 6 fault classes are present and executable', () => {
  const ids = chaos.experiments().map((e) => e.id);
  for (const required of ['dns-failure', 'certificate-expiry', 'clock-skew', 'identity-provider-outage',
    'network-partition', 'dependency-latency', 'storage-corruption', 'message-duplication',
    'message-reordering', 'partial-regional-outage', 'degraded-service', 'cascading-failure']) {
    assert.ok(ids.includes(required), `missing scenario: ${required}`);
  }
});

test('the detect-and-recover contract bites: silent survival is not a pass', () => {
  const original = chaos.EXPERIMENTS['dns-failure'];
  try {
    chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'survives silently', run: () => ({ pass: true }) };
    const silent = chaos.runExperiment('dns-failure');
    assert.equal(silent.pass, false);
    // Phase 12 extended the contract from two stages to four, so an experiment reporting nothing
    // now fails on all four rather than on the original two.
    assert.equal(silent.contractViolations.length, chaos.RESILIENCE_STAGES.length);

    chaos.EXPERIMENTS['dns-failure'] = { fault: 'crafted', hypothesis: 'detected, never recovers', run: () => ({ pass: true, detected: true, recovered: false }) };
    assert.equal(chaos.runExperiment('dns-failure').pass, false);
  } finally {
    chaos.EXPERIMENTS['dns-failure'] = original;
  }
});

test('DNS: a stale cache carries the outage, then stops lying once the stale window closes', () => {
  let now = 0;
  const dns = new chaos.StubResolver({ clock: () => now, ttlMs: 60_000, staleMs: 300_000 });
  dns.publish('svc.internal', '10.0.0.1');
  assert.equal(dns.resolve('svc.internal').source, 'authoritative');
  dns.outage('svc.internal');
  now += 30_000;
  assert.equal(dns.resolve('svc.internal').source, 'cache');
  now += 60_000;
  assert.equal(dns.resolve('svc.internal').source, 'stale-cache');
  now += 400_000;
  assert.equal(dns.resolve('svc.internal').resolved, false);
  dns.publish('svc.internal', '10.0.0.2');
  assert.equal(dns.resolve('svc.internal').address, '10.0.0.2');
});

test('an unknown name with no cache fails closed rather than resolving to nothing useful', () => {
  const dns = new chaos.StubResolver({ clock: () => 0 });
  const r = dns.resolve('never-published.internal');
  assert.equal(r.resolved, false);
  assert.equal(r.source, 'none');
});

test('ordered consumer buffers an out-of-order event and drains in order once the gap fills', () => {
  const c = new chaos.OrderedConsumer();
  assert.equal(c.receive({ seq: 1, type: 'A' }).applied, true);
  assert.equal(c.receive({ seq: 3, type: 'C' }).buffered, true);
  assert.equal(c.applied().length, 1, 'nothing may be applied across a gap');
  assert.equal(c.receive({ seq: 2, type: 'B' }).applied, true);
  assert.deepEqual(c.applied().map((e) => e.seq), [1, 2, 3]);
  assert.equal(c.bufferedCount(), 0);
  assert.equal(c.receive({ seq: 1, type: 'A' }).duplicate, true, 'a replayed event is not applied twice');
});

test('clock skew is detected against tolerance and clears when the node resyncs', () => {
  const skewed = chaos.detectClockSkew({ nodeOffsetsMs: { a: 0, b: -900_000 }, toleranceMs: 60_000 });
  assert.equal(skewed.skewDetected, true);
  assert.deepEqual(skewed.offenders, ['b']);
  assert.equal(chaos.detectClockSkew({ nodeOffsetsMs: { a: 0, b: 300 }, toleranceMs: 60_000 }).skewDetected, false);
});

test('a dependency that is merely slow still breaches its latency budget', () => {
  assert.equal(chaos.latencyBudget({ samples: [40, 55, 62], budgetMs: 500 }).breached, false);
  const slow = chaos.latencyBudget({ samples: [40, 900, 1100, 1300, 1250], budgetMs: 500 });
  assert.equal(slow.breached, true);
  assert.equal(slow.severity, 'critical');
  assert.equal(slow.overBudget, 4);
});

test('the resilience suite reports detection and recovery for every experiment and stays fail-closed', () => {
  const suite = chaos.runSuite({ light: true });
  assert.equal(suite.pass, true);
  assert.deepEqual(suite.contractViolations, []);
  assert.equal(suite.detected, suite.chaos.length);
  assert.equal(suite.recovered, suite.chaos.length);
  assert.equal(suite.failClosed, true);
  assert.equal(suite.authorizes, false);
});
