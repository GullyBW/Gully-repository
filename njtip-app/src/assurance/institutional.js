'use strict';
// Executive Governance Intelligence (Part 15), Continuous Improvement Intelligence (Part 19) and the
// Institutional Assurance Framework (Part 20). Extends the assurance bounded context.
//
// This is the layer everything else in Phase 13 reports into, which makes it the layer most likely
// to quietly become decoration. Three rules keep it honest.
//
//   1. NO MANUALLY ENTERED EXECUTIVE METRIC. Every panel is a function of a register. There is no
//      parameter anywhere below that lets a caller state a figure; supplying one is an error.
//
//   2. AN UNMEASURED DOMAIN IS REPORTED AS UNMEASURED, NEVER AS SATISFIED. The default state of
//      every assurance domain is that nobody has looked, and a framework that renders that as a
//      green tick is worse than no framework, because it is trusted.
//
//   3. IT PROVES READINESS AND NEVER AUTHORIZES. Thirteen green domains still print NOT AUTHORIZED.
//      Authorization is a recorded decision by a named human, and no aggregate of evidence produces
//      one.
const evidenceConfidence = require('./evidence-confidence');

// A panel is a named question with a derivation. `derivedFrom` is the module that answers it, so a
// reader can go and check the number rather than take it.
const EXECUTIVE_PANELS = {
  institutionalResilience: { question: 'Could the institution survive losing any one person, process, document or system?', derivedFrom: 'src/governance/institutional-resilience.js' },
  governanceMaturity: { question: 'How far has governance moved from declared to continuously assured?', derivedFrom: 'src/assurance/evidence-confidence.js (governanceMaturity)' },
  operationalReadiness: { question: 'Can the platform be run, observed and recovered?', derivedFrom: 'src/assurance/evidence-confidence.js (readinessModel)' },
  missionReadiness: { question: 'Is the platform delivering the outcomes it exists for?', derivedFrom: 'src/observability/business.js' },
  documentationHealth: { question: 'Does the documentation still describe the implementation?', derivedFrom: 'src/architecture/documentation-assurance.js' },
  organizationalContinuity: { question: 'Is there a validated alternative for every accountable role?', derivedFrom: 'src/governance/ownership.js (knowledgeContinuity)' },
  complianceEvolution: { question: 'Are legal obligations moving toward compliance or away from it?', derivedFrom: 'src/legislation/compliance-intelligence.js' },
  knowledgeContinuity: { question: 'Would the institution keep working if the people changed?', derivedFrom: 'src/governance/ownership.js' },
  simulationConfidence: { question: 'How much may we rely on what the twin predicts?', derivedFrom: 'src/twin2/operations-twin.js' },
  assumptionHealth: { question: 'Are the beliefs the platform rests on still being examined?', derivedFrom: 'src/architecture/assumptions.js' },
  // --- Strategic intelligence (Phase 14, Part 19) ----------------------------------------------
  strategicReadiness: { question: 'Could the institution absorb the changes it can already see coming?', derivedFrom: 'src/legislation/compliance-intelligence.js (regulatoryReadiness) and src/twin2/operations-twin.js' },
  organizationalMaturity: { question: 'Is the institution getting better at governing itself, or only busier?', derivedFrom: 'src/architecture/drift-prevention.js (adaptiveGovernanceAnalytics)' },
  operationalSustainability: { question: 'Can the estate be run with the people and capacity it actually has?', derivedFrom: 'src/governance/optimization.js (capacityPlan)' },
  decisionQuality: { question: 'Do the decisions taken turn out to do what they said they would?', derivedFrom: 'src/architecture/decision-memory.js' },
  publicTrust: { question: 'Do the conditions under which public trust would be warranted currently hold?', derivedFrom: 'src/observability/business.js (publicTrustIndicators)' },
  // --- Institutional health (Phase 15, Part 15) ------------------------------------------------
  governanceHealth: { question: 'Is governance functioning, or jamming?', derivedFrom: 'src/governance/optimization.js (governanceOptimization)' },
  legalAuthorityCompleteness: { question: 'Can the institution say what permits each capability to operate?', derivedFrom: 'src/legislation/legal-authority.js' },
  assumptionMaturity: { question: 'How far have the beliefs the platform rests on been taken through verification?', derivedFrom: 'src/architecture/assumptions.js (maturityReport)' },
  controlEffectiveness: { question: 'Do the controls actually catch the things they were written for?', derivedFrom: 'src/assurance/control-effectiveness.js' },
  dependencyResilience: { question: 'Does every critical capability have a validated alternative in every dependency category?', derivedFrom: 'src/governance/institutional-resilience.js (dependencyIntelligence)' },
  organizationalLearning: { question: 'Does a corrected failure change what people can do next time?', derivedFrom: 'src/assurance/institutional.js (institutionalLearning)' },
  documentationIntegrity: { question: 'Does every claim and diagram in the governed corpus still resolve against the implementation?', derivedFrom: 'src/architecture/documentation-assurance.js' },
};

// The thirteen domains Part 20 names. Each declares what it would mean for that domain to be
// unverified — the sentence that stops "unmeasured" being read as "fine".
const ASSURANCE_DOMAINS = {
  architecture: { unverifiedMeans: 'The system may not be the one described, and every other assurance rests on the description.' },
  security: { unverifiedMeans: 'Controls may not hold, and nothing would say so until they were tested by somebody hostile.' },
  privacy: { unverifiedMeans: 'Identity minimisation may have lapsed, which is unrecoverable for the person it happens to.' },
  governance: { unverifiedMeans: 'Decisions may be unattributable, so they cannot be challenged.' },
  documentation: { unverifiedMeans: 'An operator following the runbook may be following something that no longer works.' },
  operationalReadiness: { unverifiedMeans: 'The platform may not be recoverable, and the first test would be an outage.' },
  organizationalReadiness: { unverifiedMeans: 'The people accountable may not be able to act.' },
  institutionalResilience: { unverifiedMeans: 'A single person, document or system may be able to stop a constitutional capability.' },
  training: { unverifiedMeans: 'Somebody may hold a role they are not currently competent to exercise.' },
  knowledgeContinuity: { unverifiedMeans: 'A departure may take a capability with it.' },
  compliance: { unverifiedMeans: 'A legal obligation may be unmet, and discovered at an inspection.' },
  missionReadiness: { unverifiedMeans: 'The platform may be running well and not achieving what it exists for.' },
  evidenceQuality: { unverifiedMeans: 'Every figure above may rest on evidence nobody has assessed.' },
  // --- Adaptive assurance (Phase 14, Part 20) --------------------------------------------------
  dependencyResilience: { unverifiedMeans: 'A capability may rest on a single dataset, a single site, a single instrument or a single board, and nothing would have asked.' },
  strategicReadiness: { unverifiedMeans: 'A change everybody can see coming may arrive with nothing prepared for it.' },
  learningMaturity: { unverifiedMeans: 'The institution may be repairing the same class of failure indefinitely and scoring perfectly on every improvement measure while it does.' },
  governanceAdaptability: { unverifiedMeans: 'Governance may be jamming — bottlenecked, overloaded, or leaning on exceptions — with no signal until a decision is missed.' },
  publicTrustIndicators: { unverifiedMeans: 'The conditions under which reporting corruption is worth the risk may have stopped holding, and that is the one thing the platform exists to protect.' },
  // --- Adaptive institutional intelligence (Phase 15, Part 20) ----------------------------------
  legalAuthority: { unverifiedMeans: 'A capability may be operating with nothing recording what permits it to, which is not a paperwork gap but a capability nobody can defend.' },
  controlEffectiveness: { unverifiedMeans: 'Controls may run, pass, and catch nothing they were written for, and the build would stay green throughout.' },
  institutionalSustainability: { unverifiedMeans: 'The institution may be able to run today and not next year, and nothing would say which.' },
};

// --- Governance state intelligence (Phase 14, Part 10) -------------------------------------------
//
// Phase 13's assurance framework had three states: verified, failing, unmeasured. That was already
// an improvement on the usual two, and it still collapsed four genuinely different situations into
// "unmeasured":
//
//   nobody has looked · there is nothing to look at · it does not apply here ·
//   somebody looked, found a gap, and a named authority accepted it
//
// Those four need four different actions from four different people, and a dashboard that renders
// them identically tells a board that a deliberate, signed-off risk acceptance and a control nobody
// has ever run are the same thing. So there are seven states and THEY ARE NEVER MERGED — not in
// aggregation, not in a percentage, not in a colour.
//
// The `countsAsAssured` flag exists so that no completeness figure can be computed by accident: every
// state has to declare whether it counts, and only two of the seven do.
const GOVERNANCE_STATES = {
  verified: {
    countsAsAssured: true, needsAction: false,
    means: 'A control ran and held, and the evidence resolves.',
    action: 'Nothing. Keep it running.',
  },
  'accepted-risk': {
    countsAsAssured: true, needsAction: false,
    means: 'A gap exists and a named authority accepted it, with a rationale and an expiry.',
    action: 'Review before the acceptance expires. An expired acceptance stops covering anything without anyone withdrawing it.',
    // Assured is not the same as fine. It means somebody is answerable for it, which is the most any
    // governance system can offer for a risk that has not been closed.
    caveat: 'This counts as governed, not as safe. Somebody has taken responsibility; the gap is still there.',
  },
  failed: {
    countsAsAssured: false, needsAction: true,
    means: 'A control ran and did not hold.',
    action: 'Fix it, or record why it is acceptable. Both are decisions; leaving it is not.',
  },
  missing: {
    countsAsAssured: false, needsAction: true,
    means: 'No control exists at all. Distinct from failing: there is nothing to repair.',
    action: 'Build the control, or record that the obligation does not need one.',
  },
  'pending-review': {
    countsAsAssured: false, needsAction: true,
    means: 'Evidence exists and the accountable human has not yet assessed it.',
    action: 'Complete the review. Evidence nobody has read is not assurance.',
  },
  'not-applicable': {
    countsAsAssured: false, needsAction: false,
    means: 'The obligation genuinely does not apply here, and somebody recorded why.',
    action: 'Nothing, until the scope changes. An unexplained not-applicable is an unknown wearing a better label.',
  },
  unknown: {
    countsAsAssured: false, needsAction: true,
    means: 'Nobody has looked. The default state of everything.',
    action: 'Look. This is the state that must never be rendered as a green tick.',
  },
};

// `not-applicable` is the state most easily abused — it removes an item from every denominator — so
// it is the one state that cannot be asserted without a recorded reason and a named person.
function governanceState({ state, justification = null, by = null, expiresAt = null, now = 0 } = {}) {
  if (!GOVERNANCE_STATES[state]) throw new Error(`unknown governance state '${state}' — one of ${Object.keys(GOVERNANCE_STATES).join(', ')}`);
  const spec = GOVERNANCE_STATES[state];
  if (state === 'not-applicable' && (!justification || !by)) {
    const e = new Error('`not-applicable` requires a named person and a recorded reason — an unexplained not-applicable removes an obligation from every denominator and nobody can tell it apart from an unknown');
    e.failClosed = true; throw e;
  }
  if (state === 'accepted-risk') {
    if (!by || !justification) { const e = new Error('`accepted-risk` requires a named authority and a rationale'); e.failClosed = true; throw e; }
    if (!Number.isFinite(expiresAt)) { const e = new Error('`accepted-risk` requires an expiry — an acceptance nobody revisits is a gap that was renamed'); e.failClosed = true; throw e; }
    if (now >= expiresAt) {
      // Lapses back to the truth rather than to nothing: the risk was never closed.
      return { state: 'failed', ...GOVERNANCE_STATES.failed, lapsedFrom: 'accepted-risk', by, justification, expiresAt, reason: 'the acceptance has expired, so the gap is uncovered again' };
    }
  }
  return { state, ...spec, by, justification, expiresAt };
}

// Completeness across a set of governed items. Every state is counted separately and the report
// refuses to produce a single percentage without also naming what it excluded.
function governanceCompleteness(items = [], { now = 0 } = {}) {
  const rows = items.map((i) => {
    const resolved = governanceState({ ...i, now });
    return { item: i.item || i.id || '(unnamed)', domain: i.domain || null, ...resolved };
  });
  const byState = {};
  for (const id of Object.keys(GOVERNANCE_STATES)) byState[id] = 0;
  for (const r of rows) byState[r.state] += 1;

  const applicable = rows.filter((r) => r.state !== 'not-applicable');
  const assured = applicable.filter((r) => GOVERNANCE_STATES[r.state].countsAsAssured);
  const actionable = rows.filter((r) => GOVERNANCE_STATES[r.state].needsAction);
  return {
    items: rows, count: rows.length,
    states: Object.entries(GOVERNANCE_STATES).map(([id, s]) => ({ state: id, ...s })),
    byState,
    // Never merged: each of the seven is reported by name, and the two that look like success are
    // reported apart because one of them is a gap somebody signed for.
    verified: byState.verified, acceptedRisk: byState['accepted-risk'],
    failed: byState.failed, missing: byState.missing,
    pendingReview: byState['pending-review'], notApplicable: byState['not-applicable'], unknown: byState.unknown,
    applicable: applicable.length,
    completeness: applicable.length ? +(assured.length / applicable.length).toFixed(4) : null,
    // The sentence that has to travel with the figure. A completeness of 1.0 built mostly out of
    // accepted risks is a different estate from one built out of verifications.
    completenessBasis: applicable.length
      ? `${assured.length} of ${applicable.length} applicable items are assured: ${byState.verified} verified and ${byState['accepted-risk']} accepted as risk. ${byState['not-applicable']} item(s) were excluded as not applicable, each with a recorded reason.`
      : 'no applicable items — a completeness figure over an empty set would be 100% of nothing',
    lapsed: rows.filter((r) => r.lapsedFrom).map((r) => r.item),
    actionable: actionable.map((r) => ({ item: r.item, state: r.state, action: r.action })),
    // Unknown is called out on its own, because it is the state everything starts in and the one a
    // dashboard is most tempted to leave off.
    unexamined: rows.filter((r) => r.state === 'unknown').map((r) => r.item),
    sound: byState.unknown === 0 && byState.failed === 0 && byState.missing === 0 && byState['pending-review'] === 0,
    informationalOnly: true, authorizes: false,
    note: 'Seven states, never merged. Unknown, missing, not-applicable and accepted-risk are four different situations needing four different people to act; a dashboard that colours them identically is telling a board something false.',
  };
}

// --- Part 19: continuous improvement -------------------------------------------------------------
//
//   Fitness failure → root cause → corrective action → ADR → verification → operational outcome
//
// The loop only means something if it CLOSES. An improvement recorded as "done" with no verification
// is a task that was ticked, so verification requires the control that originally failed to be
// passing — the same control, not a new one somebody wrote to pass.
const IMPROVEMENT_STAGES = ['observed', 'root-caused', 'action-agreed', 'decided', 'verified', 'outcome-recorded'];

