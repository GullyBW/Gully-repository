'use strict';
// Phase 13, Parts 9, 10 & 12 — decision memory, the organizational twin, and governance rehearsals.
const test = require('node:test');
const assert = require('node:assert');
const { RehearsalRegister, REHEARSALS } = require('../src/governance/rehearsals');
const dm = require('../src/architecture/decision-memory');
const twinMod = require('../src/twin2/operations-twin');
const own = require('../src/governance/ownership');
const asm = require('../src/architecture/assumptions');

const MIN = 60_000;
const DAY = 24 * 3600_000;
const NOW = 400 * DAY;
const reg = (opts = {}) => new RehearsalRegister({ clock: () => 0, ...opts });

// --- Part 12: governance rehearsals ----------------------------------------------------------------

test('every rehearsal declares steps, expectations, a source and what it tests', () => {
  for (const required of ['incident-escalation', 'disaster-recovery', 'emergency-authorization', 'evidence-custody', 'legislative-change', 'executive-approval']) {
    assert.ok(REHEARSALS[required], required);
  }
  for (const [id, spec] of Object.entries(REHEARSALS)) {
    assert.ok(spec.steps.length >= 3, id);
    assert.ok(Object.keys(spec.expectations).length, id);
    assert.ok(spec.expectationSource, id);
    assert.ok(spec.tests, id);
  }
});

test('a rehearsal needs a facilitator and participants', () => {
  assert.throws(() => reg().schedule({ rehearsal: 'disaster-recovery', participants: ['A'] }), (e) => e.failClosed === true);
  assert.throws(() => reg().schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB' }), /rehearses nobody/);
  assert.throws(() => reg().schedule({ rehearsal: 'a-quick-chat', facilitator: 'ORB', participants: ['A'] }), /unknown rehearsal/);
});

test('observations are typed, timestamped and attributed', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['A'], at: 0 });
  assert.throws(() => r.observe(run.id, { step: 'improvised', at: 0, by: 'A' }), /is not a step of/);
  assert.throws(() => r.observe(run.id, { step: 'detected', by: 'A' }), /timestamped/);
  assert.throws(() => r.observe(run.id, { step: 'detected', at: 0 }), (e) => e.failClosed === true);
  assert.throws(() => r.observe('REH-9999', { step: 'detected', at: 0, by: 'A' }), /unknown rehearsal run/);
});

test('expectations are frozen onto the run when it is scheduled', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['A'], at: 0 });
  assert.deepStrictEqual(run.expectations, REHEARSALS['disaster-recovery'].expectations);
  assert.ok(run.expectationSource);
});

test('a recovery that overruns the documented time fails, however hard everyone tried', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['Ops'], at: 0 });
  const steps = REHEARSALS['disaster-recovery'].steps;
  steps.forEach((step, i) => r.observe(run.id, { step, at: i === steps.length - 1 ? 210 * MIN : i * MIN, by: 'Ops', integrityVerified: true }));
  const report = r.close(run.id, { by: 'ORB' });
  assert.strictEqual(report.passed, false);
  assert.ok(report.unmetExpectations.includes('resolutionMinutes'));
  assert.ok(report.lessons.length > 0);
  assert.match(report.note, /expectations recorded before the rehearsal began/);
});

test('a missed step is named, and an unobserved expectation is not met', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['A', 'B'], at: 0 });
  r.observe(run.id, { step: 'sealed', at: 0, by: 'A' });
  r.observe(run.id, { step: 'transferred', at: MIN, by: 'A' });
  const report = r.close(run.id, { by: 'OB' });
  assert.strictEqual(report.passed, false);
  assert.ok(report.missedSteps.includes('chain-verified'));
  assert.ok(report.unmetExpectations.includes('chainUnbroken'));
  assert.ok(report.findings.find((f) => f.expectation === 'chainUnbroken').detail.includes('not observed'));
});

test('steps observed out of the documented order are reported', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'incident-escalation', facilitator: 'ORB', participants: ['A'], at: 0 });
  r.observe(run.id, { step: 'detected', at: 100 * MIN, by: 'A' });
  r.observe(run.id, { step: 'raised', at: 0, by: 'A' });
  assert.ok(r.afterAction(run.id).outOfOrder.length > 0);
});

test('one person cannot assemble, review, decide and record an approval', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'executive-approval', facilitator: 'OB', participants: ['Chair'], at: 0 });
  REHEARSALS['executive-approval'].steps.forEach((step, i) => r.observe(run.id, { step, at: i * MIN, by: 'Chair', decisionRecorded: true }));
  const report = r.close(run.id, { by: 'OB' });
  assert.strictEqual(report.passed, false);
  assert.ok(report.unmetExpectations.includes('distinctAuthoriser'));
});

