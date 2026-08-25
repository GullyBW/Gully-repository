'use strict';

// Governance succession assurance and capability drift — Phase 18.1 close-out remediation R6/R9 and
// the hand-declared-list debt.
//
// The distinction this file exists to hold open:
//
//     SUCCESSION DESIGN IS NOT SUCCESSION PROOF
//
// Four things get called "we have succession" and they are not the same. DOCUMENTED is cheap and
// this platform has it in all thirty subsystems. REHEARSED is expensive and this platform has it
// nowhere. A control reporting "succession: yes" would be true of the first and false of the last,
// and every reader would take the reassuring reading.

const test = require('node:test');
const assert = require('node:assert/strict');

const own = require('../src/governance/ownership');
const ir = require('../src/governance/institutional-resilience');
const ep = require('../src/assurance/epistemic');

const CONTROLS = [
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];
const drillRegister = (records) => {
  const e = new own.ExerciseRegister({ clock: () => 0 });
  records.forEach((r) => e.recordParticipation(r));
  return e;
};
const DRILL = { person: 'ARB Vice-Chair', exercise: 'governance-succession', at: 0 };

// --- §3: the four levels ------------------------------------------------------------------------

test('succession: four levels exist and none is established the same way as the last', () => {
  assert.deepEqual(own.SUCCESSION_ASSURANCE_ORDER, ['DOCUMENTED', 'EXECUTABLE', 'REHEARSED', 'VERIFIED']);
  assert.equal(own.SUCCESSION_ASSURANCE_LEVELS.DOCUMENTED.establishedBy, 'machine');
  assert.equal(own.SUCCESSION_ASSURANCE_LEVELS.REHEARSED.establishedBy, 'record of a human act');
  assert.equal(own.SUCCESSION_ASSURANCE_LEVELS.VERIFIED.establishedBy, 'human judgement');
  // Each says what it does NOT establish. That sentence is the load-bearing one.
  for (const l of Object.values(own.SUCCESSION_ASSURANCE_LEVELS)) assert.ok(l.doesNotEstablish);
});

test('succession: a documented chain is not a rehearsed one', () => {
  const r = own.successionExercise('assurance', { now: 0 });
  assert.equal(r.documented, true);
  assert.equal(r.executable, true);
  assert.equal(r.rehearsed, false);
  assert.equal(r.verified, false);
  assert.equal(r.attainedLevel, 'EXECUTABLE');
  assert.equal(r.nextLevel, 'REHEARSED');
});

test('succession: a governance-succession exercise kind exists, so the gap is askable', () => {
  assert.ok(own.EXERCISE_KINDS['governance-succession']);
  assert.ok(own.EXERCISE_KINDS['governance-succession'].relevantTo.includes('approvingAuthority'));
});

test('succession: a failed drill is REHEARSED and not VERIFIED', () => {
  // A rehearsal that happened is not a rehearsal that worked, and a failed drill is evidence.
  const r = own.successionExercise('assurance', { exercises: drillRegister([{ ...DRILL, by: 'Oversight Board', outcome: 'failed' }]), now: 0 });
  assert.equal(r.rehearsed, true);
  assert.equal(r.verified, false);
  assert.equal(r.attainedLevel, 'REHEARSED');
});

test('succession: VERIFIED is reachable, and self-attestation does not reach it', () => {
  const attested = own.successionExercise('assurance', { exercises: drillRegister([{ ...DRILL, by: 'Oversight Board', outcome: 'completed' }]), now: 0 });
  assert.equal(attested.attainedLevel, 'VERIFIED', 'a level nothing can reach is not a level');
  const self = own.successionExercise('assurance', { exercises: drillRegister([{ ...DRILL, by: 'ARB Vice-Chair', outcome: 'completed' }]), now: 0 });
  assert.equal(self.verified, false, 'self-reported success attests nothing');
  assert.equal(self.attainedLevel, 'REHEARSED');
});

// --- §3: the seven-stage walk -------------------------------------------------------------------

test('succession: the drill walks all seven stages in order', () => {
  const r = own.successionExercise('assurance', { now: 0 });
  assert.deepEqual(r.stages.map((s) => s.step), [
    'primary-unavailable', 'first-successor-assumes', 'first-successor-unavailable',
    'second-successor-assumes', 'second-successor-unavailable', 'body-fallback', 'authority-restored',
  ]);
});

test('succession: restoration is UNKNOWN because a chain says who acts, not how acting ends', () => {
  const r = own.successionExercise('assurance', { now: 0 });
  const restore = r.stages.find((s) => s.step === 'authority-restored');
  assert.equal(restore.state, 'UNKNOWN');
  assert.match(restore.detail, /succession chain describes who acts, not how acting ends/);
  // The walk stops there, using the shared first-break rule rather than a private one.
  assert.equal(r.stoppedAt, 'authority-restored');
  assert.equal(r.contiguousNavigableDepth, 6);
  assert.equal(r.walk.length, 7);
});

test('succession: failure is detected at each level of the chain', () => {
  const chain = own.successionPlan('assurance').chain.map((c) => c.holder);
  const stageState = (r, step) => r.stages.find((s) => s.step === step).state;

  const primaryOut = own.successionExercise('assurance', { unavailable: [chain[0]], now: 0 });
  assert.equal(stageState(primaryOut, 'first-successor-assumes'), 'RESOLVED');

  const firstOut = own.successionExercise('assurance', { unavailable: [chain[0], chain[1]], now: 0 });
  assert.equal(stageState(firstOut, 'first-successor-assumes'), 'BROKEN');

  const allOut = own.successionExercise('assurance', { unavailable: chain, now: 0 });
  assert.equal(stageState(allOut, 'second-successor-assumes'), 'BROKEN');
});