class ImprovementLoop {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._seq = 0; }

  // A loop starts from a control that actually failed. It cannot be opened speculatively: an
  // improvement with no observed failure behind it is a project, not a correction.
  observe({ control, detail, observedBy, at = null } = {}) {
    if (!control) throw new Error('an improvement starts from the control that failed');
    if (!detail) throw new Error('an improvement must record what was observed');
    if (!observedBy) { const e = new Error('an observed failure must name who or what observed it'); e.failClosed = true; throw e; }
    const id = `IMP-${String(++this._seq).padStart(4, '0')}`;
    const item = { id, control, detail, observedBy, at: at ?? this._clock(), stage: 'observed', history: [{ stage: 'observed', by: observedBy, at: at ?? this._clock(), detail }] };
    this._items.set(id, item);
    return { ...item };
  }

  advance(id, stage, { by, detail, adr = null, at = null, controls = [] } = {}) {
    const item = this._items.get(id);
    if (!item) throw new Error('unknown improvement: ' + id);
    const index = IMPROVEMENT_STAGES.indexOf(stage);
    if (index < 0) throw new Error(`unknown improvement stage '${stage}' — one of ${IMPROVEMENT_STAGES.join(', ')}`);
    if (index !== IMPROVEMENT_STAGES.indexOf(item.stage) + 1) {
      const e = new Error(`'${item.stage}' → '${stage}' skips a stage — the loop only means something if every step happens`);
      e.failClosed = true; throw e;
    }
    if (!by || !detail) { const e = new Error('every improvement step requires a named human and what they did'); e.failClosed = true; throw e; }
    if (stage === 'decided' && !adr) { const e = new Error('a corrective action that changes the architecture requires an ADR — otherwise the fix is a change nobody decided'); e.failClosed = true; throw e; }
    if (stage === 'verified') {
      // THE RULE THAT MAKES THE LOOP CLOSE: the control that failed must now be passing. Not a new
      // control, not a report saying it was fixed — the same identifier, holding.
      const found = controls.find((c) => (typeof c === 'string' ? c : c.id) === item.control);
      const passing = found && typeof found === 'object' ? found.pass === true : false;
      if (!passing) {
        const e = new Error(`'${item.control}' is not passing, so this improvement is not verified — a fix verified by anything other than the control that failed is a fix nobody checked`);
        e.failClosed = true; throw e;
      }
    }
    item.stage = stage;
    item.history.push({ stage, by, at: at ?? this._clock(), detail, adr });
    if (adr) item.adr = adr;
    return { ...item };
  }

  items() { return [...this._items.values()].map((i) => ({ ...i })); }

  history({ now = null } = {}) {
    const rows = this.items().map((i) => ({
      id: i.id, control: i.control, stage: i.stage, adr: i.adr || null,
      closed: i.stage === 'outcome-recorded',
      // An improvement stuck before verification is the one worth naming: the work was done and
      // nobody confirmed it worked.
      stalledAt: i.stage === 'outcome-recorded' ? null : i.stage,
      steps: i.history.length, openedAt: i.at,
      durationMs: i.history.length > 1 ? i.history[i.history.length - 1].at - i.at : null,
    }));
    const closed = rows.filter((r) => r.closed);
    return {
      improvements: rows, count: rows.length,
      stages: [...IMPROVEMENT_STAGES],
      closed: closed.length, open: rows.length - closed.length,
      closureRate: rows.length ? +(closed.length / rows.length).toFixed(4) : null,
      stalled: rows.filter((r) => !r.closed).map((r) => ({ id: r.id, at: r.stalledAt })),
      meanClosureMs: closed.length ? Math.round(closed.reduce((a, r) => a + (r.durationMs || 0), 0) / closed.length) : null,
      now, informationalOnly: true, authorizes: false,
      note: 'An improvement is verified only when the control that originally failed is passing. A fix verified by a new control somebody wrote to pass is a fix nobody checked.',
    };
  }
}

// --- Institutional learning (Phase 14, Part 18) ---------------------------------------------------
//
//   Incident → Investigation → Root Cause → Corrective Action → Verification →
//   Governance Update → ADR → Training → Future Readiness
//
// The improvement loop already closes the first six links, and closing them is a CORRECTION. It is
// not learning. An institution that fixes the same class of problem three times has corrected three
// times and learned nothing, and every metric in a normal improvement dashboard would show it doing
// well — closure rate 100%, mean time to close falling.
//
// The distinction this module insists on:
//
//   A CORRECTION CHANGES THE SYSTEM. LEARNING CHANGES WHAT THE PEOPLE CAN DO NEXT TIME.
//
// So the chain does not end at verification. It ends at future readiness, and readiness only counts
// when somebody was trained AFTER the incident and then demonstrated it in a rehearsal. Training
// booked before the incident is not a response to it, and training with no rehearsal behind it is a
// certificate.
const LEARNING_STAGES = {
  incident: { from: 'improvement loop', evidencedBy: 'a control that ran and failed', meansIfAbsent: 'Nothing to learn from — or nothing anybody recorded.' },
  investigation: { from: 'improvement loop', evidencedBy: 'the root-caused stage, with a named investigator', meansIfAbsent: 'The failure was noticed and not looked into.' },
  'root-cause': { from: 'improvement loop', evidencedBy: 'the recorded cause, distinct from the symptom', meansIfAbsent: 'The symptom was treated.' },
  'corrective-action': { from: 'improvement loop', evidencedBy: 'the action-agreed stage', meansIfAbsent: 'A cause was found and nothing was decided about it.' },
  verification: { from: 'improvement loop', evidencedBy: 'the control that originally failed, now passing', meansIfAbsent: 'A fix nobody checked.' },
  'governance-update': { from: 'improvement loop', evidencedBy: 'a decision recorded at the decided stage', meansIfAbsent: 'The system changed and the rules governing it did not.' },
  adr: { from: 'improvement loop', evidencedBy: 'the ADR cited when the corrective action was decided', meansIfAbsent: 'An architectural change nobody decided.' },
  training: { from: 'the training register', evidencedBy: 'a completion recorded AFTER the incident', meansIfAbsent: 'The system knows something the people operating it do not.' },
  'future-readiness': { from: 'the exercise register', evidencedBy: 'a rehearsal AFTER the training', meansIfAbsent: 'People were told, and nobody has seen them do it.' },
  // Phase 15, Part 12. The last link, and the only one that says the institution is measurably
  // better than it was. Everything above can be true while readiness sits exactly where it started.
  'readiness-improvement': { from: 'a readiness assessment supplied by the caller', evidencedBy: 'a readiness figure recorded AFTER the rehearsal that is higher than the one recorded before the incident', meansIfAbsent: 'Everything was done and nothing improved. The institution went round the loop and came out where it went in.' },
};

function institutionalLearning({ loop = null, training = null, exercises = null, controls = [], readiness = null, now = 0 } = {}) {
  if (!loop) {
    return {
      incidents: [], count: 0, stages: Object.entries(LEARNING_STAGES).map(([id, s]) => ({ stage: id, ...s })),
      learningRate: null, correctionRate: null, measurable: false,
      corrected: [], learned: [], correctedNotLearned: [],
      note: 'No improvement register was supplied, so whether this institution learns anything is UNKNOWN. That is not the same as it learning nothing, and it is certainly not the same as it learning.',
      informationalOnly: true, authorizes: false,
    };
  }
  const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
  const completions = training ? training.completions() : [];
  const participation = exercises ? exercises.participation() : [];

  const rows = loop.items().map((i) => {
    const at = (stage) => { const h = i.history.find((x) => x.stage === stage); return h ? h.at : null; };
    const reached = (stage) => at(stage) !== null;
    const verifiedAt = at('verified');

    // Training must come AFTER the incident, or it was not a response to it.
    const trainedAfter = completions.filter((c) => c.at > i.at);
    // Readiness must come after the training, or nobody has seen it done.
    const earliestTraining = trainedAfter.length ? Math.min(...trainedAfter.map((c) => c.at)) : null;
    const rehearsedAfter = earliestTraining === null ? [] : participation.filter((p) => p.at > earliestTraining && p.outcome === 'completed');

    const stages = {
      incident: { reached: true, detail: `${i.control} failed: ${i.detail}` },
      investigation: { reached: reached('root-caused'), detail: reached('root-caused') ? `investigated by ${i.history.find((x) => x.stage === 'root-caused').by}` : LEARNING_STAGES.investigation.meansIfAbsent },
      'root-cause': { reached: reached('root-caused'), detail: reached('root-caused') ? i.history.find((x) => x.stage === 'root-caused').detail : LEARNING_STAGES['root-cause'].meansIfAbsent },
      'corrective-action': { reached: reached('action-agreed'), detail: reached('action-agreed') ? i.history.find((x) => x.stage === 'action-agreed').detail : LEARNING_STAGES['corrective-action'].meansIfAbsent },
      verification: { reached: reached('verified') && holding.get(i.control) !== false, detail: reached('verified') ? `${i.control} is passing` : LEARNING_STAGES.verification.meansIfAbsent },
      'governance-update': { reached: reached('decided'), detail: reached('decided') ? `decided by ${i.history.find((x) => x.stage === 'decided').by}` : LEARNING_STAGES['governance-update'].meansIfAbsent },
      adr: { reached: !!i.adr, detail: i.adr || LEARNING_STAGES.adr.meansIfAbsent },
      training: { reached: trainedAfter.length > 0, detail: trainedAfter.length ? `${trainedAfter.length} completion(s) recorded after the incident` : LEARNING_STAGES.training.meansIfAbsent },
      'future-readiness': { reached: rehearsedAfter.length > 0, detail: rehearsedAfter.length ? `${rehearsedAfter.length} rehearsal(s) completed after the training` : LEARNING_STAGES['future-readiness'].meansIfAbsent },
      // Part 12: did anything actually get better? `readiness` is a series of {at, score} the caller
      // measures; with none supplied this is UNKNOWN rather than absent, and unknown does not count.
      'readiness-improvement': (() => {
        if (!Array.isArray(readiness) || readiness.length < 2) {
          return { reached: false, unknown: true, detail: 'no readiness series was supplied, so whether anything improved is unknown — which is not the same as it having improved' };
        }
        const before = readiness.filter((r) => r.at <= i.at).slice(-1)[0] || null;
        const after = readiness.filter((r) => r.at > i.at).slice(-1)[0] || null;
        if (!before || !after) return { reached: false, unknown: true, detail: 'the readiness series does not straddle this incident, so no change can be attributed to it' };
        return {
          reached: after.score > before.score, unknown: false,
          detail: after.score > before.score
            ? `readiness moved from ${before.score} to ${after.score} after this incident`
            : `readiness was ${before.score} before and ${after.score} after — ${LEARNING_STAGES['readiness-improvement'].meansIfAbsent}`,
        };
      })(),
    };
    const missing = Object.entries(stages).filter(([, s]) => !s.reached).map(([id]) => id);
    // Corrected: the system was changed and the change was verified.
    const corrected = stages.verification.reached;
    // Learned: and the people can do something different next time, demonstrated rather than told.
    const learned = corrected && stages.training.reached && stages['future-readiness'].reached;
    // Part 12: improved is strictly stronger than learned. The institution can learn and still be
    // exactly as ready as it was, and that distinction is the one a board actually needs.
    const improved = learned && stages['readiness-improvement'].reached;
    return {
      id: i.id, control: i.control, openedAt: i.at, verifiedAt,
      stages, missing,
      corrected, learned, improved,
      // The row that matters. Everything else is a percentage.
      state: improved ? 'improved' : learned ? 'learned-not-improved' : corrected ? 'corrected-not-learned' : 'open',
      why: improved ? 'the system changed, people were trained and demonstrated it, and readiness measurably improved'
        : learned ? 'the system changed and people demonstrated the training, and readiness did not measurably move'
          : corrected ? `the system was fixed and nothing shows the institution can do better next time — missing: ${missing.join(', ')}`
            : `not yet corrected — missing: ${missing.join(', ')}`,
    };
  });

  const corrected = rows.filter((r) => r.corrected);
  const learned = rows.filter((r) => r.learned);
  const improved = rows.filter((r) => r.improved);
  const correctedNotLearned = rows.filter((r) => r.corrected && !r.learned);
  const learnedNotImproved = rows.filter((r) => r.learned && !r.improved);
  return {
    incidents: rows, count: rows.length,
    stages: Object.entries(LEARNING_STAGES).map(([id, s]) => ({ stage: id, ...s })),
    chain: Object.keys(LEARNING_STAGES),
    corrected: corrected.map((r) => r.id), learned: learned.map((r) => r.id),
    improved: improved.map((r) => r.id),
    correctedNotLearned: correctedNotLearned.map((r) => r.id),
    // Part 12: kept as its own list. An institution can learn from every incident and be no readier
    // than it was, and folding that into the learning rate would hide it.
    learnedNotImproved: learnedNotImproved.map((r) => r.id),
    improvementRate: rows.length ? +(improved.length / rows.length).toFixed(4) : null,
    correctionRate: rows.length ? +(corrected.length / rows.length).toFixed(4) : null,
    // The number a normal improvement dashboard does not have, and the only one that distinguishes
    // an institution that improves from one that repeatedly repairs.
    learningRate: rows.length ? +(learned.length / rows.length).toFixed(4) : null,
    measurable: rows.length > 0 && training !== null && exercises !== null,
    unmeasurable: [
      ...(training === null ? ['no training register was supplied — whether anybody was taught anything is unknown'] : []),
      ...(exercises === null ? ['no exercise register was supplied — whether anybody has demonstrated it is unknown'] : []),
      ...(rows.length === 0 ? ['no incident has been recorded, so there is nothing to have learned from'] : []),
    ],
    // Where the chain most often breaks, counted rather than guessed. This says what to fix about
    // how the institution learns, rather than about any one incident.
    weakestStage: (() => {
      const counts = Object.keys(LEARNING_STAGES).map((s) => ({ stage: s, missing: rows.filter((r) => r.missing.includes(s)).length }));
      const worst = counts.slice().sort((a, b) => b.missing - a.missing || a.stage.localeCompare(b.stage))[0];
      return worst && worst.missing ? worst : null;
    })(),
    now, informationalOnly: true, authorizes: false,
    note: 'A correction changes the system; learning changes what the people can do next time. An incident that was fixed, with nobody trained afterwards and nothing rehearsed, is reported as CORRECTED-NOT-LEARNED — because an institution that repairs the same class of failure repeatedly scores perfectly on every other measure.',
  };
}

// --- Institutional validation workshops (Phase 16, Part 6) -----------------------------------------
//
// The improvement loop above starts from a control that FAILED. That is the right trigger for a
// correction and it cannot start the other kind of learning: the kind where people sit in a room,
// look at how the institution actually works, and find something no control was watching for.
//
// A validation workshop is that room, made auditable. Its whole value rests on one rule:
//
//   AN UNRESOLVED ISSUE IS A FIRST-CLASS OUTCOME, AND CLOSING A WORKSHOP DOES NOT CLOSE IT.
//
// The failure mode of every workshop ever held is that the minutes record the decisions and quietly
// lose the things nobody agreed on. So an unresolved issue survives the close, is carried in the
// report, and the workshop cannot be closed while a corrective action has no owner or no follow-up
// date — because an action with neither is a sentence in a document.
const WORKSHOP_OUTCOMES = {
  finding: { mustHave: ['detail'], resolvesWorkshop: false, means: 'Something the participants observed about how the institution actually works.' },
  decision: { mustHave: ['detail', 'by'], resolvesWorkshop: false, means: 'Something the participants agreed, attributed to who agreed it.' },
  'unresolved-issue': { mustHave: ['detail'], resolvesWorkshop: false, means: 'Something nobody could agree on or answer. Survives the close, deliberately.' },
  'corrective-action': { mustHave: ['detail', 'owner', 'dueAt'], resolvesWorkshop: false, means: 'Something somebody committed to do, with a name and a date.' },
};

const WORKSHOP_STATES = ['convened', 'closed'];

