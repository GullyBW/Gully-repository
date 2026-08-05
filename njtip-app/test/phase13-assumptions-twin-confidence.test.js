'use strict';
// Phase 13, Parts 1 & 2 — the executable assumption registry, and digital twin confidence.
const test = require('node:test');
const assert = require('node:assert');
const asm = require('../src/architecture/assumptions');
const twinMod = require('../src/twin2/operations-twin');
const contextMap = require('../src/architecture/context-map');

const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const CONTROLS = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }, { id: 'APP-FIT-BROKEN', pass: false }];
const fresh = () => new asm.AssumptionRegistry({ clock: () => 0 });
const BASE = {
  statement: 'A statement long enough to be a statement.',
  rationale: 'A rationale long enough to be a rationale.',
  owner: 'Architecture Review Board', reviewCadenceDays: 90, expiresAt: YEAR,
  verificationMethod: 'executable-check',
};

// --- Part 2: the assumption registry --------------------------------------------------------------

test('an assumption without an owner or an expiry is refused', () => {
  assert.throws(() => fresh().register('A', { ...BASE, owner: undefined }), (e) => e.failClosed === true);
  assert.throws(() => fresh().register('A', { ...BASE, owner: undefined }), /nobody will revisit/);
  assert.throws(() => fresh().register('A', { ...BASE, expiresAt: undefined }), (e) => e.failClosed === true);
  assert.throws(() => fresh().register('A', { ...BASE, expiresAt: undefined }), /is a belief/);
});

test('an assumption must state what is assumed and why it was reasonable', () => {
  assert.throws(() => fresh().register('A', { ...BASE, statement: undefined }), /must state what is being assumed/);
  assert.throws(() => fresh().register('A', { ...BASE, rationale: undefined }), /why it was reasonable/);
  assert.throws(() => fresh().register('', BASE), /needs an identifier/);
  assert.throws(() => fresh().register('A', { ...BASE, verificationMethod: 'vibes' }), /unknown verification method/);
  assert.throws(() => fresh().register('A', { ...BASE, reviewCadenceDays: -1 }), /positive review cadence/);
});

test('re-registering an assumption is refused — amend it instead', () => {
  const r = fresh();
  r.register('A', BASE);
  assert.throws(() => r.register('A', BASE), /already registered/);
});

test('a malformed claim is refused so contradiction detection stays trustworthy', () => {
  assert.throws(() => fresh().register('A', { ...BASE, claim: { predicate: 'holds' } }), /must name its subject/);
  assert.throws(() => fresh().register('A', { ...BASE, claim: { subject: 's', predicate: 'maybe' } }), /unknown claim predicate/);
  assert.throws(() => fresh().register('A', { ...BASE, claim: { subject: 's', predicate: 'equals' } }), /requires a value/);
});

test('declared confidence and assessed confidence are separate, and an overclaim is named', () => {
  const r = fresh();
  r.register('A', { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], confidence: 'high' });
  const assessed = r.assessConfidence('A', { now: 0, controls: CONTROLS });
  assert.strictEqual(assessed.declared, 'high');
  assert.strictEqual(assessed.assessed, 'low');          // never verified
  assert.ok(assessed.reasons.some((x) => /never verified/.test(x)));
  const over = r.overclaims({ now: 0, controls: CONTROLS });
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].assumption, 'A');
  assert.strictEqual(over[0].overclaimed, true);
});

test('verification lifts the assessment, and a failed verification takes it to unknown', () => {
  const r = fresh();
  r.register('A', { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], confidence: 'high' });
  r.recordVerification('A', { holds: true, by: 'Assurance', at: 0 });
  assert.strictEqual(r.assessConfidence('A', { now: 0, controls: CONTROLS }).assessed, 'high');
  assert.deepStrictEqual(r.overclaims({ now: 0, controls: CONTROLS }), []);
  r.recordVerification('A', { holds: false, by: 'Assurance', at: 1 });
  assert.strictEqual(r.assessConfidence('A', { now: 0, controls: CONTROLS }).assessed, 'unknown');
  assert.strictEqual(r.verifications('A').length, 2);
});

