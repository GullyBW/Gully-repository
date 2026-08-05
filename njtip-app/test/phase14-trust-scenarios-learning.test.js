'use strict';
// Phase 14, Parts 9, 12 & 18 — the extended operational chain and public trust indicators, strategic
// scenario planning, and the institutional learning framework.
const test = require('node:test');
const assert = require('node:assert');
const bus = require('../src/observability/business');
const twinMod = require('../src/twin2/operations-twin');
const asm = require('../src/architecture/assumptions');
const inst = require('../src/assurance/institutional');
const own = require('../src/governance/ownership');

const DAY = 24 * 3600_000;
const GREEN = {
  infrastructure: { degraded: [] }, applicationBehaviour: {}, businessMetrics: { backlog: 0 },
  missionOutcomes: { custodyIntact: true }, governance: { overdueReviews: [], unattributedDecisions: [] },
  institutionalOutcomes: { mandatesDeliverable: true },
};

// --- Part 9: the extended chain and public trust ---------------------------------------------------

test('the correlation chain reaches public trust, and governance performance is cross-cutting', () => {
  assert.deepStrictEqual(bus.OPERATIONAL_LAYERS, [
    'infrastructure', 'application-behaviour', 'business-process', 'mission-outcome',
    'citizen-experience', 'institutional-outcome', 'government-objective', 'public-trust',
  ]);
  // Not a link in the chain: governance performance is not downstream of public trust.
  assert.deepStrictEqual(bus.CROSS_CUTTING_LAYERS, ['governance-performance']);
  const layers = bus.operationalIntelligence(GREEN).layers;
  assert.strictEqual(layers.find((l) => l.layer === 'governance-performance').crossCutting, true);
});

test('the platform never claims to measure public trust', () => {
  const t = bus.publicTrustIndicators(GREEN);
  assert.strictEqual(t.measuresTrust, false);
  for (const i of t.indicators) {
    assert.strictEqual(i.measuresTrust, false, i.indicator);
    assert.strictEqual(i.derived, true, i.indicator);
  }
  assert.match(t.whatWouldMeasureIt, /decided not to/);
  // A word, never a score.
  assert.strictEqual(typeof t.composite, 'string');
  // Even at its best it does not tell citizens how to feel.
  assert.match(t.basis, /may still not trust/);
});

test('every trust indicator says why it bears on trust', () => {
  assert.ok(Object.keys(bus.TRUST_INDICATORS).length >= 4);
  for (const [id, i] of Object.entries(bus.TRUST_INDICATORS)) {
    assert.ok(i.question.endsWith('?'), id);
    assert.ok(i.derivedFrom, id);
    assert.ok(i.whyItBearsOnTrust.length > 30, id);
    assert.ok(i.ifAbsent, id);
  }
});

test('an unmeasured indicator makes the composite unknown, never favourable', () => {
  const partial = bus.publicTrustIndicators({ infrastructure: { degraded: [] }, businessMetrics: { backlog: 0 } });
  assert.strictEqual(partial.composite, 'unknown');
  assert.strictEqual(partial.assessable, false);
  assert.ok(partial.unmeasured.length);
  assert.match(partial.basis, /A partial picture .* is not a favourable one/);
  assert.strictEqual(bus.publicTrustIndicators({}).composite, 'unknown');
});

test('all three composite states are reachable', () => {
  assert.strictEqual(bus.publicTrustIndicators(GREEN).composite, 'warranted');
  assert.strictEqual(bus.publicTrustIndicators({}).composite, 'unknown');
  const bad = bus.publicTrustIndicators({
    infrastructure: { degraded: ['intake-api'] }, businessMetrics: { backlog: 40 },
    missionOutcomes: { custodyIntact: false }, governance: { unattributedDecisions: ['d1'] },
    institutionalOutcomes: { mandatesDeliverable: false },
  });
  assert.strictEqual(bad.composite, 'not-warranted');
  assert.strictEqual(bad.declining.length, Object.keys(bus.TRUST_INDICATORS).length);
  assert.match(bad.basis, /conditions, not about opinion/);
});

test('a declining trust indicator produces a falsifiable recommendation', () => {
  const r = bus.operationalIntelligence({ ...GREEN, missionOutcomes: { custodyIntact: false } });
  const rec = r.recommendations.find((x) => x.from === 'public-trust');
  assert.ok(rec, 'no public-trust recommendation');
  assert.ok(rec.falsifiedBy);
  assert.strictEqual(r.authorizes, false);
});