class ValidationWorkshop {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._workshops = new Map(); this._seq = 0; }

  // Objectives are declared at convening. A workshop whose objectives are written afterwards is a
  // workshop that achieved whatever it happened to achieve.
  convene({ subject, objectives = [], participants = [], facilitator, at = null } = {}) {
    if (!subject) throw new Error('a validation workshop must state what it is about');
    if (!facilitator) { const e = new Error('a validation workshop must name a facilitator'); e.failClosed = true; throw e; }
    if (!objectives.length) { const e = new Error('a validation workshop must declare its objectives before it begins — objectives written afterwards are a description of whatever happened'); e.failClosed = true; throw e; }
    if (participants.length < 2) { const e = new Error('a validation workshop needs at least two participants — one person reviewing their own work is a review, not a validation'); e.failClosed = true; throw e; }
    const id = `VW-${String(++this._seq).padStart(4, '0')}`;
    const rec = {
      id, subject, objectives: [...objectives], participants: [...participants], facilitator,
      state: 'convened', convenedAt: at ?? this._clock(), outcomes: [], followUps: [],
    };
    this._workshops.set(id, rec);
    return { ...rec };
  }

  record(id, { outcome, detail, by = null, owner = null, dueAt = null, objective = null, at = null } = {}) {
    const w = this._workshops.get(id);
    if (!w) throw new Error('unknown validation workshop: ' + id);
    if (w.state === 'closed') { const e = new Error(`${id} is closed — an outcome added afterwards is one the room never saw`); e.failClosed = true; throw e; }
    const spec = WORKSHOP_OUTCOMES[outcome];
    if (!spec) throw new Error(`unknown workshop outcome '${outcome}' — one of ${Object.keys(WORKSHOP_OUTCOMES).join(', ')}`);
    const values = { detail, by, owner, dueAt };
    for (const field of spec.mustHave) {
      if (values[field] === null || values[field] === undefined || values[field] === '') {
        const e = new Error(`a '${outcome}' must state '${field}'${field === 'owner' ? ' — an action nobody owns is a sentence in a document' : field === 'dueAt' ? ' — an action with no date is one nobody is late for' : ''}`);
        e.failClosed = true; throw e;
      }
    }
    // An outcome may cite an objective, and if it does the objective must be one that was declared.
    if (objective && !w.objectives.includes(objective)) throw new Error(`'${objective}' was not one of this workshop's declared objectives`);
    const rec = { outcome, detail, by, owner, dueAt, objective, at: at ?? this._clock(), resolved: false };
    w.outcomes.push(rec);
    return { ...rec };
  }

  // Closing records what the room concluded. It does NOT resolve anything: an unresolved issue and
  // an open corrective action both survive it, which is the point.
  close(id, { by, at = null } = {}) {
    const w = this._workshops.get(id);
    if (!w) throw new Error('unknown validation workshop: ' + id);
    if (!by) { const e = new Error('closing a validation workshop requires a named human'); e.failClosed = true; throw e; }
    const orphaned = w.outcomes.filter((o) => o.outcome === 'corrective-action' && (!o.owner || !Number.isFinite(o.dueAt)));
    if (orphaned.length) { const e = new Error(`${orphaned.length} corrective action(s) have no owner or no due date — a workshop cannot close over an action nobody is late for`); e.failClosed = true; throw e; }
    w.state = 'closed'; w.closedBy = by; w.closedAt = at ?? this._clock();
    return { ...w };
  }

  // A follow-up review. Separate from the close and attributable to somebody else, because the
  // person who ran the workshop is not the person who should confirm its actions landed.
  followUp(id, { reviewedBy, at = null, resolvedIndexes = [], note = null } = {}) {
    const w = this._workshops.get(id);
    if (!w) throw new Error('unknown validation workshop: ' + id);
    if (w.state !== 'closed') { const e = new Error(`${id} is not closed — a follow-up reviews what a workshop concluded`); e.failClosed = true; throw e; }
    if (!reviewedBy) { const e = new Error('a follow-up review requires a named reviewer'); e.failClosed = true; throw e; }
    if (reviewedBy === w.facilitator) { const e = new Error(`'${reviewedBy}' facilitated this workshop and cannot also review whether its actions landed`); e.failClosed = true; throw e; }
    for (const i of resolvedIndexes) {
      if (!w.outcomes[i]) throw new Error(`no outcome at index ${i}`);
      w.outcomes[i].resolved = true;
      w.outcomes[i].resolvedBy = reviewedBy;
    }
    const rec = { reviewedBy, at: at ?? this._clock(), resolved: [...resolvedIndexes], note };
    w.followUps.push(rec);
    return { ...rec };
  }

  workshops() { return [...this._workshops.values()].map((w) => JSON.parse(JSON.stringify(w))); }
  workshop(id) { const w = this._workshops.get(id); return w ? JSON.parse(JSON.stringify(w)) : null; }

  // The Part 6 report. Every category is counted separately; nothing is summed into a score.
  report({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = this.workshops().map((w) => {
      const of = (kind) => w.outcomes.filter((o) => o.outcome === kind);
      const actions = of('corrective-action');
      const overdue = actions.filter((a) => !a.resolved && Number.isFinite(a.dueAt) && a.dueAt < t);
      const unresolved = of('unresolved-issue').filter((o) => !o.resolved);
      // Objectives an outcome actually cited. An objective nothing cited was not met by the workshop
      // saying it was; it was simply not addressed.
      const addressed = w.objectives.filter((obj) => w.outcomes.some((o) => o.objective === obj));
      return {
        id: w.id, subject: w.subject, state: w.state,
        facilitator: w.facilitator, participants: w.participants.length,
        objectives: w.objectives, objectivesAddressed: addressed,
        objectivesUnaddressed: w.objectives.filter((o) => !addressed.includes(o)),
        findings: of('finding').length, decisions: of('decision').length,
        unresolvedIssues: unresolved.map((o) => o.detail),
        correctiveActions: actions.map((a) => ({ detail: a.detail, owner: a.owner, dueAt: a.dueAt, resolved: a.resolved })),
        overdueActions: overdue.map((a) => ({ detail: a.detail, owner: a.owner, dueAt: a.dueAt })),
        followUps: w.followUps.length,
        // Closed is not finished. A closed workshop with open issues or overdue actions is the
        // normal state of institutional validation and the report says so rather than hiding it.
        finished: w.state === 'closed' && !unresolved.length && actions.every((a) => a.resolved),
        reason: w.state !== 'closed' ? 'still convened'
          : unresolved.length ? `closed with ${unresolved.length} unresolved issue(s) — closing a workshop does not resolve them`
            : actions.some((a) => !a.resolved) ? `closed with ${actions.filter((a) => !a.resolved).length} corrective action(s) still open`
              : 'closed, every issue resolved and every action confirmed by a follow-up review',
      };
    });
    const openIssues = rows.flatMap((r) => r.unresolvedIssues);
    const overdue = rows.flatMap((r) => r.overdueActions);
    return {
      workshops: rows, count: rows.length,
      outcomes: Object.entries(WORKSHOP_OUTCOMES).map(([outcome, o]) => ({ outcome, ...o })),
      states: [...WORKSHOP_STATES],
      convened: rows.filter((r) => r.state === 'convened').length,
      closed: rows.filter((r) => r.state === 'closed').length,
      finished: rows.filter((r) => r.finished).length,
      unresolvedIssues: openIssues, unresolvedIssueCount: openIssues.length,
      overdueActions: overdue, overdueActionCount: overdue.length,
      unaddressedObjectives: rows.flatMap((r) => r.objectivesUnaddressed.map((o) => ({ workshop: r.id, objective: o }))),
      // Never a score. The figure that matters is how much is still open, not how many rooms met.
      measurable: rows.length > 0,
      basis: rows.length
        ? `${rows.length} workshop(s); ${rows.filter((r) => r.finished).length} finished. ${openIssues.length} issue(s) remain unresolved and ${overdue.length} corrective action(s) are overdue.`
        : 'No validation workshop has been convened. The institution has never sat down and looked at how it actually works, which is a different gap from any control failing.',
      now: t, informationalOnly: true, authorizes: false,
      note: 'An unresolved issue is a first-class outcome and closing a workshop does not close it. The failure mode of every workshop is minutes that record the decisions and lose what nobody agreed on, so unresolved issues survive the close and are carried here until a follow-up review — by somebody other than the facilitator — resolves them.',
    };
  }
}

// --- Trust evidence (Phase 15, Part 8) -------------------------------------------------------------
//
// Phase 14 built leading indicators of whether public trust would be WARRANTED, and put
// `measuresTrust: false` on every row. Part 8 asks for the other half, and the distinction between
// the two is the whole content of this section:
//
//   TRUST INDICATORS are derived by this platform from its own operation. They say whether the
//   conditions for trust hold. They are not evidence about trust and they are not opinions.
//
//   TRUSTWORTHINESS EVIDENCE is recorded from OUTSIDE the platform — an audit somebody performed, a
//   complaint somebody filed, a finding an oversight body made. It is evidence about the institution
//   rather than about the system.
//
//   PUBLIC TRUST is what people actually believe. This platform does not measure it, cannot measure
//   it, and the one group whose trust matters most — people who considered reporting and decided not
//   to — is unreachable from here by construction.
//
// All three appear in the same report, labelled, and never summed.
const TRUST_EVIDENCE_KINDS = {
  'citizen-feedback': { external: true, aboutTrust: false, means: 'What people who used the service said about it.', limitation: 'Only reaches people who used it. The ones who did not are the ones whose trust matters most.' },
  'complaint-trend': { external: true, aboutTrust: false, means: 'The volume and direction of complaints about the institution.', limitation: 'Rising complaints can mean falling trust or rising willingness to complain, and the two are opposite.' },
  'transparency-indicator': { external: false, aboutTrust: false, means: 'What the institution publishes, and how promptly.', limitation: 'Publishing is a behaviour of the institution, not a belief of anybody.' },
  'independent-audit': { external: true, aboutTrust: false, means: 'A finding by an auditor who does not report to the institution.', limitation: 'Audits sample; a clean audit is evidence about what was sampled.' },
  'survey-evidence': { external: true, aboutTrust: true, means: 'The only kind here that is directly about what people believe.', limitation: 'Sampling and response bias. People who distrust an institution are less likely to answer its survey.' },
  'oversight-finding': { external: true, aboutTrust: false, means: 'A determination by a body with a statutory oversight mandate.', limitation: 'Reflects what was investigated, which is driven by what was reported.' },
};

class TrustEvidenceRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._records = []; }

  record({ kind, source, finding, at = null, period = null, independent = null, recordedBy } = {}) {
    if (!TRUST_EVIDENCE_KINDS[kind]) throw new Error(`unknown trust evidence kind '${kind}' — one of ${Object.keys(TRUST_EVIDENCE_KINDS).join(', ')}`);
    if (!source) { const e = new Error('trust evidence must name its source — evidence about an institution from nowhere in particular is a rumour'); e.failClosed = true; throw e; }
    if (!finding) throw new Error('trust evidence must record what was actually found');
    if (!recordedBy) { const e = new Error('trust evidence must name who recorded it'); e.failClosed = true; throw e; }
    // Independence is the property that makes external evidence worth more than self-assessment, so
    // it is recorded explicitly rather than inferred from the kind.
    if (TRUST_EVIDENCE_KINDS[kind].external && independent === null) {
      const e = new Error(`'${kind}' is external evidence, so it must state whether its source is independent of the institution — that is the property that makes it worth more than a self-assessment`);
      e.failClosed = true; throw e;
    }
    const rec = { kind, source, finding, period, independent, recordedBy, at: at ?? this._clock() };
    this._records.push(rec);
    return { ...rec };
  }
  records(kind = null) { return this._records.filter((r) => !kind || r.kind === kind).map((r) => ({ ...r })); }
}

// The Part 8 report. Three sections, labelled, never summed.
function trustEvidence({ register = null, indicators = null, now = 0 } = {}) {
  const records = register ? register.records() : [];
  const byKind = Object.keys(TRUST_EVIDENCE_KINDS).map((kind) => {
    const rows = records.filter((r) => r.kind === kind);
    return {
      kind, ...TRUST_EVIDENCE_KINDS[kind],
      count: rows.length,
      independentCount: rows.filter((r) => r.independent === true).length,
      recorded: rows.length > 0,
      reason: rows.length ? `${rows.length} record(s)` : 'nothing recorded — the absence of evidence about trustworthiness is not evidence of it',
    };
  });
  const independent = records.filter((r) => r.independent === true);
  const surveys = records.filter((r) => TRUST_EVIDENCE_KINDS[r.kind].aboutTrust);
  return {
    // Section 1: what this platform derives about its own operation.
    trustIndicators: indicators
      ? { composite: indicators.composite, measuresTrust: false, whatThisIs: indicators.whatThisIs, basis: indicators.basis }
      : { composite: 'unknown', measuresTrust: false, whatThisIs: 'no indicator assessment was supplied', basis: 'unknown' },
    // Section 2: what somebody outside recorded about the institution.
    trustworthinessEvidence: {
      records, count: records.length, byKind,
      independentCount: independent.length,
      kindsWithNothing: byKind.filter((k) => !k.recorded).map((k) => k.kind),
      // Independence is what makes this worth more than the platform's own opinion of itself.
      basis: records.length
        ? `${records.length} record(s), ${independent.length} from a source independent of the institution. Every kind states its own limitation; none of them is a measurement of belief except survey evidence, which has its own sampling problem.`
        : 'No evidence about the institution\'s trustworthiness has been recorded. That is not evidence of trustworthiness, and it is not evidence against it.',
    },
    // Section 3: the thing that is never measured here, stated so nobody has to infer it.
    publicTrust: {
      measured: false, value: null,
      whyNot: 'This platform has no channel to the public. It can derive whether the conditions for trust hold and it can record what others found about the institution; it cannot observe what anybody believes.',
      whoIsMissing: 'People who considered reporting corruption and decided not to. They are unreachable from inside a reporting platform by construction, and they are the population whose trust matters most.',
      whatWouldMeasureIt: 'A survey designed and run by a body independent of the institution, sampling the general population rather than service users.',
    },
    // The structural guarantee: the three sections are never combined into one figure.
    combined: false,
    separationNote: 'Trust indicators, trustworthiness evidence and public trust are three different things and are never summed. A composite of them would be a number describing nothing, and it would be quoted.',
    surveyEvidenceCount: surveys.length,
    now, informationalOnly: true, authorizes: false,
  };
}

// --- Governance evidence onboarding (Phase 15, Part 13) --------------------------------------------
//
// Every register this platform has built since Phase 13 ships empty, and every report says so: no
// training after an incident, no joint governance act, no assumption verification, no rehearsal. That
// honesty has been the right answer and it has left an obvious question unanswered — how does
// anything ever get INTO them, in a way that is auditable afterwards?
//
// This is that workflow, and its single rule is what stops it becoming a back door:
//
//   ONBOARDING NEVER BYPASSES THE TARGET REGISTER'S OWN RULES. It carries a submission to the
//   register and the register decides. A workflow that could write a training completion the
//   TrainingRegister would have refused is a workflow for laundering evidence.
//
// Everything is attributed twice — who submitted, who accepted — because the whole point of an
// onboarding record is to be answerable later for how a fact got into the system.
const EVIDENCE_TYPES = {
  training: { targetRegister: 'ownership.TrainingRegister', acceptedBy: 'the registrar for the role', means: 'Somebody completed a required course.' },
  rehearsal: { targetRegister: 'ownership.ExerciseRegister', acceptedBy: 'the exercise owner', means: 'Somebody took part in a governance rehearsal.' },
  regulatory: { targetRegister: 'legislation.ComplianceIntelligence', acceptedBy: 'the approving governance board', means: 'A regulatory change was observed or an obligation reassessed.' },
  'cross-agency': { targetRegister: 'ownership.ActivityRegister', acceptedBy: 'the accountable authority of both institutions', means: 'Two institutions performed a joint governance act.' },
  'assumption-verification': { targetRegister: 'assumptions.AssumptionRegistry', acceptedBy: 'somebody other than the assumption owner', means: 'An assumption was checked and found to hold, or not to.' },
  acceptance: { targetRegister: 'institutional-resilience.ResilienceAcceptance', acceptedBy: 'the Oversight Board for constitutional capabilities', means: 'A named authority accepted a gap, with a rationale and an expiry.' },
  // Phase 16, Part 2. The three registers Phase 15 built and left with no way in.
  'legal-authority': { targetRegister: 'legislation.LegalAuthorityRegistry', acceptedBy: 'the approving organization named in the declaration', means: 'An instrument was recorded as authorising a capability.', legalAssertion: true },
  'control-observation': { targetRegister: 'assurance.ControlObservationRegister', acceptedBy: 'the operations authority for the control', means: 'Somebody watched a control do — or fail to do — its job.' },
  'governance-agreement': { targetRegister: 'ownership.ActivityRegister', acceptedBy: 'the accountable authority of every party to it', means: 'Two or more institutions recorded an agreement about how they will work together.' },
};

const ONBOARDING_STATES = ['submitted', 'accepted', 'rejected', 'landed'];

