'use strict';
// Phase 16: evidence acquisition, governed data population, forecast and twin calibration,
// explainability, readiness traceability, control performance, exercise intelligence, capability
// maturity, legal dependency intelligence, workflow validation, validation workshops, continuous
// architecture validation, institutional performance, production transition, and the phase's new
// global invariant.
const test = require('node:test');
const assert = require('node:assert');
const inst = require('../src/assurance/institutional');
const ce = require('../src/assurance/control-effectiveness');
const dp = require('../src/architecture/drift-prevention');
const own = require('../src/governance/ownership');
const ca = require('../src/governance/cross-agency');
const ir = require('../src/governance/institutional-resilience');
const la = require('../src/legislation/legal-authority');
const cm = require('../src/architecture/context-map');
const migration = require('../src/migration/roadmap');
const evidenceConfidence = require('../src/assurance/evidence-confidence');
const { RehearsalRegister, REHEARSALS } = require('../src/governance/rehearsals');
const { OperationsTwin, SCENARIOS, CALIBRATION_MIN_OBSERVATIONS } = require('../src/twin2/operations-twin');

const MINUTE = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const NOW = 400 * DAY;
const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

// --- Part 1: evidence acquisition ---------------------------------------------------------------

const CONNECTOR = {
  kind: 'siem-platform', owner: 'National Computer Incident Response Team', sourceSystem: 'gov-siem',
  integrity: 'signed', trustLevel: 'attested', freshnessRequirementDays: 1, declaredBy: 'Office of the Chief Information Security Officer',
};

test('a connector registry ships empty and reports the estate as offline', () => {
  const r = new inst.EvidenceConnectorRegistry({ clock: () => 0 }).report({ now: 0 });
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.anyVerifiedEvidence, false);
  assert.strictEqual(r.undeclaredKinds.length, 8);
  assert.strictEqual(r.authorizes, false);
});

test('a connector cannot declare itself verified, and its owner cannot verify it', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  assert.throws(() => reg.declare('x', { ...CONNECTOR, trustLevel: 'verified' }), (e) => e.failClosed === true);
  reg.declare('siem-1', CONNECTOR);
  reg.recordSync('siem-1', { outcome: 'synchronized', records: 10, newestRecordAt: 0, by: 'scheduler' });
  assert.throws(() => reg.verify('siem-1', { by: CONNECTOR.owner, independent: true }), (e) => e.failClosed === true);
  assert.throws(() => reg.verify('siem-1', { by: 'Auditor General', independent: false }), (e) => e.failClosed === true);
});

test('the trust ceiling can be reached and is lost again with nobody doing anything', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  reg.declare('siem-1', CONNECTOR);
  assert.strictEqual(reg.state('siem-1', { now: 0 }).evidenceCeiling, 'unknown');
  reg.recordSync('siem-1', { outcome: 'synchronized', records: 400, newestRecordAt: 0, by: 'scheduler' });
  reg.verify('siem-1', { by: 'Auditor General', independent: true, at: 0 });
  assert.strictEqual(reg.state('siem-1', { now: 0 }).evidenceCeiling, 'verified');
  // Five days later the newest record is older than the connector's own declared requirement.
  const stale = reg.state('siem-1', { now: 5 * DAY });
  assert.strictEqual(stale.evidenceCeiling, 'unknown');
  assert.ok(stale.blockers.some((b) => b.startsWith('freshness is')));
});

test('an unprotected path cannot be verified away', () => {
  const reg = new inst.EvidenceConnectorRegistry({ clock: () => 0 });
  reg.declare('mon-1', { ...CONNECTOR, kind: 'monitoring-system', integrity: 'unprotected' });
  reg.recordSync('mon-1', { outcome: 'synchronized', records: 1, newestRecordAt: 0, by: 'scheduler' });
  assert.throws(() => reg.verify('mon-1', { by: 'Auditor General', independent: true }), (e) => e.failClosed === true);
  assert.strictEqual(reg.state('mon-1', { now: 0 }).evidenceCeiling, 'unknown');
});

// --- Part 2: governed data population -----------------------------------------------------------

test('synthetic data is never operational evidence, and there is no path that promotes it', () => {
  const ob = new inst.EvidenceOnboarding({ clock: () => 0 });
  for (const forbidden of ['promote', 'reclassify', 'setDataClass']) {
    assert.strictEqual(typeof ob[forbidden], 'undefined', forbidden);
  }
  assert.strictEqual(inst.DATA_CLASSES.synthetic.countsAsEvidence, false);
  // No default is safe: whichever way it defaulted would be wrong half the time.
  assert.throws(() => ob.submit({ type: 'training', payload: {}, submittedBy: 'P', rationale: 'r' }), (e) => e.failClosed === true);
  assert.throws(() => ob.submit({ type: 'training', payload: {}, submittedBy: 'P', rationale: 'r', dataClass: 'probably-real' }), (e) => e.failClosed === true);
});

test('operational evidence must be traceable to what observed it', () => {
  const ob = new inst.EvidenceOnboarding({ clock: () => 0 });
  assert.throws(() => ob.submit({ type: 'training', payload: {}, submittedBy: 'P', rationale: 'r', dataClass: 'operational' }), (e) => e.failClosed === true);
  assert.throws(() => ob.submit({ type: 'training', payload: {}, submittedBy: 'P', rationale: 'r', dataClass: 'operational', provenance: { sourceSystem: 'hr' } }), (e) => e.failClosed === true);
  const ok = ob.submit({
    type: 'training', payload: {}, submittedBy: 'P', rationale: 'r', dataClass: 'operational',
    provenance: { sourceSystem: 'learning-management', observedAt: 1, acquiredVia: 'connector:lms-1' },
  });
  assert.strictEqual(ok.operational, true);
});

