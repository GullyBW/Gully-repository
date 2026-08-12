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

// ---------------------------------------------------------------------------------------------
// Part 5 — explanation trees. A view of the walk, never a second walk.
// ---------------------------------------------------------------------------------------------

const OPTIONS = { dashboard: null, readiness: null, evidence: null, controls: [], authorities: null, history: null, now: 0 };

test('phase17: the explanation chain is nine hops and ends at a source record', () => {
  assert.deepEqual(inst.EXPLANATION_ORDER, [
    'executive-metric', 'readiness-dimension', 'evidence', 'control', 'policy',
    'legal-authority', 'adr', 'historical-records', 'source-record',
  ]);
  for (const [id, h] of Object.entries(inst.EXPLANATION_HOPS)) {
    assert.ok(h.answers.endsWith('?'), `${id} states its question`);
    assert.ok(h.resolvedFrom && h.ifBroken, `${id} states what resolves it and what its break costs`);
  }
  assert.match(inst.EXPLANATION_HOPS['historical-records'].ifBroken, /never been wrong/);
});

test('phase17: an explanation tree is a view of the walk, so the two can never disagree', () => {
  for (const panel of Object.keys(inst.EXECUTIVE_PANELS)) {
    const walk = inst.explain(panel, OPTIONS);
    const tree = inst.explanationTree(panel, OPTIONS);
    assert.equal(tree.complete, walk.complete, panel);
    assert.equal(tree.brokenAt, walk.brokenAt, panel);
    assert.equal(tree.depth, walk.hops.length, panel);
    assert.equal(tree.navigableDepth, walk.resolvedHops.length, panel);
  }
});

test('phase17: each tree node contains the ones below it, so a reader cannot skip a hop', () => {
  const tree = inst.explanationTree('governanceMaturity', OPTIONS);
  const flattened = [];
  for (let node = tree.root; node; node = node.children[0] || null) flattened.push(node.hop);
  assert.deepEqual(flattened, inst.EXPLANATION_ORDER);
  assert.equal(tree.root.depthBelow, inst.EXPLANATION_ORDER.length - 1);
  assert.equal(tree.authorizes, false);

  // A resolved hop states no consequence; an unresolved one must.
  for (let node = tree.root; node; node = node.children[0] || null) {
    if (node.resolved) assert.equal(node.ifBroken, null, node.hop);
    else assert.ok(node.ifBroken, node.hop);
  }
});

test('phase17: mean navigable depth is reported with the sentence that stops it being read alone', () => {
  const report = inst.explainabilityCompleteness(OPTIONS);
  assert.equal(report.maxDepth, 9);
  assert.equal(report.fullyExplainable, 0, 'nothing is explainable end to end with nothing supplied');
  assert.ok(report.meanNavigableDepth > 0 && report.meanNavigableDepth < 9);
  assert.match(report.completenessBasis, /alongside the chain count, never instead of it/);

  // Per-hop resolution is the figure that says what to go and fix.
  assert.deepEqual(report.byHop.map((h) => h.hop), inst.EXPLANATION_ORDER);
  report.byHop.forEach((h, i) => {
    assert.equal(h.position, i + 1);
    assert.ok(h.resolutionRate >= 0 && h.resolutionRate <= 1, h.hop);
    assert.ok(h.resolved <= h.panels, h.hop);
  });
  // The distribution accounts for every panel, or a depth is being dropped.
  const counted = Object.values(report.depthDistribution).reduce((a, b) => a + b, 0);
  assert.equal(counted, report.panels.length);
});

