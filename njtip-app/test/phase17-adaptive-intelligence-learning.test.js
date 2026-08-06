'use strict';

// Phase 17 — Adaptive Institutional Intelligence, Operational Accreditation & Continuous Learning.
//
// The phase turns on a single question that the previous sixteen never asked directly: when a
// governance figure goes up, WHY did it go up? There are three answers and only one of them is
// progress — the institution did something and there is evidence of it; the way the figure is
// computed changed; or nobody knows. Every trend in this phase routes through the same primitive
// so the three can never be confused, and an improvement nobody verified is recorded as a
// violation of the phase invariant rather than as good news.

const test = require('node:test');
const assert = require('node:assert/strict');

const ec = require('../src/assurance/evidence-confidence');
const inst = require('../src/assurance/institutional');

const DAY = 24 * 3600_000;

// ---------------------------------------------------------------------------------------------
// Part 1 — verified improvement. The primitive the rest of the phase is built on.
// ---------------------------------------------------------------------------------------------

test('phase17: a rise with nothing behind it is an unverified improvement, and that violates the invariant', () => {
  const t = ec.verifiedImprovement({ subject: 'detection rate', series: [0.4, 0.9] });
  assert.equal(t.state, 'unverified-improvement');
  assert.equal(t.improved, true);
  assert.equal(t.verified, false);
  assert.equal(t.violatesInvariant, true);
  assert.match(t.reason, /NOTHING independently verified supports the rise/);
});

test('phase17: only independent evidence verifies a rise — a self-assessment does not', () => {
  const series = [0.4, 0.9];
  const selfAssessed = ec.verifiedImprovement({
    subject: 'detection rate', series,
    evidence: [{ kind: 'self-assessment', detail: 'the owning team reports it is better', by: 'the owning team' }],
  });
  assert.equal(selfAssessed.state, 'unverified-improvement');
  assert.equal(selfAssessed.violatesInvariant, true);

  for (const kind of ['observed-outcome', 'independent-verification', 'recorded-act']) {
    const verified = ec.verifiedImprovement({
      subject: 'detection rate', series,
      evidence: [{ kind, detail: 'something happened and it was recorded', by: 'Auditor General' }],
    });
    assert.equal(verified.state, 'verified-improvement', `${kind} should verify a rise`);
    assert.equal(verified.violatesInvariant, false);
  }
});

test('phase17: a measurement change EXPLAINS a rise rather than supporting it', () => {
  const t = ec.verifiedImprovement({
    subject: 'coverage', series: [0.3, 0.8],
    evidence: [{ kind: 'measurement-change', detail: 'the denominator was narrowed', by: 'Engineering' }],
  });
  assert.equal(t.verified, false);
  assert.equal(t.state, 'unverified-improvement');
  assert.equal(t.measurementChanges.length, 1, 'the change is recorded, just not as support');
  assert.match(ec.IMPROVEMENT_EVIDENCE_KINDS['measurement-change'].means, /opposite of supporting it/i);
  assert.equal(ec.IMPROVEMENT_EVIDENCE_KINDS['measurement-change'].independent, false);
});

test('phase17: unknown, steady and regressed are three different things and none of them blocks', () => {
  const unknown = ec.verifiedImprovement({ subject: 'x', series: [0.5] });
  assert.equal(unknown.state, 'unknown');
  assert.match(ec.IMPROVEMENT_STATES.unknown.means, /Fewer than two observations/);

  const steady = ec.verifiedImprovement({ subject: 'x', series: [0.50, 0.51] });
  assert.equal(steady.state, 'steady', 'a move inside the tolerance is not a direction');

  const regressed = ec.verifiedImprovement({ subject: 'x', series: [0.9, 0.4] });
  assert.equal(regressed.state, 'regressed');

  // A fall is a different problem, reported elsewhere. This invariant is about unearned credit.
  for (const s of [unknown, steady, regressed]) assert.equal(s.violatesInvariant, false);
});

test('phase17: exactly one improvement state violates the invariant', () => {
  const violating = Object.entries(ec.IMPROVEMENT_STATES).filter(([, s]) => s.violatesInvariant).map(([id]) => id);
  assert.deepEqual(violating, ['unverified-improvement'],
    'if a regression blocked here, the invariant would become "nothing may ever get worse" and stop meaning anything');
});

test('phase17: direction follows higherIsBetter — a falling latency is an improvement', () => {
  const t = ec.verifiedImprovement({ subject: 'latency', series: [900, 200], higherIsBetter: false });
  assert.equal(t.improved, true);
  assert.equal(t.state, 'unverified-improvement');
});

test('phase17: the improvement report aggregates to the weakest link, not to the mean', () => {
  const report = ec.improvementReport({
    trends: [
      { subject: 'a', series: [0.1, 0.9], evidence: [{ kind: 'observed-outcome', detail: 'd', by: 'x' }] },
      { subject: 'b', series: [0.1, 0.9] },
    ],
    now: 0,
  });
  assert.equal(report.count, 2);
  assert.equal(report.violationCount, 1);
  assert.deepEqual(report.verifiedImprovements, ['a']);
  assert.deepEqual(report.unverifiedImprovements.map((u) => u.subject), ['b']);
  // One unverified rise among two is a violation. It is not averaged away against the verified one.
  assert.equal(report.everyImprovementVerified, false);
  assert.equal(report.authorizes, false);
});