test('the audit trail counts the two data classes apart and never sums them', () => {
  const ob = new inst.EvidenceOnboarding({ clock: () => 0 });
  const course = Object.values(own.REQUIRED_TRAINING)[0][0];
  const target = new own.TrainingRegister({ clock: () => 0 });
  const real = ob.submit({
    type: 'training', payload: { person: 'P', course, at: 1, by: 'Registrar' }, submittedBy: 'P', rationale: 'r',
    dataClass: 'operational', provenance: { sourceSystem: 'lms', observedAt: 1, acquiredVia: 'connector:lms-1' },
  });
  ob.accept(real.id, { by: 'Registrar' });
  ob.land(real.id, { register: target, apply: (r, p) => r.recordCompletion(p), by: 'Registrar' });
  const audit = ob.auditTrail({ now: 0 });
  assert.strictEqual(audit.operationalLanded, 1);
  assert.strictEqual(audit.syntheticLanded, 0);
  assert.strictEqual(audit.everyOperationalRecordTraceable, true);
  assert.strictEqual(audit.operationalLanded + audit.syntheticLanded, audit.landed);
});

// --- Part 3: forecast calibration ---------------------------------------------------------------

test('a forecast nobody scored has an unknown accuracy, not a poor one', () => {
  const r = new dp.ForecastRegister({ clock: () => 0 }).report({ now: 0 });
  assert.strictEqual(r.unknown.length, r.count);
  assert.deepStrictEqual(r.miscalibrated, []);
  assert.strictEqual(r.calibrationRate, null);
  assert.strictEqual(r.measurable, false);
  for (const d of r.dimensions) {
    for (const measure of ['accuracy', 'meanAbsoluteError', 'bias', 'drift']) assert.strictEqual(d[measure], null, `${d.dimension}.${measure}`);
  }
});

test('a forecast cannot be scored before its horizon, or twice', () => {
  const reg = new dp.ForecastRegister({ clock: () => 0 });
  const f = reg.record('auditReadiness', { point: 0.5, interval: [0.3, 0.7], constrained: true, horizonDays: 30, madeBy: 'analytics', at: 0 });
  assert.throws(() => reg.recordOutcome(f.id, { observed: 0.5, observedBy: 'ORB', at: DAY }), (e) => e.failClosed === true);
  reg.recordOutcome(f.id, { observed: 0.5, observedBy: 'ORB', at: 31 * DAY });
  assert.throws(() => reg.recordOutcome(f.id, { observed: 0.9, observedBy: 'ORB', at: 32 * DAY }), (e) => e.failClosed === true);
});

test('an over-optimistic dimension is named rather than averaged away', () => {
  const reg = new dp.ForecastRegister({ clock: () => 0 });
  let t = 0;
  for (let i = 0; i < 8; i += 1) {
    const f = reg.record('auditReadiness', { point: 0.95, interval: [0.9, 1], constrained: true, horizonDays: 30, madeBy: 'analytics', at: t });
    reg.recordOutcome(f.id, { observed: 0.4, observedBy: 'ORB', at: t + 31 * DAY });
    t += 40 * DAY;
  }
  const c = reg.calibration('auditReadiness');
  assert.strictEqual(c.grade, 'miscalibrated');
  assert.ok(c.bias > 0);
  assert.strictEqual(c.leansOptimistic, true);
  // The eleven unscored dimensions are excluded from the rate rather than counted as failures.
  const report = reg.report({ now: t });
  assert.strictEqual(report.calibrationRate, 0);
  assert.strictEqual(report.unknown.length, report.count - 1);
});

test('confidence calibration needs both kinds scored, or it says nothing', () => {
  const reg = new dp.ForecastRegister({ clock: () => 0 });
  let t = 0;
  for (let i = 0; i < 6; i += 1) {
    const f = reg.record('policyEffectiveness', { point: 0.5, interval: [0, 1], constrained: true, horizonDays: 10, madeBy: 'a', at: t });
    reg.recordOutcome(f.id, { observed: 0.5, observedBy: 'b', at: t + 11 * DAY });
    t += 20 * DAY;
  }
  assert.strictEqual(reg.calibration('policyEffectiveness').confidenceCalibration, null);
});

// --- Part 10: twin calibration ------------------------------------------------------------------

test('an uncompared scenario has an unknown accuracy, distinct from poor', () => {
  const twin = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY'], clock: () => 0 });
  const r = twin.calibrationReport({ now: 0 });
  assert.strictEqual(r.unknown.length, r.count);
  assert.deepStrictEqual(r.poor, []);
  assert.strictEqual(r.accuracyRate, null);
  for (const s of r.scenarios) assert.strictEqual(s.simulationConfidence, 'unknown', s.scenario);
});

test('half a quantitative validation is refused', () => {
  const twin = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY'], clock: () => 0 });
  const scenario = Object.keys(SCENARIOS)[0];
  assert.throws(() => twin.recordValidation(scenario, { predicted: true, observed: true, by: 'ORB', predictedValue: 0.9 }), (e) => e.failClosed === true);
  assert.throws(() => twin.recordValidation(scenario, { predicted: true, observed: true, by: 'ORB', observedValue: 0.9 }), (e) => e.failClosed === true);
});

