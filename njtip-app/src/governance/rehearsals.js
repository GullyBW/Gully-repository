'use strict';
// Governance Rehearsals (Phase 13, Part 12). Extends the governance-oversight bounded context.
//
// Phase 11 rehearsed the SYSTEM: chaos experiments prove a fault is detected, contained, recovered
// and verified. Nothing rehearsed the PEOPLE. An escalation path that has never been walked, a
// break-glass authorisation nobody has exercised, a custody hand-over practised for the first time
// during a real seizure — each is a procedure that exists on paper and has never been tested against
// a human being under time pressure.
//
// The property that makes this worth building, and the one most after-action reports quietly drop:
//
//   THE REHEARSAL IS SCORED AGAINST WHAT THE DOCUMENT PROMISED, NOT AGAINST WHAT HAPPENED.
//
// An exercise that took four hours is not a success because everyone tried hard; it is a failure if
// the runbook says thirty minutes. So every rehearsal declares its expectations UP FRONT — from the
// documented procedure — and the after-action report compares observation against expectation. A
// rehearsal whose expectations were written afterwards proves nothing, so recording an observation
// before the expectations exist is refused.
const ownership = require('./ownership');

// The rehearsals Part 12 names. Each declares the steps that must occur, in order, and where the
// expectation comes from — an expectation with no source is somebody's opinion of how it should go.
const REHEARSALS = {
  'incident-escalation': {
    title: 'An incident is escalated to the accountable authority',
    steps: ['detected', 'raised', 'acknowledged', 'authority-engaged', 'resolved'],
    expectations: { acknowledgementMinutes: 60, resolutionMinutes: 240 },
    expectationSource: 'docs/operations/runbook.md — escalations acknowledged within 24 h; this rehearsal holds to a tighter drill target',
    exercise: 'incident-escalation',
    tests: 'Whether the people named in the escalation path can actually be reached and will act.',
  },
  'disaster-recovery': {
    title: 'Service is restored after a total zone loss',
    steps: ['detected', 'declared', 'restore-started', 'service-restored', 'integrity-verified'],
    expectations: { resolutionMinutes: 30, integrityVerified: true },
    expectationSource: 'docs/operations/runbook.md — restore the volume, then confirm invariants before serving',
    exercise: 'disaster-recovery',
    tests: 'Whether the documented restore actually restores, and whether anyone checks integrity before serving.',
  },
  'emergency-authorization': {
    title: 'Break-glass authority is exercised and recorded',
    steps: ['requested', 'justified', 'authorised', 'used', 'reviewed'],
    expectations: { acknowledgementMinutes: 15, reviewedAfter: true, distinctAuthoriser: true },
    expectationSource: 'Zero Trust break-glass: AAL3, named authority, recorded and reviewed after the fact',
    exercise: 'emergency-authorization',
    tests: 'Whether emergency access can be obtained quickly AND is reviewed afterwards rather than forgotten.',
  },
  'evidence-custody': {
    title: 'Evidence changes hands without breaking the chain',
    steps: ['sealed', 'transferred', 'received', 'chain-verified'],
    expectations: { chainUnbroken: true, witnessed: true },
    expectationSource: 'Custody ledger: append-only, hash-chained, no single person completes a custody action',
    exercise: 'evidence-custody',
    tests: 'Whether a hand-over survives the chain check, and whether a second person was actually present.',
  },
  'legislative-change': {
    title: 'A gazetted amendment is assessed and mapped',
    steps: ['observed', 'assessed', 'mapped', 'gaps-identified', 'remediation-assigned'],
    expectations: { resolutionMinutes: 2880, mappedToControls: true },
    expectationSource: 'docs/compliance-intelligence.md — an unassessed change is a gap, not silence',
    exercise: 'incident-escalation',
    tests: 'Whether a change is noticed and mapped at all, rather than discovered at an inspection.',
  },
  'executive-approval': {
    title: 'A deployment authorisation is sought and recorded',
    steps: ['package-assembled', 'reviewed', 'decided', 'recorded'],
    expectations: { resolutionMinutes: 1440, decisionRecorded: true, distinctAuthoriser: true },
    expectationSource: 'Authorization is a recorded decision by a named human; evidence never authorizes',
    exercise: 'emergency-authorization',
    tests: 'Whether the approving authority is reachable and whether the decision is written down.',
  },
};