test('the verification method caps what any amount of evidence can support', () => {
  const r = fresh();
  for (const [id, method] of [['E', 'executable-check'], ['O', 'operational-observation'], ['H', 'human-attestation'], ['U', 'unverifiable']]) {
    r.register(id, { ...BASE, verificationMethod: method, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'] });
    r.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
  }
  assert.strictEqual(r.assessConfidence('E', { now: 0, controls: CONTROLS }).assessed, 'high');
  assert.strictEqual(r.assessConfidence('O', { now: 0, controls: CONTROLS }).assessed, 'moderate');
  assert.strictEqual(r.assessConfidence('H', { now: 0, controls: CONTROLS }).assessed, 'low');
  assert.strictEqual(r.assessConfidence('U', { now: 0, controls: CONTROLS }).assessed, 'unknown');
});

test('failing evidence caps the assessment regardless of the method', () => {
  const r = fresh();
  r.register('A', { ...BASE, evidence: ['APP-FIT-BROKEN'], contexts: ['assurance'] });
  r.recordVerification('A', { holds: true, by: 'Assurance', at: 0 });
  const assessed = r.assessConfidence('A', { now: 0, controls: CONTROLS });
  assert.strictEqual(assessed.assessed, 'low');
  assert.ok(assessed.reasons.some((x) => /evidence is failing/.test(x)));
});

test('expiry is absolute and review staleness is reported separately', () => {
  const r = fresh();
  r.register('A', { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], expiresAt: 10 * DAY });
  assert.deepStrictEqual(r.stale({ now: 0 }), []);
  const overdue = r.stale({ now: 100 * DAY });
  assert.strictEqual(overdue.length, 1);
  assert.strictEqual(overdue[0].expired, true);
  assert.strictEqual(overdue[0].neverReviewed, true);
  assert.strictEqual(r.assessConfidence('A', { now: 100 * DAY, controls: CONTROLS }).assessed, 'unknown');
  // Review resets the cadence clock, and only a named human may do it.
  assert.throws(() => r.review('A', {}), (e) => e.failClosed === true);
  r.review('A', { by: 'ARB Chair', at: 95 * DAY });
  assert.strictEqual(r.describe('A').lastReviewedBy, 'ARB Chair');
  // …but reviewing does not un-expire it. Expiry means the assumption must be re-taken.
  assert.ok(r.stale({ now: 100 * DAY }).some((s) => s.expired));
});

test('contradictions are found structurally, and nothing else is flagged', () => {
  const r = fresh();
  const claim = (subject, predicate, value) => ({ ...BASE, contexts: ['assurance'], claim: { subject, predicate, value } });
  r.register('LOW', claim('lag', 'at-most', 100));
  r.register('HIGH', claim('lag', 'at-least', 500));
  r.register('YES', claim('affinity', 'holds'));
  r.register('NO', claim('affinity', 'does-not-hold'));
  r.register('ONE', claim('ratio', 'equals', 1000));
  r.register('TWO', claim('ratio', 'equals', 2000));
  r.register('LONE', claim('unrelated', 'holds'));
  const found = r.contradictions();
  assert.deepStrictEqual(found.map((c) => c.subject).sort(), ['affinity', 'lag', 'ratio']);
  assert.ok(!found.some((c) => c.subject === 'unrelated'));
  assert.strictEqual(r.validate().valid, false);
  // Compatible bounds on the same subject are NOT a contradiction.
  const ok = fresh();
  ok.register('LOW', claim('lag', 'at-least', 100));
  ok.register('HIGH', claim('lag', 'at-most', 500));
  assert.deepStrictEqual(ok.contradictions(), []);
  assert.strictEqual(ok.validate().valid, true);
});

test('an assumption bearing on no real bounded context is orphaned', () => {
  const r = fresh();
  r.register('NOWHERE', { ...BASE, contexts: [] });
  r.register('GHOST', { ...BASE, contexts: ['ministry-of-typos'] });
  r.register('PARTIAL', { ...BASE, contexts: ['ministry-of-typos', contextMap.ids()[0]] });
  r.register('REAL', { ...BASE, contexts: [contextMap.ids()[0]] });
  assert.deepStrictEqual(r.orphaned().map((o) => o.assumption).sort(), ['GHOST', 'NOWHERE']);
  // A partly-wrong context list is not orphaned, but the unknown name is still reported.
  assert.ok(r.orphaned().every((o) => o.assumption !== 'PARTIAL'));
});

test('health aggregates to the weakest, and an undeclared set is unexamined rather than absent', () => {
  const r = fresh();
  r.register('GOOD', { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'] });
  r.recordVerification('GOOD', { holds: true, by: 'Assurance', at: 0 });
  r.register('WEAK', { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'], verificationMethod: 'unverifiable' });
  assert.strictEqual(r.health(['GOOD'], { now: 0, controls: CONTROLS }).confidence, 'high');
  const mixed = r.health(['GOOD', 'WEAK'], { now: 0, controls: CONTROLS });
  assert.strictEqual(mixed.confidence, 'unknown');
  assert.strictEqual(mixed.weakest, 'WEAK');
  const empty = r.health([], { now: 0, controls: CONTROLS });
  assert.strictEqual(empty.sound, false);
  assert.match(empty.reason, /unexamined/);
  const missing = r.health(['NOPE'], { now: 0, controls: CONTROLS });
  assert.deepStrictEqual(missing.missing, ['NOPE']);
  assert.strictEqual(missing.sound, false);
});

test('the platform registers its own assumptions, consistently and with evidence that resolves', () => {
  const controls = [
    ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const r = asm.seedPlatformAssumptions(fresh());
  const rep = r.report({ now: 0, controls });
  assert.ok(rep.count >= 8);
  assert.deepStrictEqual(rep.contradictions, []);
  assert.deepStrictEqual(rep.orphaned, []);
  assert.deepStrictEqual(rep.unevidenced, []);
  assert.strictEqual(rep.validation.valid, true);
  assert.strictEqual(rep.authorizes, false);
  // Honest by construction: nothing has been verified, so everything claiming above 'low' is an
  // overclaim, and the registry says so rather than flattering the platform.
  assert.ok(rep.overclaims.length > 0);
});

// --- Part 1: digital twin confidence --------------------------------------------------------------

const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];
const platformRegistry = () => asm.seedPlatformAssumptions(fresh());
const buildTwin = (opts = {}) => new twinMod.OperationsTwin({ evidenceIds: controlsAll().map((c) => c.id), clock: () => 0, ...opts });

test('every scenario declares assumptions, limitations, an owner and a cadence', () => {
  for (const [id, spec] of Object.entries(twinMod.SCENARIOS)) {
    assert.strictEqual(twinMod.assertDeclaredMetadata(id, spec), true, id);
    assert.ok(spec.assumptions.length, id);
    assert.ok(spec.limitations.length, id);
    for (const l of spec.limitations) assert.ok(l.length >= 20, `${id}: "${l}" is too terse to be a limitation`);
  }
});

test('a scenario missing its metadata may not be simulated', () => {
  const good = { assumptions: ['ASM-0001'], limitations: ['a limitation stated at sufficient length'], owner: 'ARB', reviewCadenceDays: 90 };
  for (const patch of [{ assumptions: [] }, { limitations: [] }, { owner: null }, { reviewCadenceDays: 0 }]) {
    assert.throws(() => twinMod.assertDeclaredMetadata('probe', { ...good, ...patch }), (e) => e.failClosed === true, JSON.stringify(patch));
  }
  assert.throws(() => twinMod.assertDeclaredMetadata('probe', null), (e) => e.failClosed === true);
  assert.strictEqual(twinMod.assertDeclaredMetadata('probe', good), true);
});

test('a freshly built twin has no validation history — history is never fabricated', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  for (const s of Object.keys(twinMod.SCENARIOS)) {
    assert.deepStrictEqual(twin.validationHistory(s), [], s);
    assert.strictEqual(twin.calibration(s).state, 'uncalibrated', s);
  }
});

test('recording a validation is attributed and typed', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  assert.throws(() => twin.recordValidation('dr-exercise', { predicted: true, observed: true }), (e) => e.failClosed === true);
  assert.throws(() => twin.recordValidation('dr-exercise', { predicted: 'yes', observed: true, by: 'ORB' }), /as booleans/);
  assert.throws(() => twin.recordValidation('not-a-scenario', { predicted: true, observed: true, by: 'ORB' }), /unknown scenario/);
  const rec = twin.recordValidation('dr-exercise', { predicted: true, observed: false, by: 'ORB', at: 5 });
  assert.strictEqual(rec.agreed, false);
  assert.strictEqual(twin.validationHistory('dr-exercise').length, 1);
});

test('calibration requires enough comparisons, and disagreement makes it diverge', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  for (let i = 0; i < twinMod.CALIBRATION_MIN_OBSERVATIONS - 1; i++) twin.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'ORB', at: i });
  assert.strictEqual(twin.calibration('dr-exercise').state, 'uncalibrated');
  twin.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'ORB', at: 9 });
  assert.strictEqual(twin.calibration('dr-exercise').state, 'calibrated');

  const drift = buildTwin({ assumptions: platformRegistry() });
  for (let i = 0; i < 5; i++) drift.recordValidation('dr-exercise', { predicted: true, observed: i < 1, by: 'ORB', at: i });
  assert.strictEqual(drift.calibration('dr-exercise').state, 'diverging');
  assert.strictEqual(drift.confidence('dr-exercise', { now: 0, controls: controlsAll() }).confidence, 'unknown');
});