test('calibration evidence is stamped with the model that produced it', () => {
  const twin = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY'], clock: () => 0 });
  const other = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY', 'APP-FIT-ADR-GOVERNANCE'], clock: () => 0 });
  assert.notStrictEqual(twin.digest(), other.digest());
  const scenario = Object.keys(SCENARIOS)[0];
  twin.recordValidation(scenario, { predicted: true, observed: true, by: 'ORB' });
  assert.strictEqual(twin.validationHistory(scenario)[0].modelDigest, twin.digest());
});

test('an agreeing scenario is calibrated and a disagreeing one is poor', () => {
  const scenario = Object.keys(SCENARIOS)[0];
  const good = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY'], clock: () => 0 });
  const bad = new OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP-INTEGRITY'], clock: () => 0 });
  for (let i = 0; i < CALIBRATION_MIN_OBSERVATIONS + 2; i += 1) {
    good.recordValidation(scenario, { predicted: true, observed: true, by: 'ORB', predictedValue: 0.9, observedValue: 0.88 });
    bad.recordValidation(scenario, { predicted: true, observed: false, by: 'ORB', predictedValue: 0.9, observedValue: 0.2 });
  }
  assert.strictEqual(good.scenarioCalibration(scenario, { now: 0 }).state, 'calibrated');
  assert.strictEqual(good.scenarioCalibration(scenario, { now: 0 }).simulationConfidence, 'high');
  assert.strictEqual(bad.scenarioCalibration(scenario, { now: 0 }).state, 'poor');
  assert.strictEqual(bad.scenarioCalibration(scenario, { now: 0 }).simulationConfidence, 'low');
  // The unexamined scenarios are excluded, not counted as poor.
  assert.deepStrictEqual(good.calibrationReport({ now: 0 }).poor, []);
});

// --- Parts 4 & 13: explainability and readiness traceability ------------------------------------

const fullEvidence = () => {
  const register = new evidenceConfidence.EvidenceRegister({ clock: () => 0 });
  for (const dimension of Object.keys(evidenceConfidence.READINESS_DIMENSIONS)) {
    register.record({ id: `readiness:${dimension}`, source: 'executable-check', completeness: 1, verifiedAt: 0, detail: 'supplied' });
  }
  return register;
};

test('the explainability chain runs metric to source record, in that order', () => {
  // Phase 17, Part 5 widened this from seven hops to nine. A rule can rest on a recorded decision
  // and still have no legal basis, and a figure can be derivable today and never once have been
  // compared against what happened.
  assert.deepStrictEqual(inst.EXPLANATION_ORDER, [
    'executive-metric', 'readiness-dimension', 'evidence', 'control', 'policy',
    'legal-authority', 'adr', 'historical-records', 'source-record',
  ]);
  for (const [id, h] of Object.entries(inst.EXPLANATION_HOPS)) {
    assert.ok(h.answers.endsWith('?'), id);
    assert.ok(h.resolvedFrom && h.ifBroken, id);
  }
});

test('every executive panel names a module a bounded context claims', () => {
  const owners = cm.moduleOwnership().owner || {};
  for (const [panel, spec] of Object.entries(inst.EXECUTIVE_PANELS)) {
    const module = inst.sourceModuleOf(spec.derivedFrom);
    assert.ok(module, `${panel} names no source module`);
    assert.ok(owners[module], `${panel} is derived from ${module}, which no context claims`);
  }
});

test('a chain is reported as broken AT the hop that broke, never as a percentage', () => {
  const controls = controlsAll();
  const dashboard = { panels: [{ panel: 'documentationHealth', measured: true, value: 247, detail: '0 unresolved claims' }] };
  const register = fullEvidence();
  // The two hops Phase 17 added need two more things supplied before the chain can complete.
  const authorities = new (require('../src/legislation/legal-authority').LegalAuthorityRegistry)({ clock: () => 0 });
  const history = { documentationHealth: [0.8, 0.9] };
  const full = { dashboard, evidence: register, controls, authorities, history, now: 0 };
  assert.strictEqual(inst.explain('documentationHealth', full).complete, true);
  assert.strictEqual(inst.explain('documentationHealth', { ...full, evidence: null }).brokenAt, 'evidence');
  assert.strictEqual(inst.explain('documentationHealth', { ...full, controls: [] }).brokenAt, 'control');
  assert.strictEqual(inst.explain('documentationHealth', { ...full, authorities: null }).brokenAt, 'legal-authority');
  assert.strictEqual(inst.explain('documentationHealth', { ...full, history: null }).brokenAt, 'historical-records');
  const unmeasured = inst.explain('documentationHealth', {
    ...full, dashboard: { panels: [{ panel: 'documentationHealth', measured: false, detail: 'not assessed' }] },
  });
  assert.strictEqual(unmeasured.brokenAt, 'executive-metric');
  assert.throws(() => inst.explain('a feeling', { controls }));
});

test('readiness traces forward to evidence and backward to what a control holds up', () => {
  const controls = controlsAll();
  const traced = inst.readinessTraceability({ evidence: fullEvidence(), controls, now: 0 });
  assert.strictEqual(traced.bidirectional, true);
  assert.strictEqual(traced.everyConclusionTraceable, true);
  assert.strictEqual(traced.traceabilityRate, 1);
  // The backward direction is the one nothing else asks, and on this estate it finds a large
  // minority of controls that hold up no readiness conclusion at all.
  assert.ok(traced.orphanControls.length > 0);
  assert.ok(traced.orphanRate > 0);
  assert.ok(traced.orphanContexts.length > 0);
  // An orphan is a finding, not a traceability failure.
  assert.strictEqual(traced.everyConclusionTraceable, true);
  const readinessOwners = new Set(traced.readinessOwningContexts);
  for (const r of traced.evidenceToReadiness.filter((x) => !x.supportsReadiness)) {
    if (r.context) assert.ok(!readinessOwners.has(r.context), r.control);
  }
});

