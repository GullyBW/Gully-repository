'use strict';
// Phase 12, Parts 7, 8, 9 & 10 — the executive quality dashboard, trusted builders and
// deployability, AI fairness/calibration/retirement, and session-scoped consistency.
const test = require('node:test');
const assert = require('node:assert');
const dgm = require('../src/fabric/data-governance');
const slsa = require('../src/supplychain/slsa');
const { AiLifecycle, FAIRNESS_CRITERIA } = require('../src/ai/ai-lifecycle');
const mr = require('../src/twin2/multi-region');

const DAY = 24 * 3600_000;
const good = () => Object.fromEntries(dgm.OBSERVED_DIMENSIONS.map((d) => [d, 0.99]));
const poor = () => Object.fromEntries(dgm.OBSERVED_DIMENSIONS.map((d) => [d, 0.3]));
const estate = (clock = () => 1_000_000) => dgm.seedPlatformDatasets(new dgm.DataGovernance({ clock }));

// --- Part 7: enterprise data quality intelligence -------------------------------------------------

test('an unmeasured estate is reported as unmeasured, never as sound', () => {
  const dash = estate().executiveQualityDashboard();
  assert.strictEqual(dash.acceptable, false);
  assert.match(dash.unmeasuredMeans, /Absence of a measurement is not evidence of quality/);
  for (const d of dash.byDomain) assert.strictEqual(d.status, 'unmeasured');
  for (const d of dash.byDomain) assert.strictEqual(d.score, null);
  assert.ok(dash.blockers.every((b) => /never measured/.test(b)));
});

test('the executive dashboard states the question it answers and refuses to authorize', () => {
  const dg = estate();
  for (const id of dg.datasets()) dg.observeQuality(id, good(), { recordCount: 10 });
  const dash = dg.executiveQualityDashboard();
  assert.match(dash.question, /rely on/i);
  assert.match(dash.answer, /^Yes/);
  assert.strictEqual(dash.acceptable, true);
  assert.strictEqual(dash.qualityReadiness, 1);
  assert.strictEqual(dash.authorizes, false);
  assert.strictEqual(dash.informationalOnly, true);
});

test('a single poor dataset changes the executive answer, not merely a number', () => {
  const dg = estate();
  for (const id of dg.datasets()) dg.observeQuality(id, good(), { recordCount: 10 });
  const before = dg.executiveQualityDashboard();
  dg.observeQuality('case-records', poor(), { recordCount: 10 });
  const after = dg.executiveQualityDashboard();
  assert.strictEqual(before.acceptable, true);
  assert.strictEqual(after.acceptable, false);
  assert.match(after.answer, /^Not fully/);
  assert.ok(after.blockers.some((b) => b.startsWith('case-records:')));
  assert.strictEqual(after.worstDataset, 'case-records');
  assert.ok(after.qualityReadiness < before.qualityReadiness);
});

test('the dashboard groups by domain and by accountable owner, weakest domain first', () => {
  const dg = estate();
  for (const id of dg.datasets()) dg.observeQuality(id, good(), { recordCount: 10 });
  dg.observeQuality('case-records', poor(), { recordCount: 10 });
  const dash = dg.executiveQualityDashboard();
  assert.ok(dash.byDomain.length >= 2);
  // Sorted worst-first so the reader meets the problem before the reassurance.
  const scores = dash.byDomain.map((d) => d.score).filter((s) => s !== null);
  assert.deepStrictEqual(scores, [...scores].sort((a, b) => a - b));
  const atRisk = dash.byDomain.filter((d) => d.status === 'at-risk');
  assert.ok(atRisk.length >= 1);
  // Every dataset is attributed to a named owner, and the owner view covers the whole estate.
  const owned = Object.values(dash.byOwner).reduce((a, rows) => a + rows.length, 0);
  assert.strictEqual(owned, dg.datasets().length);
  assert.ok(!Object.keys(dash.byOwner).includes('unowned'));
});

test('overdue remediation is a dashboard blocker, not a footnote', () => {
  let now = 1_000_000;
  const dg = estate(() => now);
  for (const id of dg.datasets()) dg.observeQuality(id, good(), { recordCount: 10 });
  const t = dg.openRemediation('case-records', { dimension: 'completeness', by: 'Registrar', dueInDays: 5, rationale: 'gap in filings' });
  assert.strictEqual(dg.executiveQualityDashboard({ now }).acceptable, true);
  now += 30 * DAY;
  const late = dg.executiveQualityDashboard({ now });
  assert.strictEqual(late.overdueRemediations, 1);
  assert.ok(late.blockers.some((b) => b.startsWith(t.id)));
  assert.strictEqual(late.acceptable, false);
});