test('phase17: the two new hops each break on their own, and the nine-hop chain is completable', () => {
  const evidenceConfidence = require('../src/assurance/evidence-confidence');
  const register = new evidenceConfidence.EvidenceRegister({ clock: () => 0 });
  for (const dimension of Object.keys(evidenceConfidence.READINESS_DIMENSIONS)) {
    register.record({ id: `readiness:${dimension}`, source: 'executable-check', completeness: 1, verifiedAt: 0, detail: 'supplied' });
  }
  const controls = [
    ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const authorities = new (require('../src/legislation/legal-authority').LegalAuthorityRegistry)({ clock: () => 0 });
  const base = {
    dashboard: { panels: [{ panel: 'documentationHealth', measured: true, value: 247, detail: '0 unresolved claims' }] },
    evidence: register, controls, authorities, history: { documentationHealth: [0.8, 0.9] }, now: 0,
  };

  assert.equal(inst.explain('documentationHealth', base).complete, true,
    'a chain nothing can satisfy is not a control');
  assert.equal(inst.explain('documentationHealth', { ...base, authorities: null }).brokenAt, 'legal-authority');
  assert.equal(inst.explain('documentationHealth', { ...base, history: null }).brokenAt, 'historical-records');
  assert.equal(inst.explain('documentationHealth', { ...base, history: { documentationHealth: [0.8] } }).brokenAt, 'historical-records',
    'one observation is not a record of the figure having been tested');
});

// ---------------------------------------------------------------------------------------------
// Part 12 — explainable readiness. Six facets, never summed.
// ---------------------------------------------------------------------------------------------

test('phase17: six readiness facets, and the one that matters most says why', () => {
  assert.equal(Object.keys(inst.READINESS_EXPLANATION_FACETS).length, 6);
  for (const required of ['evidenceQuality', 'confidence', 'assumptions', 'dependencies', 'uncertainty', 'historicalEvolution']) {
    const f = inst.READINESS_EXPLANATION_FACETS[required];
    assert.ok(f, required);
    assert.ok(f.asks.endsWith('?') && f.ifAbsent, required);
  }
  assert.match(inst.READINESS_EXPLANATION_FACETS.historicalEvolution.ifAbsent, /never been wrong/);
});

test('phase17: a dimension carries what it is missing, not a score', () => {
  const blind = inst.explainableReadiness({ now: 0 });
  assert.equal(blind.everyConclusionExplainable, false);
  assert.equal(blind.explainabilityRate, 0);
  assert.equal(blind.neverTested.length, blind.count);
  assert.equal(blind.authorizes, false);
  for (const d of blind.dimensions) {
    assert.equal(d.score, undefined, `${d.dimension} carries no facet score`);
    assert.ok(d.missingFacets.length > 0, d.dimension);
    assert.equal(d.facets.length, 6, d.dimension);
    // With no history supplied the historical facet must read as ABSENT.
    assert.ok(d.missingFacets.includes('historicalEvolution'), d.dimension);
    // Dependencies are structural, so they are always answerable.
    assert.ok(!d.missingFacets.includes('dependencies'), d.dimension);
  }
  assert.match(blind.basis, /never been wrong because nothing has ever tested it/);
});

test('phase17: facets appear as they are supplied, so none of them is unreachable', () => {
  const evidenceConfidence = require('../src/assurance/evidence-confidence');
  const register = new evidenceConfidence.EvidenceRegister({ clock: () => 0 });
  for (const dimension of Object.keys(evidenceConfidence.READINESS_DIMENSIONS)) {
    register.record({ id: `readiness:${dimension}`, source: 'executable-check', completeness: 1, verifiedAt: 0, detail: 'supplied' });
  }
  for (const d of inst.explainableReadiness({ evidence: register, now: 0 }).dimensions) {
    assert.ok(!d.missingFacets.includes('evidenceQuality'), d.dimension);
    assert.ok(!d.missingFacets.includes('confidence'), d.dimension);
    assert.ok(!d.missingFacets.includes('uncertainty'), d.dimension);
  }
});

test('phase17: a readiness conclusion that rose obeys the improvement invariant like every other trend', () => {
  const evidenceConfidence = require('../src/assurance/evidence-confidence');
  const dimension = Object.keys(evidenceConfidence.READINESS_DIMENSIONS)[0];

  const rising = inst.explainableReadiness({ history: { [dimension]: [0.4, 0.9] }, now: 0 });
  const row = rising.dimensions.find((d) => d.dimension === dimension);
  assert.equal(row.trend.state, 'unverified-improvement');
  assert.ok(!row.missingFacets.includes('historicalEvolution'), 'two observations are a history');
  assert.equal(rising.everyImprovementVerified, false);
  assert.ok(rising.unverifiedImprovements.includes(dimension));

  const supported = inst.explainableReadiness({
    history: { [dimension]: [0.4, 0.9] },
    improvementEvidence: { [dimension]: [{ kind: 'independent-verification', detail: 'an external assessment', by: 'Auditor General' }] },
    now: 0,
  });
  assert.equal(supported.dimensions.find((d) => d.dimension === dimension).trend.state, 'verified-improvement');
  assert.equal(supported.everyImprovementVerified, true);
});

// ---------------------------------------------------------------------------------------------
// Part 3 — adaptive forecast intelligence. Unknown predictions stay distinct from inaccurate ones.
// ---------------------------------------------------------------------------------------------

const dp = require('../src/architecture/drift-prevention');

function scoredRegister(rows, madeBy = () => 'model-A') {
  const reg = new dp.ForecastRegister({ clock: () => 0 });
  rows.forEach((r, i) => {
    const f = reg.record('auditReadiness', {
      point: r.point, interval: r.interval, constrained: true, horizonDays: 1, madeBy: madeBy(i), at: i * 10 * DAY,
    });
    reg.recordOutcome(f.id, { observed: r.observed, observedBy: 'Operations Review Board', at: i * 10 * DAY + 2 * DAY });
  });
  return reg;
}

test('phase17: an unknown forecast dimension is not an inaccurate one', () => {
  const empty = new dp.ForecastRegister({ clock: () => 0 });
  const report = empty.learningReport({ now: 0 });
  assert.equal(report.measurable, false);
  assert.equal(report.unknown.length, report.count);
  assert.deepEqual(report.unverifiedImprovements, []);
  assert.equal(report.everyImprovementVerified, true);
  assert.equal(report.authorizes, false);
  assert.match(report.note, /unknown prediction is not an inaccurate prediction/);

  const decomposition = empty.errorDecomposition('auditReadiness');
  assert.equal(decomposition.measurable, false);
  assert.equal(decomposition.dominant, 'unknown');
  assert.match(decomposition.reason, /not the same as it being wrong/);
});

test('phase17: accuracy up with the bias unchanged is a model that got luckier, not better', () => {
  // Five forecasts biased +0.2 with a band too narrow to contain it, then five with the SAME bias
  // and a band wide enough that they land inside. Accuracy 0 → 1; the model has not improved.
  const lucky = scoredRegister([
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.65, 0.75], observed: 0.5 })),
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.4, 1.0], observed: 0.5 })),
  ]);
  const learned = lucky.learning('auditReadiness', { now: 200 * DAY });
  assert.equal(learned.measurable, true);
  assert.equal(learned.earlier.accuracy, 0);
  assert.equal(learned.later.accuracy, 1);
  assert.equal(learned.earlier.bias, learned.later.bias, 'the systematic error did not move');
  assert.equal(learned.biasPersists, true);
  assert.match(learned.reason, /LUCKIER, not one that got better/);
  // The rise is real, so it still registers — as unverified, not as nothing.
  assert.equal(learned.accuracyTrend.state, 'unverified-improvement');
  assert.ok(lucky.learningReport({ now: 200 * DAY }).luckyNotBetter.includes('auditReadiness'));
});

test('phase17: a model whose bias genuinely fell is not accused of luck', () => {
  const better = scoredRegister([
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.65, 0.75], observed: 0.5 })),
    ...Array.from({ length: 5 }, () => ({ point: 0.5, interval: [0.45, 0.55], observed: 0.5 })),
  ]);
  assert.equal(better.learning('auditReadiness', { now: 200 * DAY }).biasPersists, false);
  assert.deepEqual(better.learningReport({ now: 200 * DAY }).luckyNotBetter, []);
});

test('phase17: a rebuilt model makes the two halves incomparable', () => {
  const rebuilt = scoredRegister([
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.65, 0.75], observed: 0.5 })),
    ...Array.from({ length: 5 }, () => ({ point: 0.5, interval: [0.45, 0.55], observed: 0.5 })),
  ], (i) => (i < 5 ? 'model-A' : 'model-B'));
  const across = rebuilt.learning('auditReadiness', { now: 200 * DAY });
  assert.equal(across.modelChanged, true);
  assert.equal(across.accuracyTrend.verified, false);
  assert.equal(across.accuracyTrend.measurementChanges.length, 1);
});

test('phase17: error decomposition separates a model that leans from one that wobbles', () => {
  const leaning = scoredRegister(Array.from({ length: 10 }, () => ({ point: 0.7, interval: [0.65, 0.75], observed: 0.5 })))
    .errorDecomposition('auditReadiness');
  assert.equal(leaning.dominant, 'bias');
  assert.equal(leaning.variance, 0);
  assert.match(leaning.repair, /shifting it/);

  const wobbling = scoredRegister(Array.from({ length: 10 }, (_, i) => ({
    point: 0.5, interval: [0.45, 0.55], observed: i % 2 === 0 ? 0.3 : 0.7,
  }))).errorDecomposition('auditReadiness');
  assert.equal(wobbling.dominant, 'variance');
  assert.ok(Math.abs(wobbling.bias) < 0.01, 'a noisy model is right on average');
  assert.match(wobbling.repair, /Shifting it changes nothing/);
});

test('phase17: recalibration is recommended and never applied', () => {
  const lucky = scoredRegister([
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.65, 0.75], observed: 0.5 })),
    ...Array.from({ length: 5 }, () => ({ point: 0.7, interval: [0.4, 1.0], observed: 0.5 })),
  ]);
  const widen = lucky.recalibration('auditReadiness');
  assert.equal(widen.applied, false);
  assert.equal(widen.requiresHumanApproval, true);
  assert.equal(widen.approvedBy, null);
  assert.equal(widen.direction, 'widen');
  assert.match(widen.caution, /makes every past forecast look weaker, which is the point/);
  assert.equal(lucky.learningReport({ now: 200 * DAY }).recalibrationsApplied, 0);

  const narrow = scoredRegister(Array.from({ length: 6 }, () => ({ point: 0.5, interval: [0.0, 1.0], observed: 0.5 })))
    .recalibration('auditReadiness');
  assert.equal(narrow.direction, 'narrow');
  assert.match(narrow.caution, /must not be applied on the strength of a quiet run/);
});

// ---------------------------------------------------------------------------------------------
// Part 4 — digital twin learning. Confidence rises only on verified operational evidence.
// ---------------------------------------------------------------------------------------------

const twin2 = require('../src/twin2/operations-twin');
const SCENARIO = Object.keys(twin2.SCENARIOS)[0];