const MINUTE = 60_000;

class RehearsalRegister {
  constructor({ clock = () => 0, exercises = null } = {}) { this._clock = clock; this._runs = new Map(); this._seq = 0; this._exercises = exercises; }

  catalogue() { return Object.entries(REHEARSALS).map(([id, r]) => ({ rehearsal: id, ...r })); }

  // Schedule a rehearsal. The expectations are copied from the catalogue AT THIS MOMENT and frozen
  // onto the run, so a later edit to the catalogue cannot retroactively change what a past exercise
  // was held to.
  schedule({ rehearsal, at = null, facilitator, participants = [] } = {}) {
    const spec = REHEARSALS[rehearsal];
    if (!spec) throw new Error(`unknown rehearsal '${rehearsal}' — one of ${Object.keys(REHEARSALS).join(', ')}`);
    if (!facilitator) { const e = new Error('a rehearsal must name a facilitator'); e.failClosed = true; throw e; }
    if (!participants.length) { const e = new Error('a rehearsal with no participants rehearses nobody'); e.failClosed = true; throw e; }
    const id = `REH-${String(++this._seq).padStart(4, '0')}`;
    const run = {
      id, rehearsal, title: spec.title, facilitator, participants: [...participants],
      scheduledAt: at ?? this._clock(),
      expectations: { ...spec.expectations }, expectationSource: spec.expectationSource,
      requiredSteps: [...spec.steps], observations: [], closed: false,
    };
    this._runs.set(id, run);
    return { ...run };
  }