// --- Part 8: enterprise supply-chain trust --------------------------------------------------------

test('an unregistered builder is not trusted, and trusting one needs a named human', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  const unknown = sc.verifyBuilder('ci-runner-7');
  assert.strictEqual(unknown.trusted, false);
  assert.match(unknown.reason, /not registered/);
  assert.throws(() => sc.registerBuilder('ci', { operator: 'GovCI' }), /named human/);
  assert.throws(() => sc.registerBuilder('ci', { operator: 'GovCI' }), (e) => e.failClosed === true);
  assert.throws(() => sc.registerBuilder('ci', { by: 'ISRB Chair', rationale: 'audited' }), /operating authority/);
});

test('builder properties are checked separately, so partial hardening reads as partial', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  sc.registerBuilder('partial', { operator: 'GovCI', hardened: true, isolated: true, by: 'ISRB Chair', rationale: 'audited 2026-Q1' });
  const p = sc.verifyBuilder('partial');
  assert.strictEqual(p.trusted, false);
  assert.deepStrictEqual(p.failing, ['ephemeral', 'attestsProvenance']);
  for (const c of p.checks) assert.ok(c.why, `check '${c.property}' does not say what it buys`);
  sc.registerBuilder('full', { operator: 'GovCI', hardened: true, isolated: true, ephemeral: true, attestsProvenance: true, by: 'ISRB Chair', rationale: 'audited 2026-Q1' });
  const f = sc.verifyBuilder('full');
  assert.strictEqual(f.trusted, true);
  assert.deepStrictEqual(f.failing, []);
  assert.strictEqual(f.trustedBy, 'ISRB Chair');
});

test('vulnerability scan history is append-only and timestamped', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  assert.throws(() => sc.recordVulnerabilityScan({ critical: 0 }), /timestamped/);
  sc.recordVulnerabilityScan({ at: 10, high: 2 });
  assert.throws(() => sc.recordVulnerabilityScan({ at: 10, high: 0 }), /append-only/);
});

test('a vulnerability trend needs two points, and reports direction rather than a bare count', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  const none = sc.vulnerabilityTrend();
  assert.strictEqual(none.direction, 'insufficient-data');
  assert.strictEqual(none.slaBreached, null);
  sc.recordVulnerabilityScan({ at: 1, critical: 2, high: 4 });
  assert.strictEqual(sc.vulnerabilityTrend().direction, 'insufficient-data');
  sc.recordVulnerabilityScan({ at: 2, critical: 1, high: 2 });
  sc.recordVulnerabilityScan({ at: 3, critical: 0, high: 0 });
  const improving = sc.vulnerabilityTrend();
  assert.strictEqual(improving.direction, 'improving');
  assert.ok(improving.slope < 0);
  assert.strictEqual(improving.clean, true);
});

test('a critical finding open past its remediation window breaches the SLA whatever the count says', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  sc.recordVulnerabilityScan({ at: 1, critical: 1, high: 0, oldestCriticalAgeDays: 2 });
  sc.recordVulnerabilityScan({ at: 2, critical: 1, high: 0, oldestCriticalAgeDays: 40 });
  const t = sc.vulnerabilityTrend();
  assert.strictEqual(t.direction, 'flat');          // the count never moved
  assert.strictEqual(t.slaBreached, true);          // but the finding aged past its window
  assert.strictEqual(t.clean, false);
  assert.match(t.reason, /40 days against a 7-day remediation window/);
});

test('zero scans is not zero findings — an unscanned artifact is not deployable', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  const rep = sc.deployabilityReport({ artifact: 'njtip-app', artifactDigest: 'deadbeef' });
  assert.strictEqual(rep.deployable, false);
  assert.strictEqual(rep.failClosed, true);
  assert.strictEqual(rep.authorizes, false);
  assert.match(rep.note, /NOT DEPLOYABLE/);
  const checks = rep.blockers.map((b) => b.check);
  assert.ok(checks.includes('trusted-builder'));
  assert.ok(checks.includes('vulnerability-scan'));
  assert.ok(rep.blockers.some((b) => /zero scans is not zero findings/.test(b.reason)));
});