// --- Part 2: where a record came from, and what it is -------------------------------------------
//
// Every register in this platform is empty, and Part 2 is the machinery for filling them. That makes
// one distinction load-bearing above all others:
//
//   SYNTHETIC DATA IS NEVER OPERATIONAL EVIDENCE, AND CANNOT BECOME IT.
//
// This whole repository is synthetic by design. The moment a governed register can hold both, a
// report that counts them together is a report claiming operational history the institution does not
// have. So every submission declares its class, the class is carried onto the landed record, and no
// transition promotes one to the other — `promote()` does not exist, deliberately.
const DATA_CLASSES = {
  synthetic: {
    operational: false, countsAsEvidence: false,
    means: 'Generated for exercise, demonstration or test. Real in shape, invented in substance.',
    ifMiscounted: 'The institution believes it has an operational history it does not have, and every downstream figure inherits the belief.',
  },
  operational: {
    operational: true, countsAsEvidence: true,
    means: 'Recorded from something that actually happened, traceable to the source that observed it.',
    ifMiscounted: 'Real evidence is discounted as a drill, and a genuine finding is filed as practice.',
  },
};

// What must be true before an operational record is allowed to land. Each says what its absence
// means, because "incomplete provenance" is not a finding anybody can act on.
const PROVENANCE_FIELDS = {
  sourceSystem: { absentMeans: 'Nothing says which system observed this, so nobody can go back and check it.' },
  observedAt: { absentMeans: 'Nothing says when it happened, so freshness and ordering are both unknowable.' },
  acquiredVia: { absentMeans: 'Nothing says how it got here, so the acquisition path cannot be audited.' },
};

class EvidenceOnboarding {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._seq = 0; }

  submit({ type, payload = {}, submittedBy, rationale, dataClass = null, provenance = null, connector = null, at = null } = {}) {
    if (!EVIDENCE_TYPES[type]) throw new Error(`unknown evidence type '${type}' — one of ${Object.keys(EVIDENCE_TYPES).join(', ')}`);
    if (!submittedBy) { const e = new Error('an evidence submission must name who submitted it'); e.failClosed = true; throw e; }
    if (!rationale) { const e = new Error('an evidence submission must say why this record is being added — a fact with no stated reason for being here is one nobody can question later'); e.failClosed = true; throw e; }
    // Phase 16, Part 2. A submission with no declared class would default to something, and whichever
    // default was chosen would be wrong half the time in the direction nobody notices.
    if (!DATA_CLASSES[dataClass]) {
      const e = new Error(`an evidence submission must declare its data class — one of ${Object.keys(DATA_CLASSES).join(', ')}. Synthetic data is never operational evidence and there is no default that is safe to assume.`);
      e.failClosed = true; throw e;
    }
    // Operational evidence must be traceable to what observed it. Synthetic evidence must not claim
    // to be: a drill with a provenance record reads as a real event to everybody downstream.
    if (dataClass === 'operational') {
      for (const [field, meta] of Object.entries(PROVENANCE_FIELDS)) {
        if (!provenance || provenance[field] === undefined || provenance[field] === null || provenance[field] === '') {
          const e = new Error(`operational evidence must record '${field}' — ${meta.absentMeans}`);
          e.failClosed = true; throw e;
        }
      }
    }
    const id = `EVD-${String(++this._seq).padStart(4, '0')}`;
    const rec = {
      id, type, payload: JSON.parse(JSON.stringify(payload)), submittedBy, rationale,
      dataClass, ...DATA_CLASSES[dataClass],
      provenance: provenance ? { ...provenance } : null, connector,
      state: 'submitted', at: at ?? this._clock(),
      history: [{ state: 'submitted', by: submittedBy, at: at ?? this._clock(), detail: rationale }],
    };
    this._items.set(id, rec);
    return { ...rec };
  }

  // Acceptance is a separate human act by somebody OTHER than the submitter. A submission that
  // accepts itself is a submission that was never reviewed.
  accept(id, { by, at = null, note = null } = {}) {
    const item = this._items.get(id);
    if (!item) throw new Error('unknown evidence submission: ' + id);
    if (item.state !== 'submitted') { const e = new Error(`'${id}' is '${item.state}', not 'submitted'`); e.failClosed = true; throw e; }
    if (!by) { const e = new Error('accepting evidence requires a named human'); e.failClosed = true; throw e; }
    if (by === item.submittedBy) { const e = new Error(`'${by}' submitted this evidence and cannot also accept it — a submission that accepts itself was never reviewed`); e.failClosed = true; throw e; }
    item.state = 'accepted'; item.acceptedBy = by;
    item.history.push({ state: 'accepted', by, at: at ?? this._clock(), detail: note });
    return { ...item };
  }

  reject(id, { by, reason, at = null } = {}) {
    const item = this._items.get(id);
    if (!item) throw new Error('unknown evidence submission: ' + id);
    if (!by || !reason) { const e = new Error('rejecting evidence requires a named human and a reason — a rejection nobody explained cannot be appealed'); e.failClosed = true; throw e; }
    item.state = 'rejected';
    item.history.push({ state: 'rejected', by, at: at ?? this._clock(), detail: reason });
    return { ...item };
  }

  // Land the accepted evidence in its target register, by calling that register's own API. If the
  // register refuses, the submission is marked rejected WITH THE REGISTER'S REASON — the workflow
  // never overrides it, and the refusal is recorded rather than swallowed.
  land(id, { register, apply, by, at = null } = {}) {
    const item = this._items.get(id);
    if (!item) throw new Error('unknown evidence submission: ' + id);
    if (item.state !== 'accepted') { const e = new Error(`'${id}' is '${item.state}' — only accepted evidence may be landed`); e.failClosed = true; throw e; }
    if (typeof apply !== 'function') throw new Error('landing evidence requires the target register\'s own function — this workflow never writes to a register directly');
    if (!by) { const e = new Error('landing evidence requires a named human'); e.failClosed = true; throw e; }
    try {
      const result = apply(register, item.payload);
      item.state = 'landed'; item.landedBy = by; item.landedAt = at ?? this._clock();
      item.history.push({ state: 'landed', by, at: item.landedAt, detail: `accepted by ${item.acceptedBy} and written to ${EVIDENCE_TYPES[item.type].targetRegister}` });
      return { ...item, result };
    } catch (err) {
      // The register refused. That is the register's decision and it stands.
      item.state = 'rejected';
      item.history.push({ state: 'rejected', by, at: at ?? this._clock(), detail: `the target register refused it: ${err.message}` });
      const e = new Error(`the target register refused this evidence: ${err.message}`);
      e.failClosed = true; e.registerRefusal = true; throw e;
    }
  }

  item(id) { const i = this._items.get(id); return i ? JSON.parse(JSON.stringify(i)) : null; }
  items() { return [...this._items.values()].map((i) => JSON.parse(JSON.stringify(i))); }

  // The audit trail. Every submission, whatever became of it, with both attributions.
  auditTrail({ now = null } = {}) {
    const rows = this.items();
    const landed = rows.filter((r) => r.state === 'landed');
    const rejected = rows.filter((r) => r.state === 'rejected');
    return {
      submissions: rows, count: rows.length,
      types: Object.entries(EVIDENCE_TYPES).map(([type, t]) => ({ type, ...t })),
      states: [...ONBOARDING_STATES],
      landed: landed.length, rejected: rejected.length,
      pending: rows.filter((r) => r.state === 'submitted').length,
      accepted: rows.filter((r) => r.state === 'accepted').length,
      // Every landed record is answerable to two named humans and a reason.
      fullyAttributed: landed.every((r) => r.submittedBy && r.acceptedBy && r.landedBy && r.rationale),
      // Rejections are kept, because a register that only records what was accepted tells you what
      // people believed rather than what they tried.
      rejections: rejected.map((r) => ({ id: r.id, type: r.type, reason: (r.history[r.history.length - 1] || {}).detail })),
      byType: Object.keys(EVIDENCE_TYPES).map((type) => ({ type, submitted: rows.filter((r) => r.type === type).length, landed: rows.filter((r) => r.type === type && r.state === 'landed').length })),
      // Phase 16, Part 2. The two classes are counted apart and never summed into a total that would
      // read as operational history.
      dataClasses: Object.entries(DATA_CLASSES).map(([dataClass, d]) => ({ dataClass, ...d, submitted: rows.filter((r) => r.dataClass === dataClass).length, landed: landed.filter((r) => r.dataClass === dataClass).length })),
      operationalLanded: landed.filter((r) => r.dataClass === 'operational').length,
      syntheticLanded: landed.filter((r) => r.dataClass === 'synthetic').length,
      // Every operational record is traceable to what observed it, or it did not land.
      everyOperationalRecordTraceable: landed.filter((r) => r.dataClass === 'operational')
        .every((r) => r.provenance && Object.keys(PROVENANCE_FIELDS).every((f) => r.provenance[f])),
      provenanceFields: Object.entries(PROVENANCE_FIELDS).map(([field, f]) => ({ field, ...f })),
      now, informationalOnly: true, authorizes: false,
      note: 'Onboarding never bypasses a target register\'s own rules: it carries a submission and the register decides. A refusal is recorded with the register\'s reason rather than overridden, and every landed record names who submitted it, who accepted it, and why it is here. Synthetic and operational records are counted apart and never summed — there is no transition that promotes one to the other.',
    };
  }
}

// --- Evidence acquisition connectors (Phase 16, Part 1) --------------------------------------------
//
// Onboarding answers "how does a fact get into a register, auditably". It assumes a human is
// carrying the fact. Part 1 is the other half: the systems that would supply facts continuously, and
// what has to be true about one before anything it supplies may be believed.
//
// The rule that keeps this from becoming an automated way to fabricate history:
//
//   A CONNECTOR'S TRUST LEVEL IS A CEILING, NOT A LABEL. Evidence acquired through a connector can
//   never be trusted more than the connector it came through, and a connector nobody has assessed
//   supplies UNKNOWN evidence — which is not verified evidence, and never becomes it by arriving
//   repeatedly.
//
// Nothing here connects to anything. This platform is synthetic and offline; these are declarations
// of what a connector must state about itself before its output may be counted, and the registry
// ships EMPTY because no external system has been connected to anything.
const CONNECTOR_KINDS = {
  'legislation-repository': {
    supplies: 'Instruments, amendments and commencement dates.',
    cannotTell: 'Whether an instrument authorises a particular capability. That is a legal reading, not a record lookup.',
    failsAs: 'A repealed instrument stays cited because the feed stopped and nobody noticed.',
  },
  'pki-infrastructure': {
    supplies: 'Certificate inventory, expiry, revocation status and issuing chain.',
    cannotTell: 'Whether the key behind a certificate is still under the custody it was issued under.',
    failsAs: 'A certificate is reported valid and its private key left the HSM a year ago.',
  },
  'siem-platform': {
    supplies: 'Security events, correlations and alert dispositions.',
    cannotTell: 'What it did not see. A SIEM reports detections, and the gap is the thing that matters.',
    failsAs: 'A false-negative rate of zero, because only detected incidents were ever recorded.',
  },
  'audit-system': {
    supplies: 'Audit findings, their status, and who they were raised against.',
    cannotTell: 'Whether a closed finding was actually remediated or merely closed.',
    failsAs: 'A closed finding is counted as a fixed one.',
  },
  'monitoring-system': {
    supplies: 'Availability, latency and error rates for declared services.',
    cannotTell: 'Whether the service was doing the right thing while it was up.',
    failsAs: 'Green dashboards during an outage of something nobody monitored.',
  },
  'identity-provider': {
    supplies: 'Authentication events, assurance levels and credential lifecycle.',
    cannotTell: 'Whether the person behind a credential is the person it was issued to.',
    failsAs: 'A shared account reads as one diligent individual.',
  },
  'workflow-engine': {
    supplies: 'Case and process transitions, timings and outcomes.',
    cannotTell: 'Whether a transition reflected a decision somebody actually made.',
    failsAs: 'A bulk state change reads as a hundred considered dispositions.',
  },
  'observability-platform': {
    supplies: 'Traces, metrics and logs across declared services.',
    cannotTell: 'Anything about work that produced no telemetry.',
    failsAs: 'A silent failure path is invisible and therefore reported as absent.',
  },
};

// Trust in a connector. `unknown` is the state of a connector nobody has assessed, and it is the
// default because assuming anything else about an unassessed system is the failure this prevents.
const TRUST_LEVELS = {
  unknown: { rank: 0, verifiable: false, means: 'Nobody has assessed this source. Its output is unknown evidence.' },
  declared: { rank: 1, verifiable: false, means: 'Somebody stated what it is. Nothing has checked the statement.' },
  attested: { rank: 2, verifiable: false, means: 'The operating institution attests to it. Still a self-assessment.' },
  verified: { rank: 3, verifiable: true, means: 'An independent party verified the source and its integrity controls.' },
};
const TRUST_ORDER = ['unknown', 'declared', 'attested', 'verified'];

// Whether what arrived is what was sent. Distinct from trust: a source nobody trusts can still have
// intact transport, and a trusted source can deliver corrupted records.
const INTEGRITY_STATES = {
  unknown: { intact: false, means: 'No integrity control is declared, so nothing says whether what arrived is what was sent.' },
  unprotected: { intact: false, means: 'The path has no integrity control. Records could be altered in transit and nothing would show it.' },
  checksummed: { intact: true, means: 'Records carry a digest that is checked on arrival.' },
  signed: { intact: true, means: 'Records are signed by the source and the signature is verified on arrival.' },
};

// How stale the connector's newest record is, against the freshness the connector itself declared it
// needs. A freshness requirement nobody stated cannot be missed, so it is required at declaration.
const FRESHNESS_STATES = {
  unknown: { fresh: false, means: 'Nothing has ever synchronized, so there is no record to be stale.' },
  fresh: { fresh: true, means: 'The newest record is within the declared freshness requirement.' },
  stale: { fresh: false, means: 'The newest record is older than this connector declared it needs to be.' },
};

const SYNC_STATES = {
  'never-synchronized': { healthy: false, means: 'No synchronization has ever been attempted or recorded.' },
  synchronized: { healthy: true, means: 'The last synchronization completed and reported a record count.' },
  degraded: { healthy: false, means: 'The last synchronization completed with errors.' },
  failed: { healthy: false, means: 'The last synchronization did not complete.' },
};

const DAY_MS = 24 * 3600_000;