// --- Part 12: strategic scenario planning ----------------------------------------------------------

const STRATEGIC = ['policy-reform', 'legislative-change', 'funding-reduction', 'organizational-restructuring', 'staffing-growth', 'cross-government-collaboration', 'emergency-operations'];
const controlsAll = () => require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true }));
function strategicTwin() {
  const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  return new twinMod.OperationsTwin({ evidenceIds: controlsAll().map((c) => c.id), assumptions: registry, clock: () => 0 });
}

test('all seven strategic scenarios are modelled with the metadata every scenario needs', () => {
  for (const s of STRATEGIC) {
    const spec = twinMod.SCENARIOS[s];
    assert.ok(spec, s);
    assert.strictEqual(twinMod.assertDeclaredMetadata(s, spec), true, s);
    assert.ok(twinMod.ENTITY_KINDS[spec.perturbs], `${s} perturbs ${spec.perturbs}`);
  }
});

test('a policy reform drags in the contexts that depend on a weakened guarantee', () => {
  const twin = strategicTwin();
  const r = twin.simulate({ scenario: 'policy-reform', change: { reforms: { analytics: 'eventual' }, adr: 'ADR-0007' }, now: 0, controls: controlsAll() });
  assert.ok(r.blocking.some((f) => /inherit a weaker guarantee/.test(f.finding)));
  // …and a reform with no ADR is blocked for that reason alone.
  const noAdr = twin.simulate({ scenario: 'policy-reform', change: { reforms: { analytics: 'eventual' } }, now: 0, controls: controlsAll() });
  assert.ok(noAdr.blocking.some((f) => /cites no ADR/.test(f.finding)));
});

test('a legislative change reports reach wider than the instrument names', () => {
  const twin = strategicTwin();
  const r = twin.simulate({ scenario: 'legislative-change', change: { affects: ['investigation'], requiresControls: ['APP-FIT-DOES-NOT-EXIST'] }, now: 0, controls: controlsAll() });
  assert.ok(r.blocking.some((f) => /requires a control that does not exist/.test(f.finding)));
  assert.ok(r.findings.some((f) => /reach is wider than the instrument states/.test(f.finding)));
  const ok = twin.simulate({ scenario: 'legislative-change', change: { affects: ['investigation'], requiresControls: ['APP-FIT-CONTEXT-MAP'] }, now: 0, controls: controlsAll() });
  assert.strictEqual(ok.safe, true);
});

test('a merger that destroys separation of duties is blocked', () => {
  const twin = strategicTwin();
  const r = twin.simulate({ scenario: 'organizational-restructuring', change: { merge: [['Oversight Board', 'Oversight Board Secretariat']] }, now: 0, controls: controlsAll() });
  assert.ok(r.blocking.some((f) => /separation of duties is lost/.test(f.finding)));
  assert.strictEqual(twin.simulate({ scenario: 'organizational-restructuring', change: { merge: [] }, now: 0, controls: controlsAll() }).safe, true);
});

test('headcount does not close a single-person dependency', () => {
  const twin = strategicTwin();
  const NOW = 400 * DAY;
  const continuity = own.knowledgeContinuity({
    availability: new own.AvailabilityRegister({ clock: () => NOW }),
    activity: new own.ActivityRegister({ clock: () => NOW }),
    training: new own.TrainingRegister({ clock: () => NOW }),
    exercises: new own.ExerciseRegister({ clock: () => NOW }),
    now: NOW,
  });
  const grown = twin.simulate({ scenario: 'staffing-growth', change: { additionalAuthorities: 20, continuity }, now: 0, controls: controlsAll() });
  const spof = grown.findings.find((f) => f.entity === 'single-person-dependencies');
  assert.match(spof.finding, /before growth, and \d+ after it/);
  assert.match(spof.finding, /a name, not an alternative/);
  // With nothing to assess it says unknown rather than nothing.
  const blind = twin.simulate({ scenario: 'staffing-growth', change: { additionalAuthorities: 20 }, now: 0, controls: controlsAll() });
  assert.match(blind.findings.find((f) => f.entity === 'single-person-dependencies').finding, /UNKNOWN/);
});