  // Record what actually happened, step by step. Refused after the run is closed: an after-action
  // report you can still add observations to is one that can be made to say anything.
  observe(runId, { step, at, by, note = null, ...extra } = {}) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    if (run.closed) { const e = new Error(`${runId} is closed — an after-action report that can still be edited is one that can be made to say anything`); e.failClosed = true; throw e; }
    if (!run.requiredSteps.includes(step)) throw new Error(`'${step}' is not a step of '${run.rehearsal}' — one of ${run.requiredSteps.join(', ')}`);
    if (!Number.isFinite(at)) throw new Error('an observation must be timestamped');
    if (!by) { const e = new Error('an observation must name who recorded it'); e.failClosed = true; throw e; }
    run.observations.push({ step, at, by, note, ...extra });
    return { ...run.observations[run.observations.length - 1] };
  }

  close(runId, { by, at = null } = {}) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    if (!by) { const e = new Error('closing a rehearsal requires a named human'); e.failClosed = true; throw e; }
    run.closed = true; run.closedBy = by; run.closedAt = at ?? this._clock();
    // Part 11 linkage: a rehearsal that actually happened is what makes participation current.
    if (this._exercises && REHEARSALS[run.rehearsal].exercise) {
      for (const p of run.participants) {
        try { this._exercises.recordParticipation({ person: p, exercise: REHEARSALS[run.rehearsal].exercise, at: run.closedAt, by, outcome: 'completed' }); } catch (_) { /* register may not accept it */ }
      }
    }
    return this.afterAction(runId);
  }

  // THE AFTER-ACTION REPORT. Observation compared against the expectation recorded before the run.
  afterAction(runId) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    const seen = new Map(run.observations.map((o) => [o.step, o]));
    const missed = run.requiredSteps.filter((s) => !seen.has(s));
    const outOfOrder = [];
    let previous = -Infinity, previousStep = null;
    for (const step of run.requiredSteps) {
      const o = seen.get(step);
      if (!o) continue;
      if (o.at < previous) outOfOrder.push(`${step} was observed before ${previousStep}`);
      previous = o.at; previousStep = step;
    }

    const first = run.observations.length ? Math.min(...run.observations.map((o) => o.at)) : null;
    const last = run.observations.length ? Math.max(...run.observations.map((o) => o.at)) : null;
    const findings = [];
    const exp = run.expectations;

    // Timing, against what the document promised.
    const ack = seen.get('acknowledged') || seen.get('justified') || seen.get('reviewed');
    if (Number.isFinite(exp.acknowledgementMinutes)) {
      if (!ack || first === null) findings.push({ expectation: 'acknowledgementMinutes', met: false, detail: 'no acknowledgement was observed at all' });
      else {
        const mins = (ack.at - first) / MINUTE;
        findings.push({ expectation: 'acknowledgementMinutes', met: mins <= exp.acknowledgementMinutes, observed: +mins.toFixed(1), expected: exp.acknowledgementMinutes, detail: `acknowledged after ${mins.toFixed(1)} min against a ${exp.acknowledgementMinutes} min expectation` });
      }
    }
    if (Number.isFinite(exp.resolutionMinutes)) {
      if (missed.length || first === null) findings.push({ expectation: 'resolutionMinutes', met: false, detail: `the rehearsal did not complete: missing ${missed.join(', ') || 'observations'}` });
      else {
        const mins = (last - first) / MINUTE;
        findings.push({ expectation: 'resolutionMinutes', met: mins <= exp.resolutionMinutes, observed: +mins.toFixed(1), expected: exp.resolutionMinutes, detail: `completed in ${mins.toFixed(1)} min against a ${exp.resolutionMinutes} min expectation` });
      }
    }
    // Boolean expectations: each must be OBSERVED true, and an unobserved one is not met.
    for (const key of ['integrityVerified', 'chainUnbroken', 'witnessed', 'reviewedAfter', 'mappedToControls', 'decisionRecorded']) {
      if (exp[key] === undefined) continue;
      const observed = run.observations.some((o) => o[key] === true);
      findings.push({ expectation: key, met: observed, detail: observed ? 'observed' : `not observed — an expectation nobody recorded meeting is not met` });
    }
    // Separation of duties inside the rehearsal itself.
    if (exp.distinctAuthoriser) {
      const authorisers = new Set(run.observations.filter((o) => ['authorised', 'decided'].includes(o.step)).map((o) => o.by));
      const requesters = new Set(run.observations.filter((o) => ['requested', 'package-assembled'].includes(o.step)).map((o) => o.by));
      const overlap = [...authorisers].filter((a) => requesters.has(a));
      findings.push({ expectation: 'distinctAuthoriser', met: authorisers.size > 0 && overlap.length === 0, detail: overlap.length ? `${overlap.join(', ')} both requested and authorised` : authorisers.size ? 'the authoriser was not the requester' : 'nobody was observed authorising' });
    }

    const failed = findings.filter((f) => !f.met);
    return {
      run: runId, rehearsal: run.rehearsal, title: run.title,
      facilitator: run.facilitator, participants: run.participants,
      closed: run.closed, closedBy: run.closedBy || null,
      expectations: run.expectations, expectationSource: run.expectationSource,
      steps: run.requiredSteps.map((s) => ({ step: s, observed: seen.has(s), at: seen.has(s) ? seen.get(s).at : null, by: seen.has(s) ? seen.get(s).by : null })),
      missedSteps: missed, outOfOrder,
      findings, unmetExpectations: failed.map((f) => f.expectation),
      // The point of the whole exercise: measured against the promise, not against effort.
      passed: failed.length === 0 && missed.length === 0 && outOfOrder.length === 0,
      lessons: [
        ...missed.map((s) => `Step '${s}' did not happen. Either the procedure is wrong or nobody knew to do it.`),
        ...outOfOrder.map((o) => `${o}. The documented order was not followed.`),
        ...failed.map((f) => `Expectation '${f.expectation}' was not met: ${f.detail}`),
      ],
      informationalOnly: true, authorizes: false,
      note: 'Scored against the expectations recorded before the rehearsal began, taken from the documented procedure. A rehearsal whose expectations were written afterwards proves nothing.',
    };
  }

  runs() { return [...this._runs.values()].map((r) => ({ ...r })); }

  // Which rehearsals have never been run, and which have been run and failed. Both matter, and the
  // first is the one an assurance report usually omits.
  coverage({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = Object.keys(REHEARSALS).sort().map((id) => {
      const runs = this.runs().filter((r) => r.rehearsal === id && r.closed);
      const reports = runs.map((r) => this.afterAction(r.id));
      const latest = reports.length ? reports[reports.length - 1] : null;
      return {
        rehearsal: id, title: REHEARSALS[id].title, tests: REHEARSALS[id].tests,
        runs: runs.length, everRun: runs.length > 0,
        latestPassed: latest ? latest.passed : null,
        latestAt: runs.length ? runs[runs.length - 1].closedAt : null,
        unmet: latest ? latest.unmetExpectations : [],
        state: !runs.length ? 'never-rehearsed' : latest.passed ? 'passed' : 'failed',
      };
    });
    return {
      rehearsals: rows, now: t,
      neverRehearsed: rows.filter((r) => !r.everRun).map((r) => r.rehearsal),
      failing: rows.filter((r) => r.state === 'failed').map((r) => r.rehearsal),
      passing: rows.filter((r) => r.state === 'passed').map((r) => r.rehearsal),
      coverage: rows.length ? +(rows.filter((r) => r.everRun).length / rows.length).toFixed(4) : null,
      // Never rehearsed is its own state and the worst one: a procedure nobody has walked is a
      // procedure whose first test will be a real incident.
      sound: rows.every((r) => r.state === 'passed'),
      informationalOnly: true, authorizes: false,
      note: 'A procedure nobody has rehearsed is one whose first test will be a real incident. Never-rehearsed is reported separately from failed, because it is worse and it is easier to overlook.',
    };
  }

  report({ now = null } = {}) {
    return {
      catalogue: this.catalogue(),
      runs: this.runs().map((r) => ({ id: r.id, rehearsal: r.rehearsal, closed: r.closed, participants: r.participants.length })),
      afterActions: this.runs().filter((r) => r.closed).map((r) => this.afterAction(r.id)),
      coverage: this.coverage({ now }),
      failClosed: true, authorizes: false,
    };
  }

  // --- Part 7: the conditions a run was held under -----------------------------------------------
  //
  // Recorded at SCHEDULE time or not at all, and this is the point: a facilitator who can set
  // `unannounced: true` after seeing the result can make any drill look like whatever they need.
  declareConditions(runId, { announced, faultsInjected = false, liveSystems = false, by, at = null } = {}) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    if (run.closed) { const e = new Error(`${runId} is closed — the conditions a run was held under cannot be declared after the result is known`); e.failClosed = true; throw e; }
    if (run.conditions) { const e = new Error(`${runId} already has declared conditions — restating them after the run has begun is how a tabletop becomes an unannounced drill`); e.failClosed = true; throw e; }
    if (typeof announced !== 'boolean') { const e = new Error('a rehearsal must state whether the participants were told it was coming — that is the single largest determinant of what it tests'); e.failClosed = true; throw e; }
    if (!by) { const e = new Error('declaring the conditions of a rehearsal requires a named human'); e.failClosed = true; throw e; }
    // DERIVED, not chosen. The facilitator states the facts; the band follows from them.
    const band = !announced ? 'unannounced' : liveSystems ? 'live' : faultsInjected ? 'simulated' : 'tabletop';
    run.conditions = { announced, faultsInjected, liveSystems, by, at: at ?? this._clock(), realism: band };
    return { ...run.conditions };
  }

  // A facilitator's judgement on the two qualities the platform genuinely cannot derive. Attributed,
  // and refused after close for the same reason observations are.
  assess(runId, { coordinationQuality, communicationEffectiveness, by, note = null, at = null } = {}) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    if (run.closed) { const e = new Error(`${runId} is closed — an assessment added afterwards is one that can be made to fit the outcome`); e.failClosed = true; throw e; }
    if (!by) { const e = new Error('an exercise assessment requires a named assessor'); e.failClosed = true; throw e; }
    const bands = ['poor', 'adequate', 'good'];
    for (const [field, value] of [['coordinationQuality', coordinationQuality], ['communicationEffectiveness', communicationEffectiveness]]) {
      if (!bands.includes(value)) throw new Error(`'${field}' must be one of ${bands.join(', ')} — a numeric score would imply a precision a human judgement does not have`);
    }
    run.assessment = { coordinationQuality, communicationEffectiveness, by, note, at: at ?? this._clock() };
    return { ...run.assessment };
  }

  // A lesson. Requires an owner: a lesson nobody owns is an observation.
  recordLesson(runId, { lesson, owner, by, at = null } = {}) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    if (!lesson) throw new Error('a lesson must say what was learned');
    if (!owner) { const e = new Error('a lesson must name who owns acting on it — a lesson nobody owns is an observation'); e.failClosed = true; throw e; }
    if (!by) { const e = new Error('a lesson must name who recorded it'); e.failClosed = true; throw e; }
    if (!run.lessons) run.lessons = [];
    run.lessons.push({ lesson, owner, by, at: at ?? this._clock() });
    return { ...run.lessons[run.lessons.length - 1] };
  }

  // The seven qualities for one closed run. Every one states whether it was derived or assessed, and
  // an unassessed quality is `unknown` rather than absent.
  exerciseIntelligence(runId) {
    const run = this._runs.get(runId);
    if (!run) throw new Error('unknown rehearsal run: ' + runId);
    const after = run.closed ? this.afterAction(runId) : null;
    const quality = (id, value, known, detail) => ({
      quality: id, ...EXERCISE_QUALITIES[id],
      value: known ? value : null, known,
      detail: known ? detail : `not assessed — ${EXERCISE_QUALITIES[id].ifUnknown}`,
    });

    const acted = new Set(run.observations.map((o) => o.by));
    const participated = run.participants.filter((p) => acted.has(p));
    const stepsSeen = new Set(run.observations.map((o) => o.step));
    const lessons = run.lessons || [];
    const conditions = run.conditions || null;

    const qualities = [
      quality('realism', conditions ? conditions.realism : null, !!conditions,
        conditions ? `${conditions.realism}: ${REALISM_BANDS[conditions.realism].means}` : null),
      quality('objectiveCompletion', +(stepsSeen.size / run.requiredSteps.length).toFixed(4), run.observations.length > 0,
        `${stepsSeen.size} of ${run.requiredSteps.length} required steps were observed`),
      quality('participantPerformance', run.participants.length ? +(participated.length / run.participants.length).toFixed(4) : null, run.observations.length > 0,
        `${participated.length} of ${run.participants.length} declared participants recorded an action`),
      quality('coordinationQuality', run.assessment ? run.assessment.coordinationQuality : null, !!run.assessment,
        run.assessment ? `assessed '${run.assessment.coordinationQuality}' by ${run.assessment.by}` : null),
      quality('communicationEffectiveness', run.assessment ? run.assessment.communicationEffectiveness : null, !!run.assessment,
        run.assessment ? `assessed '${run.assessment.communicationEffectiveness}' by ${run.assessment.by}` : null),
      quality('recoveryEffectiveness', after ? after.passed : null, !!after,
        after ? (after.passed ? 'every expectation recorded beforehand was met' : `unmet: ${after.unmetExpectations.map((u) => u.expectation).join(', ')}`) : null),
      quality('lessonsLearned', lessons.length, run.closed,
        lessons.length ? `${lessons.length} lesson(s), each with a named owner` : 'no lesson was recorded — either the rehearsal found nothing or nobody wrote it down, and those are different'),
    ];
    const unknown = qualities.filter((q) => !q.known);
    return {
      run: runId, rehearsal: run.rehearsal, closed: run.closed,
      qualities, unknownQualities: unknown.map((q) => q.quality),
      conditions, assessment: run.assessment || null, lessons,
      // An unassessed quality is not a good one, so a run is only fully characterised when all seven
      // are known — and that is the figure the maturity model below reads.
      fullyCharacterised: unknown.length === 0,
      basis: unknown.length
        ? `${qualities.length - unknown.length} of ${qualities.length} qualities are known; ${unknown.map((q) => q.quality).join(', ')} were never assessed and are UNKNOWN rather than assumed adequate`
        : 'all seven qualities are known for this run',
      informationalOnly: true, authorizes: false,
    };
  }

  // Longitudinal exercise maturity, derived from the whole history. This is the figure that says
  // whether the institution's rehearsing is improving, which passing every drill never does.
  exerciseMaturity({ now = null } = {}) {
    const t = now ?? this._clock();
    const closed = this.runs().filter((r) => r.closed);
    const intel = closed.map((r) => this.exerciseIntelligence(r.id));
    const cov = this.coverage({ now: t });
    const assessed = intel.filter((i) => i.assessment);
    const beyondTabletop = intel.filter((i) => i.conditions && REALISM_BANDS[i.conditions.realism].rank > 0);
    const withOwnedLessons = intel.filter((i) => i.lessons.length > 0);

    // Derived, and each level requires everything below it — a level reached by skipping is not a
    // level, it is a coincidence.
    let level = 'E0';
    if (closed.length) level = 'E1';
    if (level === 'E1' && assessed.length) level = 'E2';
    if (level === 'E2' && beyondTabletop.length) level = 'E3';
    if (level === 'E3' && withOwnedLessons.length && cov.neverRehearsed.length === 0) level = 'E4';

    const realismCounts = Object.fromEntries(Object.keys(REALISM_BANDS).map((b) => [b, intel.filter((i) => i.conditions && i.conditions.realism === b).length]));
    return {
      level, ...EXERCISE_MATURITY_LEVELS[level],
      levels: EXERCISE_MATURITY_ORDER.map((id) => ({ level: id, ...EXERCISE_MATURITY_LEVELS[id] })),
      qualities: Object.entries(EXERCISE_QUALITIES).map(([quality, q]) => ({ quality, ...q })),
      realismBands: Object.entries(REALISM_BANDS).map(([band, b]) => ({ band, ...b, runs: realismCounts[band] })),
      runs: closed.length, assessedRuns: assessed.length,
      beyondTabletop: beyondTabletop.length, runsWithLessons: withOwnedLessons.length,
      neverRehearsed: cov.neverRehearsed,
      fullyCharacterised: intel.filter((i) => i.fullyCharacterised).length,
      // What the NEXT level costs, so the figure is actionable rather than a grade.
      nextLevel: level === 'E4' ? null : EXERCISE_MATURITY_ORDER[EXERCISE_MATURITY_ORDER.indexOf(level) + 1],
      toReachNext: level === 'E0' ? 'close a rehearsal'
        : level === 'E1' ? 'have a facilitator assess coordination and communication on a run'
          : level === 'E2' ? 'run one rehearsal beyond a tabletop — inject a fault, involve a live system, or do not announce it'
            : level === 'E3' ? `record an owned lesson, and rehearse the ${cov.neverRehearsed.length} scenario(s) never run: ${cov.neverRehearsed.join(', ')}`
              : null,
      measurable: closed.length > 0,
      basis: closed.length
        ? `${closed.length} closed rehearsal(s); ${assessed.length} assessed, ${beyondTabletop.length} beyond a tabletop, ${withOwnedLessons.length} producing an owned lesson.`
        : 'No rehearsal has been closed. Exercise maturity is E0, and the cheapest way to pass every rehearsal is to run none.',
      now: t, informationalOnly: true, authorizes: false,
      note: 'Realism is derived from the conditions rather than assessed by the facilitator: an announced, scheduled walkthrough is a tabletop whatever anybody scores it. An unassessed quality is UNKNOWN, not adequate — the cheapest way to pass every rehearsal is to run easier rehearsals, and this figure is what makes that visible.',
    };
  }
}

