'use strict';

// The succession exercise state machine: PLANNED -> REHEARSED -> VERIFIED -> AUTHORITY_RESTORED.
//
// This is an EXERCISE INSTANCE lifecycle, and it is deliberately not the same thing as
// SUCCESSION_ASSURANCE_LEVELS, which is a SUBSYSTEM maturity ladder. The ladder reads this register
// rather than keeping its own idea of what has been rehearsed, so there is one source of truth.
//
// The distinctions held here:
//
//     REHEARSED != VERIFIED          practising is not passing
//     AUTOMATED_EVIDENCE_READY != VERIFIED   a machine may evaluate criteria and may not conclude
//     SUCCESSION DESIGN != SUCCESSION PROOF  a plan is not a rehearsal

const test = require('node:test');
const assert = require('node:assert/strict');

const own = require('../src/governance/ownership');
const ir = require('../src/governance/institutional-resilience');

const CRITERIA = [
  { id: 'successor-identified', description: 'a successor was named', met: (r) => r.evidence.REHEARSED.actions.includes('successor-identified') },
  { id: 'credentials-verified', description: 'the successor established who they were', met: (r) => r.evidence.REHEARSED.actions.includes('credentials-verified') },
  { id: 'quorum-reached', description: 'the body reached quorum', met: (r) => r.evidence.REHEARSED.actions.includes('quorum-reached') },
  { id: 'capability-continued', description: 'the capability kept working', met: (r) => r.evidence.REHEARSED.actions.includes('capability-continued') },
];
const ACTIONS = ['succession-initiated', 'successor-identified', 'credentials-verified', 'quorum-reached', 'successor-assumed-authority', 'capability-continued'];

function advancing() {
  let tick = 0;
  const r = new own.SuccessionExerciseRegister({ clock: () => tick });
  r.tick = (n) => { tick = n; };
  return r;
}
const plan = (r, id = 'SYN-SUCC-001') => r.plan(id, {
  scenario: 'ARB chair unavailable during an architecture decision window',
  capability: 'governance-decision-recording', responsibleAuthority: 'Architecture Review Board',
  intendedSuccessor: 'ARB Vice-Chair', scope: 'assurance bounded context, approvingAuthority role',
  prerequisites: ['deputy named', 'quorum rules recorded'], declaredBy: 'Oversight Board',
});
// The complete §15 scenario, built once and reused.
function fullLifecycle() {
  const r = advancing();
  r.tick(10); plan(r);
  r.tick(40); r.rehearse('SYN-SUCC-001', {
    participants: ['ARB Vice-Chair', 'Oversight Board Secretariat'], actions: ACTIONS,
    outcome: 'completed', failures: [], runBy: 'Oversight Board Secretariat',
    authorityUnavailableAt: 12, initiatedAt: 15, successorConfirmedAt: 22,
  });
  r.tick(50); r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'sha256:synthetic-digest' });
  r.tick(60); r.restore('SYN-SUCC-001', {
    restoredTo: 'Architecture Review Board', restoredBy: 'Oversight Board',
    restorationEvent: 'primary resumed the chair at the next quorate sitting',
    governanceConfirmation: 'Oversight Board minuted the close of the interregnum',
  });
  return r;
}
const refuses = (fn) => assert.throws(fn, (e) => e.failClosed === true);

// --- §15: the end-to-end synthetic rehearsal ----------------------------------------------------

test('succession: the whole lifecycle runs end to end and changes nothing operational', () => {
  const r = fullLifecycle();
  const rec = r.get('SYN-SUCC-001');
  assert.equal(rec.state, 'AUTHORITY_RESTORED');
  assert.deepEqual(rec.history.map((h) => h.to), ['PLANNED', 'REHEARSED', 'VERIFIED', 'AUTHORITY_RESTORED']);
  // Evidence exists at every state, and each carries what its state requires.
  for (const state of ['PLANNED', 'REHEARSED', 'VERIFIED', 'AUTHORITY_RESTORED']) {
    assert.ok(rec.evidence[state], `no evidence recorded for ${state}`);
    for (const field of own.SUCCESSION_EXERCISE_STATES[state].requires) {
      assert.ok(field in rec.evidence[state], `${state} evidence is missing '${field}'`);
    }
  }
});

// --- §2/§3: the state machine -------------------------------------------------------------------