test('confidence is capped by the weakest factor and names what is limiting it', () => {
  const blind = buildTwin();                       // no assumption registry at all
  const c = blind.confidence('dr-exercise', { now: 0, controls: controlsAll() });
  assert.strictEqual(c.confidence, 'unknown');
  assert.ok(c.limitedBy.includes('assumptions'));
  assert.ok(c.factors.every((f) => f.why));
  assert.match(c.method, /never their average/);
});

test('a calibrated simulation on verified assumptions reaches high confidence', () => {
  const registry = fresh();
  for (const id of twinMod.SCENARIOS['dr-exercise'].assumptions) {
    registry.register(id, {
      ...BASE, statement: 'sound for the probe', rationale: 'exercises the success path',
      evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['resilience'], reviewCadenceDays: 3650, expiresAt: 10 * YEAR,
    });
    registry.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
  }
  const twin = buildTwin({ assumptions: registry });
  for (let i = 0; i < 4; i++) twin.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'ORB', at: i });
  const c = twin.confidence('dr-exercise', { now: 0, controls: [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }] });
  assert.strictEqual(c.confidence, 'high', JSON.stringify(c.factors));
  // Phase 14, Part 2: six dimensions, all supporting 'high'. The three original factor names are
  // still among them, so nothing reading `limitedBy` for them had to change.
  assert.deepStrictEqual(c.limitedBy, ['calibration', 'assumptions', 'model-completeness', 'data', 'simulation', 'forecast']);
});