test('the supply-chain posture carries builder verification and the vulnerability trend', () => {
  const sc = new slsa.SupplyChainAttestation({ clock: () => 1_000 });
  sc.registerBuilder('full', { operator: 'GovCI', hardened: true, isolated: true, ephemeral: true, attestsProvenance: true, by: 'ISRB Chair', rationale: 'audited' });
  const rep = sc.report({});
  assert.strictEqual(rep.builders.length, 1);
  assert.strictEqual(rep.builders[0].trusted, true);
  assert.strictEqual(rep.vulnerabilityTrend.direction, 'insufficient-data');
});

// --- Part 9: comprehensive AI assurance -----------------------------------------------------------

function approvedModel(id = 'm') {
  const ai = new AiLifecycle({ clock: () => 1_000 });
  ai.register('model', id, { owner: 'analytics-domain', purpose: 'case-prioritisation', riskClass: 'high' });
  ai.approve('model', id, { by: 'AI Governance Board', rationale: 'explainable, advisory-only, deterministic' });
  return ai;
}

test('the platform declares several fairness criteria and refuses to pick one silently', () => {
  const ai = approvedModel();
  assert.ok(Object.keys(FAIRNESS_CRITERIA).length >= 4);
  for (const c of ai.fairnessCriteria()) {
    assert.ok(c.description, `${c.id} has no description`);
    assert.ok(c.suitsWhen, `${c.id} does not say when it applies`);
  }
  const undeclared = ai.fairnessReport('m');
  assert.strictEqual(undeclared.assessed, false);
  assert.match(undeclared.reason, /will not pick one silently/);
});

test('choosing a fairness criterion is an attributed governance decision', () => {
  const ai = approvedModel();
  assert.throws(() => ai.declareFairnessCriterion('m', { criterion: 'equal-opportunity' }), (e) => e.failClosed === true);
  assert.throws(() => ai.declareFairnessCriterion('m', { criterion: 'roughly-even', by: 'a', rationale: 'b' }), /unknown fairness criterion/);
  assert.throws(() => ai.declareFairnessCriterion('ghost', { criterion: 'equal-opportunity', by: 'a', rationale: 'b' }), /unknown/);
  const d = ai.declareFairnessCriterion('m', { criterion: 'equal-opportunity', threshold: 0.2, by: 'AI Governance Board', rationale: 'missing a real case matters more than a false alarm' });
  assert.strictEqual(d.criterion, 'equal-opportunity');
  assert.strictEqual(d.threshold, 0.2);
});

test('fairness is assessed against the declared criterion and its threshold', () => {
  const ai = approvedModel();
  ai.declareFairnessCriterion('m', { criterion: 'equal-opportunity', threshold: 0.2, by: 'AI Governance Board', rationale: 'recall matters most' });
  assert.strictEqual(ai.fairnessReport('m').assessed, false);   // no observations yet
  ai.observeBias('m', { group: 'region-a', outcomeRate: 0.5, sampleSize: 100 });
  ai.observeBias('m', { group: 'region-b', outcomeRate: 0.9, sampleSize: 100 });
  const unfair = ai.fairnessReport('m');
  assert.strictEqual(unfair.assessed, true);
  assert.strictEqual(unfair.fair, false);
  assert.ok(unfair.criterionMeaning);
  assert.strictEqual(unfair.declaredBy, 'AI Governance Board');
  // The same disparity clears a wider threshold — which is exactly why the threshold is declared.
  const wide = approvedModel('w');
  wide.declareFairnessCriterion('w', { criterion: 'equal-opportunity', threshold: 0.5, by: 'AI Governance Board', rationale: 'pilot tolerance' });
  wide.observeBias('w', { group: 'region-a', outcomeRate: 0.5, sampleSize: 100 });
  wide.observeBias('w', { group: 'region-b', outcomeRate: 0.9, sampleSize: 100 });
  assert.strictEqual(wide.fairnessReport('w').fair, true);
});

test('a calibration curve is refused until there are enough points to draw one', () => {
  const ai = approvedModel();
  const empty = ai.calibrationReport('m');
  assert.strictEqual(empty.assessed, false);
  assert.match(empty.reason, /a shape, not a measurement/);
  assert.throws(() => ai.recordCalibration('m', { confidence: 1.5, correct: true }), /\[0, 1\]/);
  assert.throws(() => ai.recordCalibration('m', { confidence: 0.9, correct: 'probably' }), /boolean/);
});

