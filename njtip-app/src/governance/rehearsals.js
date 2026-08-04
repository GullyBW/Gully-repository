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
}

module.exports = { RehearsalRegister, REHEARSALS };