test('an expired assumption drags a calibrated simulation back to unknown', () => {
  const registry = fresh();
  for (const id of twinMod.SCENARIOS['dr-exercise'].assumptions) {
    registry.register(id, { ...BASE, evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['resilience'], expiresAt: 10 * DAY });
    registry.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
  }
  const twin = buildTwin({ assumptions: registry });
  for (let i = 0; i < 4; i++) twin.recordValidation('dr-exercise', { predicted: true, observed: true, by: 'ORB', at: i });
  const c = twin.confidence('dr-exercise', { now: 100 * DAY, controls: [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }] });
  assert.strictEqual(c.confidence, 'unknown');
  assert.ok(c.limitedBy.includes('assumptions'));
});

test('every simulation carries its confidence metadata and still authorizes nothing', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  const run = twin.simulate({ scenario: 'operational-failure', change: { failed: ['kms'] }, now: 0, controls: controlsAll() });
  for (const field of ['confidence', 'confidenceDetail', 'assumptions', 'limitations', 'owner', 'reviewCadenceDays', 'reviewDueAt', 'calibration', 'validationHistory']) {
    assert.ok(run[field] !== undefined && run[field] !== null, `missing ${field}`);
  }
  assert.strictEqual(run.calibration, 'uncalibrated');
  assert.strictEqual(run.authorizes, false);
  assert.strictEqual(run.isolation.unchanged, true);
  assert.ok(run.confidenceDetail.evidenceBasis.entities > 0);
});

test('the confidence trend needs two comparisons and warns when agreement decays', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  assert.strictEqual(twin.confidenceTrend('dr-exercise').direction, 'insufficient-data');
  for (const [i, observed] of [true, true, false, false].entries()) {
    twin.recordValidation('dr-exercise', { predicted: true, observed, by: 'ORB', at: i });
  }
  const trend = twin.confidenceTrend('dr-exercise');
  assert.strictEqual(trend.direction, 'degrading');
  assert.match(trend.warning, /drifting away from the system it describes/);
});

test('the confidence report aggregates to the weakest scenario and names the uncalibrated ones', () => {
  const twin = buildTwin({ assumptions: platformRegistry() });
  const rep = twin.confidenceReport({ now: 0, controls: controlsAll() });
  assert.strictEqual(rep.count, Object.keys(twinMod.SCENARIOS).length);
  assert.strictEqual(rep.uncalibrated.length, rep.count);
  const order = ['high', 'moderate', 'low', 'unknown'];
  const weakest = rep.scenarios.slice().sort((a, b) => order.indexOf(b.confidence) - order.indexOf(a.confidence))[0];
  assert.strictEqual(rep.confidence, weakest.confidence);
  assert.strictEqual(rep.authorizes, false);
  assert.match(rep.note, /uncalibrated simulation cannot report high confidence/);
});