// --- Operational exercise intelligence (Phase 16, Part 7) ------------------------------------------
//
// The after-action report answers one question: did the run meet the expectations recorded before it
// began. That is the right question and it is not enough to tell an institution whether its
// rehearsing is getting better, because the cheapest way to pass every rehearsal is to run easier
// rehearsals.
//
// So seven qualities, and the one that keeps the rest honest:
//
//   REALISM IS DERIVED FROM THE CONDITIONS, NOT ASSESSED BY THE FACILITATOR. An announced, scheduled
//   walkthrough against no live system is a tabletop, whatever anybody scores it. The facilitator can
//   grade coordination and communication — those genuinely need a human judgement — but they cannot
//   grade how real their own exercise was.
//
// And the rule every quality obeys:
//
//   AN UNASSESSED QUALITY IS UNKNOWN, NOT GOOD. A rehearsal whose coordination nobody graded has
//   unknown coordination, and an exercise maturity computed as though unknown meant fine is the
//   reason drills stop finding anything.
const EXERCISE_QUALITIES = {
  realism: {
    derived: true,
    asks: 'How close were the conditions to a real incident?',
    from: 'whether the run was announced, whether faults were injected, and whether live systems were involved',
    ifUnknown: 'Nobody can tell a rehearsal that would have caught something from one that could not.',
  },
  objectiveCompletion: {
    derived: true,
    asks: 'Were the documented steps actually completed, in order?',
    from: 'the observations recorded against the required steps',
    ifUnknown: 'A rehearsal that stopped halfway reads the same as one that finished.',
  },
  participantPerformance: {
    derived: true,
    asks: 'Did the people who were supposed to act actually act?',
    from: 'the share of declared participants who recorded at least one observation',
    ifUnknown: 'A rehearsal attended by a list of names is indistinguishable from one people took part in.',
  },
  coordinationQuality: {
    derived: false,
    asks: 'Did the people involved work as one, or in parallel?',
    from: 'a facilitator assessment — this genuinely needs a human judgement and the platform cannot derive it',
    ifUnknown: 'The failure mode that shows up in a real incident is the one nobody graded.',
  },
  communicationEffectiveness: {
    derived: false,
    asks: 'Did the right people learn the right thing in time?',
    from: 'a facilitator assessment',
    ifUnknown: 'Communication is the thing that fails first and is measured last.',
  },
  recoveryEffectiveness: {
    derived: true,
    asks: 'Was the thing actually restored, within the expectation recorded beforehand?',
    from: 'the after-action report\'s expectation outcomes',
    ifUnknown: 'A rehearsal can be declared successful without anything having been recovered.',
  },
  lessonsLearned: {
    derived: true,
    asks: 'Did the run produce anything anybody has to act on?',
    from: 'recorded lessons, each with an owner',
    ifUnknown: 'A rehearsal that produced no lesson either found nothing or nobody wrote it down, and those are different.',
  },
};