test('a collaboration that crosses a zone boundary is refused, and the record answers the zone question', () => {
  const twin = strategicTwin();
  const run = (change) => twin.simulate({ scenario: 'cross-government-collaboration', change, now: 0, controls: controlsAll() });

  // Phase 15, Part 6 closed the ADR-0009 debt: the context map now declares zone governance, so the
  // proposal no longer supplies it and cannot answer the question for itself.
  assert.ok(run({ partners: ['AG'], sharing: ['custody', 'investigation'] }).blocking.some((f) => /constitutional invariant/.test(f.finding)));
  // A context whose declared constraint is 'no-sharing' cannot be shared by agreement.
  assert.ok(run({ partners: ['AG'], sharing: ['intake'] }).blocking.some((f) => /no-sharing/.test(f.finding)));
  // A proposal that disagrees with the architecture-of-record blocks rather than overriding it.
  assert.ok(run({ partners: ['AG'], sharing: ['custody'], zones: { custody: 'executive' } }).blocking.some((f) => /working from the wrong picture/.test(f.finding)));
  // Within one zone, under a governed-sharing constraint, it passes — so the check is satisfiable.
  const ok = run({ partners: ['AG'], sharing: ['custody'] });
  assert.strictEqual(ok.safe, true);
  assert.ok(ok.findings.some((f) => /does not cross a zone boundary/.test(f.finding)));
});

test('an emergency runs out of people before it runs out of systems', () => {
  const twin = strategicTwin();
  const surge = twin.simulate({ scenario: 'emergency-operations', change: { failed: ['intake-api'], surgeMultiplier: 50 }, now: 0, controls: controlsAll() });
  assert.ok(surge.blocking.some((f) => /wait for a person rather than for a system/.test(f.finding)));
  assert.ok(surge.blocking.some((f) => /constitutional service/.test(f.finding)));
  assert.strictEqual(twin.simulate({ scenario: 'emergency-operations', change: { failed: ['analytics'], surgeMultiplier: 1 }, now: 0, controls: controlsAll() }).safe, true);
});

test('strategic simulations are deterministic and never touch the baseline', () => {
  const twin = strategicTwin();
  for (const s of STRATEGIC) {
    const r = twin.simulate({ scenario: s, change: {}, now: 0, controls: controlsAll() });
    assert.strictEqual(r.isolation.unchanged, true, s);
    assert.strictEqual(r.authorizes, false, s);
    assert.strictEqual(Object.keys(r.confidenceDimensions).length, 6, s);
  }
  const a = twin.simulate({ scenario: 'funding-reduction', change: { reduceBy: 0.4 }, now: 0, controls: controlsAll() });
  const b = twin.simulate({ scenario: 'funding-reduction', change: { reduceBy: 0.4 }, now: 0, controls: controlsAll() });
  assert.deepStrictEqual(a.findings, b.findings);
});

// --- Part 18: institutional learning ---------------------------------------------------------------