// --- Part 5: control performance ----------------------------------------------------------------

test('precision and recall are reported side by side and never combined', () => {
  const reg = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 10; i += 1) {
    const t = i * 10 * DAY;
    if (i < 7) reg.record('C', { outcome: 'true-positive', occurredAt: t, detectedAt: t + 5 * MINUTE, acknowledgedAt: t + 20 * MINUTE, acknowledgedBy: 'Duty', remediatedAt: t + 2 * HOUR, recoveredAt: t + 3 * HOUR, observedBy: 'ORB' });
    else if (i < 9) reg.record('C', { outcome: 'false-negative', occurredAt: t, observedBy: 'ORB' });
    else reg.record('C', { outcome: 'false-positive', occurredAt: t, detectedAt: t + MINUTE, acknowledgedAt: t + 2 * MINUTE, acknowledgedBy: 'Duty', observedBy: 'ORB' });
  }
  const p = ce.controlPerformance('C', { register: reg, now: 0 });
  assert.strictEqual(p.precisionRecall.combined, false);
  const value = (id) => p.measures.find((m) => m.measure === id).value;
  assert.strictEqual(value('precision'), 0.875);
  assert.strictEqual(value('recall'), +(7 / 9).toFixed(4));
  // Recovery is not remediation.
  assert.strictEqual(value('meanTimeToRecover'), 3 * HOUR);
  assert.notStrictEqual(value('meanTimeToRespond'), value('meanTimeToRecover'));
});

test('an unobserved control has unknown performance and a mean over one observation is indicative', () => {
  const empty = new ce.ControlObservationRegister({ clock: () => 0 });
  const none = ce.controlPerformance('APP-FIT-NOTHING', { register: empty, now: 0 });
  assert.strictEqual(none.measured, false);
  assert.strictEqual(none.unknownMeasures.length, 9);
  const thin = new ce.ControlObservationRegister({ clock: () => 0 });
  thin.record('E', { outcome: 'true-positive', occurredAt: 0, detectedAt: MINUTE, observedBy: 'ORB' });
  assert.ok(ce.controlPerformance('E', { register: thin, now: 0 }).indicativeMeasures.includes('meanTimeToDetect'));
});

test('a period with no observations is not a period scoring zero', () => {
  const reg = new ce.ControlObservationRegister({ clock: () => 0 });
  reg.record('C', { outcome: 'true-positive', occurredAt: 0, detectedAt: MINUTE, observedBy: 'ORB' });
  assert.strictEqual(ce.performanceTrend('C', { register: reg, periods: [500 * DAY, 600 * DAY, 700 * DAY], now: 0 }).measurable, false);
});

// --- Part 7: exercise intelligence --------------------------------------------------------------

test('realism is derived from the conditions rather than graded by the facilitator', () => {
  assert.strictEqual(inst.EXECUTIVE_PANELS.documentationHealth !== undefined, true);
  for (const [facts, expected] of [
    [{ announced: true, faultsInjected: false, liveSystems: false }, 'tabletop'],
    [{ announced: true, faultsInjected: true, liveSystems: false }, 'simulated'],
    [{ announced: true, faultsInjected: true, liveSystems: true }, 'live'],
    [{ announced: false }, 'unannounced'],
  ]) {
    const reg = new RehearsalRegister({ clock: () => 0 });
    const run = reg.schedule({ rehearsal: 'incident-escalation', facilitator: 'ORB', participants: ['A'], at: 0 });
    assert.strictEqual(reg.declareConditions(run.id, { ...facts, by: 'ORB' }).realism, expected);
  }
});

test('conditions cannot be restated and assessments cannot follow the close', () => {
  const reg = new RehearsalRegister({ clock: () => 0 });
  const run = reg.schedule({ rehearsal: 'incident-escalation', facilitator: 'ORB', participants: ['A'], at: 0 });
  reg.declareConditions(run.id, { announced: false, by: 'ORB' });
  assert.throws(() => reg.declareConditions(run.id, { announced: true, by: 'ORB' }), (e) => e.failClosed === true);
  // A numeric score implies a precision a human judgement does not have.
  assert.throws(() => reg.assess(run.id, { coordinationQuality: 0.9, communicationEffectiveness: 'good', by: 'ORB' }));
  assert.throws(() => reg.recordLesson(run.id, { lesson: 'x', by: 'ORB' }), (e) => e.failClosed === true);
  for (const step of REHEARSALS['incident-escalation'].steps) reg.observe(run.id, { step, at: 1, by: 'A' });
  reg.close(run.id, { by: 'ORB', at: 2 });
  assert.throws(() => reg.assess(run.id, { coordinationQuality: 'good', communicationEffectiveness: 'good', by: 'ORB' }), (e) => e.failClosed === true);
});