function validatedTwin(rows) {
  const t = new twin2.OperationsTwin({ clock: () => 0 });
  rows.forEach((r, i) => t.recordValidation(SCENARIO, {
    predicted: true, observed: r.observed, by: 'Operations Review Board', at: i * DAY,
    ...(r.evidence ? { evidence: r.evidence } : {}),
    ...(r.reviewEveryDays ? { reviewEveryDays: r.reviewEveryDays } : {}),
  }));
  return t;
}

test('phase17: a twin nobody has compared against reality is unknown, not a twin that failed to improve', () => {
  const report = new twin2.OperationsTwin({ clock: () => 0 }).learningReport({ now: 0 });
  assert.equal(report.measurable, false);
  assert.equal(report.unknown.length, report.count);
  assert.equal(report.totalObservations, 0, 'the twin ships with no fabricated validation history');
  assert.equal(report.authorizes, false);
  assert.match(report.basis, /UNKNOWN/);
});

test('phase17: an agreement rise with nothing recorded behind it may not raise simulation confidence', () => {
  const opinion = validatedTwin([
    ...Array.from({ length: 3 }, () => ({ observed: false })),
    ...Array.from({ length: 3 }, () => ({ observed: true })),
  ]);
  const learning = opinion.scenarioLearning(SCENARIO, { now: 100 * DAY });
  assert.equal(learning.earlier.agreementRate, 0);
  assert.equal(learning.later.agreementRate, 1);
  assert.equal(learning.agreementTrend.state, 'unverified-improvement');
  assert.notEqual(learning.confidenceAdjustment.direction, 'may-increase');
  assert.equal(learning.verifiedObservations, 0);
  assert.match(learning.confidenceAdjustment.because, /opinion about the simulation is not a test of it/);
});

test('phase17: the same rise backed by recorded operational outcomes may raise confidence', () => {
  const evidenced = validatedTwin([
    ...Array.from({ length: 3 }, () => ({ observed: false, evidence: ['INC-2026-001'], reviewEveryDays: 365 })),
    ...Array.from({ length: 3 }, () => ({ observed: true, evidence: ['INC-2026-002'], reviewEveryDays: 365 })),
  ]);
  const learning = evidenced.scenarioLearning(SCENARIO, { now: 100 * DAY });
  assert.equal(learning.agreementTrend.state, 'verified-improvement');
  assert.equal(learning.confidenceAdjustment.direction, 'may-increase', 'a rule nothing can satisfy is not a rule');
  assert.equal(learning.verifiedObservations, 6);
  // …and it is still only a recommendation.
  assert.equal(learning.confidenceAdjustment.applied, false);
  assert.equal(learning.confidenceAdjustment.approvedBy, null);
  assert.equal(evidenced.learningReport({ now: 100 * DAY }).adjustmentsApplied, 0);
});

test('phase17: review schedules are tracked, and an unscheduled review is counted rather than assumed current', () => {
  const unscheduled = validatedTwin(Array.from({ length: 6 }, () => ({ observed: true, evidence: ['INC-1'] })));
  assert.equal(unscheduled.scenarioLearning(SCENARIO, { now: 100 * DAY }).unscheduledReviews, 6);

  const stale = validatedTwin(Array.from({ length: 6 }, () => ({ observed: true, evidence: ['INC-1'], reviewEveryDays: 30 })));
  assert.equal(stale.scenarioLearning(SCENARIO, { now: 400 * DAY }).overdueReviews.length, 6);
  assert.equal(stale.scenarioLearning(SCENARIO, { now: 10 * DAY }).overdueReviews.length, 0);
});

test('phase17: every validation is stamped with the model that produced it', () => {
  const t = validatedTwin(Array.from({ length: 3 }, () => ({ observed: true, evidence: ['INC-1'] })));
  const history = t.validationHistory(SCENARIO);
  assert.ok(history.every((h) => h.modelDigest), 'a comparison against a different model is evidence about a different twin');
  assert.equal([...new Set(history.map((h) => h.modelDigest))].length, 1);
  // Two twins over different evidence are different models, so a rebuild is detectable at all.
  assert.notEqual(new twin2.OperationsTwin({ evidenceIds: ['EV-EXTRA'], clock: () => 0 }).digest(), t.digest());
});

test('phase17: the Phase 16 validation API still works unchanged', () => {
  // Backward compatibility: no evidence, no review schedule, and a quantitative magnitude.
  const t = new twin2.OperationsTwin({ clock: () => 0 });
  const rec = t.recordValidation(SCENARIO, {
    predicted: true, observed: true, by: 'ORB', at: 0, predictedValue: 10, observedValue: 12,
  });
  assert.equal(rec.calibrationError, 2);
  assert.equal(rec.verified, false, 'a validation with no evidence is recorded, and recorded as unverified');
  assert.equal(rec.reviewDueAt, null);
  assert.throws(
    () => t.recordValidation(SCENARIO, { predicted: true, observed: true, by: 'ORB', at: 0, predictedValue: 5 }),
    (e) => e.failClosed === true,
  );
});

// ---------------------------------------------------------------------------------------------
// Part 6 — control performance intelligence. Recall over the watched few is not the estate.
// ---------------------------------------------------------------------------------------------

const ce = require('../src/assurance/control-effectiveness');
const MINUTE = 60_000;

test('phase17: detection coverage is computed over the controls that ran, not the watched subset', () => {
  const reg = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 12; i += 1) {
    reg.record('C', {
      outcome: i % 4 === 0 ? 'false-negative' : 'true-positive',
      occurredAt: i * 10 * DAY,
      detectedAt: i % 4 === 0 ? null : i * 10 * DAY + MINUTE,
      observedBy: 'ORB',
    });
  }
  const report = ce.longTermPerformance({ register: reg, controls: ['C', 'D', 'E', 'F'], periods: [0, 40 * DAY, 80 * DAY, 120 * DAY], now: 0 });
  assert.equal(report.detectionCoverage, 0.25);
  assert.equal(report.observedCount, 1);
  assert.equal(report.count, 4);
  assert.match(report.coverageBasis, /not over the estate/);

  const recall = report.controls[0].performance.measures.find((m) => m.measure === 'recall').value;
  assert.ok(report.detectionCoverage < recall, 'coverage qualifies recall rather than repeating it');
  assert.equal(report.authorizes, false);
});

test('phase17: operational stability needs two measured periods, and a swinging control is named', () => {
  const swing = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 4; i += 1) swing.record('S', { outcome: 'true-positive', occurredAt: i * DAY, detectedAt: i * DAY + MINUTE, observedBy: 'ORB' });
  for (let i = 0; i < 4; i += 1) swing.record('S', { outcome: 'false-negative', occurredAt: 100 * DAY + i * DAY, observedBy: 'ORB' });
  assert.ok(ce.longTermPerformance({ register: swing, controls: ['S'], periods: [0, 50 * DAY, 150 * DAY], now: 0 }).volatile.includes('S'));

  const noPeriods = ce.longTermPerformance({ register: swing, controls: ['S'], periods: [], now: 0 });
  assert.equal(noPeriods.controls[0].operationalStability, null, 'no periods produces null, never perfect');
  assert.equal(noPeriods.controls[0].stabilityMeasurable, false);

  // A steady control is not volatile, or the finding fires on everything.
  const steady = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 8; i += 1) steady.record('T', { outcome: 'true-positive', occurredAt: i * 20 * DAY, detectedAt: i * 20 * DAY + MINUTE, observedBy: 'ORB' });
  assert.deepEqual(ce.longTermPerformance({ register: steady, controls: ['T'], periods: [0, 80 * DAY, 160 * DAY], now: 0 }).volatile, []);
});