class EvidenceConnectorRegistry {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._connectors = new Map(); this._syncs = new Map(); }

  // Declare a connector. Every field Part 1 requires is mandatory at declaration, because a
  // half-declared connector is one whose gaps are discovered when its evidence is already being
  // counted.
  declare(id, { kind, owner, sourceSystem, integrity = 'unknown', trustLevel = 'unknown', freshnessRequirementDays, supplies = [], declaredBy, at = null } = {}) {
    if (!id) throw new Error('a connector must have an identifier');
    if (!CONNECTOR_KINDS[kind]) throw new Error(`unknown connector kind '${kind}' — one of ${Object.keys(CONNECTOR_KINDS).join(', ')}`);
    if (!owner) { const e = new Error('a connector must name the institution accountable for it — an unowned feed is one nobody fixes'); e.failClosed = true; throw e; }
    if (!sourceSystem) { const e = new Error('a connector must name the system it reads from'); e.failClosed = true; throw e; }
    if (!declaredBy) { const e = new Error('a connector declaration must name who made it'); e.failClosed = true; throw e; }
    if (!INTEGRITY_STATES[integrity]) throw new Error(`unknown integrity state '${integrity}' — one of ${Object.keys(INTEGRITY_STATES).join(', ')}`);
    if (!TRUST_LEVELS[trustLevel]) throw new Error(`unknown trust level '${trustLevel}' — one of ${TRUST_ORDER.join(', ')}`);
    if (!Number.isFinite(freshnessRequirementDays) || freshnessRequirementDays <= 0) {
      const e = new Error('a connector must declare how fresh its evidence needs to be — a freshness requirement nobody stated cannot be missed');
      e.failClosed = true; throw e;
    }
    // Verified is an independent party's conclusion. A declaration cannot assert it about itself.
    if (trustLevel === 'verified') {
      const e = new Error('a connector cannot declare itself verified — verification is an independent party\'s conclusion, recorded with verify()');
      e.failClosed = true; throw e;
    }
    const rec = {
      id, kind, ...CONNECTOR_KINDS[kind], owner, sourceSystem,
      integrity, trustLevel, freshnessRequirementDays, supplies: [...supplies],
      declaredBy, at: at ?? this._clock(), verification: null,
    };
    this._connectors.set(id, rec);
    return { ...rec };
  }

  // Independent verification. By somebody who is not the connector's own owner, for the same reason
  // an assumption is not verified by the person who made it.
  verify(id, { by, independent, findings = null, at = null } = {}) {
    const c = this._connectors.get(id);
    if (!c) throw new Error('unknown connector: ' + id);
    if (!by) { const e = new Error('verifying a connector requires a named verifier'); e.failClosed = true; throw e; }
    if (by === c.owner) { const e = new Error(`'${by}' owns this connector and cannot verify it — that is a self-assessment, which is what 'attested' already means`); e.failClosed = true; throw e; }
    if (independent !== true) { const e = new Error('a connector verification must state that the verifier is independent of the institution operating the source'); e.failClosed = true; throw e; }
    // Integrity is the thing verification is about. A verified connector over an unprotected path is
    // a verified claim that nothing checks what arrives.
    if (!INTEGRITY_STATES[c.integrity].intact) {
      const e = new Error(`'${id}' has integrity '${c.integrity}', so nothing checks that what arrived is what was sent — that cannot be verified away`);
      e.failClosed = true; throw e;
    }
    c.trustLevel = 'verified';
    c.verification = { by, independent, findings, at: at ?? this._clock() };
    return { ...c };
  }

  // Record a synchronization. Attributed and counted; an unattributed sync is a claim that something
  // ran.
  recordSync(id, { outcome, records = 0, newestRecordAt = null, errors = [], by, at = null } = {}) {
    const c = this._connectors.get(id);
    if (!c) throw new Error('unknown connector: ' + id);
    if (!['synchronized', 'degraded', 'failed'].includes(outcome)) throw new Error(`unknown sync outcome '${outcome}'`);
    if (!by) { const e = new Error('a synchronization record must name what performed it'); e.failClosed = true; throw e; }
    if (outcome === 'synchronized' && !Number.isFinite(newestRecordAt)) {
      const e = new Error('a successful synchronization must record the timestamp of the newest record it brought — without it freshness is unknowable');
      e.failClosed = true; throw e;
    }
    const rec = { connector: id, outcome, records, newestRecordAt, errors: [...errors], by, at: at ?? this._clock() };
    if (!this._syncs.has(id)) this._syncs.set(id, []);
    this._syncs.get(id).push(rec);
    return { ...rec };
  }

  connectors() { return [...this._connectors.values()].map((c) => ({ ...c })).sort((a, b) => a.id.localeCompare(b.id)); }
  syncs(id) { return (this._syncs.get(id) || []).map((s) => ({ ...s })); }

  // The state of one connector, derived. Nothing here is declared except what the declaration said.
  state(id, { now = null } = {}) {
    const t = now ?? this._clock();
    const c = this._connectors.get(id);
    if (!c) throw new Error('unknown connector: ' + id);
    const syncs = this._syncs.get(id) || [];
    const last = syncs[syncs.length - 1] || null;
    const sync = !last ? 'never-synchronized' : last.outcome;
    const freshness = !last || !Number.isFinite(last.newestRecordAt) ? 'unknown'
      : (t - last.newestRecordAt) <= c.freshnessRequirementDays * DAY_MS ? 'fresh' : 'stale';
    // THE CEILING. Evidence through this connector can be no better than the weakest of: what
    // somebody assessed about the source, whether the path protects what it carries, whether
    // anything has actually arrived, and whether what arrived is recent enough to mean anything.
    const blockers = [
      ...(TRUST_LEVELS[c.trustLevel].verifiable ? [] : [`trust is '${c.trustLevel}' — ${TRUST_LEVELS[c.trustLevel].means}`]),
      ...(INTEGRITY_STATES[c.integrity].intact ? [] : [`integrity is '${c.integrity}' — ${INTEGRITY_STATES[c.integrity].means}`]),
      ...(SYNC_STATES[sync].healthy ? [] : [`synchronization is '${sync}' — ${SYNC_STATES[sync].means}`]),
      ...(FRESHNESS_STATES[freshness].fresh ? [] : [`freshness is '${freshness}' — ${FRESHNESS_STATES[freshness].means}`]),
    ];
    return {
      connector: id, kind: c.kind, owner: c.owner, sourceSystem: c.sourceSystem,
      trustLevel: c.trustLevel, ...TRUST_LEVELS[c.trustLevel],
      integrity: c.integrity, integrityIntact: INTEGRITY_STATES[c.integrity].intact,
      sync, syncHealthy: SYNC_STATES[sync].healthy,
      freshness, fresh: FRESHNESS_STATES[freshness].fresh,
      lastSync: last, syncCount: syncs.length,
      recordsAcquired: syncs.reduce((a, s) => a + (s.records || 0), 0),
      // The ceiling itself: `verified` only when nothing above blocks it, `unknown` otherwise.
      evidenceCeiling: blockers.length ? 'unknown' : 'verified',
      blockers,
      cannotTell: c.cannotTell, failsAs: c.failsAs,
      reason: blockers.length
        ? `evidence from '${id}' is capped at UNKNOWN: ${blockers.join('; ')}`
        : `'${id}' is independently verified over a protected path, synchronized and fresh — evidence from it may be counted as verified`,
      now: t,
    };
  }

  // Part 1's question, answered for the whole estate.
  report({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = this.connectors().map((c) => this.state(c.id, { now: t }));
    const verifiedSources = rows.filter((r) => r.evidenceCeiling === 'verified');
    return {
      connectors: rows, count: rows.length,
      kinds: Object.entries(CONNECTOR_KINDS).map(([kind, k]) => ({ kind, ...k, declared: rows.filter((r) => r.kind === kind).length })),
      trustLevels: TRUST_ORDER.map((level) => ({ level, ...TRUST_LEVELS[level], connectors: rows.filter((r) => r.trustLevel === level).length })),
      integrityStates: Object.entries(INTEGRITY_STATES).map(([state, s]) => ({ state, ...s })),
      freshnessStates: Object.entries(FRESHNESS_STATES).map(([state, s]) => ({ state, ...s })),
      syncStates: Object.entries(SYNC_STATES).map(([state, s]) => ({ state, ...s })),
      // Kinds Part 1 asks for that nothing supplies. Declared as a gap rather than omitted, because a
      // report over three connectors that silently omits the other five reads as complete.
      undeclaredKinds: Object.keys(CONNECTOR_KINDS).filter((k) => !rows.some((r) => r.kind === k)),
      verifiedSources: verifiedSources.map((r) => r.connector),
      cappedAtUnknown: rows.filter((r) => r.evidenceCeiling === 'unknown').map((r) => ({ connector: r.connector, blockers: r.blockers })),
      // THE PART 1 RULE, computed rather than promised.
      anyVerifiedEvidence: verifiedSources.length > 0,
      acquisitionBasis: rows.length
        ? `${verifiedSources.length} of ${rows.length} declared connectors can supply verified evidence. The rest are capped at UNKNOWN, and unknown evidence is never promoted to verified by arriving repeatedly.`
        : 'No evidence connector is declared. This platform is offline and synthetic; nothing external supplies it, and every register it holds was filled by a named human or is empty.',
      failClosed: true, informationalOnly: true, authorizes: false,
      note: 'A connector\'s trust level is a ceiling, not a label. Evidence can never be trusted more than the path it came through, and each kind states what it CANNOT tell you — because the gap in a source is the part that gets forgotten once its output is on a dashboard.',
      now: t,
    };
  }
}

// --- Executive explainability (Phase 16, Part 4) & readiness evidence chains (Part 13) -----------
//
// Twenty-two executive panels and ten readiness dimensions, every one of them derived and none of
// them EXPLAINABLE. A board member reading "documentation health: 247" can see the number is
// derived — `manualEntry: false` says so — and cannot see what it is derived FROM without reading
// the source. A figure whose provenance is a code comment is a figure nobody can challenge.
//
// So every executive value walks a chain of seven hops, and the discipline is:
//
//   A CHAIN IS ONLY AS GOOD AS ITS FIRST BREAK. It is reported as broken AT the hop that failed,
//   with what would resolve it — not as a percentage complete, because a chain that is six-sevenths
//   complete supports exactly nothing.
//
// Every hop is DERIVED. The panel names the module it comes from; the context map says which bounded
// context claims that module; the readiness model says which dimensions that context owns; RACI says
// which controls that context is accountable for; the consistency stance says what policy the context
// declares; the stance cites an ADR; and the module is the source record. Nothing in this section is
// a hand-kept mapping table, so a panel that moves to another module re-links itself.
const EXPLANATION_HOPS = {
  'executive-metric': {
    answers: 'What is the figure, and is it measured at all?',
    resolvedFrom: 'the executive panel and its declared source module',
    ifBroken: 'The dashboard shows a number nothing produced.',
  },
  'readiness-dimension': {
    answers: 'Which readiness conclusion does this figure bear on?',
    resolvedFrom: 'the readiness dimensions owned by the bounded context that claims the panel\'s source module',
    ifBroken: 'The metric changes nothing. It is a number on a dashboard that no decision depends on.',
  },
  evidence: {
    answers: 'What evidence supports that readiness dimension, and how confident is it?',
    resolvedFrom: 'the evidence register entry for the dimension',
    ifBroken: 'A readiness conclusion rests on nothing anybody recorded.',
  },
  control: {
    answers: 'Which executable controls actually enforce it?',
    resolvedFrom: 'the RACI control ownership matrix for the owning context, intersected with the controls that ran',
    ifBroken: 'The evidence is a statement rather than a check. Nothing would fail if it stopped being true.',
  },
  policy: {
    answers: 'What operating rule does the context declare?',
    resolvedFrom: 'the declared consistency stance for the bounded context',
    ifBroken: 'The context operates under a default nobody chose.',
  },
  adr: {
    answers: 'Which recorded decision put that rule there?',
    resolvedFrom: 'the ADR the stance cites, verified to exist in docs/adr/',
    ifBroken: 'A rule is being enforced and nobody can say who decided it or why.',
  },
  'source-record': {
    answers: 'Where is the record a reader can go and check?',
    resolvedFrom: 'the source module the panel declares, verified to exist on disk',
    ifBroken: 'The trail ends in a citation of something that is not there.',
  },
};
const EXPLANATION_ORDER = ['executive-metric', 'readiness-dimension', 'evidence', 'control', 'policy', 'adr', 'source-record'];

// The module a panel is derived from. `derivedFrom` is prose with a path in it, so the path is
// extracted rather than assumed to be the whole string.
function sourceModuleOf(derivedFrom) {
  const m = String(derivedFrom || '').match(/src\/[A-Za-z0-9/_-]+\.js/);
  return m ? m[0] : null;
}

// The chain for one executive panel. Every hop resolves or names what would resolve it.
function explain(panel, { dashboard = null, readiness = null, evidence = null, controls = [], now = 0 } = {}) {
  if (!EXECUTIVE_PANELS[panel]) throw new Error(`unknown executive panel '${panel}'`);
  const contextMap = require('../architecture/context-map');
  const multiRegion = require('../twin2/multi-region');
  const adrGovernance = require('../architecture/adr-governance');
  const evidenceConfidence = require('./evidence-confidence');
  const raci = require('../governance/raci');
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..', '..');

  const spec = EXECUTIVE_PANELS[panel];
  const module = sourceModuleOf(spec.derivedFrom);
  const owner = module ? (contextMap.moduleOwnership().owner || {})[module] || null : null;
  const hops = [];
  const hop = (id, resolved, detail, records = []) => {
    hops.push({ hop: id, ...EXPLANATION_HOPS[id], resolved, detail, records });
    return resolved;
  };

  // 1. The metric itself.
  const row = dashboard && Array.isArray(dashboard.panels) ? dashboard.panels.find((p) => p.panel === panel) : null;
  hop('executive-metric', !!(row && row.measured),
    row ? (row.measured ? `'${panel}' = ${JSON.stringify(row.value)} (${row.detail})` : `'${panel}' is unmeasured — ${row.detail}`)
      : 'no executive dashboard was supplied, so the figure itself is unknown',
    row ? [`${spec.derivedFrom}`] : []);

  // 2. Which readiness conclusion it bears on. Derived through the context that claims the module.
  const dimensions = Object.entries(evidenceConfidence.READINESS_DIMENSIONS)
    .filter(([, d]) => owner && d.owner === owner).map(([id]) => id);
  hop('readiness-dimension', dimensions.length > 0,
    dimensions.length ? `'${module}' is claimed by the '${owner}' context, which owns readiness dimension(s): ${dimensions.join(', ')}`
      : owner ? `'${module}' is claimed by the '${owner}' context, which owns no readiness dimension — this metric bears on no readiness conclusion`
        : `no bounded context claims '${module || spec.derivedFrom}', so nothing connects this metric to a readiness conclusion`,
    dimensions);

  // 3. The evidence behind those dimensions.
  const evidenceRows = dimensions.map((d) => {
    const rec = evidence ? evidence.get(`readiness:${d}`) : null;
    return { dimension: d, present: !!(rec && rec.completeness > 0), source: rec ? rec.source : null, confidence: rec ? rec.confidence : null };
  });
  hop('evidence', evidenceRows.length > 0 && evidenceRows.every((e) => e.present),
    evidenceRows.length
      ? evidenceRows.map((e) => `${e.dimension}: ${e.present ? `${e.source}, confidence ${e.confidence}` : 'absent'}`).join('; ')
      : 'no readiness dimension to carry evidence for',
    evidenceRows.map((e) => `readiness:${e.dimension}`));

  // 4. The controls that enforce it, intersected with what actually ran.
  const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
  const owned = owner
    ? raci.controlOwnership([...ran]).controls.filter((c) => c.context === owner).map((c) => c.control)
    : [];
  hop('control', owned.length > 0,
    owned.length ? `${owned.length} control(s) owned by '${owner}' ran on this build`
      : owner ? `no control that ran is owned by the '${owner}' context — the evidence is a statement rather than a check`
        : 'no owning context, so no control can be attributed',
    owned);

  // 5. The declared operating rule for that context.
  const stance = owner ? (multiRegion.contextConsistency().find((s) => s.context === owner) || null) : null;
  hop('policy', !!(stance && stance.declared),
    stance && stance.declared ? `'${owner}' declares '${stance.model}' consistency: ${stance.rationale}`
      : owner ? `'${owner}' declares no consistency stance, so it operates under a default nobody chose`
        : 'no owning context, so no declared policy',
    stance && stance.declared ? [`${owner}: ${stance.model}`] : []);

  // 6. The recorded decision behind the rule, verified to exist.
  const adrNumbers = adrGovernance.adrFiles().map((f) => Number(path.basename(f).slice(0, 4)));
  const cited = stance && stance.adr ? Number(String(stance.adr).replace(/\D/g, '')) : null;
  hop('adr', cited !== null && adrNumbers.includes(cited),
    cited === null ? 'the declared stance cites no recorded decision'
      : adrNumbers.includes(cited) ? `${stance.adr} exists in docs/adr/`
        : `the stance cites ${stance.adr} and no such ADR exists`,
    cited !== null ? [stance.adr] : []);

  // 7. The record a reader can actually go and open.
  const exists = module ? fs.existsSync(path.join(ROOT, module)) : false;
  hop('source-record', exists,
    module ? (exists ? `${module} exists on disk` : `${module} is cited and does not exist`)
      : `'${spec.derivedFrom}' names no source module a reader could open`,
    module ? [module] : []);

  // THE RULE: broken AT the first failing hop, never a percentage.
  const firstBreak = hops.find((h) => !h.resolved) || null;
  return {
    panel, question: spec.question, derivedFrom: spec.derivedFrom, module, context: owner,
    hops, hopCount: hops.length,
    complete: !firstBreak,
    brokenAt: firstBreak ? firstBreak.hop : null,
    // What it costs, in the words of the hop that broke, rather than as a generic failure.
    consequence: firstBreak ? firstBreak.ifBroken : null,
    whatWouldResolveIt: firstBreak ? firstBreak.resolvedFrom : null,
    resolvedHops: hops.filter((h) => h.resolved).map((h) => h.hop),
    explanation: firstBreak
      ? `'${panel}' cannot be fully explained: the chain breaks at '${firstBreak.hop}' — ${firstBreak.detail}`
      : `'${panel}' is explainable end to end: ${hops.map((h) => h.detail).join(' → ')}`,
    now, informationalOnly: true, authorizes: false,
  };
}

