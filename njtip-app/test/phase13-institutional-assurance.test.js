'use strict';
// Phase 13, Parts 15, 18, 19 & 20 — executive governance intelligence, operational intelligence,
// continuous improvement, and the institutional assurance framework.
const test = require('node:test');
const assert = require('node:assert');
const inst = require('../src/assurance/institutional');
const bus = require('../src/observability/business');

const GREEN_SOURCES = {
  resilience: { holds: true, violationCount: 0 },
  governanceMaturity: { level: 5, name: 'Continuously assured' },
  readiness: { readyCount: 10, dimensionCount: 10, allDimensionsReady: true },
  mission: { safeToDeploy: true, boardSummary: 'no declared justice service is affected' },
  documentation: { sound: true, verification: { claims: 132, unresolvedCount: 0 } },
  continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: [] },
  compliance: { complianceRate: 1, direction: 'improving', recentDirection: 'improving', reconciliation: { sound: true } },
  training: { sound: true, readinessContribution: 1, expiredQualifications: [] },
  simulation: { confidence: 'high', uncalibrated: [] },
  assumptions: { count: 9, sound: true, stale: [], overclaims: [] },
  // Phase 14, Part 19 added five strategic panels; Part 20 added five assurance domains.
  regulatory: { count: 2, ready: true, readinessBasis: '2 forecast change(s) modelled' },
  adaptive: { constrained: ['auditReadiness'], unconstrained: [], forecasts: [1, 2, 3, 4, 5, 6] },
  capacity: { measured: ['staffing'], complete: true, shortfallCount: 0, unmeasurable: [] },
  decisions: { evaluationRate: 1, contradicted: [], unevaluated: [] },
  publicTrust: { composite: 'warranted', basis: 'every measured condition holds' },
  learning: { learningRate: 1, measurable: true, correctedNotLearned: [] },
  optimization: { findingCount: 0, bottleneckAuthorities: [], overCapacityAuthorities: [] },
  // Phase 15, Part 15 added seven institutional-health panels; Part 20 added three domains.
  legalAuthority: { count: 5, complete: true, blocking: [], completenessBasis: '5 of 5 critical capabilities have a reviewed legal authority' },
  assumptionMaturity: { organizationalMaturity: 'A4', belowMinimum: [], verificationBacklog: [], maturityBasis: 'every assumption is at or above the maturity its criticality requires' },
  controlEffectiveness: { effectivenessRate: 1, measurable: true, ineffective: [], effectivenessBasis: 'every observed control is effective' },
  dependencyIntelligence: { count: 5, open: 0, weakestType: { type: 'organizational' } },
  sustainability: { sustainable: true },
};

// --- Part 15: executive governance intelligence ----------------------------------------------------

test('every executive panel states its question and where it is derived from', () => {
  for (const [id, p] of Object.entries(inst.EXECUTIVE_PANELS)) {
    assert.ok(p.question && p.question.endsWith('?'), id);
    assert.ok(p.derivedFrom, id);
  }
  assert.strictEqual(Object.keys(inst.EXECUTIVE_PANELS).length, 22);
});

test('an unmeasured panel is unmeasured, never satisfied', () => {
  const d = inst.executiveGovernanceIntelligence({});
  assert.strictEqual(d.sound, false);
  assert.strictEqual(d.unmeasured.length, Object.keys(inst.EXECUTIVE_PANELS).length);
  for (const p of d.panels) {
    assert.strictEqual(p.measured, false, p.panel);
    assert.strictEqual(p.sound, null, p.panel);
  }
});

test('there is no path that accepts a hand-entered executive metric', () => {
  const injected = inst.executiveGovernanceIntelligence({ institutionalResilience: 1, governanceMaturity: 5 });
  assert.strictEqual(injected.panels.find((p) => p.panel === 'institutionalResilience').measured, false);
  for (const p of injected.panels) assert.strictEqual(p.manualEntry, false);
  assert.strictEqual(injected.everyMetricDerived, true);
});