test('phase17: a rising estate detection rate is unverified until something is recorded behind it', () => {
  const rising = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 4; i += 1) rising.record('R', { outcome: 'false-negative', occurredAt: i * DAY, observedBy: 'ORB' });
  for (let i = 0; i < 4; i += 1) rising.record('R', { outcome: 'true-positive', occurredAt: 100 * DAY + i * DAY, detectedAt: 100 * DAY + i * DAY + MINUTE, observedBy: 'ORB' });

  const periods = [0, 50 * DAY, 150 * DAY];
  assert.equal(ce.longTermPerformance({ register: rising, controls: ['R'], periods, now: 0 }).detectionTrend.state, 'unverified-improvement');
  assert.equal(ce.longTermPerformance({
    register: rising, controls: ['R'], periods,
    improvementEvidence: [{ kind: 'recorded-act', detail: 'the detector was rebuilt and reviewed', by: 'ORB' }], now: 0,
  }).detectionTrend.state, 'verified-improvement');
});

test('phase17: an estate nobody has watched says its figures would be computed over nothing', () => {
  const blank = ce.longTermPerformance({ register: new ce.ControlObservationRegister({ clock: () => 0 }), controls: ['A', 'B'], now: 0 });
  assert.equal(blank.measurable, false);
  assert.equal(blank.detectionCoverage, 0);
  assert.match(blank.basis, /computed over nothing/);
});

// ---------------------------------------------------------------------------------------------
// Part 7 — validation intelligence. A finding raised twice is the institution not learning.
// ---------------------------------------------------------------------------------------------

const own = require('../src/governance/ownership');

function holdWorkshop(reg, subject, finding) {
  const w = reg.convene({ subject, objectives: ['o'], participants: ['A', 'B'], facilitator: 'Operations Review Board', at: 0 });
  reg.record(w.id, { outcome: 'finding', detail: finding });
  reg.record(w.id, { outcome: 'decision', detail: `raise ${subject}`, by: 'ORB' });
  reg.record(w.id, { outcome: 'corrective-action', detail: `fix ${subject}`, owner: 'Oversight Board Secretariat', dueAt: 100 });
  reg.close(w.id, { by: 'Operations Review Board', at: 10 });
  return w;
}

test('phase17: the same finding raised in two workshops is detected through normalised text', () => {
  const reg = new inst.ValidationWorkshop({ clock: () => 0 });
  holdWorkshop(reg, 'first review', 'the ISRB cluster shares no forum with the rest of government');
  holdWorkshop(reg, 'second review', '  The ISRB cluster   shares no forum with the rest of government ');
  holdWorkshop(reg, 'third review', 'something nobody had said before');

  const report = reg.learningEffectiveness({ now: 100 });
  assert.equal(report.recurringFindings.length, 1, 'a finding raised once is not recurring');
  assert.equal(report.recurringFindings[0].times, 2);
  assert.equal(report.recurringFindings[0].workshops.length, 2);
  assert.match(report.note, /not learning/);
  assert.equal(report.scored, false, 'six measures with different units are never summed');
});

test('phase17: completion counts confirmed actions, not closed workshops', () => {
  const reg = new inst.ValidationWorkshop({ clock: () => 0 });
  const first = holdWorkshop(reg, 'review', 'a finding');
  assert.equal(reg.learningEffectiveness({ now: 100 }).measures.find((m) => m.measure === 'correctiveActionCompletion').value, 0,
    'closing a workshop does not complete an action');
  reg.followUp(first.id, { reviewedBy: 'Auditor General', resolvedIndexes: [2], at: 20 });
  assert.ok(reg.learningEffectiveness({ now: 100 }).measures.find((m) => m.measure === 'correctiveActionCompletion').value > 0);
});

test('phase17: learning effectiveness counts only activity that came after the workshop claiming it', () => {
  const reg = new inst.ValidationWorkshop({ clock: () => 0 });
  holdWorkshop(reg, 'review', 'a finding');
  const training = new own.TrainingRegister({ clock: () => 0 });
  const person = own.OWNERSHIP[own.subsystems()[0]].operationalOwner;
  const courses = Object.values(own.REQUIRED_TRAINING)[0];

  training.recordCompletion({ person, course: courses[0], at: 5, by: 'Registrar' });
  const before = reg.learningEffectiveness({ training, now: 100 });
  assert.equal(before.measures.find((m) => m.measure === 'trainingOutcomes').value, 0,
    'a completion that predates the workshop was not caused by it');
  assert.ok(before.unmeasured.includes('operationalImprovements'));
  assert.equal(before.measures.find((m) => m.measure === 'operationalImprovements').value, null,
    'an unsupplied register leaves its measure unknown, not zero');

  training.recordCompletion({ person, course: courses[1] || Object.values(own.REQUIRED_TRAINING)[1][0], at: 50, by: 'Registrar' });
  assert.equal(reg.learningEffectiveness({ training, now: 100 }).measures.find((m) => m.measure === 'trainingOutcomes').value, 1);
});

test('phase17: with no workshop held, nothing can have been learned from one', () => {
  const report = new inst.ValidationWorkshop({ clock: () => 0 }).learningEffectiveness({ now: 0 });
  assert.equal(report.measurable, false);
  assert.match(report.basis, /nothing can have been learned/);
  assert.equal(report.authorizes, false);
});

// ---------------------------------------------------------------------------------------------
// Part 9 — legal hierarchy intelligence. An instrument cannot go beyond what it was made under.
// ---------------------------------------------------------------------------------------------

const la = require('../src/legislation/legal-authority');

function hierarchyOf(rows) {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  for (const [id, tier, derivesFrom, permits = [], prohibits = []] of rows) {
    reg.recordInstrument(id, { tier, derivesFrom, issuedBy: 'Government of Botswana', permits, prohibits, recordedBy: 'Registrar', at: 0 });
  }
  return { reg, report: la.legalHierarchy(reg, { now: 0 }) };
}

test('phase17: the hierarchy is six tiers, strictly ordered, each stating what it may not do', () => {
  assert.deepEqual(la.LEGAL_TIER_ORDER, ['constitution', 'act', 'regulation', 'directive', 'policy', 'procedure']);
  la.LEGAL_TIER_ORDER.forEach((tier, i) => {
    assert.equal(la.LEGAL_TIERS[tier].rank, i, tier);
    assert.ok(la.LEGAL_TIERS[tier].mayNot, tier);
    assert.ok(la.LEGAL_TIERS[tier].amendedBy, tier);
  });
  assert.match(la.LEGAL_TIERS.regulation.mayNot, /ultra vires/);
});

test('phase17: an empty hierarchy is not a consistent one', () => {
  const empty = la.legalHierarchy(new la.LegalAuthorityRegistry({ clock: () => 0 }), { now: 0 });
  assert.equal(empty.measurable, false);
  assert.equal(empty.consistent, false, 'zero conflicts across zero instruments is not a clean bill of health');
  assert.equal(empty.conflictCount, 0);
  assert.equal(empty.rootedRate, null);
  assert.match(empty.basis, /unopened book/);
  assert.equal(empty.authorizes, false);
});