// Part 4's report across every panel.
function explainability({ dashboard = null, readiness = null, evidence = null, controls = [], now = 0 } = {}) {
  const rows = Object.keys(EXECUTIVE_PANELS).sort().map((p) => explain(p, { dashboard, readiness, evidence, controls, now }));
  const complete = rows.filter((r) => r.complete);
  const byHop = EXPLANATION_ORDER.map((h) => ({
    hop: h, ...EXPLANATION_HOPS[h],
    breaksHere: rows.filter((r) => r.brokenAt === h).map((r) => r.panel),
  }));
  return {
    panels: rows, count: rows.length,
    hops: byHop, chain: [...EXPLANATION_ORDER],
    explainable: complete.map((r) => r.panel),
    unexplainable: rows.filter((r) => !r.complete).map((r) => ({ panel: r.panel, brokenAt: r.brokenAt, consequence: r.consequence })),
    // Where the chain most often breaks. This says what to fix about the platform's explainability
    // rather than about any one panel.
    weakestHop: byHop.slice().sort((a, b) => b.breaksHere.length - a.breaksHere.length || a.hop.localeCompare(b.hop))[0] || null,
    explainabilityRate: rows.length ? +(complete.length / rows.length).toFixed(4) : null,
    // THE PART 4 RULE, computed rather than promised.
    everyValueExplainable: rows.length > 0 && complete.length === rows.length,
    now, informationalOnly: true, authorizes: false,
    note: 'Every hop is derived: the panel names its module, the context map claims the module, the readiness model owns the dimension, RACI owns the control, the context declares the stance, the stance cites the ADR, and the module is the record. Nothing here is a hand-kept mapping, so a panel that moves re-links itself. A chain is reported as broken AT its first failing hop, never as a percentage — a chain six-sevenths complete supports nothing.',
  };
}

// --- Part 13: bidirectional readiness traceability ------------------------------------------------
//
// Part 4 walks forward from a figure. Part 13 asks the question that catches the other failure:
//
//   Readiness → Evidence: what does this conclusion rest on?
//   Evidence  → Readiness: what does this control actually hold up?
//
// The second direction is the one nothing has ever asked, and it finds the controls that support no
// readiness conclusion at all. A control nothing depends on is not necessarily wrong — but nobody
// should discover during an audit that a third of the suite holds nothing up.
function readinessTraceability({ readiness = null, evidence = null, controls = [], now = 0 } = {}) {
  const evidenceConfidence = require('./evidence-confidence');
  const raci = require('../governance/raci');
  const ran = [...new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)))].sort();
  const ownership = raci.controlOwnership(ran).controls;
  const contextOf = Object.fromEntries(ownership.map((c) => [c.control, c.context]));

  // Readiness → Evidence.
  const forward = Object.entries(evidenceConfidence.READINESS_DIMENSIONS).map(([dimension, d]) => {
    const rec = evidence ? evidence.get(`readiness:${dimension}`) : null;
    const supporting = ran.filter((c) => contextOf[c] === d.owner);
    const scored = readiness && Array.isArray(readiness.dimensions) ? readiness.dimensions.find((x) => x.dimension === dimension) : null;
    const chain = [
      { link: 'readiness-dimension', resolved: true, detail: d.title },
      { link: 'evidence', resolved: !!(rec && rec.completeness > 0), detail: rec ? `${rec.source}, completeness ${rec.completeness}` : `no evidence record for '${d.evidence}'` },
      { link: 'control', resolved: supporting.length > 0, detail: supporting.length ? `${supporting.length} control(s) owned by '${d.owner}'` : `no control that ran is owned by '${d.owner}'` },
    ];
    const broken = chain.find((l) => !l.resolved) || null;
    return {
      dimension, title: d.title, owner: d.owner, evidenceKey: d.evidence,
      status: scored ? scored.status : 'unknown', ready: scored ? scored.ready : null,
      supportingControls: supporting, chain,
      traceable: !broken, brokenAt: broken ? broken.link : null,
      reason: broken ? `'${dimension}' cannot be traced to what supports it: ${broken.detail}` : `'${dimension}' traces to ${supporting.length} control(s) through recorded evidence`,
    };
  });

  // Evidence → Readiness. Every control that ran, and what it holds up.
  const owners = new Set(Object.values(evidenceConfidence.READINESS_DIMENSIONS).map((d) => d.owner));
  const reverse = ran.map((control) => {
    const context = contextOf[control] || null;
    const supports = Object.entries(evidenceConfidence.READINESS_DIMENSIONS)
      .filter(([, d]) => context && d.owner === context).map(([id]) => id);
    return {
      control, context, supports,
      // Not an error. A finding: a control holding nothing up is one nobody would miss.
      supportsReadiness: supports.length > 0,
      reason: !context ? 'this control has no owning bounded context'
        : supports.length ? `supports ${supports.join(', ')} through the '${context}' context`
          : `owned by '${context}', which owns no readiness dimension — this control holds up no readiness conclusion`,
    };
  });

  const untraceable = forward.filter((f) => !f.traceable);
  const orphanControls = reverse.filter((r) => !r.supportsReadiness);
  return {
    readinessToEvidence: forward, evidenceToReadiness: reverse,
    dimensionCount: forward.length, controlCount: reverse.length,
    traceable: forward.filter((f) => f.traceable).map((f) => f.dimension),
    untraceable: untraceable.map((f) => ({ dimension: f.dimension, brokenAt: f.brokenAt, reason: f.reason })),
    orphanControls: orphanControls.map((r) => r.control),
    orphanContexts: [...new Set(orphanControls.map((r) => r.context).filter(Boolean))].sort(),
    readinessOwningContexts: [...owners].sort(),
    // THE PART 13 RULE, computed in both directions rather than promised in one.
    bidirectional: true,
    everyConclusionTraceable: forward.length > 0 && untraceable.length === 0,
    traceabilityRate: forward.length ? +(forward.filter((f) => f.traceable).length / forward.length).toFixed(4) : null,
    orphanRate: reverse.length ? +(orphanControls.length / reverse.length).toFixed(4) : null,
    basis: `${forward.length - untraceable.length} of ${forward.length} readiness dimensions trace to the evidence and controls behind them. In the other direction, ${orphanControls.length} of ${reverse.length} controls that ran hold up no readiness conclusion — not an error, but not something anybody should discover during an audit.`,
    now, informationalOnly: true, authorizes: false,
    note: 'Traceability is checked in both directions. Forward answers "what does this conclusion rest on"; backward answers "what does this control actually hold up", and only the backward direction finds a suite that has grown past what any readiness conclusion depends on.',
  };
}

// --- Institutional performance intelligence (Phase 16, Part 14) -----------------------------------
//
// Twenty-two panels answer "is this domain sound". Part 14 asks a different question a board asks and
// nothing here answered: is the institution PERFORMING — and it is a different question because a
// domain can be sound and going nowhere.
//
// Six indicators, and the constraint that has held since Phase 1 and is checked here rather than
// promised:
//
//   MANUAL EXECUTIVE METRICS REMAIN PROHIBITED. There is no parameter in this function that accepts
//   a figure. Every indicator is a function of a report, and supplying a number instead of a report
//   produces `unmeasured`, not the number.
const PERFORMANCE_INDICATORS = {
  governanceEfficiency: {
    asks: 'Is governance producing decisions, or queuing them?',
    derivedFrom: 'src/governance/optimization.js — review load against declared capacity',
    ifUnmeasured: 'Nobody can tell a board that decides from one that meets.',
  },
  operationalEffectiveness: {
    asks: 'Do the controls actually catch what they are for?',
    derivedFrom: 'src/assurance/control-effectiveness.js — observed detection rate',
    ifUnmeasured: 'A green build stands in for operational evidence.',
  },
  organizationalMaturity: {
    asks: 'How capable is the institution across its seven domains?',
    derivedFrom: 'src/governance/ownership.js (capabilityMaturity)',
    ifUnmeasured: 'Capability is asserted rather than assessed.',
  },
  legalReadiness: {
    asks: 'Can the institution say what permits each capability to operate?',
    derivedFrom: 'src/legislation/legal-authority.js',
    ifUnmeasured: 'Lawfulness is assumed from the absence of a challenge.',
  },
  documentationQuality: {
    asks: 'Does the governed corpus still describe the implementation?',
    derivedFrom: 'src/architecture/documentation-assurance.js',
    ifUnmeasured: 'An operator follows a procedure nobody has checked.',
  },
  institutionalResilience: {
    asks: 'Does every critical capability have a validated alternative?',
    derivedFrom: 'src/governance/institutional-resilience.js',
    ifUnmeasured: 'A single person, document or instrument can stop a constitutional capability and nothing says so.',
  },
};

function institutionalPerformance(sources = {}) {
  const g = (fn) => { try { const r = fn(); return r === undefined ? null : r; } catch (_) { return null; } };
  const indicator = (id, value, performing, detail) => ({
    indicator: id, ...PERFORMANCE_INDICATORS[id],
    // A raw number supplied instead of a report produces `unmeasured`, never the number.
    measured: value !== null && value !== undefined,
    value: value ?? null,
    performing: value === null || value === undefined ? null : performing,
    detail: detail || `not measured — ${PERFORMANCE_INDICATORS[id].ifUnmeasured}`,
    derived: true, manualEntry: false,
  });

  const indicators = [
    indicator('governanceEfficiency',
      g(() => sources.optimization && sources.optimization.load && sources.optimization.load.approvalLoad.length
        ? +(sources.optimization.load.approvalLoad.filter((r) => !r.overCapacity).length / sources.optimization.load.approvalLoad.length).toFixed(4) : null),
      g(() => sources.optimization && sources.optimization.overCapacityAuthorities.length === 0),
      g(() => sources.optimization && `${sources.optimization.overCapacityAuthorities.length} authority(ies) owe more reviews than they can perform`)),
    indicator('operationalEffectiveness',
      g(() => sources.controlPerformance && sources.controlPerformance.measurable ? sources.controlPerformance.meanDetectionRate : null),
      g(() => sources.controlPerformance && sources.controlPerformance.measurable && sources.controlPerformance.degrading.length === 0),
      g(() => sources.controlPerformance && sources.controlPerformance.basis)),
    indicator('organizationalMaturity',
      g(() => sources.capabilityMaturity && sources.capabilityMaturity.organizationalLevel !== 'unknown' ? sources.capabilityMaturity.organizationalLevel : null),
      g(() => sources.capabilityMaturity && sources.capabilityMaturity.complete),
      g(() => sources.capabilityMaturity && sources.capabilityMaturity.basis)),
    indicator('legalReadiness',
      g(() => sources.legalAuthority ? +(sources.legalAuthority.authorized.length / Math.max(1, sources.legalAuthority.count)).toFixed(4) : null),
      g(() => sources.legalAuthority && sources.legalAuthority.complete),
      g(() => sources.legalAuthority && sources.legalAuthority.completenessBasis)),
    indicator('documentationQuality',
      g(() => sources.documentation && sources.documentation.verification
        ? +((sources.documentation.verification.claims - sources.documentation.verification.unresolvedCount) / Math.max(1, sources.documentation.verification.claims)).toFixed(4) : null),
      g(() => sources.documentation && sources.documentation.sound),
      g(() => sources.documentation && `${sources.documentation.verification.unresolvedCount} of ${sources.documentation.verification.claims} claims do not resolve`)),
    indicator('institutionalResilience',
      g(() => sources.resilience && Array.isArray(sources.resilience.capabilities)
        ? +(sources.resilience.capabilities.filter((c) => c.categoriesValidated).length / Math.max(1, sources.resilience.capabilities.length)).toFixed(4) : null),
      g(() => sources.resilience && sources.resilience.holds),
      g(() => sources.resilience && `${sources.resilience.violationCount} capability(ies) rest on a single dependency`)),
  ];

  const measured = indicators.filter((i) => i.measured);
  const underperforming = indicators.filter((i) => i.performing === false);
  return {
    indicators, count: indicators.length,
    catalogue: Object.entries(PERFORMANCE_INDICATORS).map(([indicator, i]) => ({ indicator, ...i })),
    measured: measured.map((i) => i.indicator),
    unmeasured: indicators.filter((i) => !i.measured).map((i) => i.indicator),
    underperforming: underperforming.map((i) => i.indicator),
    // Weakest link, and an unmeasured indicator is not a performing one.
    performing: indicators.every((i) => i.performing === true),
    everyIndicatorDerived: indicators.every((i) => i.derived === true && i.manualEntry === false),
    measurable: measured.length > 0,
    basis: measured.length
      ? `${measured.length} of ${indicators.length} performance indicators are measured; ${underperforming.length} are underperforming. The ${indicators.length - measured.length} unmeasured are excluded rather than counted as performing.`
      : 'No performance indicator has a source. The institution\'s performance is unmeasured, which is not the same as poor and not the same as adequate.',
    authorizationStatus: 'NOT AUTHORIZED',
    informationalOnly: true, authorizes: false,
    note: 'Manual executive metrics remain prohibited. There is no parameter here that accepts a figure: every indicator is a function of a report, and supplying a number instead of a report produces "unmeasured" rather than the number.',
  };
}

// --- The Phase 16 global invariant ---------------------------------------------------------------
//
//   No executive conclusion, readiness assessment, governance recommendation, institutional
//   forecast, or operational decision shall exist without a complete, explainable, evidence-backed
//   traceability chain.
//
// The six-clause invariant asks whether a CAPABILITY is sound. This one asks whether a CONCLUSION is
// answerable — and it is a different question, because a platform can be entirely sound and still
// produce figures nobody can trace.
//
// The rule that makes it a gate rather than a report:
//
//   AN UNTRACEABLE CONCLUSION BLOCKS READINESS UNTIL SOMEBODY EITHER TRACES IT OR ACCEPTS IT ON THE
//   RECORD, with a rationale and an expiry. There is no third option, and in particular there is no
//   option where the conclusion keeps being published while nobody can say what it rests on.
const TRACEABILITY_SUBJECTS = {
  'executive-conclusion': { produces: 'the twenty-two executive panels', tracedBy: 'the seven-hop explainability chain', ifUntraced: 'A board acts on a figure whose provenance is a code comment.' },
  'readiness-assessment': { produces: 'the ten readiness dimensions', tracedBy: 'bidirectional readiness traceability', ifUntraced: 'Readiness is asserted and nobody can say from what.' },
  'governance-recommendation': { produces: 'optimization recommendations and decision packages', tracedBy: 'the evidence and affected controls each names', ifUntraced: 'Advice is followed and nobody can reconstruct why it was given.' },
  'institutional-forecast': { produces: 'the twelve governance forecasts', tracedBy: 'a recorded forecast scored against an observed outcome', ifUntraced: 'A prediction is quoted as a fact and nothing ever checks it.' },
  'operational-decision': { produces: 'recorded governance decisions', tracedBy: 'the decision memory and the ledger behind it', ifUntraced: 'A decision exists with no recoverable basis, so it cannot be challenged or repeated.' },
};

// The ten areas Phase 16 requires this evaluated across. Each names the source that would answer it.
const TRACEABILITY_AREAS = {
  architecture: 'src/architecture/drift-prevention.js (continuousArchitectureValidation)',
  governance: 'src/governance/raci.js and src/governance/ownership.js',
  documentation: 'src/architecture/documentation-assurance.js',
  legalAuthority: 'src/legislation/legal-authority.js',
  evidence: 'src/assurance/evidence-confidence.js (EvidenceRegister)',
  operationalReadiness: 'src/assurance/evidence-confidence.js (readinessModel)',
  institutionalResilience: 'src/governance/institutional-resilience.js',
  executiveIntelligence: 'src/assurance/institutional.js (explainability)',
  organizationalCapability: 'src/governance/ownership.js (capabilityMaturity)',
  digitalTwinSimulations: 'src/twin2/operations-twin.js (calibrationReport)',
};

