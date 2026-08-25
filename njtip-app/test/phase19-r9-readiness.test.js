'use strict';

// R9 preparation: a controlled real ARB succession rehearsal.
//
// The governing principle for this stage, and the reason this file adds no simulation of the
// rehearsal itself:
//
//     Do not write more software to simulate evidence that can now only be obtained
//     through human institutional action.
//
// Everything here prepares for R9 and verifies that the preparation fails closed. None of it is
// R9. The exercise as declared reports NOT_READY, blocked on one thing: no governance body has
// approved it. That approval is not something this platform can write for itself.

const test = require('node:test');
const assert = require('node:assert/strict');

const own = require('../src/governance/ownership');
const ir = require('../src/governance/institutional-resilience');

const register = () => new own.SuccessionExerciseRegister({ clock: () => 0 });
const APPROVED = { ...own.R9_EXERCISE, governanceApproval: { by: 'Oversight Board', at: 0, minute: 'synthetic' } };
const gate = (d, opts = {}) => own.r9ReadinessGate(d, { register: register(), now: 0, ...opts });

// --- Part 1: the readiness gate -----------------------------------------------------------------

test('r9: nothing supplied is UNKNOWN, never ready', () => {
  const g = own.r9ReadinessGate(null, { now: 0 });
  assert.equal(g.state, 'UNKNOWN');
  assert.equal(g.mayProceed, false);
  assert.equal(g.failClosed, true);
});

test('r9: the exercise as declared is prepared but not approved', () => {
  const g = gate(own.R9_EXERCISE);
  assert.equal(g.state, 'NOT_READY');
  assert.deepEqual(g.blockingPrerequisites, ['governanceApprovalRecorded']);
  assert.equal(own.R9_EXERCISE.governanceApproval, null, 'an approval nobody gave is fabricated evidence');
  assert.equal(own.R9_EXERCISE.status, 'AWAITING_GOVERNANCE_APPROVAL');
});

test('r9: READY is reachable and is not permission', () => {
  const g = gate(APPROVED);
  assert.equal(g.state, 'READY');
  assert.equal(g.isPermission, false);
  assert.equal(g.establishesInstitutionalAssurance, false);
  assert.equal(g.authorizes, false);
});

test('r9: every critical prerequisite genuinely blocks', () => {
  const cases = [
    ['governanceBodyDefined', { governanceBody: null }],
    ['successorIdentified', { successor: 'Somebody Not In The Chain' }],
    ['scenarioDefined', { scenario: null }],
    ['objectivesDefined', { objectives: [] }],
    ['successCriteriaDefined', { successCriteria: [] }],
    ['failureCriteriaDefined', { failureCriteria: [] }],
    ['evaluatorIdentified', { evaluator: null }],
    ['participantsIdentified', { participants: [] }],
    ['humanAccountabilityDefined', { accountableFor: null }],
    ['exerciseBoundariesDeclared', { boundaries: [] }],
  ];
  for (const [prereq, mutation] of cases) {
    const g = gate({ ...APPROVED, ...mutation });
    assert.notEqual(g.state, 'READY', `'${prereq}' is decoration`);
    assert.ok(g.blockingPrerequisites.includes(prereq));
  }
});

// --- Part 3: boundaries -------------------------------------------------------------------------

test('r9: a production event is refused, and a rehearsal moves no real authority', () => {
  assert.equal(gate({ ...APPROVED, exerciseClass: 'PRODUCTION_EVENT' }).state, 'NOT_READY');
  assert.equal(own.EXERCISE_CLASSES.REHEARSAL.realAuthority, false);
  assert.equal(own.EXERCISE_CLASSES.SIMULATION.producesInstitutionalEvidence, false);
  assert.equal(own.EXERCISE_CLASSES.PRODUCTION_EVENT.realAuthority, true);
  // Every boundary the model declares is declared by the exercise.
  for (const b of Object.keys(own.EXERCISE_BOUNDARIES)) assert.ok(own.R9_EXERCISE.boundaries.includes(b));
});

// --- Part 9: independent evaluation -------------------------------------------------------------

test('r9: the evaluator cannot also be a participant', () => {
  const g = gate({ ...APPROVED, evaluator: 'ARB Vice-Chair' });
  assert.equal(g.state, 'NOT_READY');
  assert.ok(g.blockingPrerequisites.includes('evaluatorIndependent'));
  // The declared evaluator holds no role in the exercise.
  assert.ok(!own.R9_EXERCISE.participants.includes(own.R9_EXERCISE.evaluator));
});

// --- Part 5: the approved sequence --------------------------------------------------------------

test('r9: the expected sequence is drawn from the vocabulary and is possible', () => {
  const seq = own.validateEventSequence(own.R9_EXERCISE.expectedEventSequence);
  assert.equal(seq.valid, true, seq.problems.join('; '));
  // …and an impossible sequence blocks readiness.
  const bad = gate({ ...APPROVED, expectedEventSequence: [{ event: 'credentials-verified', at: 1 }, { event: 'succession-initiated', at: 2 }] });
  assert.ok(bad.blockingPrerequisites.includes('evidenceVocabularyValid'));
});

// --- Part 14: adversarial scenarios -------------------------------------------------------------
//
// Each produces a deterministic expected outcome, and every one of them is a refusal.