test('phase17: an instrument below the Constitution must name what it was made under', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  assert.throws(
    () => reg.recordInstrument('Loose Policy', { tier: 'policy', issuedBy: 'Ministry', recordedBy: 'Registrar', at: 0 }),
    (e) => e.failClosed === true && /must name the instrument it is made under/.test(e.message),
  );
  assert.throws(
    () => reg.recordInstrument('Super Constitution', { tier: 'constitution', derivesFrom: 'Something', issuedBy: 'X', recordedBy: 'R', at: 0 }),
    /derives from nothing/,
  );
});

test('phase17: a regulation permitting what its Act does not is detected as exceeding its parent', () => {
  const { report } = hierarchyOf([
    ['Constitution of Botswana', 'constitution', null, ['publish-judgments']],
    ['Courts Act', 'act', 'Constitution of Botswana', ['publish-judgments']],
    ['Publication Regulations', 'regulation', 'Courts Act', ['publish-judgments', 'publish-litigant-addresses']],
  ]);
  const exceeds = report.conflicts.find((c) => c.conflict === 'exceeds-parent');
  assert.ok(exceeds);
  assert.equal(exceeds.instrument, 'Publication Regulations');
  assert.equal(exceeds.subject, 'publish-litigant-addresses');
  assert.equal(report.consistent, false);
  // The permission the Act DID grant is not flagged, or the finding fires on everything.
  assert.equal(report.conflicts.filter((c) => c.subject === 'publish-judgments').length, 0);
});

test('phase17: a directive permitting what the Constitution prohibits is void to that extent', () => {
  const { report } = hierarchyOf([
    ['Constitution of Botswana', 'constitution', null, ['publish-judgments'], ['disclose-sealed-records']],
    ['Courts Act', 'act', 'Constitution of Botswana', ['publish-judgments']],
    ['Publication Regulations', 'regulation', 'Courts Act', ['publish-judgments']],
    ['Records Directive', 'directive', 'Publication Regulations', ['disclose-sealed-records']],
  ]);
  const c = report.conflicts.find((x) => x.conflict === 'contradicts-ancestor');
  assert.ok(c);
  assert.equal(c.instrument, 'Records Directive');
  assert.equal(c.resolvedBy, 'Constitution of Botswana', 'the higher instrument settles it');
  assert.match(c.detail, /void to that extent/);
});

test('phase17: precedence cannot settle a conflict between equals, and the report says so', () => {
  const { report } = hierarchyOf([
    ['Constitution of Botswana', 'constitution', null, ['bulk-export']],
    ['Courts Act', 'act', 'Constitution of Botswana', ['bulk-export']],
    ['Access Directive A', 'directive', 'Courts Act', ['bulk-export']],
    ['Access Directive B', 'directive', 'Courts Act', [], ['bulk-export']],
  ]);
  const sibling = report.conflicts.find((c) => c.conflict === 'sibling-contradiction');
  assert.ok(sibling);
  assert.equal(sibling.subject, 'bulk-export');
  assert.match(sibling.detail, /neither outranks the other/);
  assert.equal(sibling.sharedAncestor, 'Courts Act');
  assert.match(la.HIERARCHY_CONFLICTS['sibling-contradiction'].ifIgnored, /human decision, not a rule/);
});

test('phase17: a parent must OUTRANK its child — equal rank is as wrong as inverted', () => {
  const { report: inverted } = hierarchyOf([
    ['Departmental Policy', 'policy', 'Some Act'],
    ['Some Act', 'act', 'Departmental Policy'],
  ]);
  assert.ok(inverted.conflicts.some((c) => c.conflict === 'inverted-derivation'));

  const { report: flat } = hierarchyOf([
    ['Retention Policy', 'policy', 'Access Policy'],
    ['Access Policy', 'policy', 'Publication Directive'],
    ['Publication Directive', 'directive', 'Courts Act'],
  ]);
  assert.ok(flat.conflicts.some((c) => c.conflict === 'inverted-derivation' && c.instrument === 'Retention Policy'),
    'a policy made under another policy can never reach the Constitution');

  const { report: stepped } = hierarchyOf([
    ['Constitution', 'constitution', null],
    ['An Act', 'act', 'Constitution'],
    ['A Policy', 'policy', 'An Act'],
  ]);
  assert.equal(stepped.conflicts.filter((c) => c.conflict === 'inverted-derivation').length, 0);
});

test('phase17: a capability citing an instrument absent from the hierarchy is reported, not assumed sound', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  reg.declare('case-filing', {
    kind: 'legislation', instrument: 'Uncited Act', approvingOrganization: 'Attorney General Chambers',
    reviewEveryDays: 365, expiresAt: 10 ** 12, evidence: ['APP-FIT-LEGAL-HIERARCHY'], scope: 'filing',
    declaredBy: 'Registrar', at: 0,
  });
  reg.recordInstrument('Constitution of Botswana', { tier: 'constitution', issuedBy: 'Republic', recordedBy: 'Registrar', at: 0 });
  const report = la.legalHierarchy(reg, { now: 0 });
  assert.deepEqual(report.uncitedInstruments, ['Uncited Act']);
  assert.deepEqual(report.conflicts.find((c) => c.conflict === 'uncited-basis').capabilities, ['case-filing']);
});

// ---------------------------------------------------------------------------------------------
// Part 8 — enterprise workflow intelligence. Structure is knowable where behaviour is not.
// ---------------------------------------------------------------------------------------------

const ca = require('../src/governance/cross-agency');

test('phase17: an unexamined hand-off is excluded from coordination quality, not counted as failed', () => {
  const report = ca.workflowIntelligence({ now: 0 });
  // Nothing on this estate has been examined, so the answer must be UNKNOWN. A zero would read as
  // "cross-government coordination does not work", which nobody has established.
  assert.equal(report.coordinationQuality, null);
  assert.equal(report.measurable.coordinationQuality, false);
  assert.match(report.coordinationBasis, /not zero/);
  for (const c of report.coordination) {
    if (c.examinedHandoffs === 0) {
      assert.equal(c.quality, null, c.capability);
      assert.equal(c.measurable, false, c.capability);
    }
    assert.ok(c.blockedHandoffs <= c.examinedHandoffs, c.capability);
  }
  assert.equal(report.authorizes, false);
});

test('phase17: failure propagation is structural, so it is known even though behaviour is not', () => {
  const report = ca.workflowIntelligence({ now: 0 });
  assert.equal(report.measurable.failurePropagation, true);
  assert.equal(report.measurable.workflowCompletion, false, 'no workflow has been observed running');
  assert.ok(report.stepCount > 0);
  assert.equal(report.maxBlastRadius, report.steps[0].blastRadius, 'steps are ordered widest-first');
  for (const s of report.steps) {
    const expected = s.blastRadius >= 4 ? 'systemic' : s.blastRadius >= 2 ? 'shared' : 'isolated';
    assert.equal(s.propagation, expected, s.context);
    if (s.compounding) {
      assert.notEqual(s.propagation, 'isolated');
      assert.ok(s.unvalidatedDownstream.length > 0);
    }
  }
});

test('phase17: a shared step on unvalidated workflows compounds, and appears in the findings', () => {
  const report = ca.workflowIntelligence({ now: 0 });
  assert.ok(report.compoundingSteps.length > 0);
  for (const s of report.compoundingSteps) {
    assert.ok(report.findings.some((f) => f.includes(s.context)), s.context);
  }
});