function evaluateTraceabilityInvariant(sources = {}) {
  const g = (fn) => { try { const r = fn(); return r === undefined ? null : r; } catch (_) { return null; } };
  const subject = (id, traced, detail) => ({
    subject: id, ...TRACEABILITY_SUBJECTS[id],
    traced: traced === null ? null : !!traced,
    unknown: traced === null,
    holds: traced === true,
    detail: detail || `no source was supplied to trace this from — ${TRACEABILITY_SUBJECTS[id].ifUntraced}`,
  });

  const subjects = [
    subject('executive-conclusion',
      g(() => sources.explainability ? sources.explainability.everyValueExplainable : null),
      g(() => sources.explainability && `${sources.explainability.explainable.length} of ${sources.explainability.count} executive values are explainable end to end; the chain most often breaks at '${sources.explainability.weakestHop.hop}'`)),
    subject('readiness-assessment',
      g(() => sources.traceability ? sources.traceability.everyConclusionTraceable : null),
      g(() => sources.traceability && sources.traceability.basis)),
    subject('governance-recommendation',
      g(() => sources.decisions ? sources.decisions.everyPackageAdvisory && sources.decisions.packages.every((p) => p.supportingEvidence.length && p.affectedControls.length) : null),
      g(() => sources.decisions && `${sources.decisions.count} decision package(s), each carrying supporting evidence and affected controls`)),
    subject('institutional-forecast',
      g(() => sources.calibration ? sources.calibration.measurable : null),
      g(() => sources.calibration && sources.calibration.basis)),
    subject('operational-decision',
      g(() => sources.decisionMemory ? (sources.decisionMemory.unevaluated || []).length === 0 : null),
      g(() => sources.decisionMemory && `${(sources.decisionMemory.unevaluated || []).length} decision(s) have never been evaluated against what actually happened`)),
  ];

  // The ten areas. An area with no source is UNKNOWN — the same discipline as everywhere else.
  const areas = Object.entries(TRACEABILITY_AREAS).map(([area, derivedFrom]) => {
    const supplied = sources.areas && sources.areas[area] !== undefined && sources.areas[area] !== null;
    return {
      area, derivedFrom,
      evaluated: supplied,
      holds: supplied ? !!sources.areas[area] : null,
      reason: supplied ? (sources.areas[area] ? 'traceable' : 'a conclusion in this area cannot be traced to what it rests on')
        : 'no source was supplied for this area, so whether its conclusions are traceable is unknown',
    };
  });

  const violations = [
    ...subjects.filter((s) => !s.holds).map((s) => ({ subject: s.subject, area: null, unknown: s.unknown, reason: s.detail, ifUntraced: s.ifUntraced })),
    ...areas.filter((a) => a.holds !== true).map((a) => ({ subject: null, area: a.area, unknown: !a.evaluated, reason: a.reason, ifUntraced: 'A whole area of the platform produces conclusions nobody can trace.' })),
  ];
  return {
    statement: 'No executive conclusion, readiness assessment, governance recommendation, institutional forecast, or operational decision shall exist without a complete, explainable, evidence-backed traceability chain.',
    subjects, subjectCount: subjects.length,
    areas, areaCount: areas.length,
    violations, violationCount: violations.length,
    // Counted apart, as everywhere: nobody looked is not the same as we looked and it does not trace.
    unknownViolations: violations.filter((v) => v.unknown).length,
    tracedViolations: violations.filter((v) => !v.unknown).length,
    holds: violations.length === 0,
    blocksInstitutionalReadiness: violations.length > 0,
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'This invariant is about CONCLUSIONS, not capabilities: a platform can be entirely sound and still produce figures nobody can trace. An untraceable conclusion blocks readiness until somebody traces it or accepts it on the record with a rationale and an expiry — there is no option where it keeps being published while nobody can say what it rests on.',
  };
}

// The report, with acceptances applied. Uses the same acceptance discipline as the capability
// invariant — a named authority, a rationale and an expiry — through the same register class.
function traceabilityInvariantReport({ acceptances = null, now = 0, ...sources } = {}) {
  const evaluation = evaluateTraceabilityInvariant(sources);
  const active = acceptances && acceptances.activeTraceability ? acceptances.activeTraceability({ now }) : [];
  const expired = acceptances && acceptances.expiredTraceability ? acceptances.expiredTraceability({ now }) : [];
  const covered = (v) => active.some((a) => a.subject === (v.subject || v.area));
  const unaccepted = evaluation.violations.filter((v) => !covered(v));
  return {
    ...evaluation,
    acceptances: active, expiredAcceptances: expired,
    accepted: evaluation.violations.filter(covered),
    unaccepted,
    blocksInstitutionalReadiness: unaccepted.length > 0,
    now,
  };
}

// --- Part 15: the executive dashboard ------------------------------------------------------------
//
// Every panel is derived. There is no path here that accepts a figure.
function executiveGovernanceIntelligence(sources = {}) {
  const panel = (id, value, sound, detail) => ({
    panel: id, ...EXECUTIVE_PANELS[id],
    measured: value !== null && value !== undefined,
    value: value ?? null, sound: value === null || value === undefined ? null : sound,
    detail, derived: true, manualEntry: false,
  });
  const g = (fn, fallback = null) => { try { const r = fn(); return r === undefined ? fallback : r; } catch (_) { return fallback; } };

  const panels = [
    panel('institutionalResilience', g(() => sources.resilience && sources.resilience.holds), g(() => sources.resilience && sources.resilience.holds) === true, g(() => sources.resilience && `${sources.resilience.violationCount} capability(ies) depend on a single thing`, 'not assessed')),
    panel('governanceMaturity', g(() => sources.governanceMaturity && sources.governanceMaturity.level), g(() => sources.governanceMaturity && sources.governanceMaturity.level >= 4), g(() => sources.governanceMaturity && sources.governanceMaturity.name, 'not assessed')),
    panel('operationalReadiness', g(() => sources.readiness && sources.readiness.readyCount), g(() => sources.readiness && sources.readiness.allDimensionsReady), g(() => sources.readiness && `${sources.readiness.readyCount}/${sources.readiness.dimensionCount} dimensions ready`, 'not assessed')),
    panel('missionReadiness', g(() => sources.mission && sources.mission.safeToDeploy), g(() => sources.mission && sources.mission.safeToDeploy === true), g(() => sources.mission && sources.mission.boardSummary, 'not assessed')),
    panel('documentationHealth', g(() => sources.documentation && sources.documentation.verification.claims), g(() => sources.documentation && sources.documentation.sound), g(() => sources.documentation && `${sources.documentation.verification.unresolvedCount} unresolved claim(s)`, 'not assessed')),
    panel('organizationalContinuity', g(() => sources.continuity && sources.continuity.minimumBusFactor), g(() => sources.continuity && sources.continuity.sound), g(() => sources.continuity && `${sources.continuity.singlePersonDependencies.length} role(s) rest on one person`, 'not assessed')),
    panel('complianceEvolution', g(() => sources.compliance && sources.compliance.complianceRate), g(() => sources.compliance && sources.compliance.reconciliation && sources.compliance.reconciliation.sound), g(() => sources.compliance && `direction ${sources.compliance.direction}, recently ${sources.compliance.recentDirection}`, 'not assessed')),
    panel('knowledgeContinuity', g(() => sources.training && sources.training.readinessContribution), g(() => sources.training && sources.training.sound), g(() => sources.training && `${sources.training.expiredQualifications.length} expired qualification(s)`, 'not assessed')),
    panel('simulationConfidence', g(() => sources.simulation && sources.simulation.confidence), g(() => sources.simulation && ['high', 'moderate'].includes(sources.simulation.confidence)), g(() => sources.simulation && `${sources.simulation.uncalibrated.length} scenario(s) never compared against reality`, 'not assessed')),
    panel('assumptionHealth', g(() => sources.assumptions && sources.assumptions.count), g(() => sources.assumptions && sources.assumptions.sound), g(() => sources.assumptions && `${sources.assumptions.stale.length} stale, ${sources.assumptions.overclaims.length} overclaimed`, 'not assessed')),
    // Part 19. Each is a function of a register, exactly like the ten above; there is still no
    // parameter anywhere in this module that accepts a figure.
    panel('strategicReadiness', g(() => sources.regulatory && sources.regulatory.count), g(() => sources.regulatory && sources.regulatory.ready), g(() => sources.regulatory && sources.regulatory.readinessBasis, 'not assessed')),
    panel('organizationalMaturity', g(() => sources.adaptive && sources.adaptive.constrained.length), g(() => sources.adaptive && sources.adaptive.unconstrained.length === 0), g(() => sources.adaptive && `${sources.adaptive.unconstrained.length} of ${sources.adaptive.forecasts.length} forecasts rest on too few observations to constrain anything`, 'not assessed')),
    panel('operationalSustainability', g(() => sources.capacity && sources.capacity.measured.length), g(() => sources.capacity && sources.capacity.complete && sources.capacity.shortfallCount === 0), g(() => sources.capacity && `${sources.capacity.shortfallCount} capacity shortfall(s), ${sources.capacity.unmeasurable.length} dimension(s) unmeasurable`, 'not assessed')),
    panel('decisionQuality', g(() => sources.decisions && sources.decisions.evaluationRate), g(() => sources.decisions && sources.decisions.contradicted.length === 0 && sources.decisions.unevaluated.length === 0), g(() => sources.decisions && `${sources.decisions.unevaluated.length} decision(s) never evaluated, ${sources.decisions.contradicted.length} contradicted by their own evidence`, 'not assessed')),
    panel('publicTrust', g(() => sources.publicTrust && sources.publicTrust.composite), g(() => sources.publicTrust && sources.publicTrust.composite === 'warranted'), g(() => sources.publicTrust && sources.publicTrust.basis, 'not assessed')),
    // Part 15. Same rule as the twenty-two above it: each is a function of a register, and there is
    // still no parameter anywhere in this module that accepts a figure.
    panel('governanceHealth', g(() => sources.optimization && sources.optimization.findingCount), g(() => sources.optimization && sources.optimization.bottleneckAuthorities.length === 0 && sources.optimization.overCapacityAuthorities.length === 0), g(() => sources.optimization && `${sources.optimization.bottleneckAuthorities.length} bottleneck(s), ${sources.optimization.findingCount} finding(s)`, 'not assessed')),
    panel('legalAuthorityCompleteness', g(() => sources.legalAuthority && sources.legalAuthority.count), g(() => sources.legalAuthority && sources.legalAuthority.complete), g(() => sources.legalAuthority && sources.legalAuthority.completenessBasis, 'not assessed')),
    panel('assumptionMaturity', g(() => sources.assumptionMaturity && sources.assumptionMaturity.organizationalMaturity), g(() => sources.assumptionMaturity && sources.assumptionMaturity.belowMinimum.length === 0), g(() => sources.assumptionMaturity && sources.assumptionMaturity.maturityBasis, 'not assessed')),
    panel('controlEffectiveness', g(() => sources.controlEffectiveness && sources.controlEffectiveness.effectivenessRate), g(() => sources.controlEffectiveness && sources.controlEffectiveness.measurable && sources.controlEffectiveness.ineffective.length === 0), g(() => sources.controlEffectiveness && sources.controlEffectiveness.effectivenessBasis, 'not assessed')),
    panel('dependencyResilience', g(() => sources.dependencyIntelligence && sources.dependencyIntelligence.count), g(() => sources.dependencyIntelligence && sources.dependencyIntelligence.open === 0), g(() => sources.dependencyIntelligence && `${sources.dependencyIntelligence.open} open single dependency(ies); weakest type ${sources.dependencyIntelligence.weakestType ? sources.dependencyIntelligence.weakestType.type : 'unknown'}`, 'not assessed')),
    panel('organizationalLearning', g(() => sources.learning && sources.learning.learningRate), g(() => sources.learning && sources.learning.measurable && sources.learning.correctedNotLearned.length === 0), g(() => sources.learning && `${sources.learning.correctedNotLearned.length} incident(s) corrected without learning`, 'not assessed')),
    panel('documentationIntegrity', g(() => sources.documentation && sources.documentation.verification && sources.documentation.verification.claims), g(() => sources.documentation && sources.documentation.sound), g(() => sources.documentation && `${sources.documentation.verification.unresolvedCount} unresolved claim(s)`, 'not assessed')),
  ];
  const unmeasured = panels.filter((p) => !p.measured).map((p) => p.panel);
  const unsound = panels.filter((p) => p.sound === false).map((p) => p.panel);
  return {
    panels, count: panels.length,
    unmeasured, unsound,
    // Weakest link: the board's picture is as good as its worst panel, and an unmeasured panel is
    // worse than a red one because it looks like nothing.
    sound: unmeasured.length === 0 && unsound.length === 0,
    everyMetricDerived: panels.every((p) => p.derived && p.manualEntry === false),
    authorizationStatus: 'NOT AUTHORIZED',
    derivedFromEvidence: true, authorizes: false, informationalOnly: true,
    note: 'Every panel is a function of a register; there is no parameter anywhere in this module that accepts a figure. An unmeasured panel is reported as unmeasured, never as satisfied.',
  };
}

// --- Institutional sustainability (Phase 15, Part 19) ----------------------------------------------
//
// Every other measure in this platform asks whether the institution can operate NOW. Sustainability
// asks whether it can still operate in five years, which is a different question with different
// answers — an institution can be entirely ready today and structurally unable to stay that way.
//
// Seven dimensions, each with a stated horizon, because "sustainable" with no timeframe attached is
// a word rather than an assessment.
const SUSTAINABILITY_DIMENSIONS = {
  governanceContinuity: { horizon: 'the next board cycle', asks: 'Will the governance bodies still be able to convene and decide?', ifLost: 'Decisions queue and the estate runs on defaults nobody chose.' },
  organizationalResilience: { horizon: 'the next staffing cycle', asks: 'Will there still be a validated alternative for every accountable role?', ifLost: 'A departure takes a capability with it.' },
  documentationSustainability: { horizon: 'the next release cycle', asks: 'Is the governed corpus being maintained as fast as the implementation changes?', ifLost: 'An operator follows a procedure that no longer works, during the incident it was written for.' },
  assumptionHealth: { horizon: 'the review cadence of the shortest-lived assumption', asks: 'Are the beliefs the platform rests on still being verified?', ifLost: 'The platform keeps operating on beliefs that stopped being true, and nothing says when they did.' },
  knowledgePreservation: { horizon: 'a generation of staff', asks: 'Does the know-how exist outside the heads of the people who hold it now?', ifLost: 'The institution has to rediscover how it works, at the worst possible time.' },
  successionReadiness: { horizon: 'the next leadership change', asks: 'Could every accountable post change hands without a capability stopping?', ifLost: 'A resignation becomes an outage.' },
  legalContinuity: { horizon: 'the life of the shortest-lived instrument', asks: 'Will the legal basis for each capability still stand?', ifLost: 'The platform operates without authority, which no amount of technical excellence repairs.' },
};

