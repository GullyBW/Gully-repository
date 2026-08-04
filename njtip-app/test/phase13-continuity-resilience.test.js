'use strict';
// Phase 13, Parts 8, 11 & 13 — knowledge continuity, training assurance, and the global invariant
// that no critical capability may depend on a single person, process, document or system.
const test = require('node:test');
const assert = require('node:assert');
const own = require('../src/governance/ownership');
const ir = require('../src/governance/institutional-resilience');

const DAY = 24 * 3600_000;
const NOW = 400 * DAY;
const controls = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

// A fully evidenced estate: every primary AND deputy available, active, trained and rehearsed.
function evidencedEstate({ includeDeputies = true, trainedAt = NOW - 30 * DAY } = {}) {
  const availability = new own.AvailabilityRegister({ clock: () => NOW });
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const training = new own.TrainingRegister({ clock: () => NOW });
  const exercises = new own.ExerciseRegister({ clock: () => NOW });
  for (const s of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      const people = includeDeputies ? [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])] : [own.OWNERSHIP[s][role]];
      for (const person of people) {
        activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
        for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: trainedAt, by: 'Registrar of Governance' });
        for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
      }
    }
  }
  return { availability, activity, training, exercises, now: NOW };
}

// --- Part 11: rehearsal participation and training assurance ---------------------------------------

test('rehearsal participation is attested, typed, timestamped and expires', () => {
  const ex = new own.ExerciseRegister({ clock: () => NOW });
  assert.throws(() => ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW }), (e) => e.failClosed === true);
  assert.throws(() => ex.recordParticipation({ person: 'X', exercise: 'a-chat', at: NOW, by: 'ORB' }), /unknown exercise/);
  assert.throws(() => ex.recordParticipation({ exercise: 'disaster-recovery', at: NOW, by: 'ORB' }), /a person and an exercise/);
  const rec = ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW, by: 'ORB' });
  assert.strictEqual(rec.expiresAt, NOW + own.EXERCISE_VALIDITY_DAYS * DAY);
});

test('never having rehearsed is distinguished from a lapsed rehearsal', () => {
  const ex = new own.ExerciseRegister({ clock: () => NOW });
  assert.deepStrictEqual(ex.status('Y', 'operationalOwner', { now: NOW }).lapsed, []);
  assert.ok(ex.status('Y', 'operationalOwner', { now: NOW }).never.includes('disaster-recovery'));
  ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW - 400 * DAY, by: 'ORB' });
  const s = ex.status('X', 'operationalOwner', { now: NOW });
  assert.ok(s.lapsed.includes('disaster-recovery'));
  assert.strictEqual(s.current, false);
  ex.recordParticipation({ person: 'X', exercise: 'disaster-recovery', at: NOW - 10 * DAY, by: 'ORB' });
  assert.strictEqual(ex.status('X', 'operationalOwner', { now: NOW }).current, true);
});

test('every exercise says why it matters and which roles it applies to', () => {
  for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) {
    assert.ok(k.why, id);
    assert.ok(k.relevantTo.length, id);
    for (const role of k.relevantTo) assert.ok(own.DEPUTY_ROLES.includes(role), `${id} → ${role}`);
  }
});

test('role readiness is the weakest of four facts, and unknown is not ready', () => {
  const blind = own.roleReadiness('X', 'dataSteward', { now: NOW });
  assert.strictEqual(blind.ready, false);
  assert.strictEqual(blind.unknownFactors.length, 4);
  assert.deepStrictEqual(blind.failedFactors, []);
  assert.match(blind.reason, /readiness unknown/);
  const e = evidencedEstate();
  const person = own.OWNERSHIP[own.subsystems()[0]].dataSteward;
  const ready = own.roleReadiness(person, 'dataSteward', e);
  assert.strictEqual(ready.ready, true, ready.reason);
  assert.deepStrictEqual(ready.unknownFactors, []);
});