test('an unassessed exercise quality is unknown rather than adequate, and maturity cannot skip a level', () => {
  const reg = new RehearsalRegister({ clock: () => 0 });
  assert.strictEqual(reg.exerciseMaturity({ now: 0 }).level, 'E0');
  const run = reg.schedule({ rehearsal: 'incident-escalation', facilitator: 'ORB', participants: ['A'], at: 0 });
  reg.declareConditions(run.id, { announced: false, by: 'ORB' });
  reg.recordLesson(run.id, { lesson: 'the paging list was stale', owner: 'Platform Security Operations', by: 'ORB' });
  for (const step of REHEARSALS['incident-escalation'].steps) reg.observe(run.id, { step, at: 1, by: 'A' });
  reg.close(run.id, { by: 'ORB', at: 2 });
  const intel = reg.exerciseIntelligence(run.id);
  assert.strictEqual(intel.fullyCharacterised, false);
  for (const q of ['coordinationQuality', 'communicationEffectiveness']) {
    assert.strictEqual(intel.qualities.find((x) => x.quality === q).known, false);
  }
  // Realistic and lesson-producing, but never assessed: it stops at E1.
  assert.strictEqual(reg.exerciseMaturity({ now: 0 }).level, 'E1');
});

// --- Part 11: organizational capability maturity ------------------------------------------------

const GREEN_CAPABILITY = {
  governanceMaturity: { level: 5 },
  readiness: { allDimensionsReady: true, readyCount: 10, dimensionCount: 10, dimensions: [{ dimension: 'security', ready: true, status: 'ready' }] },
  resilience: { holds: true, capabilities: [{}], violationCount: 0 },
  compliance: { reconciliation: { sound: true }, complianceRate: 1 },
  legalAuthority: { complete: true, authorized: ['a'], count: 1, declared: ['a'] },
  continuity: { sound: true, minimumBusFactor: 2 },
};

test('a capability domain with no source is unknown rather than level zero', () => {
  const blind = own.capabilityMaturity({});
  assert.strictEqual(blind.organizationalLevel, 'unknown');
  assert.strictEqual(blind.unknown.length, 7);
  for (const d of blind.domains) assert.strictEqual(d.rank, null, d.domain);
  // Level zero is reachable and is a different finding: assessed, and nothing in place.
  const assessed = own.capabilityMaturity({ legalAuthority: { complete: false, authorized: [], count: 5, declared: [] } });
  assert.strictEqual(assessed.organizationalLevel, 'L0');
  assert.strictEqual(assessed.weakestDomain, 'legalReadiness');
});

test('the institution is as capable as its weakest assessed domain', () => {
  const full = own.capabilityMaturity(GREEN_CAPABILITY);
  const weak = own.capabilityMaturity({ ...GREEN_CAPABILITY, resilience: { holds: false, capabilities: [], violationCount: 3 } });
  assert.strictEqual(full.complete, true);
  assert.strictEqual(weak.weakestDomain, 'resilience');
  assert.ok(own.CAPABILITY_LEVELS[weak.organizationalLevel].rank < own.CAPABILITY_LEVELS[full.organizationalLevel].rank);
});

test('a level that fell only because coverage widened says so', () => {
  const one = own.capabilityMaturity({ governanceMaturity: { level: 5 } });
  const wider = own.capabilityMaturity({ governanceMaturity: { level: 5 }, legalAuthority: { complete: false, authorized: [], count: 5, declared: [] } });
  const evolution = own.maturityEvolution([one, wider]);
  assert.strictEqual(evolution.direction, 'regressing');
  assert.ok(evolution.coverageDelta > 0);
  assert.ok(evolution.coverageNote);
  assert.strictEqual(own.maturityEvolution([one]).measurable, false);
});

// --- Part 9: legal dependency intelligence ------------------------------------------------------

const declareAuthority = (reg, capability, instrument, kind = 'legislation', expiresAt = NOW + 10 * YEAR) => reg.declare(capability, {
  kind, instrument, approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 3650, expiresAt,
  evidence: ['APP-FIT-LEGISLATIVE-IMPACT'], scope: 'the capability as declared', declaredBy: 'Legal Informatics Team', at: NOW - DAY,
});

test('each of the five legal defects is detected on its own', () => {
  const probe = (build) => {
    const reg = new la.LegalAuthorityRegistry({ clock: () => NOW });
    build(reg);
    return la.legalDependencyIntelligence(reg, { now: NOW + 30 * DAY });
  };
  assert.ok(probe(() => {}).byDefect['missing-authority'].length > 0);
  assert.ok(probe((r) => declareAuthority(r, 'evidence-custody', 'Act A', 'legislation', NOW + DAY)).byDefect['expired-authority'].includes('evidence-custody'));
  const dup = probe((r) => { declareAuthority(r, 'evidence-custody', 'Act A'); declareAuthority(r, 'evidence-custody', 'Act A'); });
  assert.ok(dup.byDefect['duplicated-authority'].includes('evidence-custody'));
  // A re-declaration of the same instrument is a duplicate, not a supersession.
  assert.ok(!dup.byDefect['superseded-authority'].includes('evidence-custody'));
  assert.ok(probe((r) => { declareAuthority(r, 'evidence-custody', 'Act A'); declareAuthority(r, 'evidence-custody', 'Act B'); })
    .byDefect['superseded-authority'].includes('evidence-custody'));
  assert.ok(probe((r) => { declareAuthority(r, 'evidence-custody', 'Act A', 'constitutional'); declareAuthority(r, 'anonymous-reporting', 'Act A', 'policy'); })
    .byDefect['conflicting-authority'].length > 0);
  assert.ok(probe((r) => { declareAuthority(r, 'evidence-custody', 'Act A', 'constitutional'); declareAuthority(r, 'evidence-custody', 'Act B', 'policy'); })
    .findings.some((f) => f.downgrade));
});