test('a correctly run rehearsal passes', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['A', 'B'], at: 0 });
  r.observe(run.id, { step: 'sealed', at: 0, by: 'A', witnessed: true });
  r.observe(run.id, { step: 'transferred', at: MIN, by: 'A' });
  r.observe(run.id, { step: 'received', at: 2 * MIN, by: 'B' });
  r.observe(run.id, { step: 'chain-verified', at: 3 * MIN, by: 'B', chainUnbroken: true });
  const report = r.close(run.id, { by: 'OB' });
  assert.strictEqual(report.passed, true, report.lessons.join('; '));
  assert.deepStrictEqual(report.missedSteps, []);
  assert.strictEqual(report.authorizes, false);
});

test('a closed after-action report cannot be edited', () => {
  const r = reg();
  const run = r.schedule({ rehearsal: 'evidence-custody', facilitator: 'OB', participants: ['A'], at: 0 });
  r.observe(run.id, { step: 'sealed', at: 0, by: 'A' });
  r.close(run.id, { by: 'OB' });
  assert.throws(() => r.observe(run.id, { step: 'transferred', at: MIN, by: 'A' }), (e) => e.failClosed === true);
  assert.throws(() => r.close(run.id, {}), /named human/);
});

test('never-rehearsed is its own state, and the worst one', () => {
  const empty = reg().coverage({ now: 0 });
  assert.strictEqual(empty.neverRehearsed.length, Object.keys(REHEARSALS).length);
  assert.strictEqual(empty.sound, false);
  assert.strictEqual(empty.coverage, 0);
  assert.match(empty.note, /first test will be a real incident/);
});

test('closing a rehearsal makes the participants\' training currency real', () => {
  const exercises = new own.ExerciseRegister({ clock: () => 0 });
  const r = reg({ exercises });
  const run = r.schedule({ rehearsal: 'disaster-recovery', facilitator: 'ORB', participants: ['Operator'], at: 0 });
  REHEARSALS['disaster-recovery'].steps.forEach((step, i) => r.observe(run.id, { step, at: i * MIN, by: 'Operator', integrityVerified: true }));
  r.close(run.id, { by: 'ORB' });
  assert.ok(exercises.participation('Operator').some((p) => p.exercise === 'disaster-recovery'));
});

// --- Part 9: decision memory -----------------------------------------------------------------------

const CONTROLS = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }, { id: 'APP-FIT-BROKEN-PROBE', pass: false }];
const memory = () => new dm.DecisionMemory({ clock: () => 0 });

test('a lineage entry must reference a real ADR and name who recorded it', () => {
  assert.throws(() => memory().record('ADR-9999', 'implementation', { by: 'A', modules: ['src/x.js'] }), /a note about nothing/);
  assert.throws(() => memory().record('ADR-0001', 'implementation', { modules: ['src/x.js'] }), (e) => e.failClosed === true);
  assert.throws(() => memory().record('ADR-0001', 'daydream', { by: 'A' }), /unknown lineage stage/);
});

test('each stage requires what makes it meaningful', () => {
  assert.throws(() => memory().record('ADR-0001', 'implementation', { by: 'A' }), /requires 'modules'/);
  assert.throws(() => memory().record('ADR-0001', 'outcome', { by: 'A', verdict: 'as-predicted' }), /requires 'evidence'/);
  assert.throws(() => memory().record('ADR-0001', 'outcome', { by: 'A', evidence: ['x'] }), /needs a verdict/);
  assert.throws(() => memory().record('ADR-0001', 'lesson', { by: 'A' }), /requires 'statement'/);
  assert.throws(() => memory().record('ADR-0001', 'supersession', { by: 'A', adr: 'ADR-9999' }), /does not exist/);
});

test('an outcome citing evidence that never ran is claimed, not evidenced', () => {
  const m = memory();
  m.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-NEVER-WRITTEN'] });
  const l = m.lineage('ADR-0001', { controls: CONTROLS });
  assert.strictEqual(l.evidencedOutcome, false);
  assert.strictEqual(l.outcomes[0].state, 'claimed');
  assert.ok(l.gaps.some((g) => /claimed rather than evidenced/.test(g)));
});

test('success claimed on failing evidence is a contradiction', () => {
  const m = memory();
  m.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-BROKEN-PROBE'] });
  const l = m.lineage('ADR-0001', { controls: CONTROLS });
  assert.strictEqual(l.outcomes[0].contradicted, true);
  assert.ok(l.gaps.some((g) => /failing evidence/.test(g)));
});