test('phase17: the intelligence report carries the validation it extends rather than recomputing it', () => {
  assert.deepEqual(
    ca.workflowIntelligence({ now: 0 }).validation.workflows.map((w) => w.capability),
    ca.workflowValidation({ now: 0 }).workflows.map((w) => w.capability),
  );
});

test('phase17: a rising workflow validation rate needs verified evidence like every other trend', () => {
  assert.equal(ca.workflowIntelligence({ now: 0 }).validationTrend.state, 'unknown');
  assert.equal(ca.workflowIntelligence({ history: [0.2, 0.8], now: 0 }).validationTrend.state, 'unverified-improvement');
  assert.equal(ca.workflowIntelligence({
    history: [0.2, 0.8],
    improvementEvidence: [{ kind: 'observed-outcome', detail: 'the workflows were run and recorded', by: 'ORB' }],
    now: 0,
  }).validationTrend.state, 'verified-improvement');
});

// ---------------------------------------------------------------------------------------------
// Part 10 — capability evolution. Movement is not progress; churn is the figure that catches it.
// ---------------------------------------------------------------------------------------------

const snap = (level) => ({ organizationalLevel: level, assessedCount: 7, domains: [] });

test('phase17: capability evolution needs two assessed snapshots, and unknown is not level zero', () => {
  const one = own.capabilityEvolution({ snapshots: [snap('L1')] });
  assert.equal(one.measurable, false);
  assert.equal(one.improvementVelocity, null);
  assert.equal(one.organizationalStability, null);
  assert.equal(one.progression, null);
  assert.equal(one.authorizes, false);

  const unassessed = own.capabilityEvolution({
    snapshots: [snap('L2'), { organizationalLevel: 'unknown', assessedCount: 0, domains: [] }],
  });
  assert.equal(unassessed.measurable, false, 'an unknown level is not a data point at rank zero');
});

test('phase17: an institution moving eight steps to end where it started is churning, not progressing', () => {
  const churning = own.capabilityEvolution({ snapshots: [snap('L1'), snap('L3'), snap('L1'), snap('L3'), snap('L1')] });
  assert.equal(churning.netMovement, 0);
  assert.equal(churning.totalMovement, 8);
  assert.equal(churning.churn, true);
  assert.equal(churning.improvementVelocity, 0);
  assert.ok(churning.organizationalStability > 1);
  assert.match(churning.reason, /churning rather than progressing/);
});

test('phase17: neither a flat institution nor a monotonic climb is churn', () => {
  const flat = own.capabilityEvolution({ snapshots: [snap('L2'), snap('L2'), snap('L2')] });
  assert.equal(flat.churn, false);
  assert.equal(flat.totalMovement, 0);
  assert.equal(flat.trend.state, 'steady');
  assert.equal(own.capabilityEvolution({ snapshots: [snap('L0'), snap('L2'), snap('L4')] }).churn, false,
    'velocity alone must not trigger the finding');
});

test('phase17: a maturity rise obeys the improvement invariant like every other trend', () => {
  const rising = own.capabilityEvolution({ snapshots: [snap('L0'), snap('L1'), snap('L2')] });
  assert.equal(rising.progression, 2);
  assert.equal(rising.regression, 0);
  assert.equal(rising.trend.state, 'unverified-improvement');
  assert.equal(rising.everyImprovementVerified, false);

  const supported = own.capabilityEvolution({
    snapshots: [snap('L0'), snap('L2')],
    evidence: [{ kind: 'independent-verification', detail: 'an external assessment confirmed the level', by: 'Auditor General' }],
  });
  assert.equal(supported.trend.state, 'verified-improvement');
});

test('phase17: velocity states its unit rather than implying a timescale nobody supplied', () => {
  const perSnapshot = own.capabilityEvolution({ snapshots: [snap('L0'), snap('L2')] });
  assert.match(perSnapshot.velocityUnit, /per snapshot/);
  const timed = own.capabilityEvolution({ snapshots: [snap('L0'), snap('L2')], periodDays: 90 });
  assert.match(timed.velocityUnit, /per day/);
  assert.notEqual(timed.improvementVelocity, perSnapshot.improvementVelocity);
});

// ---------------------------------------------------------------------------------------------
// Part 11 — architecture intelligence. A forecast is not a finding.
// ---------------------------------------------------------------------------------------------

test('phase17: every architectural risk states what would falsify it', () => {
  assert.equal(Object.keys(dp.ARCHITECTURE_RISKS).length, 5);
  for (const [id, r] of Object.entries(dp.ARCHITECTURE_RISKS)) {
    assert.ok(r.asks.endsWith('?'), id);
    assert.ok(r.derivedFrom, id);
    assert.ok(r.falsifiedBy, `${id} — a forecast nothing could falsify is a hunch`);
    assert.ok(r.ifRealised, id);
  }
});

test('phase17: unknown proximity is off the scale, not at the far end of it', () => {
  assert.equal(dp.RISK_PROXIMITY.unknown.rank, null);
  assert.match(dp.RISK_PROXIMITY.unknown.means, /not the same as far away/);
  for (const id of ['distant', 'approaching', 'imminent']) {
    assert.equal(typeof dp.RISK_PROXIMITY[id].rank, 'number', id);
  }
});

test('phase17: an unmeasurable pressure is unknown rather than distant, and no risk is a finding', () => {
  const blind = dp.architectureIntelligence({ controls: [], assumptions: null, documentation: null, adrReview: null, now: 0 });
  const drift = blind.risks.find((r) => r.risk === 'documentation-drift');
  assert.equal(drift.proximity, 'unknown');
  assert.equal(drift.value, null);
  assert.ok(blind.unknown.includes('documentation-drift'));
  for (const r of blind.risks) assert.equal(r.isFinding, false, r.risk);
  assert.equal(blind.findings, 0);
  assert.equal(blind.scored, false, 'five pressures with different units are never summed');
  assert.equal(blind.authorizes, false);
});

test('phase17: the coupling forecast and the drift ratchet read the same baseline', () => {
  assert.equal(dp.COUPLING_BASELINE, 125);
  const coupling = dp.architectureIntelligence({ now: 0 }).risks.find((r) => r.risk === 'dependency-conflict');
  // Measured from the source tree, so it is available even with nothing else supplied.
  assert.notEqual(coupling.proximity, 'unknown');
  assert.equal(coupling.value, dp.COUPLING_BASELINE, 'coupling sits exactly at its baseline: the next added edge fails the build');
  assert.equal(coupling.proximity, 'imminent');
  assert.equal(coupling.headroom, 0);
});

// ---------------------------------------------------------------------------------------------
// Part 13 — executive performance intelligence. Two more evidence-derived indicators.
// ---------------------------------------------------------------------------------------------

test('phase17: the executive dashboard carries eight indicators and none accepts a figure', () => {
  assert.equal(Object.keys(inst.PERFORMANCE_INDICATORS).length, 8);
  for (const required of ['evidenceQuality', 'collaborationMaturity']) {
    assert.ok(inst.PERFORMANCE_INDICATORS[required], required);
    assert.ok(inst.PERFORMANCE_INDICATORS[required].derivedFrom, required);
  }
  const injected = inst.institutionalPerformance({ evidenceQuality: 1, collaborationMaturity: 1 });
  assert.deepEqual(injected.measured, [], 'a supplied figure produces unmeasured, never the figure');
  assert.equal(injected.everyIndicatorDerived, true);
});