test('phase17: an empty improvement report reports no violation it could not have found', () => {
  const empty = ec.improvementReport({ trends: [], now: 0 });
  assert.equal(empty.violationCount, 0);
  assert.equal(empty.everyImprovementVerified, true);
  assert.match(empty.basis, /nothing has improved or regressed as far as this report knows/);
});

// ---------------------------------------------------------------------------------------------
// Part 16 — evidence quality evolution. This trend watches the denominator too.
// ---------------------------------------------------------------------------------------------

const DIMENSION = Object.keys(ec.QUALITY_DIMENSIONS)[0];

test('phase17: a shrinking evidence corpus explains a quality rise rather than supporting it', () => {
  const evolution = ec.evidenceQualityEvolution({
    snapshots: [
      { count: 100, byDimension: { [DIMENSION]: 0.4 } },
      { count: 20, byDimension: { [DIMENSION]: 0.9 } },
    ],
    now: 0,
  });
  assert.equal(evolution.corpusShrank, true);
  assert.equal(evolution.corpusGrowth, -80);
  assert.ok(evolution.unverifiedImprovements.includes(DIMENSION));
  assert.equal(evolution.everyImprovementVerified, false);

  const row = evolution.dimensions.find((d) => d.dimension === DIMENSION);
  assert.equal(row.trend.verified, false);
  assert.match(row.trend.reason, /the corpus shrank from 100 to 20/);
  assert.match(evolution.note, /denominator/i);
  assert.equal(evolution.authorizes, false);
});

test('phase17: a corpus that held its size is not blamed for a rise it did not cause', () => {
  const steady = ec.evidenceQualityEvolution({
    snapshots: [{ count: 100, byDimension: { [DIMENSION]: 0.4 } }, { count: 100, byDimension: { [DIMENSION]: 0.9 } }],
    now: 0,
  });
  assert.equal(steady.corpusShrank, false);
  assert.doesNotMatch(steady.dimensions.find((d) => d.dimension === DIMENSION).trend.reason, /corpus shrank/);
  // Still unverified — but for the ordinary reason, not the denominator.
  assert.ok(steady.unverifiedImprovements.includes(DIMENSION));
});

test('phase17: one evidence snapshot is not a trend', () => {
  const single = ec.evidenceQualityEvolution({ snapshots: [{ count: 10, byDimension: { [DIMENSION]: 0.5 } }], now: 0 });
  assert.equal(single.measurable, false);
  assert.equal(single.corpusShrank, null, 'nothing can be said about a corpus changing size from one observation');
  assert.equal(single.authorizes, false);
});

// ---------------------------------------------------------------------------------------------
// Part 2 — evidence source health. Health is about how a source is DOING.
// ---------------------------------------------------------------------------------------------

function declareConnector(reg, id, overrides = {}) {
  return reg.declare(id, {
    kind: 'audit-system', owner: 'Registrar of the High Court', sourceSystem: 'Case Registry',
    integrity: 'signed', trustLevel: 'declared', freshnessRequirementDays: 7,
    declaredBy: 'Registrar of the High Court', at: 0, ...overrides,
  });
}

test('phase17: a connector that has never synchronized has unknown reliability, not zero', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'CN-1');
  const r = reg.reliability('CN-1', { now: 30 * DAY });
  assert.equal(r.measurable, false);
  assert.equal(r.successRate, null);
  assert.equal(r.failureCount, null);
  assert.equal(r.stalePeriods, null);
  assert.match(r.reason, /UNKNOWN, not zero/);
});

test('phase17: an independently verified source that has never run is unknown, not healthy', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'CN-V');
  reg.verify('CN-V', { by: 'Auditor General', independent: true, at: 0 });

  const before = reg.health('CN-V', { now: 0 });
  assert.equal(before.state, 'unknown', 'health is about how a source is doing, and it has not done anything');
  assert.equal(before.behaviourObserved, false);

  // Once it runs, arrives fresh and does not fail, healthy becomes reachable — so the state is not
  // decoration.
  reg.recordSync('CN-V', { outcome: 'synchronized', records: 5, newestRecordAt: 0, latencyMs: 50, by: 'scheduler', at: 0 });
  assert.equal(reg.health('CN-V', { now: 0 }).state, 'healthy');
});

test('phase17: unknown health does not hide the declaration findings underneath it', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'CN-1');
  const h = reg.health('CN-1', { now: 30 * DAY });
  assert.equal(h.state, 'unknown');
  assert.ok(h.failing.includes('verificationHistory'), 'nobody has verified it, and that stays visible');
  assert.ok(h.failing.includes('provenanceConfidence'));
  assert.match(h.basis, /still need work/);
});