test('a full lineage runs decision to lesson to the next decision', () => {
  const m = memory();
  m.record('ADR-0001', 'implementation', { by: 'ARB', modules: ['src/app.js'] });
  m.record('ADR-0001', 'outcome', { by: 'ARB', verdict: 'as-predicted', evidence: ['APP-FIT-CONTEXT-MAP'] });
  m.record('ADR-0001', 'lesson', { by: 'ARB', statement: 'Freezing the baseline early made every later phase additive.' });
  m.record('ADR-0001', 'supersession', { by: 'ARB', adr: 'ADR-0002' });
  const l = m.lineage('ADR-0001', { controls: CONTROLS });
  assert.strictEqual(l.complete, true, l.gaps.join('; '));
  assert.strictEqual(l.built, true);
  assert.strictEqual(l.evaluated, true);
  assert.strictEqual(l.evidencedOutcome, true);
  assert.deepStrictEqual(l.ledTo, ['ADR-0002']);
});

test('a decision nobody has checked is unevaluated, not successful', () => {
  const m = memory();
  const l = m.lineage('ADR-0003', { controls: CONTROLS });
  assert.strictEqual(l.evaluated, false);
  assert.strictEqual(l.verdict, null);
  assert.ok(l.gaps.some((g) => /which is not the same as it working/.test(g)));
  const report = m.report({ controls: CONTROLS });
  assert.ok(report.unevaluated.includes('ADR-0003'));
  assert.ok(report.evaluationRate < 1);
  assert.match(report.note, /UNEVALUATED, not successful/);
  assert.strictEqual(report.authorizes, false);
});

// --- Part 10: the organizational twin ---------------------------------------------------------------

function evidencedContinuity() {
  const availability = new own.AvailabilityRegister({ clock: () => NOW });
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const training = new own.TrainingRegister({ clock: () => NOW });
  const exercises = new own.ExerciseRegister({ clock: () => NOW });
  for (const s of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
        activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
        for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
        for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
      }
    }
  }
  return own.knowledgeContinuity({ availability, activity, training, exercises, now: NOW });
}
const orgTwin = () => new twinMod.OperationsTwin({
  evidenceIds: ['APP-FIT-ORGANIZATIONAL-TWIN'],
  assumptions: asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 })),
  clock: () => 0,
});

test('the organizational scenarios declare their assumptions and limitations', () => {
  for (const id of ['owner-absence', 'leadership-turnover', 'operational-overload']) {
    assert.ok(twinMod.SCENARIOS[id], id);
    assert.strictEqual(twinMod.assertDeclaredMetadata(id, twinMod.SCENARIOS[id]), true);
  }
});

test('losing an office and its deputy together leaves a governance object unowned', () => {
  const chair = own.OWNERSHIP[own.subsystems()[0]].approvingAuthority;
  const r = orgTwin().simulate({ scenario: 'leadership-turnover', change: { absent: [chair] } });
  assert.strictEqual(r.safe, false);
  assert.ok(r.blocking.some((f) => /no accountable authority remains/.test(f.finding)));
  assert.ok(r.findings.some((f) => f.entity === 'organizational-spof'));
  assert.strictEqual(r.isolation.unchanged, true);
});

test('a deputy nobody has assessed does not cover an absence', () => {
  const chair = own.OWNERSHIP[own.subsystems()[0]].approvingAuthority;
  const unknown = orgTwin().simulate({ scenario: 'owner-absence', change: { absent: [chair] } });
  assert.strictEqual(unknown.safe, false);
  assert.ok(unknown.blocking.some((f) => /not assessed as ready/.test(f.finding)));
  // …and one who is assessed ready does cover it.
  const covered = orgTwin().simulate({ scenario: 'owner-absence', change: { absent: [chair], continuity: evidencedContinuity() } });
  assert.strictEqual(covered.safe, true, covered.blocking.map((f) => f.finding).slice(0, 2).join('; '));
});

test('concurrent incidents exhaust the available approving authorities', () => {
  const overload = orgTwin().simulate({ scenario: 'operational-overload', change: { concurrentIncidents: 99 } });
  assert.strictEqual(overload.safe, false);
  assert.ok(overload.blocking.some((f) => /nobody to authorise/.test(f.finding)));
  const manageable = orgTwin().simulate({ scenario: 'operational-overload', change: { concurrentIncidents: 1 } });
  assert.strictEqual(manageable.safe, true);
});

test('an absence scenario with nobody absent comes out clean', () => {
  const quiet = orgTwin().simulate({ scenario: 'owner-absence', change: { absent: [] } });
  assert.strictEqual(quiet.safe, true);
  assert.strictEqual(quiet.authorizes, false);
});