test('succession: every state is reachable', () => {
  const r = advancing();
  r.tick(10); plan(r);
  assert.equal(r.get('SYN-SUCC-001').state, 'PLANNED');
  r.tick(40); r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'Runner' });
  assert.equal(r.get('SYN-SUCC-001').state, 'REHEARSED');
  r.tick(50); r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
  assert.equal(r.get('SYN-SUCC-001').state, 'VERIFIED');
  r.tick(60); r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' });
  assert.equal(r.get('SYN-SUCC-001').state, 'AUTHORITY_RESTORED');
});

test('succession: PLANNED -> VERIFIED is refused', () => {
  const r = advancing(); plan(r);
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' }));
});

test('succession: PLANNED -> AUTHORITY_RESTORED is refused', () => {
  const r = advancing(); plan(r);
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

test('succession: REHEARSED -> AUTHORITY_RESTORED is refused', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

test('succession: an exercise cannot be moved backwards or re-declared', () => {
  const r = fullLifecycle();
  refuses(() => plan(r));
});

// --- §6/§7: rehearsed is not verified -----------------------------------------------------------

test('succession: a participant record alone never establishes VERIFIED', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['ARB Vice-Chair'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  assert.equal(r.get('SYN-SUCC-001').state, 'REHEARSED');
  assert.notEqual(r.get('SYN-SUCC-001').state, 'VERIFIED');
});

test('succession: the runner cannot verify their own exercise', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'Runner' });
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Runner', decision: 'verified', evidenceIntegrity: 'd' }));
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: null, decision: 'verified', evidenceIntegrity: 'd' }));
});

test('succession: verification requires its criteria to be met', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R' });
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' }));
});

test('succession: automated evidence is not verification', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  const auto = r.automatedEvidence('SYN-SUCC-001', { criteria: CRITERIA });
  assert.equal(auto.status, 'AUTOMATED_EVIDENCE_READY');
  assert.equal(auto.establishesVerification, false);
  assert.equal(auto.humanVerificationRequired, 'HUMAN_VERIFICATION');
  // Running it does not advance the record.
  assert.equal(r.get('SYN-SUCC-001').state, 'REHEARSED');
  assert.ok(!Object.keys(own.SUCCESSION_EXERCISE_STATES).includes('AUTOMATED_EVIDENCE_READY'));
});

// --- §4: failure scenarios ----------------------------------------------------------------------

test('succession: all fifteen failure modes can be recorded', () => {
  assert.equal(Object.keys(own.SUCCESSION_FAILURE_MODES).length, 15);
  for (const mode of Object.keys(own.SUCCESSION_FAILURE_MODES)) {
    const r = advancing(); plan(r);
    r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'failed', failures: [{ mode }], runBy: 'R' });
    assert.equal(r.get('SYN-SUCC-001').evidence.REHEARSED.failures[0].mode, mode);
  }
});

test('succession: a failed exercise can never be verified as successful', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'failed', failures: [{ mode: 'insufficient-quorum' }], runBy: 'R' });
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' }));
  // …and it can honestly be recorded as evaluated and not verified.
  r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'not-verified', evidenceIntegrity: 'd' });
  assert.equal(r.get('SYN-SUCC-001').evidence.VERIFIED.decision, 'not-verified');
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

test('succession: an unrecognised failure mode and an unstated outcome are both refused', () => {
  const r = advancing(); plan(r);
  refuses(() => r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'failed', failures: [{ mode: 'invented' }], runBy: 'R' }));
  refuses(() => r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, failures: [], runBy: 'R' }));
});