test('a fully evidenced dashboard is sound and still prints NOT AUTHORIZED', () => {
  const d = inst.executiveGovernanceIntelligence(GREEN_SOURCES);
  assert.strictEqual(d.sound, true, d.unsound.join(', '));
  assert.deepStrictEqual(d.unmeasured, []);
  assert.strictEqual(d.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(d.authorizes, false);
});

test('a failing source turns its panel red rather than being averaged away', () => {
  const d = inst.executiveGovernanceIntelligence({ ...GREEN_SOURCES, resilience: { holds: false, violationCount: 3 } });
  assert.strictEqual(d.sound, false);
  assert.ok(d.unsound.includes('institutionalResilience'));
  assert.match(d.panels.find((p) => p.panel === 'institutionalResilience').detail, /3 capability/);
});

// --- Part 19: continuous improvement ----------------------------------------------------------------

test('an improvement starts from a control that actually failed', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  assert.throws(() => loop.observe({ detail: 'something', observedBy: 'CI' }), /starts from the control that failed/);
  assert.throws(() => loop.observe({ control: 'APP-FIT-X', observedBy: 'CI' }), /must record what was observed/);
  assert.throws(() => loop.observe({ control: 'APP-FIT-X', detail: 'failed' }), (e) => e.failClosed === true);
});

test('the loop cannot skip a stage', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-X', detail: 'failed', observedBy: 'CI' });
  assert.throws(() => loop.advance(i.id, 'verified', { by: 'A', detail: 'd' }), (e) => e.failClosed === true);
  assert.throws(() => loop.advance(i.id, 'imagined', { by: 'A', detail: 'd' }), /unknown improvement stage/);
  assert.throws(() => loop.advance(i.id, 'root-caused', { by: 'A' }), (e) => e.failClosed === true);
});

test('a corrective action that changes the architecture requires an ADR', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-X', detail: 'failed', observedBy: 'CI' });
  loop.advance(i.id, 'root-caused', { by: 'Eng', detail: 'cause' });
  loop.advance(i.id, 'action-agreed', { by: 'ARB', detail: 'plan' });
  assert.throws(() => loop.advance(i.id, 'decided', { by: 'ARB', detail: 'agreed' }), /requires an ADR/);
  assert.ok(loop.advance(i.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005' }));
});

test('verification is the control that failed now passing, and nothing else', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-X', detail: 'failed', observedBy: 'CI' });
  loop.advance(i.id, 'root-caused', { by: 'Eng', detail: 'cause' });
  loop.advance(i.id, 'action-agreed', { by: 'ARB', detail: 'plan' });
  loop.advance(i.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005' });
  assert.throws(() => loop.advance(i.id, 'verified', { by: 'CI', detail: 'fixed', controls: [{ id: 'APP-FIT-X', pass: false }] }), /is not passing/);
  assert.throws(() => loop.advance(i.id, 'verified', { by: 'CI', detail: 'fixed', controls: [{ id: 'APP-FIT-OTHER', pass: true }] }), (e) => e.failClosed === true);
  assert.ok(loop.advance(i.id, 'verified', { by: 'CI', detail: 'holds', controls: [{ id: 'APP-FIT-X', pass: true }] }));
  loop.advance(i.id, 'outcome-recorded', { by: 'ARB', detail: 'held across a quarter' });
  const h = loop.history({});
  assert.strictEqual(h.closureRate, 1);
  assert.strictEqual(h.closed, 1);
  assert.strictEqual(h.authorizes, false);
});

test('an improvement stalled before verification is named', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-Y', detail: 'failed', observedBy: 'CI' });
  loop.advance(i.id, 'root-caused', { by: 'A', detail: 'cause' });
  const h = loop.history({});
  assert.strictEqual(h.closureRate, 0);
  assert.deepStrictEqual(h.stalled, [{ id: i.id, at: 'root-caused' }]);
  assert.match(h.note, /a fix nobody checked/);
});

// --- Part 18: operational intelligence --------------------------------------------------------------

test('an unmeasured layer breaks the correlation rather than being skipped', () => {
  const none = bus.operationalIntelligence({});
  assert.strictEqual(none.correlationValid, false);
  assert.strictEqual(none.chainComplete, false);
  // Phase 14, Part 9: eight chain layers plus the cross-cutting governance-performance layer.
  assert.strictEqual(none.unmeasured.length, bus.OPERATIONAL_LAYERS.length + bus.CROSS_CUTTING_LAYERS.length);
  assert.match(none.note, /correlation between one thing and an assumption/);
  // The gap itself produces a recommendation.
  assert.ok(none.recommendations.some((r) => r.from === 'coverage'));
});