// Realism bands, derived from conditions rather than graded. Ordered weakest first.
const REALISM_BANDS = {
  tabletop: { rank: 0, means: 'Announced, scheduled, discussed. Tests whether people know the plan.' },
  simulated: { rank: 1, means: 'Faults were injected against a model or a non-production system.' },
  live: { rank: 2, means: 'Live systems were involved, still announced.' },
  unannounced: { rank: 3, means: 'Nobody was told it was coming. The only kind that tests what people actually do.' },
};

// Longitudinal exercise maturity. Derived from the history, never assessed.
const EXERCISE_MATURITY_LEVELS = {
  E0: { rank: 0, name: 'Unexercised', means: 'No rehearsal has been run and closed.' },
  E1: { rank: 1, name: 'Rehearsed', means: 'Rehearsals happen. Nothing says whether they are realistic or whether they produce anything.' },
  E2: { rank: 2, name: 'Assessed', means: 'Rehearsals are graded on coordination and communication by a facilitator.' },
  E3: { rank: 3, name: 'Realistic', means: 'At least one rehearsal has gone beyond a tabletop against live or injected conditions.' },
  E4: { rank: 4, name: 'Learning', means: 'Rehearsals produce owned lessons, and the estate rehearses everything in the catalogue.' },
};
const EXERCISE_MATURITY_ORDER = ['E0', 'E1', 'E2', 'E3', 'E4'];

module.exports = { RehearsalRegister, REHEARSALS, EXERCISE_QUALITIES, REALISM_BANDS, EXERCISE_MATURITY_LEVELS, EXERCISE_MATURITY_ORDER };