test('succession: the body fallback requires a quorum, not a signature', () => {
  const r = own.successionExercise('assurance', { now: 0 });
  const body = r.stages.find((s) => s.step === 'body-fallback');
  assert.equal(body.state, 'RESOLVED');
  assert.match(body.detail, /quorum required/);
  assert.match(body.detail, /different authorities/);
});

test('succession: authority movement changes RACI and escalation still terminates at a board', () => {
  const r = own.successionExercise('assurance', { now: 0 });
  assert.notEqual(r.raciUnderSuccession.accountableNow, r.raciUnderSuccession.accountableIfUnavailable);
  assert.equal(r.escalationStillTerminates, true);
  assert.ok(Object.keys(own.SUCCESSION_CHECKS).length >= 10);
});

test('succession: the estate has thirty documented chains and zero rehearsals', () => {
  const e = own.successionAssurance({ now: 0 });
  assert.equal(e.count, 30);
  assert.equal(e.documented, 30);
  assert.equal(e.executable, 30);
  assert.equal(e.rehearsed, 0, 'recorded rather than smoothed');
  assert.equal(e.verified, 0);
  assert.equal(e.neverRehearsed.length, 30);
  assert.equal(e.weakestLevel, 'EXECUTABLE');
  assert.doesNotMatch(e.basis, /%|percent/);
  assert.equal(e.authorizes, false);
});

// --- §5: governance capability drift ------------------------------------------------------------

test('drift: five kinds, none of which blocks a build', () => {
  for (const k of ['UNDECLARED_CAPABILITY_MEMBER', 'STALE_CONTROL_REFERENCE', 'STALE_MODULE_REFERENCE', 'DUPLICATE_CLAIM', 'EMPTY_DECLARATION']) {
    assert.ok(ir.CAPABILITY_DRIFT_KINDS[k]);
    assert.equal(ir.CAPABILITY_DRIFT_KINDS[k].blocking, false);
    assert.ok(ep.EPISTEMIC_STATES[ir.CAPABILITY_DRIFT_KINDS[k].epistemic]);
  }
  // An unclaimed control is unknown, not broken: nobody having placed it is not a defect in it.
  assert.equal(ir.CAPABILITY_DRIFT_KINDS.UNDECLARED_CAPABILITY_MEMBER.epistemic, 'UNKNOWN');
  assert.equal(ir.CAPABILITY_DRIFT_KINDS.STALE_CONTROL_REFERENCE.epistemic, 'BROKEN');
});

test('drift: each kind is detectable', () => {
  const probe = (caps) => ir.governanceCapabilityDrift({ controls: CONTROLS, capabilities: caps, now: 0 });
  const real = { title: 't', controls: ['APP-FIT-EPISTEMIC-INTEGRITY'], modules: ['src/assurance/epistemic.js'] };
  assert.ok(probe({ a: { ...real, controls: ['APP-FIT-NOPE'] } }).byKind.STALE_CONTROL_REFERENCE);
  assert.ok(probe({ a: { ...real, modules: ['src/assurance/nowhere.js'] } }).byKind.STALE_MODULE_REFERENCE);
  assert.ok(probe({ a: { title: 't', controls: [], modules: [] } }).byKind.EMPTY_DECLARATION);
  assert.ok(probe({ a: real, b: { ...real, title: 'u' } }).byKind.DUPLICATE_CLAIM);
  assert.ok(probe({ a: { title: 't', controls: ['APP-FIT-EPISTEMIC-INTEGRITY'], modules: ['src/architecture/adr-governance.js'] } })
    .byKind.UNDECLARED_CAPABILITY_MEMBER, 'the debt this control exists for');
});

test('drift: a complete declaration reports clean', () => {
  const watched = 'src/governance/raci.js';
  const complete = [...ir.controlsExercisingModules([watched]).keys()];
  assert.ok(complete.length > 0);
  const clean = ir.governanceCapabilityDrift({ controls: CONTROLS, capabilities: { solo: { title: 't', controls: complete, modules: [watched] } }, now: 0 });
  assert.equal(clean.count, 0);
  assert.equal(clean.state, 'RESOLVED');
});

test('drift: the current estate reports its real drift and adopts nothing', () => {
  const before = Object.keys(ir.GOVERNANCE_CAPABILITIES).length;
  const d = ir.governanceCapabilityDrift({ controls: CONTROLS, now: 0 });
  assert.equal(Object.keys(ir.GOVERNANCE_CAPABILITIES).length, before, 'detection widened the declared set');
  assert.ok(d.count > 0, 'the debt is real and is reported');
  assert.equal(d.state, 'UNKNOWN');
  assert.equal(d.blocksInstitutionalReadiness, false);
  assert.equal(d.requiresGovernanceReview, true);
  // Nothing reported as undeclared may also be declared.
  for (const id of d.undeclared) {
    assert.ok(!Object.values(ir.GOVERNANCE_CAPABILITIES).some((c) => (c.controls || []).includes(id)));
  }
  assert.doesNotMatch(d.basis, /%|percent/);
});

test('drift: the machine/human boundary is stated', () => {
  const d = ir.governanceCapabilityDrift({ controls: CONTROLS, now: 0 });
  assert.match(d.humanJudgementRequired, /belongs to an existing capability, to a new one, or to neither/);
  assert.equal(d.producesInstitutionalVerdict, false);
  assert.equal(d.authorizes, false);
});

test('drift and succession are deterministic', () => {
  assert.deepEqual(
    ir.governanceCapabilityDrift({ controls: CONTROLS, now: 0 }),
    ir.governanceCapabilityDrift({ controls: CONTROLS, now: 0 }),
  );
  assert.deepEqual(own.successionExercise('assurance', { now: 0 }), own.successionExercise('assurance', { now: 0 }));
});