test('phase17: an ungraded corpus and an unexamined hand-off are unknown, not poor', () => {
  const eq = inst.institutionalPerformance({ evidenceQuality: { count: 0, quality: null, sound: false, threshold: 0.7, belowThreshold: [] } })
    .indicators.find((i) => i.indicator === 'evidenceQuality');
  assert.equal(eq.measured, false);
  assert.equal(eq.performing, null, 'unknown quality is not poor quality');

  const cm = inst.institutionalPerformance({ workflowIntelligence: { coordinationQuality: null, compoundingSteps: [], coordinationBasis: 'b' } })
    .indicators.find((i) => i.indicator === 'collaborationMaturity');
  assert.equal(cm.measured, false);
  assert.equal(cm.performing, null, 'unknown collaboration is not failing collaboration');
});

test('phase17: evidence quality reports the weakest item, because a corpus is as good as its worst', () => {
  const eq = inst.institutionalPerformance({ evidenceQuality: { count: 3, quality: 0.2, sound: false, threshold: 0.7, belowThreshold: [{ evidence: 'x' }] } })
    .indicators.find((i) => i.indicator === 'evidenceQuality');
  assert.equal(eq.value, 0.2);
  assert.equal(eq.performing, false);
  assert.match(eq.detail, /weakest of 3 graded item\(s\)/);
});

// ---------------------------------------------------------------------------------------------
// Part 14 — accreditation readiness. Planning artefacts that cannot become permission.
// ---------------------------------------------------------------------------------------------

const rm = require('../src/migration/roadmap');

const fullPack = () => rm.accreditationReadiness({
  fitnessResults: [{ id: 'X', pass: true }],
  documentation: { sound: true, verification: { unresolvedCount: 0, claims: 1 } },
  rehearsals: { coverage: () => ({ neverRehearsed: [] }) },
  ownershipContinuity: { continuous: true, rolesWithoutValidatedAlternate: [] },
  now: 0,
});

test('phase17: seven planning artefacts, each naming the human who alone can sign it', () => {
  assert.equal(Object.keys(rm.ACCREDITATION_ARTEFACTS).length, 7);
  for (const [id, a] of Object.entries(rm.ACCREDITATION_ARTEFACTS)) {
    assert.ok(a.produces && a.signedByRole && a.humanOnly, id);
    assert.ok(a.requires.length > 0, id);
  }
});

test('phase17: a more complete accreditation pack permits exactly what an empty one permits', () => {
  const bare = rm.accreditationReadiness({ now: 0 });
  const full = fullPack();
  assert.ok(full.completeness > bare.completeness, 'supplying evidence genuinely raised completeness');
  for (const field of ['deploymentPermitted', 'authorizes', 'executes', 'planOnly', 'signedBy', 'authorizationStatus']) {
    assert.deepEqual(full[field], bare[field], `${field} did not move with completeness`);
  }
  assert.equal(full.deploymentPermitted, false);
  assert.equal(full.authorizationStatus, 'NOT AUTHORIZED');
  assert.equal(full.signedBy, null);
});

test('phase17: every artefact is unsigned, and the preparer is never the role that signs it', () => {
  const full = fullPack();
  assert.equal(full.unsigned.length, full.count);
  for (const a of full.artefacts) {
    assert.equal(a.signedBy, null, a.artefact);
    assert.equal(a.permitsDeployment, false, a.artefact);
    assert.equal(a.isPlanOnly, true, a.artefact);
    assert.notEqual(a.preparedBy, a.signedByRole, a.artefact);
  }
});

test('phase17: a requirement nothing could answer is unknown and excluded, never counted as unmet', () => {
  assert.equal(rm.REQUIREMENT_STATES.unknown.examined, false);
  assert.match(rm.REQUIREMENT_STATES.unknown.means, /Not examined is not unmet/);

  const acceptance = rm.accreditationReadiness({ now: 0 }).artefacts.find((a) => a.artefact === 'operationalAcceptance');
  assert.ok(acceptance.unknownRequirements.length > 0);
  assert.equal(acceptance.completeness, null, 'nothing examinable produces null, not zero');
  assert.match(acceptance.completenessBasis, /unknown rather than zero/);

  for (const a of fullPack().artefacts) {
    if (a.completeness === null) continue;
    const examined = a.requirementCount - a.unknownRequirements.length;
    assert.ok(examined > 0, a.artefact);
    assert.ok(a.satisfiedCount <= examined, a.artefact);
  }
});

test('phase17: accreditation completeness is the weakest artefact, because a pack is submitted whole', () => {
  const full = fullPack();
  const examinable = full.artefacts.filter((a) => a.completeness !== null);
  assert.equal(full.completeness, Math.min(...examinable.map((a) => a.completeness)));
  assert.ok(full.artefacts.some((a) => a.artefact === full.weakestArtefact));
});

test('phase17: security certification is genuinely unmet — no residual risk has ever been accepted', () => {
  const cert = rm.accreditationReadiness({ now: 0 }).artefacts.find((a) => a.artefact === 'securityCertification');
  assert.ok(cert.unmetRequirements.includes('residual risks with named acceptors'));
});

// ---------------------------------------------------------------------------------------------
// Phase 18.1 Parts 2 & 6 — merge governance and merge verification.
//
// These exist because of something that happened rather than a general principle: three
// specifications were merged into one decision-package guard and the merge was recorded in a commit
// message, which is not architectural governance. An ungoverned merge is invisible — from the code
// alone there is no way to tell a requirement that was absorbed from one that was dropped.
// ---------------------------------------------------------------------------------------------

const adrGov = require('../src/architecture/adr-governance');

const MERGE_BASE = {
  mergedRequirements: ['Spec A Part 1', 'Spec B Part 2'],
  into: 'src/somewhere.js',
  rationale: 'because they describe one artefact',
  architecturalJustification: 'one guard, not two',
  compatibilityImpact: 'additive for readers',
  implementationStrategy: 'union of the field lists',
  recordedBy: 'Architecture Review Board',
  // Phase 18.1 Part 2 added seven further fields, each refused when absent.
  specificationReferences: ['Spec A §1', 'Spec B §2'],
  mergedCapability: 'Decision Intelligence',
  affectedModules: ['src/somewhere.js'],
  callerImpact: 'breaking for assemblers, additive for readers',
  requirementFieldMapping: { 'Spec A Part 1': ['fieldA'], 'Spec B Part 2': ['fieldB'] },
  verificationStrategy: 'structural, by mergeVerification()',
  unresolvedSemanticQuestions: ['whether fieldA means what Spec A intended'],
  approvedBy: 'Oversight Board',
};

test('phase18.1: recording a merge and approving one are different acts, and nobody approves itself', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  // This platform performs the first act and never the second.
  assert.throws(() => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', approvedBy: undefined }), (e) => e.failClosed === true);
  // NO SUBSYSTEM MAY APPROVE ITSELF — the platform's oldest rule, applied to merges.
  assert.throws(
    () => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', approvedBy: 'Architecture Review Board' }),
    (e) => e.failClosed === true && /self-approval/.test(e.message),
  );
  assert.equal(reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012' }).selfApproved, false);
});

test('phase18.1: a requirement absorbed but mapped to nothing was dropped, not merged', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  assert.throws(
    () => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', requirementFieldMapping: { 'Spec A Part 1': ['fieldA'] } }),
    (e) => e.failClosed === true,
  );
  assert.throws(
    () => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', requirementFieldMapping: { 'Spec A Part 1': ['fieldA'], 'Spec B Part 2': [] } }),
    (e) => e.failClosed === true,
  );
});