test('r9 adversarial: thirteen attacks on the succession record all fail closed', () => {
  const refuses = (label, fn) => {
    let closed = false;
    try { fn(); } catch (e) { closed = e.failClosed === true; }
    assert.ok(closed, label);
  };
  const planned = (r, id = 'A') => {
    r.plan(id, { scenario: 's', capability: 'c', responsibleAuthority: 'Architecture Review Board', intendedSuccessor: 'ARB Vice-Chair', scope: 'x', prerequisites: ['p'], declaredBy: 'OB' });
    return r;
  };
  const rehearsed = (actions = ['successor-assumed-authority'], outcome = 'completed') => {
    const r = planned(register());
    r.rehearse('A', { participants: ['p'], actions, outcome, failures: outcome === 'completed' ? [] : [{ mode: 'insufficient-quorum' }], runBy: 'Runner' });
    return r;
  };
  const CRIT = [{ id: 'k', met: () => true }];

  // 1. Successor impersonation. Caught by the readiness gate rather than by a register refusal —
  //    a holder outside the recorded chain never gets as far as an exercise.
  const impersonated = gate({ ...APPROVED, successor: 'Somebody Else Entirely' });
  assert.equal(impersonated.state, 'NOT_READY');
  assert.ok(impersonated.blockingPrerequisites.includes('successorIdentified'));
  // 2. Unauthorized authority claim — restoration to the acting holder.
  refuses('unauthorized authority claim', () => {
    const r = rehearsed(); r.verify('A', { criteria: CRIT, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
    r.restore('A', { restoredTo: 'ARB Vice-Chair', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' });
  });
  // 3. Forged restoration — no transfer ever happened.
  refuses('forged restoration event', () => {
    const r = rehearsed(['succession-initiated']);
    r.verify('A', { criteria: [{ id: 'k', met: (x) => x.evidence.REHEARSED.actions.includes('succession-initiated') }], evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
    r.restore('A', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' });
  });
  // 4. Missing evidence.
  refuses('missing evidence', () => planned(register()).rehearse('A', { participants: [], actions: [], outcome: 'completed', failures: [], runBy: 'R' }));
  // 5. Replayed event.
  refuses('replayed event', () => planned(register()).rehearse('A', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R', events: [{ event: 'authority-unavailable', at: 1 }, { event: 'authority-unavailable', at: 2 }] }));
  // 6. Altered timestamp — the clock runs backwards.
  refuses('altered timestamp', () => planned(register()).rehearse('A', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R', events: [{ event: 'authority-unavailable', at: 9 }, { event: 'succession-initiated', at: 2 }] }));
  // 7. Invalid event order.
  refuses('invalid event order', () => planned(register()).rehearse('A', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R', events: [{ event: 'credentials-verified', at: 1 }, { event: 'succession-initiated', at: 2 }] }));
  // 8. Quorum manipulation — a failed drill verified as successful.
  refuses('quorum manipulation', () => {
    const r = rehearsed(['succession-initiated'], 'failed');
    r.verify('A', { criteria: CRIT, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
  });
  // 9. Conflicting authority — the same exercise declared twice.
  refuses('conflicting succession attempt', () => { const r = planned(register()); planned(r); });
  // 10. Evaluator conflict — the runner verifies their own exercise.
  refuses('evaluator conflict', () => rehearsed().verify('A', { criteria: CRIT, evaluator: 'Runner', decision: 'verified', evidenceIntegrity: 'd' }));
  // 11. Evidence-chain corruption — an event outside the vocabulary.
  refuses('evidence chain corruption', () => planned(register()).rehearse('A', { participants: ['p'], actions: ['banana'], outcome: 'completed', failures: [], runBy: 'R' }));
  // 12. Premature verification — skipping the rehearsal.
  refuses('premature verification', () => planned(register()).verify('A', { criteria: CRIT, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' }));
  // 13. Premature restoration — skipping verification.
  refuses('premature restoration', () => rehearsed().restore('A', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

// --- Part 11: historical data quality -----------------------------------------------------------

test('r9: no pre-validation record persists, and one arriving from outside is marked not repaired', () => {
  const empty = own.successionEvidenceQuality(register(), { now: 0 });
  assert.equal(empty.count, 0);
  assert.match(empty.basis, /no pre-validation record persists anywhere/);
  assert.equal(empty.rewritesHistory, false);

  // A record as it would arrive from outside the register's own guards.
  const tainted = register();
  tainted.plan('T', { scenario: 's', capability: 'c', responsibleAuthority: 'A', intendedSuccessor: 'B', scope: 'x', prerequisites: ['p'], declaredBy: 'OB' });
  const rec = tainted._exercises.get('T');
  rec.state = 'REHEARSED';
  rec.evidence.REHEARSED = { participants: ['p'], actions: ['banana'], outcome: 'completed', failures: [], at: 0, runBy: 'R', events: [] };

  const q = own.successionEvidenceQuality(tainted, { now: 0 });
  assert.deepEqual(q.preValidation, ['T']);
  assert.deepEqual(q.excludedFromAssurance, ['T']);
  assert.equal(q.exercises[0].contributesToAssurance, false);
  // Preserved exactly as written.
  assert.deepEqual(q.exercises[0].unvalidatedActions, ['banana']);
});

// --- Part 17: what is and is not established ----------------------------------------------------

test('r9: institutional assurance is not claimed by any readiness result', () => {
  for (const g of [gate(APPROVED), gate(own.R9_EXERCISE), own.r9ReadinessGate(null, { now: 0 })]) {
    assert.equal(g.establishesInstitutionalAssurance, false);
    assert.equal(g.authorizes, false);
  }
  // And the resilience view still reports every governance capability as WEAK: nothing rehearsed.
  const CONTROLS = [
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const view = ir.capabilityResilienceView({ controls: CONTROLS, now: 0 });
  assert.equal(view.strong.length, 0);
  assert.equal(view.weak.length, 5);
});

test('r9: the readiness gate is deterministic', () => {
  assert.deepEqual(gate(APPROVED), gate(APPROVED));
  assert.deepEqual(gate(own.R9_EXERCISE), gate(own.R9_EXERCISE));
});