test('an overconfident model is miscalibrated, not "usually right"', () => {
  const ai = approvedModel();
  for (let i = 0; i < 100; i++) ai.recordCalibration('m', { confidence: 0.9, correct: i < 60 });
  const r = ai.calibrationReport('m');
  assert.strictEqual(r.assessed, true);
  assert.strictEqual(r.calibrated, false);
  assert.deepStrictEqual(r.overconfidentBuckets, ['0.8–1.0']);
  assert.ok(r.expectedCalibrationError > 0.15);
  assert.match(r.reason, /confidence floor/);
  const bucket = r.buckets.find((b) => b.bucket === '0.8–1.0');
  assert.strictEqual(bucket.accuracy, 0.6);
  assert.strictEqual(bucket.meanConfidence, 0.9);
});

test('a genuinely calibrated model reports calibrated, so the check can pass as well as fail', () => {
  const ai = approvedModel();
  for (const c of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (let i = 0; i < 100; i++) ai.recordCalibration('m', { confidence: c, correct: i < Math.round(c * 100) });
  }
  const r = ai.calibrationReport('m');
  assert.strictEqual(r.calibrated, true);
  assert.ok(r.expectedCalibrationError <= 0.15);
  assert.deepStrictEqual(r.overconfidentBuckets, []);
});

test('retirement removes approval and closes the door on inference', () => {
  const ai = approvedModel();
  assert.strictEqual(ai.isApproved('model', 'm').approved, true);
  assert.throws(() => ai.retire('model', 'm', { by: 'AI Governance Board' }), (e) => e.failClosed === true);
  assert.throws(() => ai.retire('model', 'ghost', { by: 'a', rationale: 'b' }), /unknown artifact/);
  assert.throws(() => ai.retire('model', 'm', { by: 'a', rationale: 'b', supersededBy: 'nonexistent' }), /does not exist/);
  ai.retire('model', 'm', { by: 'AI Governance Board', rationale: 'superseded by a re-approved version' });
  assert.strictEqual(ai.isApproved('model', 'm').approved, false);
  assert.match(ai.isApproved('model', 'm').reason, /retired by AI Governance Board/);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', confidence: 0.9, requestedBy: 'inv-1' }), (e) => e.failClosed === true);
  assert.throws(() => ai.retire('model', 'm', { by: 'a', rationale: 'b' }), /already retired/);
  assert.strictEqual(ai.retired().length, 1);
  // A retired high-risk artifact is not an unapproved one — the estate stays valid.
  assert.strictEqual(ai.validate().valid, true, ai.validate().violations.join('; '));
});

test('the AI report carries fairness, calibration and retirement and still authorizes nothing', () => {
  const ai = approvedModel();
  ai.declareFairnessCriterion('m', { criterion: 'equalised-odds', by: 'AI Governance Board', rationale: 'both errors carry consequences' });
  const rep = ai.report();
  assert.strictEqual(rep.fairness.length, 1);
  assert.strictEqual(rep.calibration.length, 1);
  assert.strictEqual(rep.fairnessCriteria.length, Object.keys(FAIRNESS_CRITERIA).length);
  assert.deepStrictEqual(rep.retired, []);
  assert.strictEqual(rep.authorizes, false);
  assert.strictEqual(rep.advisoryOnly, true);
});

// --- Part 10: enterprise consistency governance ---------------------------------------------------

test('the five consistency models are declared, including both session guarantees', () => {
  for (const id of ['strong', 'causal', 'read-your-writes', 'monotonic-reads', 'eventual']) {
    const m = mr.CONSISTENCY_MODELS[id];
    assert.ok(m, `consistency model '${id}' is not declared`);
    assert.ok(m.description && m.cost, `'${id}' does not state its cost`);
  }
  assert.strictEqual(mr.CONSISTENCY_MODELS['read-your-writes'].sessionScoped, true);
  assert.strictEqual(mr.CONSISTENCY_MODELS['monotonic-reads'].sessionScoped, true);
  assert.notStrictEqual(mr.CONSISTENCY_MODELS.eventual.sessionScoped, true);
});

test('every consistency decision cites the ADR that made it', () => {
  const v = mr.validateConsistency();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  for (const c of mr.contextConsistency()) {
    assert.match(c.adr || '', /^ADR-\d{4}$/, `${c.context} cites no ADR`);
    assert.ok(c.rationale, `${c.context} has no rationale`);
  }
});