test('succession: unauthorized restoration is refused', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
  // Restoring to the acting holder rather than the primary is the office being kept by inertia.
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'ARB Vice-Chair', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

// --- §5: evidence is required -------------------------------------------------------------------

test('succession: a field that exists but says nothing is not evidence', () => {
  const r = advancing();
  refuses(() => r.plan('Z', { scenario: 's', capability: 'c', responsibleAuthority: 'A', intendedSuccessor: 'B', scope: 'x', prerequisites: [], declaredBy: 'OB' }));
  refuses(() => r.plan('Z', { scenario: '', capability: 'c', responsibleAuthority: 'A', intendedSuccessor: 'B', scope: 'x', prerequisites: ['p'], declaredBy: 'OB' }));
});

// --- §8: TTAR -----------------------------------------------------------------------------------

test('succession: TTAR is measured on the logical clock and is deterministic', () => {
  const t1 = fullLifecycle().ttar('SYN-SUCC-001');
  const t2 = fullLifecycle().ttar('SYN-SUCC-001');
  assert.deepEqual(t1, t2);
  assert.equal(t1.state, 'RESOLVED');
  assert.equal(t1.duration, 48);
  assert.equal(t1.unit, 'logical clock ticks');
  assert.deepEqual(t1.segments.map((s) => s.ticks), [3, 7, 38]);
  assert.equal(t1.informsGovernance, false, 'a measurement must not move a governance decision on its own');
});

test('succession: TTAR is UNKNOWN where a marker was never recorded', () => {
  const r = advancing(); r.tick(10); plan(r);
  r.tick(40); r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  const t = r.ttar('SYN-SUCC-001');
  assert.equal(t.state, 'UNKNOWN');
  assert.equal(t.duration, null, 'a duration from a missing marker is a number that looks measured');
  assert.ok(t.missing.length > 0);
});

test('succession: changing the markers changes TTAR', () => {
  const shifted = advancing();
  shifted.tick(10); plan(shifted);
  shifted.tick(40); shifted.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R', authorityUnavailableAt: 12, initiatedAt: 30, successorConfirmedAt: 35 });
  assert.notDeepEqual(shifted.ttar('SYN-SUCC-001').segments, fullLifecycle().ttar('SYN-SUCC-001').segments);
});

// --- §11: repeatability -------------------------------------------------------------------------

test('succession: identical inputs produce identical records', () => {
  assert.deepEqual(fullLifecycle().get('SYN-SUCC-001'), fullLifecycle().get('SYN-SUCC-001'));
  assert.deepEqual(fullLifecycle().exercises(), fullLifecycle().exercises());
});

// --- §10: succession feeds institutional resilience ---------------------------------------------

test('resilience: a capability with no rehearsed succession is not fully resilient', () => {
  const CONTROLS = [
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const spread = {
    spread: {
      title: 'two of every kind', contexts: ['assurance'],
      controls: ['APP-FIT-DECISION-QUALITY', 'APP-FIT-LIFECYCLE-DEFAULT-DENY'],
      documents: ['docs/architecture-governance.md', 'docs/adaptive-governance.md'],
      modules: ['src/assurance/institutional.js', 'src/assurance/epistemic.js'],
    },
  };
  const without = ir.governanceCapabilityResilience({ controls: CONTROLS, capabilities: spread, now: 0 });
  assert.equal(without.capabilities[0].state, 'SINGLE_POINT_OBSERVED');
  assert.equal(without.capabilities[0].heldBackBySuccession, true);
  assert.match(without.capabilities[0].reason, /a plan is not a rehearsal/);

  const reg = fullLifecycle();
  const with_ = ir.governanceCapabilityResilience({ controls: CONTROLS, capabilities: spread, successionExercises: reg, now: 0 });
  assert.equal(with_.capabilities[0].state, 'RESILIENT');
  assert.equal(with_.capabilities[0].successionRehearsed, true);
});

test('resilience: the five declared governance capabilities have never rehearsed succession', () => {
  const CONTROLS = [
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const r = ir.governanceCapabilityResilience({ controls: CONTROLS, now: 0 });
  assert.equal(r.successionNeverRehearsed.length, 5, 'recorded rather than smoothed');
  assert.equal(r.successionRehearsed.length, 0);
  for (const c of r.capabilities) assert.equal(c.successionLevel, 'EXECUTABLE');
});

// --- Phase 4: what AUTHORITY_RESTORED actually means --------------------------------------------
//
// Asked what it meant, the honest answer was "several different things". The state required a
// `restorationEvent` and the rehearsal recorded free-text `actions` that accepted the string
// "banana", so five genuinely different institutional events were indistinguishable: the successor
// assuming authority, the capability surviving, the primary returning, the acting arrangement being
// closed, and the drill finishing. A successor can assume authority and the capability still fail,
// and authority can return without the interregnum being closed — which is how an "acting"
// arrangement quietly becomes permanent.

test('events: the vocabulary separates the five events that used to be one string', () => {
  for (const e of ['successor-assumed-authority', 'capability-continued', 'authority-returned', 'interregnum-closed']) {
    assert.ok(own.SUCCESSION_EVENTS[e], `'${e}' is not a declared event`);
    assert.ok(own.SUCCESSION_EVENTS[e].distinctFrom, `'${e}' does not say what it is distinct from`);
  }
  // The two that must not be conflated, ordered apart.
  assert.ok(own.SUCCESSION_EVENTS['authority-returned'].order < own.SUCCESSION_EVENTS['interregnum-closed'].order);
  assert.ok(own.SUCCESSION_EVENTS['successor-assumed-authority'].order < own.SUCCESSION_EVENTS['authority-returned'].order);
  assert.match(own.SUCCESSION_EXERCISE_STATES.AUTHORITY_RESTORED.means, /two distinct events/i);
});

test('events: free text is no longer an action', () => {
  const r = advancing(); plan(r);
  refuses(() => r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ['banana'], outcome: 'completed', failures: [], runBy: 'R' }));
});

test('restoration: authority cannot be restored from a transfer that never happened', () => {
  const r = advancing();
  r.tick(10); plan(r);
  r.tick(40); r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R' });
  // A criterion the drill actually met, so verification succeeds and the refusal under test is the
  // restoration one rather than an unmet-criteria one.
  const initiated = [{ id: 'initiated', met: (x) => x.evidence.REHEARSED.actions.includes('succession-initiated') }];
  r.tick(50); r.verify('SYN-SUCC-001', { criteria: initiated, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
  r.tick(60);
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
});

test('restoration: the primary returning is not the interregnum closing', () => {
  const r = advancing();
  r.tick(10); plan(r);
  r.tick(40); r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ACTIONS, outcome: 'completed', failures: [], runBy: 'R' });
  r.tick(50); r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' });
  r.tick(60);
  refuses(() => r.restore('SYN-SUCC-001', {
    restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e',
    governanceConfirmation: 'g', restorationEvents: ['authority-returned'],
  }));
});

// --- Phase 5: evidence ordering -----------------------------------------------------------------

test('ordering: an impossible chronology fails closed', () => {
  const seq = (events) => {
    const r = advancing(); plan(r);
    return () => r.rehearse('SYN-SUCC-001', { participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R', events });
  };
  refuses(seq([{ event: 'succession-initiated', at: 9 }, { event: 'authority-unavailable', at: 2 }]));   // reversed
  refuses(seq([{ event: 'credentials-verified', at: 1 }, { event: 'succession-initiated', at: 2 }]));    // impossible order
  refuses(seq([{ event: 'authority-unavailable', at: 1 }, { event: 'authority-unavailable', at: 2 }]));  // replayed
  refuses(seq([{ event: 'authority-unavailable' }]));                                                    // missing timestamp
  refuses(seq([{ event: 'not-a-real-event', at: 1 }]));                                                  // corrupted
});

test('ordering: a well-formed sequence is accepted, and equal ticks are legitimate', () => {
  const r = advancing(); plan(r);
  r.rehearse('SYN-SUCC-001', {
    participants: ['p'], actions: ['succession-initiated'], outcome: 'completed', failures: [], runBy: 'R',
    events: [{ event: 'authority-unavailable', at: 1 }, { event: 'succession-initiated', at: 1 }, { event: 'successor-assumed-authority', at: 3 }],
  });
  assert.equal(r.get('SYN-SUCC-001').state, 'REHEARSED');
  assert.equal(own.validateEventSequence([{ event: 'authority-unavailable', at: 1 }, { event: 'succession-initiated', at: 1 }]).valid, true);
});

// --- Phase 2: the two models derive, never duplicate --------------------------------------------

test('models: the ladder derives from the exercise register rather than duplicating it', () => {
  const before = own.successionExercise('assurance', { now: 0 });
  assert.equal(before.rehearsed, false);
  const after = own.successionExercise('assurance', { exercises: fullLifecycle(), now: 0 });
  assert.equal(after.rehearsed, true, 'a verified exercise did not reach the ladder');
  assert.equal(after.attainedLevel, 'VERIFIED');
  // The two vocabularies stay different.
  assert.notDeepEqual(own.SUCCESSION_ASSURANCE_ORDER, Object.keys(own.SUCCESSION_EXERCISE_STATES));
});

// --- Phase 10: the derived resilience view ------------------------------------------------------

const VIEW_CAPS = {
  probe: { title: 'p', contexts: ['assurance'], controls: ['APP-FIT-DECISION-QUALITY'], documents: ['docs/architecture-governance.md'], modules: ['src/assurance/epistemic.js'] },
};
function probeRegister(outcome, decision) {
  let tick = 0;
  const r = new own.SuccessionExerciseRegister({ clock: () => tick });
  tick = 10; r.plan('X', { scenario: 's', capability: 'probe', responsibleAuthority: 'Architecture Review Board', intendedSuccessor: 'ARB Vice-Chair', scope: 'x', prerequisites: ['p'], declaredBy: 'OB' });
  tick = 40; r.rehearse('X', { participants: ['p'], actions: ['successor-assumed-authority', 'capability-continued'], outcome, failures: outcome === 'completed' ? [] : [{ mode: 'insufficient-quorum' }], runBy: 'R', authorityUnavailableAt: 12, initiatedAt: 15, successorConfirmedAt: 22 });
  tick = 50; r.verify('X', { criteria: [{ id: 'k', met: () => true }], evaluator: 'Auditor General', decision, evidenceIntegrity: 'd' });
  if (decision === 'verified') { tick = 60; r.restore('X', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }); }
  return r;
}
const viewRow = (reg) => ir.capabilityResilienceView({ capabilities: VIEW_CAPS, controls: [{ id: 'APP-FIT-DECISION-QUALITY', pass: true }], successionExercises: reg, now: 0 }).rows[0];

test('view: every resilience state is reachable', () => {
  assert.equal(viewRow(probeRegister('completed', 'verified')).state, 'STRONG');
  assert.equal(viewRow(probeRegister('failed', 'not-verified')).state, 'CRITICAL');
  assert.equal(viewRow(null).state, 'WEAK');
});

test('view: it is derived and owns nothing', () => {
  const full = ir.capabilityResilienceView({ controls: [], now: 0 });
  assert.equal(full.derived, true);
  assert.equal(full.isRegister, false);
  assert.equal(full.authorizes, false);
  assert.deepEqual(full.contradictions, [], 'the ladder and the register disagree');
  assert.doesNotMatch(full.basis, /%|percent/);
});

test('view: the five governance capabilities are weak and that is recorded', () => {
  const CONTROLS = [
    ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
    ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
  ];
  const full = ir.capabilityResilienceView({ controls: CONTROLS, now: 0 });
  assert.equal(full.weak.length, 5);
  assert.equal(full.strong.length, 0);
  for (const r of full.rows) assert.ok(r.flags.includes('unrehearsed-succession'));
});

// --- Phase 14: the failure path -----------------------------------------------------------------

test('failure path: the platform refuses to claim success when conditions are not met', () => {
  const r = advancing();
  r.tick(10); plan(r);
  // The drill runs and the quorum is never reached.
  r.tick(40); r.rehearse('SYN-SUCC-001', {
    participants: ['ARB Vice-Chair'], actions: ['succession-initiated', 'successor-identified'],
    outcome: 'failed', failures: [{ mode: 'insufficient-quorum' }, { mode: 'approver-unavailable' }], runBy: 'Runner',
    authorityUnavailableAt: 12, initiatedAt: 15,
  });
  // Automated evidence must not be ready.
  const auto = r.automatedEvidence('SYN-SUCC-001', { criteria: CRITERIA });
  assert.equal(auto.status, 'AUTOMATED_EVIDENCE_INCOMPLETE');
  assert.ok(auto.unresolvedFindings.length > 0);
  // Verification as successful is refused; recording the failure honestly is not.
  r.tick(50);
  refuses(() => r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'verified', evidenceIntegrity: 'd' }));
  r.verify('SYN-SUCC-001', { criteria: CRITERIA, evaluator: 'Auditor General', decision: 'not-verified', evidenceIntegrity: 'd' });
  // Restoration is refused on a failed exercise.
  r.tick(60);
  refuses(() => r.restore('SYN-SUCC-001', { restoredTo: 'Architecture Review Board', restoredBy: 'OB', restorationEvent: 'e', governanceConfirmation: 'g' }));
  // TTAR stays UNKNOWN — restoration never happened.
  assert.equal(r.ttar('SYN-SUCC-001').state, 'UNKNOWN');
  // And the ladder does not credit it as verified.
  const ladder = own.successionExercise('assurance', { exercises: r, now: 0 });
  assert.equal(ladder.verified, false);
});