test('a legal impact analysis names what a withdrawal would strand', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => NOW });
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES)) {
    declareAuthority(reg, capability, `Instrument for ${capability}`);
    reg.review(capability, { by: 'Attorney General Chambers', at: NOW });
  }
  assert.strictEqual(la.legalDependencyIntelligence(reg, { now: NOW }).clean, true);
  const impact = la.legalImpact(reg, 'Instrument for evidence-custody', { now: NOW });
  assert.deepStrictEqual(impact.strandedCapabilities, ['evidence-custody']);
  assert.ok(impact.constitutionalCapabilities.includes('evidence-custody'));
  // An uncited instrument has no RECORDED effect, which is not the same as no effect.
  assert.match(la.legalImpact(reg, 'An Act nobody cited', { now: NOW }).impact, /only knows what has been declared to it/);
});

// --- Part 8: cross-government workflow validation -----------------------------------------------

test('an inter-agency workflow nobody has recorded running is unvalidated, never successful', () => {
  const r = ca.workflowValidation({});
  assert.strictEqual(r.count, Object.keys(ir.CRITICAL_CAPABILITIES).length);
  assert.deepStrictEqual(r.validated, []);
  assert.strictEqual(r.unvalidatedCount, r.count);
  assert.strictEqual(r.invalidCount, 0);
  for (const w of r.workflows) {
    assert.strictEqual(w.verdict, 'unvalidated', w.capability);
    assert.strictEqual(w.examined, false, w.capability);
    assert.ok(w.unknownDimensions.includes('workflowCompletion'));
    assert.ok(w.unknownDimensions.includes('legalCompatibility'));
  }
});

test('a consulted but empty activity register moves completion from unknown to examined', () => {
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const w = ca.validateWorkflow('evidence-custody', { activity, now: NOW });
  const completion = w.dimensions.find((d) => d.dimension === 'workflowCompletion');
  assert.strictEqual(completion.examined, true);
  assert.strictEqual(completion.satisfied, false);
  assert.notStrictEqual(completion.state, 'unknown');
});

test('a workflow with a recorded act at every step is complete', () => {
  const activity = new own.ActivityRegister({ clock: () => NOW });
  for (const step of ca.workflowPath('evidence-custody')) {
    activity.recordAct({ person: own.OWNERSHIP[step.context].operationalOwner, act: 'review', subsystem: step.context, at: NOW - DAY });
  }
  const w = ca.validateWorkflow('evidence-custody', { activity, now: NOW });
  assert.strictEqual(w.dimensions.find((d) => d.dimension === 'workflowCompletion').satisfied, true);
});

test('the workflow path is derived from the architecture and starts at the capability', () => {
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES)) {
    const steps = ca.workflowPath(capability);
    assert.ok(steps.length > 0, capability);
    assert.strictEqual(steps[0].context, ir.CRITICAL_CAPABILITIES[capability].contexts[0]);
    for (const s of steps) assert.ok(cm.ids().includes(s.context) && s.institution && s.zone);
  }
  assert.throws(() => ca.workflowPath('a feeling'));
});

// --- Part 6: institutional validation workshops -------------------------------------------------

test('a validation workshop needs objectives, a facilitator and more than one participant', () => {
  const reg = new inst.ValidationWorkshop({ clock: () => 0 });
  const base = { subject: 's', objectives: ['o'], participants: ['A', 'B'], facilitator: 'ORB' };
  assert.throws(() => reg.convene({ ...base, objectives: [] }), (e) => e.failClosed === true);
  assert.throws(() => reg.convene({ ...base, facilitator: undefined }), (e) => e.failClosed === true);
  // One person reviewing their own work is a review, not a validation.
  assert.throws(() => reg.convene({ ...base, participants: ['A'] }), (e) => e.failClosed === true);
});

test('closing a workshop does not close its unresolved issues', () => {
  const reg = new inst.ValidationWorkshop({ clock: () => 0 });
  const w = reg.convene({ subject: 'cross-agency readiness', objectives: ['confirm the chain', 'agree who calls whom'], participants: ['A', 'B'], facilitator: 'ORB', at: 0 });
  assert.throws(() => reg.record(w.id, { outcome: 'corrective-action', detail: 'fix it', dueAt: 100 }), (e) => e.failClosed === true);
  assert.throws(() => reg.record(w.id, { outcome: 'corrective-action', detail: 'fix it', owner: 'OBS' }), (e) => e.failClosed === true);
  reg.record(w.id, { outcome: 'finding', detail: 'the ISRB cluster shares no forum', objective: 'confirm the chain' });
  reg.record(w.id, { outcome: 'unresolved-issue', detail: 'nobody could say who chairs a joint incident' });
  reg.record(w.id, { outcome: 'corrective-action', detail: 'add the ISRB to the OB agenda', owner: 'Oversight Board Secretariat', dueAt: 100 });
  reg.close(w.id, { by: 'ORB', at: 10 });
  const row = reg.report({ now: 200 }).workshops[0];
  assert.strictEqual(row.finished, false);
  assert.strictEqual(row.unresolvedIssues.length, 1);
  assert.strictEqual(row.overdueActions.length, 1);
  assert.deepStrictEqual(row.objectivesUnaddressed, ['agree who calls whom']);
  // The follow-up must be by somebody other than the facilitator.
  assert.throws(() => reg.followUp(w.id, { reviewedBy: 'ORB' }), (e) => e.failClosed === true);
  reg.followUp(w.id, { reviewedBy: 'Auditor General', resolvedIndexes: [1, 2], at: 210 });
  const after = reg.report({ now: 300 });
  assert.strictEqual(after.finished, 1);
  assert.strictEqual(after.unresolvedIssueCount, 0);
});