test('expired qualifications reduce the readiness contribution on their own', () => {
  const good = own.trainingAssurance(evidencedEstate());
  assert.strictEqual(good.readinessContribution, 1);
  assert.strictEqual(good.sound, true);
  const lapsed = own.trainingAssurance(evidencedEstate({ trainedAt: NOW - 400 * DAY }));
  assert.ok(lapsed.readinessContribution < good.readinessContribution);
  assert.ok(lapsed.expiredQualifications.length > 0);
  assert.strictEqual(lapsed.sound, false);
});

test('unknown certification counts as not certified', () => {
  const nothing = own.trainingAssurance({ now: NOW });
  assert.strictEqual(nothing.readinessContribution, 0);
  assert.ok(nothing.unknown.length > 0);
  assert.strictEqual(nothing.sound, false);
  assert.match(nothing.note, /certifies nobody/);
});

// --- Part 8: knowledge continuity ------------------------------------------------------------------

test('a fully evidenced estate reaches a bus factor of two', () => {
  const kc = own.knowledgeContinuity(evidencedEstate());
  assert.strictEqual(kc.sound, true, kc.singlePersonDependencies.slice(0, 3).join(', '));
  assert.strictEqual(kc.minimumBusFactor, 2);
  assert.deepStrictEqual(kc.singlePersonDependencies, []);
  assert.strictEqual(kc.authorizes, false);
});

test('a derived deputy with no evidence is a name, not an alternative', () => {
  // The trap this control exists for: the platform derives a deputy for every role, so counting
  // names would report perfect continuity everywhere.
  const primariesOnly = own.knowledgeContinuity(evidencedEstate({ includeDeputies: false }));
  assert.strictEqual(primariesOnly.sound, false);
  assert.strictEqual(primariesOnly.minimumBusFactor, 1);
  assert.ok(primariesOnly.singlePersonDependencies.length > 0);
  assert.match(primariesOnly.roles.find((r) => r.busFactor === 1).reason, /a name, not an alternative/);
});

test('an estate with no evidence at all has nobody ready', () => {
  const kc = own.knowledgeContinuity({ now: NOW });
  assert.strictEqual(kc.minimumBusFactor, 0);
  assert.ok(kc.unstaffed.length > 0);
  assert.strictEqual(kc.sound, false);
});

// --- Part 13: the global invariant -----------------------------------------------------------------

test('the invariant is stated and every dimension says how an alternative is validated', () => {
  for (const required of ['person', 'team', 'document', 'process', 'service', 'region', 'supplier', 'communication-channel']) {
    assert.ok(ir.DEPENDENCY_KINDS[required], required);
    assert.ok(ir.DEPENDENCY_KINDS[required].question, required);
    assert.ok(ir.DEPENDENCY_KINDS[required].validatedBy, required);
  }
  const e = ir.evaluate({ controls: controls() });
  assert.match(e.invariant, /single person, a single process, a single document, or a single system/);
});

test('every critical capability says what its loss costs', () => {
  for (const [id, spec] of Object.entries(ir.CRITICAL_CAPABILITIES)) {
    assert.ok(spec.lossMeans && spec.lossMeans.length >= 30, id);
    assert.ok(spec.services.length && spec.subsystems.length, id);
  }
  assert.ok(Object.values(ir.CRITICAL_CAPABILITIES).filter((c) => c.constitutional).length >= 3);
});

test('unknown personal continuity is treated as a single-person dependency', () => {
  const blind = ir.evaluate({ controls: controls() });
  assert.strictEqual(blind.holds, false);
  assert.ok(blind.capabilities.every((c) => c.singleDependencies.includes('person')));
  assert.strictEqual(blind.blocksInstitutionalReadiness, true);
  assert.strictEqual(blind.authorizes, false);
});