test('phase17: staleness is measured against the source own cadence, not a uniform threshold', () => {
  const fast = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(fast, 'CN-FAST', { freshnessRequirementDays: 7 });
  fast.recordSync('CN-FAST', { outcome: 'synchronized', records: 1, newestRecordAt: 0, by: 'scheduler', at: 0 });
  fast.recordSync('CN-FAST', { outcome: 'synchronized', records: 1, newestRecordAt: 30 * DAY, by: 'scheduler', at: 30 * DAY });
  assert.ok(fast.reliability('CN-FAST', { now: 30 * DAY }).stalePeriods >= 1);

  const slow = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(slow, 'CN-SLOW', { freshnessRequirementDays: 90 });
  slow.recordSync('CN-SLOW', { outcome: 'synchronized', records: 1, newestRecordAt: 0, by: 'scheduler', at: 0 });
  slow.recordSync('CN-SLOW', { outcome: 'synchronized', records: 1, newestRecordAt: 30 * DAY, by: 'scheduler', at: 30 * DAY });
  assert.equal(slow.reliability('CN-SLOW', { now: 30 * DAY }).stalePeriods, 0,
    'the same gap is stale for a weekly feed and unremarkable for a quarterly one');
});

test('phase17: latency is averaged over the synchronizations that timed themselves, with the sample count stated', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'CN-2');
  reg.recordSync('CN-2', { outcome: 'synchronized', records: 10, newestRecordAt: 0, latencyMs: 100, by: 'scheduler', at: 0 });
  reg.recordSync('CN-2', { outcome: 'synchronized', records: 10, newestRecordAt: 30 * DAY, latencyMs: 300, by: 'scheduler', at: 30 * DAY });
  reg.recordSync('CN-2', { outcome: 'failed', errors: ['refused'], by: 'scheduler', at: 31 * DAY });

  const r = reg.reliability('CN-2', { now: 32 * DAY });
  assert.equal(r.meanLatencyMs, 200);
  assert.equal(r.latencySamples, 2, 'a mean over two of three synchronizations is a mean over two');
  assert.equal(r.failureCount, 1);
  assert.equal(r.successRate, 0.6667);

  // A synchronization that did not time itself leaves latency unknown, never zero.
  const untimed = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(untimed, 'CN-3');
  untimed.recordSync('CN-3', { outcome: 'synchronized', records: 1, newestRecordAt: 0, by: 'scheduler', at: 0 });
  assert.equal(untimed.reliability('CN-3', { now: 0 }).meanLatencyMs, null);
});

test('phase17: an integrity failure cannot be recorded against a path declared unprotected', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'CN-OPEN', { integrity: 'unprotected' });
  assert.throws(
    () => reg.recordSync('CN-OPEN', { outcome: 'synchronized', records: 1, newestRecordAt: 0, integrityFailures: 1, by: 'scheduler', at: 0 }),
    (e) => e.failClosed === true && /nothing checks what arrives/.test(e.message),
    'an unprotected path has no integrity control that could have failed, so claiming one is a contradiction',
  );
});

test('phase17: seven health dimensions, each saying what not knowing it costs', () => {
  assert.equal(Object.keys(inst.SOURCE_HEALTH_DIMENSIONS).length, 7);
  for (const [id, d] of Object.entries(inst.SOURCE_HEALTH_DIMENSIONS)) {
    assert.ok(d.asks && d.asks.endsWith('?'), `${id} states its question`);
    assert.ok(d.ifUnknown, `${id} states what not knowing it costs`);
  }
  assert.equal(inst.SOURCE_HEALTH_STATES.unknown.examined, false);
  assert.match(inst.SOURCE_HEALTH_STATES.unknown.means, /not examined is not unhealthy/i);
});

test('phase17: a dashboard of unknown sources is not a dashboard of failures', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'A');
  declareConnector(reg, 'B');
  const dash = reg.healthDashboard({ now: 0 });
  assert.deepEqual(dash.unhealthy, []);
  assert.deepEqual(dash.unknown, ['A', 'B']);
  assert.deepEqual(dash.neverSynchronized, ['A', 'B']);
  assert.equal(dash.healthRate, null, 'a rate over zero measured sources is unknown, not zero');
  assert.equal(dash.measurable, false);
  assert.equal(dash.authorizes, false);
});

test('phase17: the connector register ships empty — no synthetic source history is fabricated', () => {
  const dash = new inst.EvidenceConnectorRegistry({ clock: () => 0 }).healthDashboard({ now: 0 });
  assert.equal(dash.count, 0);
  assert.equal(dash.measurable, false);
  assert.match(dash.basis, /not-applicable-and-stated/);
});

test('phase17: the estate availability trend obeys the improvement rule like every other trend', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  declareConnector(reg, 'A');
  assert.equal(reg.healthDashboard({ now: 0 }).availabilityTrend.state, 'unknown');
  assert.equal(reg.healthDashboard({ now: 0, history: [0.3, 0.9] }).availabilityTrend.state, 'unverified-improvement');
  assert.equal(reg.healthDashboard({
    now: 0, history: [0.3, 0.9],
    evidence: [{ kind: 'recorded-act', detail: 'the feed was repaired and the change recorded', by: 'OCTO' }],
  }).availabilityTrend.state, 'verified-improvement');
});