// --- Part 12: continuous architecture validation ------------------------------------------------

test('a baseline nobody approved is a snapshot, and no baseline means unknown', () => {
  const b = new dp.ArchitectureBaseline({ clock: () => 0 });
  assert.throws(() => b.record({ version: 'v1.7', contexts: 30, modules: 100, recordedBy: 'ARB' }), (e) => e.failClosed === true);
  const asm = require('../src/architecture/assumptions');
  const assumptions = new asm.AssumptionRegistry({ clock: () => 0 });
  asm.seedPlatformAssumptions(assumptions, { at: 0 });
  const noBaseline = dp.continuousArchitectureValidation({ controls: controlsAll(), assumptions, now: 0 });
  assert.strictEqual(noBaseline.evolution.known, false);
  assert.strictEqual(noBaseline.undocumentedEvolution, null);
});

test('undocumented architectural evolution is rejected rather than reported', () => {
  const asm = require('../src/architecture/assumptions');
  const assumptions = new asm.AssumptionRegistry({ clock: () => 0 });
  asm.seedPlatformAssumptions(assumptions, { at: 0 });
  const controls = controlsAll();
  const matching = new dp.ArchitectureBaseline({ clock: () => 0 });
  matching.record({ version: 'v1.7', contexts: cm.ids().length, modules: cm.sourceModules().length, adr: 'ADR-0004', recordedBy: 'ARB' });
  const ok = dp.continuousArchitectureValidation({ controls, assumptions, baseline: matching, now: 0 });
  assert.strictEqual(ok.undocumentedEvolution, false);
  assert.strictEqual(dp.assertNoUndocumentedEvolution(ok), true);

  const stale = new dp.ArchitectureBaseline({ clock: () => 0 });
  stale.record({ version: 'v1.6', contexts: cm.ids().length - 2, modules: cm.sourceModules().length, adr: 'ADR-0004', recordedBy: 'ARB' });
  const drifted = dp.continuousArchitectureValidation({ controls, assumptions, baseline: stale, now: 0 });
  assert.strictEqual(drifted.undocumentedEvolution, true);
  assert.throws(() => dp.assertNoUndocumentedEvolution(drifted), (e) => e.failClosed === true);
  assert.throws(() => dp.assertNoUndocumentedEvolution({ blocking: ['ownershipConsistency'], undocumentedEvolution: false }), (e) => e.failClosed === true);
});

// --- Part 14: institutional performance ---------------------------------------------------------

test('a supplied performance figure produces unmeasured, never the figure', () => {
  const injected = inst.institutionalPerformance({ legalReadiness: 0.99, documentationQuality: 1, governanceEfficiency: 1 });
  assert.deepStrictEqual(injected.measured, []);
  assert.strictEqual(injected.everyIndicatorDerived, true);
  for (const i of injected.indicators) assert.strictEqual(i.manualEntry, false, i.indicator);
  assert.strictEqual(injected.authorizationStatus, 'NOT AUTHORIZED');
});

test('every performance indicator can fail on its own', () => {
  const green = {
    optimization: { load: { approvalLoad: [{ overCapacity: false }] }, overCapacityAuthorities: [] },
    controlPerformance: { measurable: true, meanDetectionRate: 0.95, degrading: [], basis: 'b' },
    capabilityMaturity: { organizationalLevel: 'L3', complete: true, basis: 'b' },
    legalAuthority: { authorized: ['a'], count: 1, complete: true, completenessBasis: 'b' },
    documentation: { sound: true, verification: { claims: 247, unresolvedCount: 0 } },
    resilience: { holds: true, capabilities: [{ categoriesValidated: true }], violationCount: 0 },
    // Phase 17, Part 13 added two indicators to this dashboard. A "green" fixture that does not
    // source them is no longer green: an unsourced indicator is unmeasured, and unmeasured is not
    // performing.
    evidenceQuality: { count: 12, quality: 0.9, sound: true, threshold: 0.7, belowThreshold: [] },
    workflowIntelligence: { coordinationQuality: 0.9, compoundingSteps: [], coordinationBasis: 'b' },
  };
  assert.strictEqual(inst.institutionalPerformance(green).performing, true);
  for (const [indicator, broken] of [
    ['governanceEfficiency', { optimization: { load: { approvalLoad: [{ overCapacity: true }] }, overCapacityAuthorities: ['OB'] } }],
    ['operationalEffectiveness', { controlPerformance: { measurable: true, meanDetectionRate: 0.3, degrading: ['X'], basis: 'b' } }],
    ['organizationalMaturity', { capabilityMaturity: { organizationalLevel: 'L1', complete: false, basis: 'b' } }],
    ['legalReadiness', { legalAuthority: { authorized: [], count: 5, complete: false, completenessBasis: 'b' } }],
    ['documentationQuality', { documentation: { sound: false, verification: { claims: 247, unresolvedCount: 9 } } }],
    ['institutionalResilience', { resilience: { holds: false, capabilities: [{ categoriesValidated: false }], violationCount: 3 } }],
    ['evidenceQuality', { evidenceQuality: { count: 12, quality: 0.2, sound: false, threshold: 0.7, belowThreshold: [{ evidence: 'x' }] } }],
    ['collaborationMaturity', { workflowIntelligence: { coordinationQuality: 0.4, compoundingSteps: [{ context: 'case-management' }], coordinationBasis: 'b' } }],
  ]) {
    const r = inst.institutionalPerformance({ ...green, ...broken });
    assert.ok(r.underperforming.includes(indicator), indicator);
    assert.strictEqual(r.performing, false, indicator);
  }
});