test('with a fully evidenced estate, person, document and region all clear', () => {
  const continuity = own.knowledgeContinuity(evidencedEstate());
  const e = ir.evaluate({ continuity, controls: controls() });
  for (const c of e.capabilities) {
    assert.ok(!c.singleDependencies.includes('person'), `${c.capability} still depends on one person`);
    assert.ok(!c.singleDependencies.includes('document'), `${c.capability} still depends on one document`);
    assert.ok(!c.singleDependencies.includes('region'), `${c.capability} still depends on one region`);
  }
  // At least one capability comes out fully resilient, so the check has a success path.
  assert.ok(e.capabilities.some((c) => c.resilient));
});

test('the per-zone persistence store is correctly identified as a fatal single service', () => {
  const intake = ir.serviceResilience('anonymous-reporting');
  assert.strictEqual(intake.singleDependency, true);
  assert.ok(intake.fatalSingleServices.includes('persistence-ind'));
  assert.match(intake.reason, /the capability stops if any of these is lost/);
  // Three services in a chain is a chain, not redundancy — the check removes each in turn.
  assert.strictEqual(intake.checks.length, 3);
});

test('accepting a single point of failure is attributed, time-bound and constitutionally restricted', () => {
  const a = new ir.ResilienceAcceptance({ clock: () => NOW });
  assert.throws(() => a.accept({ capability: 'anonymous-reporting', kind: 'service', rationale: 'r', expiresAt: NOW + DAY }), (e) => e.failClosed === true);
  assert.throws(() => a.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', rationale: 'r' }), /must expire/);
  assert.throws(() => a.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Platform Engineering', rationale: 'r', expiresAt: NOW + DAY }), /only the Oversight Board/);
  assert.throws(() => a.accept({ capability: 'imaginary', kind: 'service', by: 'Oversight Board', rationale: 'r', expiresAt: NOW + DAY }), /unknown critical capability/);
  assert.throws(() => a.accept({ capability: 'anonymous-reporting', kind: 'telepathy', by: 'Oversight Board', rationale: 'r', expiresAt: NOW + DAY }), /unknown dependency kind/);
  const rec = a.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', rationale: 'one store per zone is the current architecture', expiresAt: NOW + 30 * DAY });
  assert.strictEqual(rec.by, 'Oversight Board');
  // A non-constitutional capability may be accepted by an operational authority.
  assert.ok(a.accept({ capability: 'service-recovery', kind: 'team', by: 'Operations Review Board', rationale: 'single team by design', expiresAt: NOW + DAY }));
});

test('an expired acceptance stops covering a single point of failure by itself', () => {
  const continuity = own.knowledgeContinuity(evidencedEstate());
  const a = new ir.ResilienceAcceptance({ clock: () => NOW });
  a.accept({ capability: 'anonymous-reporting', kind: 'service', by: 'Oversight Board', rationale: 'planned redundancy', expiresAt: NOW + 30 * DAY });
  const covered = ir.report({ continuity, controls: controls(), acceptances: a, now: NOW });
  assert.ok(!covered.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.kind === 'service'));
  const later = ir.report({ continuity, controls: controls(), acceptances: a, now: NOW + 60 * DAY });
  assert.ok(later.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.kind === 'service'));
  assert.strictEqual(later.blocksInstitutionalReadiness, true);
  assert.strictEqual(later.expiredAcceptances.length, 1);
});

test('recommendations name what would close each dependency, constitutional first', () => {
  const e = ir.evaluate({ controls: controls() });
  const recs = ir.recommendations(e);
  assert.ok(recs.count > 0);
  assert.strictEqual(recs.recommendationsOnly, true);
  assert.strictEqual(recs.authorizes, false);
  assert.strictEqual(recs.recommendations[0].priority, 'constitutional');
  for (const r of recs.recommendations) {
    assert.ok(r.recommendedAction, `${r.capability}/${r.kind}`);
    assert.ok(r.finding, `${r.capability}/${r.kind}`);
  }
  assert.match(recs.note, /Nothing here mitigates anything/);
});