function closedLoop() {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-X', detail: 'a control failed', observedBy: 'CI', at: 10 * DAY });
  loop.advance(i.id, 'root-caused', { by: 'Eng', detail: 'the cause', at: 11 * DAY });
  loop.advance(i.id, 'action-agreed', { by: 'ARB', detail: 'the plan', at: 12 * DAY });
  loop.advance(i.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005', at: 13 * DAY });
  loop.advance(i.id, 'verified', { by: 'CI', detail: 'holds', controls: [{ id: 'APP-FIT-X', pass: true }], at: 14 * DAY });
  return { loop, id: i.id };
}
const COURSE = Object.values(own.REQUIRED_TRAINING)[0][0];
const EXERCISE = Object.keys(own.EXERCISE_KINDS)[0];

test('the learning chain is declared, each stage saying what its absence means', () => {
  // Phase 15, Part 12 added the tenth stage: readiness-improvement.
  assert.strictEqual(Object.keys(inst.LEARNING_STAGES).length, 10);
  assert.ok(inst.LEARNING_STAGES['readiness-improvement']);
  for (const required of ['incident', 'investigation', 'root-cause', 'corrective-action', 'verification', 'governance-update', 'adr', 'training', 'future-readiness']) {
    assert.ok(inst.LEARNING_STAGES[required], required);
  }
  for (const [id, s] of Object.entries(inst.LEARNING_STAGES)) {
    assert.ok(s.evidencedBy, id);
    assert.ok(s.meansIfAbsent, id);
  }
});

test('with no register, whether the institution learns is unknown — not zero', () => {
  const b = inst.institutionalLearning({});
  assert.strictEqual(b.learningRate, null);
  assert.strictEqual(b.measurable, false);
  assert.match(b.note, /UNKNOWN/);
});

test('a fixed incident with nobody trained is corrected, not learned', () => {
  const { loop, id } = closedLoop();
  const r = inst.institutionalLearning({
    loop, training: new own.TrainingRegister({ clock: () => 0 }), exercises: new own.ExerciseRegister({ clock: () => 0 }),
    controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY,
  });
  assert.strictEqual(r.correctionRate, 1);
  assert.strictEqual(r.learningRate, 0);
  assert.deepStrictEqual(r.correctedNotLearned, [id]);
  assert.strictEqual(r.incidents[0].state, 'corrected-not-learned');
  assert.match(r.note, /repairs the same class of failure repeatedly/);
});

test('training before the incident is not a response to it', () => {
  const { loop } = closedLoop();
  const training = new own.TrainingRegister({ clock: () => 0 });
  training.recordCompletion({ person: 'Somebody', course: COURSE, at: 1 * DAY, by: 'Registrar' });
  const r = inst.institutionalLearning({ loop, training, exercises: new own.ExerciseRegister({ clock: () => 0 }), controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
  assert.strictEqual(r.learningRate, 0);
});

test('training with no rehearsal behind it is a certificate, not readiness', () => {
  const { loop } = closedLoop();
  const training = new own.TrainingRegister({ clock: () => 0 });
  training.recordCompletion({ person: 'Somebody', course: COURSE, at: 20 * DAY, by: 'Registrar' });
  const r = inst.institutionalLearning({ loop, training, exercises: new own.ExerciseRegister({ clock: () => 0 }), controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
  assert.strictEqual(r.learningRate, 0);
  assert.strictEqual(r.incidents[0].stages['future-readiness'].reached, false);
  // A rehearsal that happened BEFORE the training does not demonstrate it either.
  const early = new own.ExerciseRegister({ clock: () => 0 });
  early.recordParticipation({ person: 'Somebody', exercise: EXERCISE, at: 15 * DAY, by: 'ORB', role: 'operationalOwner' });
  assert.strictEqual(inst.institutionalLearning({ loop, training, exercises: early, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY }).learningRate, 0);
});

test('fixed, taught, then demonstrated reaches learned — so the bar is satisfiable', () => {
  const { loop, id } = closedLoop();
  const training = new own.TrainingRegister({ clock: () => 0 });
  training.recordCompletion({ person: 'Somebody', course: COURSE, at: 20 * DAY, by: 'Registrar' });
  const exercises = new own.ExerciseRegister({ clock: () => 0 });
  exercises.recordParticipation({ person: 'Somebody', exercise: EXERCISE, at: 30 * DAY, by: 'ORB', role: 'operationalOwner' });
  const r = inst.institutionalLearning({ loop, training, exercises, controls: [{ id: 'APP-FIT-X', pass: true }], now: 100 * DAY });
  assert.strictEqual(r.learningRate, 1);
  assert.deepStrictEqual(r.learned, [id]);
  assert.strictEqual(r.measurable, true);
  // Phase 15, Part 12: learned is not improved. With no readiness series the last stage is unknown.
  assert.strictEqual(r.improvementRate, 0);
  assert.deepStrictEqual(r.learnedNotImproved, [id]);
  const measured = inst.institutionalLearning({
    loop, training, exercises, controls: [{ id: 'APP-FIT-X', pass: true }],
    readiness: [{ at: 5 * DAY, score: 0.6 }, { at: 60 * DAY, score: 0.8 }], now: 100 * DAY,
  });
  assert.strictEqual(measured.improvementRate, 1);
  assert.deepStrictEqual(measured.incidents[0].missing, []);
  assert.strictEqual(measured.weakestStage, null);
});

test('an open incident is neither corrected nor learned, and the chain names where it breaks', () => {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  loop.observe({ control: 'APP-FIT-Y', detail: 'failed', observedBy: 'CI', at: 1 * DAY });
  const r = inst.institutionalLearning({
    loop, training: new own.TrainingRegister({ clock: () => 0 }), exercises: new own.ExerciseRegister({ clock: () => 0 }),
    controls: [], now: 100 * DAY,
  });
  assert.strictEqual(r.correctionRate, 0);
  assert.strictEqual(r.learningRate, 0);
  assert.strictEqual(r.incidents[0].state, 'open');
  assert.ok(r.weakestStage.stage);
  assert.strictEqual(r.authorizes, false);
});