// --- Part 15: production transition -------------------------------------------------------------

test('the production transition framework plans and never executes', () => {
  for (const forbidden of ['execute', 'cutover', 'promote', 'deploy', 'goLive']) {
    assert.strictEqual(typeof migration[forbidden], 'undefined', forbidden);
  }
  assert.ok(!Object.values(migration.TRANSITION_STATES).some((s) => s.ready));
  const plan = migration.productionTransitionPlan({ fitnessResults: [{ id: 'A', pass: true }] });
  assert.strictEqual(plan.count, 8);
  assert.strictEqual(plan.anyTrackReady, false);
  assert.strictEqual(plan.deploymentPermitted, false);
  assert.strictEqual(plan.executes, false);
  assert.strictEqual(plan.authorizationStatus, 'NOT AUTHORIZED');
  const institutions = new Set(own.subsystems().flatMap((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority]));
  for (const d of plan.humanDecisions) assert.ok(institutions.has(d.owner), d.owner);
});

// --- The Phase 16 global invariant --------------------------------------------------------------

const TRACED = {
  explainability: { everyValueExplainable: true, explainable: ['a'], count: 1, weakestHop: { hop: 'evidence' } },
  traceability: { everyConclusionTraceable: true, basis: 'b' },
  decisions: { everyPackageAdvisory: true, count: 1, packages: [{ supportingEvidence: ['x'], affectedControls: ['y'] }] },
  calibration: { measurable: true, basis: 'b' },
  decisionMemory: { unevaluated: [] },
  areas: Object.fromEntries(Object.keys(inst.TRACEABILITY_AREAS).map((a) => [a, true])),
};

test('the traceability invariant covers five subjects across ten areas and blocks when unheld', () => {
  assert.strictEqual(Object.keys(inst.TRACEABILITY_SUBJECTS).length, 5);
  assert.strictEqual(Object.keys(inst.TRACEABILITY_AREAS).length, 10);
  const blind = inst.evaluateTraceabilityInvariant({});
  assert.strictEqual(blind.holds, false);
  assert.strictEqual(blind.blocksInstitutionalReadiness, true);
  assert.strictEqual(blind.violationCount, 15);
  // Nobody looked is counted apart from we looked and it does not trace.
  assert.strictEqual(blind.unknownViolations, 15);
  assert.strictEqual(blind.tracedViolations, 0);
});

test('every traceability subject can be traced and can fail on its own', () => {
  assert.strictEqual(inst.evaluateTraceabilityInvariant(TRACED).holds, true);
  for (const [subject, broken] of [
    ['executive-conclusion', { explainability: { everyValueExplainable: false, explainable: [], count: 22, weakestHop: { hop: 'executive-metric' } } }],
    ['readiness-assessment', { traceability: { everyConclusionTraceable: false, basis: 'b' } }],
    ['governance-recommendation', { decisions: { everyPackageAdvisory: true, count: 1, packages: [{ supportingEvidence: [], affectedControls: [] }] } }],
    ['institutional-forecast', { calibration: { measurable: false, basis: 'b' } }],
    ['operational-decision', { decisionMemory: { unevaluated: ['DEC-0001'] } }],
  ]) {
    const r = inst.evaluateTraceabilityInvariant({ ...TRACED, ...broken });
    assert.strictEqual(r.holds, false, subject);
    const row = r.subjects.find((s) => s.subject === subject);
    assert.strictEqual(row.holds, false, subject);
    // Examined and failing, not unknown: somebody looked.
    assert.strictEqual(row.unknown, false, subject);
  }
});

test('an untraceable conclusion is accepted only by a named authority, with a rationale and an expiry', () => {
  const acceptances = new ir.ResilienceAcceptance({ clock: () => 0 });
  assert.throws(() => acceptances.acceptTraceability({ by: 'OB', rationale: 'r', expiresAt: DAY }));
  assert.throws(() => acceptances.acceptTraceability({ subject: 'executive-conclusion', rationale: 'r', expiresAt: DAY }), (e) => e.failClosed === true);
  assert.throws(() => acceptances.acceptTraceability({ subject: 'executive-conclusion', by: 'OB', rationale: 'r' }), (e) => e.failClosed === true);
  acceptances.acceptTraceability({ subject: 'executive-conclusion', by: 'Oversight Board', rationale: 'the dashboard is unmeasured on a fresh platform', expiresAt: 30 * DAY });
  const now = inst.traceabilityInvariantReport({ acceptances, now: 0 });
  assert.ok(now.accepted.some((a) => a.subject === 'executive-conclusion'));
  assert.strictEqual(now.blocksInstitutionalReadiness, true);
  // The acceptance expires on its own, with nobody withdrawing anything.
  const later = inst.traceabilityInvariantReport({ acceptances, now: 60 * DAY });
  assert.strictEqual(later.accepted.length, 0);
  assert.strictEqual(later.expiredAcceptances.length, 1);
});