test('phase18.1: each Part 2 field is refused when absent', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  for (const field of ['mergedCapability', 'callerImpact', 'requirementFieldMapping', 'verificationStrategy']) {
    assert.throws(() => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', [field]: undefined }), (e) => e.failClosed === true, field);
  }
  assert.throws(() => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', affectedModules: [] }), (e) => e.failClosed === true);
});

test('phase18.1: the platform merge records its capability, modules, approval and open questions', () => {
  const m = adrGov.seedPlatformMerges(new adrGov.MergeRegister({ clock: () => 0 })).merge('MERGE-0001');
  assert.equal(m.mergedCapability, 'Decision Intelligence');
  assert.ok(m.affectedModules.length >= 2, 'a merge that changed three files and records one is unreviewable');
  assert.equal(m.selfApproved, false);
  assert.ok(m.unresolvedSemanticQuestions.length > 0,
    'a merge that claims to have settled everything is a merge nobody checked');
  for (const requirement of m.mergedRequirements) {
    assert.ok(Array.isArray(m.requirementFieldMapping[requirement]) && m.requirementFieldMapping[requirement].length, requirement);
  }
});

test('phase18.1: the merge schema applies from ADR-0012, where the first merge was recorded', () => {
  assert.equal(adrGov.MERGE_SCHEMA_FROM, 12);
  assert.deepEqual(
    adrGov.MERGE_SCHEMA.map((s) => s.field),
    ['mergedRequirements', 'mergeRationale', 'compatibilityImpact', 'implementationStrategy',
      'verificationStrategy', 'unresolvedSemanticQuestions'],
  );
  for (const s of adrGov.MERGE_SCHEMA) assert.ok(s.heading && s.why, s.field);
  // The ADR that establishes the tier satisfies it. A rule its own ADR does not meet is the
  // weakest possible version of that rule.
  assert.equal(adrGov.schemaNameFor(12), 'merge');
  assert.equal(adrGov.schemaNameFor(11), 'governance', 'earlier ADRs are never retrofitted');
});

test('phase18.1: a merge citing no ADR, or an ADR nobody wrote, is refused', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  assert.throws(() => reg.record('M', { ...MERGE_BASE }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0099' }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('M', { ...MERGE_BASE, adr: 'not-an-adr' }), (e) => e.failClosed === true);
  // …and a complete record is accepted, or nothing could ever be registered.
  assert.ok(reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012' }));
});

test('phase18.1: one requirement implemented once is not a merge', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  assert.throws(
    () => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', mergedRequirements: ['only one'] }),
    (e) => e.failClosed === true,
  );
});

test('phase18.1: a merge must state its rationale, compatibility impact and strategy', () => {
  const reg = new adrGov.MergeRegister({ clock: () => 0 });
  for (const field of ['rationale', 'architecturalJustification', 'compatibilityImpact', 'implementationStrategy', 'recordedBy', 'into']) {
    assert.throws(
      () => reg.record('M', { ...MERGE_BASE, adr: 'ADR-0012', [field]: undefined }),
      (e) => e.failClosed === true,
      field,
    );
  }
});

test('phase18.1: an empty merge register says what it does not know', () => {
  const empty = new adrGov.MergeRegister({ clock: () => 0 }).report({ now: 0 });
  assert.equal(empty.measurable, false);
  assert.equal(empty.declarative, true);
  assert.match(empty.basis, /not the same as no merge having happened/);
  assert.equal(empty.authorizes, false);
});

test('phase18.1: the merge this platform actually performed is recorded and governed', () => {
  const reg = adrGov.seedPlatformMerges(new adrGov.MergeRegister({ clock: () => 0 }));
  const report = reg.report({ now: 0 });
  assert.equal(report.everyMergeGoverned, true);
  assert.deepEqual(report.duplicatedRequirements, [], 'a requirement cannot be absorbed twice');
  const index = reg.requirementIndex();
  for (const requirement of ['Phase 17 Part 15', 'Phase 17 Part 17', 'Phase 18 Part 7']) {
    assert.ok(index.has(requirement), `${requirement} is findable in the register`);
  }
});

test('phase18.1: every merged requirement still maps to a field the guard requires', () => {
  const reg = adrGov.seedPlatformMerges(new adrGov.MergeRegister({ clock: () => 0 }));
  const requiredFields = Object.keys(inst.DECISION_PACKAGE_FIELDS);
  const verified = adrGov.mergeVerification({
    register: reg, requiredFields, now: 0,
    satisfiedBy: {
      'Phase 17 Part 15': ['supportingEvidence', 'assumptions', 'confidence', 'alternativesConsidered', 'legalDependencies', 'historicalOutcomes', 'forecastConfidence', 'validationHistory'],
      'Phase 17 Part 17': ['confidence', 'supportingEvidence', 'assumptions', 'risks', 'uncertainties', 'historicalOutcomes', 'governanceOwner'],
      'Phase 18 Part 7': ['supportingEvidence', 'assumptions', 'confidence', 'historicalOutcomes', 'legalDependencies', 'governanceOwner', 'risks', 'institutionalImpacts', 'alternativesConsidered', 'predictedConsequences', 'validationHistory', 'constitutionalImplications'],
    },
  });
  assert.equal(verified.everyMergeVerified, true);
  assert.deepEqual(verified.functionalityLost, []);
  // …and it says what it cannot establish.
  for (const m of verified.merges) {
    assert.equal(m.verifies, 'structure');
    assert.match(m.cannotVerify, /judgement is human/);
  }
});

test('phase18.1: an unchecked requirement is unknown — neither satisfied nor lost', () => {
  const reg = adrGov.seedPlatformMerges(new adrGov.MergeRegister({ clock: () => 0 }));
  const unchecked = adrGov.mergeVerification({
    register: reg, satisfiedBy: {}, requiredFields: Object.keys(inst.DECISION_PACKAGE_FIELDS), now: 0,
  });
  assert.equal(unchecked.everyMergeVerified, false);
  assert.deepEqual(unchecked.functionalityLost, [], 'unknown is not lost');
  assert.equal(unchecked.merges[0].unexamined.length, 3);
  assert.match(unchecked.basis, /UNKNOWN rather than lost/);

  // …and a requirement whose field genuinely vanished IS reported as lost.
  const broken = adrGov.mergeVerification({
    register: reg, requiredFields: Object.keys(inst.DECISION_PACKAGE_FIELDS), now: 0,
    satisfiedBy: { 'Phase 18 Part 7': ['constitutionalImplications', 'aFieldThatWasRemoved'] },
  });
  assert.ok(broken.functionalityLost.length > 0);
  assert.equal(broken.everyMergeVerified, false);
});

test('phase18.1: a verification over no merges is not a passing one', () => {
  const nothing = adrGov.mergeVerification({ register: null, now: 0 });
  assert.equal(nothing.measurable, false);
  assert.equal(nothing.everyMergeVerified, false);
  assert.match(nothing.basis, /not evidence that no merge happened/);
});