test('a session must observe its own write', () => {
  const behind = mr.readAllowed({ context: 'investigation', replicaLagMs: 100, session: { lastWriteSequence: 10 }, replicaSequence: 5 });
  assert.strictEqual(behind.allowed, false);
  assert.strictEqual(behind.failClosed, true);
  assert.match(behind.reason, /must observe its own write/);
  const caughtUp = mr.readAllowed({ context: 'investigation', replicaLagMs: 100, session: { lastWriteSequence: 10 }, replicaSequence: 10 });
  assert.strictEqual(caughtUp.allowed, true);
});

test('time may not run backwards for a reader', () => {
  const backwards = mr.readAllowed({ context: 'analytics', replicaLagMs: 100, session: { lastReadSequence: 50 }, replicaSequence: 40 });
  assert.strictEqual(backwards.allowed, false);
  assert.match(backwards.reason, /time would run backwards/);
  assert.strictEqual(mr.readAllowed({ context: 'analytics', replicaLagMs: 100, session: { lastReadSequence: 50 }, replicaSequence: 50 }).allowed, true);
});

test('an unverifiable session guarantee is not a guarantee', () => {
  const noToken = mr.readAllowed({ context: 'investigation', replicaLagMs: 100 });
  assert.strictEqual(noToken.allowed, false);
  assert.match(noToken.reason, /cannot be checked without a session token/);
  // A non-session model is unaffected by the absence of a token.
  assert.strictEqual(mr.readAllowed({ context: 'observability', replicaLagMs: 100 }).allowed, true);
  assert.strictEqual(mr.sessionGuaranteeHolds({ model: 'eventual' }).applicable, false);
});

test('the staleness bound still applies before the session guarantee is reached', () => {
  const stale = mr.readAllowed({ context: 'investigation', replicaLagMs: 60_000, session: { lastWriteSequence: 0 }, replicaSequence: 99 });
  assert.strictEqual(stale.allowed, false);
  assert.match(stale.reason, /exceeds the 30000ms staleness bound/);
});

test('the dependency map reports consistency inversions for a human to judge', () => {
  const map = mr.consistencyDependencyMap();
  assert.ok(map.contexts.length >= 16);
  for (const row of map.contexts) {
    assert.ok(row.note, `${row.context}: dependency row states nothing`);
    assert.strictEqual(row.inversion, row.weakerDependencies.length > 0);
    for (const d of row.dependsOn) assert.ok(mr.CONSISTENCY_MODELS[d.model]);
  }
  assert.match(map.note, /human to judge, not silently resolved/);
  assert.deepStrictEqual(map.inversions, map.contexts.filter((r) => r.inversion).map((r) => r.context));
});

test('under failover a consistency model is refused, never quietly downgraded', () => {
  const healthy = mr.validateFailover({ failed: [] });
  assert.deepStrictEqual(healthy.unavailable, []);
  assert.strictEqual(healthy.quorum.hasQuorum, true);
  assert.strictEqual(healthy.noGuaranteeWeakened, true);

  const lost = mr.validateFailover({ failed: ['bw-south', 'bw-north'] });
  assert.strictEqual(lost.quorum.hasQuorum, false);
  assert.ok(lost.unavailable.includes('custody'));
  assert.ok(lost.unavailable.includes('identity-access'));
  // A model that only holds when everything is healthy is a model that holds when you do not need it.
  assert.strictEqual(lost.noGuaranteeWeakened, true);
  for (const row of lost.contexts) {
    if (row.degradedTo === 'unavailable') assert.match(row.reason, /unavailable rather than serving a weaker guarantee/);
    else assert.strictEqual(row.degradedTo, 'read-only');
    assert.strictEqual(row.writesAvailable, false);
  }
  assert.strictEqual(lost.failClosed, true);
  assert.strictEqual(lost.authorizes, false);
});

test('the operator posture marks a session-scoped context as settled at read time', () => {
  const posture = mr.consistencyPosture({
    committedSequence: 100,
    replicas: { 'bw-central': 100, 'bw-south': 99, 'bw-north': 98 },
    healthy: ['bw-central', 'bw-south', 'bw-north'],
  });
  const sessionRows = posture.matrix.filter((r) => r.sessionDependent);
  assert.ok(sessionRows.length > 0);
  for (const r of sessionRows) assert.match(r.reason, /settled at read time/);
  const plain = posture.matrix.filter((r) => !r.sessionDependent);
  for (const r of plain) assert.doesNotMatch(r.reason, /settled at read time/);
  assert.ok(posture.dependencyMap);
  assert.ok(posture.failover);
  assert.strictEqual(posture.authorizes, false);
});