test('a fully measured chain carries a conclusion and recommends action', () => {
  const full = bus.operationalIntelligence({
    infrastructure: { degraded: ['kms'] }, applicationBehaviour: {},
    businessMetrics: { backlog: 12 }, missionOutcomes: { custodyIntact: true },
    governance: { overdueReviews: ['intake'], unattributedDecisions: [] },
    institutionalOutcomes: { mandatesDeliverable: true },
  });
  assert.strictEqual(full.chainComplete, true);
  assert.strictEqual(full.correlationValid, true);
  assert.ok(full.recommendations.length >= 3);
  for (const r of full.recommendations) {
    assert.ok(r.from, 'a recommendation does not say where it came from');
    assert.ok(r.falsifiedBy, 'a recommendation nobody can argue with is an instruction');
    assert.ok(r.urgency);
  }
  assert.strictEqual(full.authorizes, false);
});

test('the operational layers are declared in order, with governance-performance cross-cutting', () => {
  // Phase 14, Part 9 extended the correlation to public trust. `governance-performance` moved out of
  // the chain and into `CROSS_CUTTING_LAYERS`, because it is not downstream of public trust — it
  // bears on every layer, and modelling it as a link put it in an order that was simply false. It is
  // still required for the correlation to be complete.
  assert.deepStrictEqual(bus.OPERATIONAL_LAYERS, [
    'infrastructure', 'application-behaviour', 'business-process', 'mission-outcome',
    'citizen-experience', 'institutional-outcome', 'government-objective', 'public-trust',
  ]);
  assert.deepStrictEqual(bus.CROSS_CUTTING_LAYERS, ['governance-performance']);
});

// --- Part 20: the institutional assurance framework ------------------------------------------------

test('all twenty-one domains are declared, each saying what unverified would mean', () => {
  assert.strictEqual(Object.keys(inst.ASSURANCE_DOMAINS).length, 21);
  for (const [id, d] of Object.entries(inst.ASSURANCE_DOMAINS)) {
    assert.ok(d.unverifiedMeans && d.unverifiedMeans.length > 30, id);
  }
});

test('an unmeasured domain is reported as unmeasured, never as verified', () => {
  const a = inst.institutionalAssurance({});
  assert.strictEqual(a.institutionallyReady, false);
  assert.strictEqual(a.unmeasured.length, 21);
  assert.strictEqual(a.verified, 0);
  assert.ok(a.domains.every((d) => d.state === 'unmeasured'));
  for (const b of a.blockers) assert.match(b, /unmeasured|failing/);
});

test('failing and unmeasured are different states', () => {
  const a = inst.institutionalAssurance({ ...GREEN_SOURCES, drift: { clean: false }, security: true, privacy: true, evidenceQuality: { sound: true } });
  assert.ok(a.failing.includes('architecture'));
  assert.ok(!a.unmeasured.includes('architecture'));
  assert.strictEqual(a.domains.find((d) => d.domain === 'architecture').state, 'failing');
});

test('a fully verified estate is institutionally ready and still NOT AUTHORIZED', () => {
  const a = inst.institutionalAssurance({
    drift: { clean: true }, security: true, privacy: true,
    governanceMaturity: { level: 5 }, documentation: { sound: true },
    readiness: { allDimensionsReady: true }, continuity: { sound: true, minimumBusFactor: 2 },
    resilience: { holds: true, capabilities: [{ categoriesValidated: true }] }, training: { sound: true },
    compliance: { reconciliation: { sound: true } }, mission: { safeToDeploy: true },
    evidenceQuality: { sound: true },
    regulatory: { ready: true }, learning: { learningRate: 1, correctedNotLearned: [] },
    optimization: { bottleneckAuthorities: [], overCapacityAuthorities: [] },
    publicTrust: { composite: 'warranted' },
    // Phase 15: legal authority, control effectiveness and sustainability.
    legalAuthority: { complete: true }, controlEffectiveness: { measurable: true, ineffective: [] },
    sustainability: { sustainable: true },
  });
  assert.strictEqual(a.institutionallyReady, true, a.blockers.join('; '));
  assert.strictEqual(a.verified, 21);
  // The invariant that has survived every phase.
  assert.strictEqual(a.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(a.authorizes, false);
  assert.strictEqual(a.derivedFromReadiness, false);
  assert.strictEqual(a.failClosed, true);
  assert.match(a.note, /does not replace human authority/);
});