function institutionalSustainability(sources = {}) {
  const g = (fn) => { try { const r = fn(); return r === undefined ? null : r; } catch (_) { return null; } };
  const dimension = (id, sustainable, detail) => ({
    dimension: id, ...SUSTAINABILITY_DIMENSIONS[id],
    measured: sustainable !== null && sustainable !== undefined,
    sustainable: sustainable === null || sustainable === undefined ? null : sustainable,
    detail: detail || 'not assessed', derived: true,
  });

  const dimensions = [
    dimension('governanceContinuity',
      g(() => sources.optimization && sources.optimization.overCapacityAuthorities.length === 0),
      g(() => sources.optimization && `${sources.optimization.overCapacityAuthorities.length} authority(ies) owe more reviews than they can perform`)),
    dimension('organizationalResilience',
      g(() => sources.continuity && sources.continuity.sound),
      g(() => sources.continuity && `minimum bus factor ${sources.continuity.minimumBusFactor}`)),
    dimension('documentationSustainability',
      g(() => sources.documentation && sources.documentation.sound),
      g(() => sources.documentation && `${sources.documentation.verification.unresolvedCount} unresolved claim(s)`)),
    dimension('assumptionHealth',
      g(() => sources.assumptionMaturity && sources.assumptionMaturity.belowMinimum.length === 0 && sources.assumptionMaturity.verificationBacklog.length === 0),
      g(() => sources.assumptionMaturity && `${sources.assumptionMaturity.verificationBacklog.length} assumption(s) overdue for verification, ${sources.assumptionMaturity.belowMinimum.length} below the maturity their criticality requires`)),
    dimension('knowledgePreservation',
      g(() => sources.resilience && Array.isArray(sources.resilience.capabilities) && sources.resilience.capabilities.every((c) => !c.singleDependencies.includes('knowledge'))),
      g(() => sources.resilience && `${(sources.resilience.capabilities || []).filter((c) => c.singleDependencies.includes('knowledge')).length} capability(ies) live in somebody's head`)),
    dimension('successionReadiness',
      g(() => sources.continuity && sources.continuity.singlePersonDependencies.length === 0),
      g(() => sources.continuity && `${sources.continuity.singlePersonDependencies.length} role(s) rest on one person`)),
    dimension('legalContinuity',
      g(() => sources.legalAuthority && sources.legalAuthority.complete),
      g(() => sources.legalAuthority && `${sources.legalAuthority.blocking.length} capability(ies) have no current legal basis`)),
  ];

  const unmeasured = dimensions.filter((d) => !d.measured);
  const unsustainable = dimensions.filter((d) => d.sustainable === false);
  return {
    dimensions, count: dimensions.length,
    catalogue: Object.entries(SUSTAINABILITY_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d })),
    unmeasured: unmeasured.map((d) => d.dimension),
    unsustainable: unsustainable.map((d) => d.dimension),
    // Weakest link, as everywhere. An institution is sustainable only if it is sustainable on every
    // dimension, and an unmeasured dimension is not a sustainable one.
    sustainable: unmeasured.length === 0 && unsustainable.length === 0,
    horizonsBasis: 'Each dimension states its own horizon, because "sustainable" with no timeframe is a word rather than an assessment. The estate is sustainable to the shortest of them.',
    shortestHorizon: dimensions.filter((d) => d.sustainable === false).map((d) => `${d.dimension} (${d.horizon})`),
    everyFigureDerived: dimensions.every((d) => d.derived === true),
    informationalOnly: true, authorizes: false,
    note: 'Sustainability asks whether the institution can still operate in five years, which is a different question from whether it can operate today and often has a different answer. An unmeasured dimension is not a sustainable one.',
  };
}

// --- Executive decision support (Phase 15, Part 18) ------------------------------------------------
//
// The most dangerous artefact this platform produces. A decision package is a recommendation with
// enough evidence attached that a board can act on it without going and checking — which is exactly
// what makes it capable of substituting for the decision rather than informing it.
//
// So every package carries the eight things Part 18 requires, and one more the phase does not ask
// for and the platform has insisted on since Phase 1:
//
//   EVERY PACKAGE CONCLUDES "Human authorization required." It is a constant string, nothing
//   computes it, and `assertAdvisory` refuses to emit a package without it.
const DECISION_PACKAGE_FIELDS = {
  supportingEvidence: { absentMeans: 'The recommendation rests on nothing a reader can check.' },
  confidence: { absentMeans: 'Nobody can tell whether this is a firm conclusion or a hunch.' },
  assumptions: { absentMeans: 'The reasoning has premises and none of them is stated, so none can be disagreed with.' },
  affectedControls: { absentMeans: 'Nothing says what would have to change, so the cost is invisible.' },
  legalDependencies: { absentMeans: 'The recommendation may not be lawful and nothing here would say so.' },
  institutionalImpacts: { absentMeans: 'Nothing says who inside the institution this lands on.' },
  risks: { absentMeans: 'A recommendation with no stated risk is a recommendation nobody has argued with.' },
  uncertainties: { absentMeans: 'Every recommendation has things nobody knows. One that lists none is concealing them.' },
};

const HUMAN_AUTHORIZATION_REQUIRED = 'Human authorization required.';

// Exported so the guard can be fed a crafted package that omits something.
function assertAdvisory(pkg) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!pkg || !pkg.recommendation) fail('a decision package must state a recommendation');
  for (const [field, meta] of Object.entries(DECISION_PACKAGE_FIELDS)) {
    const value = pkg[field];
    const missing = value === undefined || value === null || (Array.isArray(value) && !value.length) || value === '';
    if (missing) fail(`a decision package must carry '${field}' — ${meta.absentMeans}`);
  }
  if (pkg.conclusion !== HUMAN_AUTHORIZATION_REQUIRED) fail(`every decision package must conclude "${HUMAN_AUTHORIZATION_REQUIRED}" — a package that concludes anything else is a decision`);
  if (pkg.authorizes !== false) fail('a decision package may not claim authority');
  return true;
}

function decisionPackage(spec = {}) {
  const pkg = {
    ...spec,
    advisory: true, authorizes: false,
    // A constant string. Nothing computes it, and no input can change it.
    conclusion: HUMAN_AUTHORIZATION_REQUIRED,
    decidedBy: null,
    note: 'A decision package assembles evidence for a decision. It never takes one: the conclusion is a constant, and the accountable human decides on the record.',
  };
  assertAdvisory(pkg);
  return pkg;
}

// Assemble the packages the current evidence actually supports. Each is built from a real finding, so
// a platform with no findings produces no packages rather than inventing advice.
function decisionSupport(sources = {}) {
  const packages = [];
  const push = (spec) => { packages.push(decisionPackage(spec)); };

  if (sources.legalAuthority && sources.legalAuthority.blocking && sources.legalAuthority.blocking.length) {
    const blocking = sources.legalAuthority.blocking;
    push({
      subject: 'legal-authority', priority: blocking.some((b) => b.constitutional) ? 'constitutional' : 'standard',
      recommendation: `Record and have reviewed the legal basis for ${blocking.length} capability(ies): ${blocking.map((b) => b.capability).join(', ')}.`,
      supportingEvidence: [`src/legislation/legal-authority.js: ${blocking.map((b) => `${b.capability} is '${b.state}'`).join('; ')}`],
      confidence: 'high — this is an absence of records, which is directly observable rather than estimated',
      assumptions: ['That a legal basis exists and is simply unrecorded. If none exists, this is a far larger finding than a recording gap.'],
      affectedControls: ['APP-FIT-LEGAL-AUTHORITY', 'APP-FIT-GLOBAL-INVARIANT', 'APP-FIT-LEGAL-DEPENDENCY-GRAPH'],
      legalDependencies: blocking.map((b) => `${b.capability}: ${b.reason}`),
      institutionalImpacts: ['The Attorney General\'s Chambers and each capability\'s approving organization would have to record and review a declaration.'],
      risks: ['Recording a plausible-sounding instrument that turns out not to authorise the capability would be worse than the current gap, because it would look closed.'],
      uncertainties: ['Whether the instruments exist and are simply unrecorded, or whether some capability is operating without one.'],
    });
  }
  if (sources.assumptionMaturity && sources.assumptionMaturity.verificationBacklog && sources.assumptionMaturity.verificationBacklog.length) {
    const backlog = sources.assumptionMaturity.verificationBacklog;
    push({
      subject: 'assumption-verification', priority: backlog.some((b) => b.criticality === 'foundational') ? 'constitutional' : 'standard',
      recommendation: `Verify ${backlog.length} assumption(s), most critical first: ${backlog.slice(0, 3).map((b) => b.assumption).join(', ')}.`,
      supportingEvidence: [`src/architecture/assumptions.js: organizational maturity is ${sources.assumptionMaturity.organizationalMaturity}, ${sources.assumptionMaturity.belowMinimum.length} below the level their criticality requires`],
      confidence: 'high — derived from what has been recorded, not estimated',
      assumptions: ['That the declared criticality of each assumption is right. Criticality is a judgement and can be argued with.'],
      affectedControls: ['APP-FIT-ASSUMPTION-MATURITY', 'APP-FIT-ASSUMPTION-GRAPH', 'APP-FIT-TWIN-CONFIDENCE-DIMENSIONS'],
      legalDependencies: ['None directly, though several assumptions bear on capabilities whose legal basis is also unrecorded.'],
      institutionalImpacts: ['Each assumption\'s owner, and somebody independent of them to perform the verification.'],
      risks: ['Verification performed by the owner would raise the recorded maturity without raising the actual assurance.'],
      uncertainties: ['Whether the assumptions still hold. That is the point of verifying them, and nothing here can predict the answer.'],
    });
  }
  if (sources.controlEffectiveness && !sources.controlEffectiveness.measurable) {
    push({
      subject: 'control-effectiveness', priority: 'standard',
      recommendation: 'Begin recording observations of controls doing their job, so effectiveness can be measured rather than assumed from a green build.',
      supportingEvidence: [`src/assurance/control-effectiveness.js: ${sources.controlEffectiveness.unknown.length} control(s) have no performance evidence`],
      confidence: 'high — the absence of observations is directly observable',
      assumptions: ['That the controls currently detect anything at all. Nothing has tested that; it is what the observations would establish.'],
      affectedControls: ['APP-FIT-CONTROL-EFFECTIVENESS', 'APP-FIT-GLOBAL-INVARIANT'],
      legalDependencies: ['None.'],
      institutionalImpacts: ['Operations would have to record detection, acknowledgement and remediation times for real conditions.'],
      risks: ['Recording only the incidents the controls caught would produce a false-negative rate of zero and a reliability figure that means nothing.'],
      uncertainties: ['How many conditions have occurred that no control noticed. That number is currently unknowable and is exactly what the register would start to reveal.'],
    });
  }

  return {
    packages, count: packages.length,
    fields: Object.entries(DECISION_PACKAGE_FIELDS).map(([field, f]) => ({ field, ...f })),
    conclusion: HUMAN_AUTHORIZATION_REQUIRED,
    // Constitutional matters first, then deterministically.
    ordered: packages.slice().sort((a, b) => (a.priority === 'constitutional' ? 0 : 1) - (b.priority === 'constitutional' ? 0 : 1) || a.subject.localeCompare(b.subject)).map((p) => p.subject),
    everyPackageAdvisory: packages.every((p) => p.advisory === true && p.authorizes === false && p.conclusion === HUMAN_AUTHORIZATION_REQUIRED),
    basis: packages.length
      ? `${packages.length} package(s), each assembled from a finding the evidence actually supports.`
      : 'No decision package was assembled, because no supplied evidence supports one. A platform with nothing to say says nothing rather than inventing advice.',
    advisory: true, authorizes: false,
    note: 'A decision package is the most dangerous artefact here: enough evidence attached that a board could act without checking, which is what makes it capable of substituting for the decision. The conclusion is a constant string and no input can change it.',
  };
}

// --- Part 20: the institutional assurance framework ----------------------------------------------
function institutionalAssurance(sources = {}) {
  const verdicts = {
    architecture: sources.drift ? sources.drift.clean : null,
    security: sources.security !== undefined ? sources.security : null,
    privacy: sources.privacy !== undefined ? sources.privacy : null,
    governance: sources.governanceMaturity ? sources.governanceMaturity.level >= 3 : null,
    documentation: sources.documentation ? sources.documentation.sound : null,
    operationalReadiness: sources.readiness ? sources.readiness.allDimensionsReady : null,
    organizationalReadiness: sources.continuity ? sources.continuity.sound : null,
    institutionalResilience: sources.resilience ? sources.resilience.holds : null,
    training: sources.training ? sources.training.sound : null,
    knowledgeContinuity: sources.continuity ? sources.continuity.minimumBusFactor >= 2 : null,
    compliance: sources.compliance && sources.compliance.reconciliation ? sources.compliance.reconciliation.sound : null,
    missionReadiness: sources.mission ? sources.mission.safeToDeploy : null,
    evidenceQuality: sources.evidenceQuality ? sources.evidenceQuality.sound : null,
    // Part 20. Each verdict resolves to `null` when nothing was supplied, so an unmeasured domain
    // stays unmeasured rather than defaulting either way.
    dependencyResilience: sources.resilience && Array.isArray(sources.resilience.capabilities)
      ? sources.resilience.capabilities.every((c) => c.categoriesValidated) : null,
    strategicReadiness: sources.regulatory ? sources.regulatory.ready : null,
    learningMaturity: sources.learning && sources.learning.learningRate !== null && sources.learning.learningRate !== undefined
      ? sources.learning.learningRate > 0 && sources.learning.correctedNotLearned.length === 0 : null,
    governanceAdaptability: sources.optimization
      ? sources.optimization.bottleneckAuthorities.length === 0 && sources.optimization.overCapacityAuthorities.length === 0 : null,
    publicTrustIndicators: sources.publicTrust ? sources.publicTrust.composite === 'warranted' : null,
    // Part 20.
    legalAuthority: sources.legalAuthority ? sources.legalAuthority.complete : null,
    // A register that exists but has nothing in it leaves this UNMEASURED, not failing. Controls
    // nobody has watched are not controls known to be bad, and reporting them as failing would put
    // the wrong repair on somebody's desk.
    controlEffectiveness: sources.controlEffectiveness
      ? (sources.controlEffectiveness.measurable ? sources.controlEffectiveness.ineffective.length === 0 : null) : null,
    institutionalSustainability: sources.sustainability ? sources.sustainability.sustainable : null,
  };
  const domains = Object.keys(ASSURANCE_DOMAINS).map((id) => ({
    domain: id,
    ...ASSURANCE_DOMAINS[id],
    verified: verdicts[id] === true,
    // Unmeasured is its own state, and the framework says what it would mean rather than hiding it.
    state: verdicts[id] === true ? 'verified' : verdicts[id] === false ? 'failing' : 'unmeasured',
  }));
  const unmeasured = domains.filter((d) => d.state === 'unmeasured');
  const failing = domains.filter((d) => d.state === 'failing');
  return {
    domains, count: domains.length,
    verified: domains.filter((d) => d.verified).length,
    failing: failing.map((d) => d.domain),
    unmeasured: unmeasured.map((d) => d.domain),
    // Institutional readiness is the weakest domain, and an unmeasured domain is not a green one.
    institutionallyReady: failing.length === 0 && unmeasured.length === 0,
    blockers: [
      ...failing.map((d) => `${d.domain}: failing — ${d.unverifiedMeans}`),
      ...unmeasured.map((d) => `${d.domain}: unmeasured — ${d.unverifiedMeans}`),
    ],
    // THE INVARIANT THAT SURVIVES EVERY PHASE. A constant string; nothing computes it.
    authorizationStatus: 'NOT AUTHORIZED',
    authorizationBasis: 'Authorization is a recorded decision by the approving authority for a specific deployment. Thirteen verified domains do not produce one, and no aggregate of evidence ever will.',
    derivedFromReadiness: false, authorizes: false, failClosed: true,
    note: 'The framework proves institutional readiness. It does not replace human authority, and an unmeasured domain is reported as unmeasured rather than as satisfied — a framework that renders "nobody looked" as a green tick is worse than none, because it is trusted.',
  };
}

module.exports = {
  EXECUTIVE_PANELS, ASSURANCE_DOMAINS, IMPROVEMENT_STAGES,
  ImprovementLoop, executiveGovernanceIntelligence, institutionalAssurance,
  GOVERNANCE_STATES, governanceState, governanceCompleteness,
  LEARNING_STAGES, institutionalLearning,
  WORKSHOP_OUTCOMES, WORKSHOP_STATES, ValidationWorkshop,
  PERFORMANCE_INDICATORS, institutionalPerformance,
  TRACEABILITY_SUBJECTS, TRACEABILITY_AREAS, evaluateTraceabilityInvariant, traceabilityInvariantReport,
  TRUST_EVIDENCE_KINDS, TrustEvidenceRegister, trustEvidence,
  EVIDENCE_TYPES, ONBOARDING_STATES, EvidenceOnboarding,
  DATA_CLASSES, PROVENANCE_FIELDS,
  EXPLANATION_HOPS, EXPLANATION_ORDER, sourceModuleOf, explain, explainability, readinessTraceability,
  CONNECTOR_KINDS, TRUST_LEVELS, TRUST_ORDER, INTEGRITY_STATES, FRESHNESS_STATES, SYNC_STATES,
  EvidenceConnectorRegistry,
  SUSTAINABILITY_DIMENSIONS, institutionalSustainability,
  DECISION_PACKAGE_FIELDS, HUMAN_AUTHORIZATION_REQUIRED, assertAdvisory, decisionPackage, decisionSupport,
};
