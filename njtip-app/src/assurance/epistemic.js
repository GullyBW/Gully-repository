'use strict';

// Epistemic states and contiguous assurance chains — the two principles Batch 5 discovered, moved
// out of the one function that found them so the rest of the platform can hold to them.
//
// Neither of these is a new engine. They are the arithmetic that `explain()` and `explainDecision()`
// were already doing, named once so a third caller cannot quietly do it differently. Every place
// that walks a chain of prerequisites shares this file; nothing here decides anything.
//
// --- Why three states -----------------------------------------------------------------------------
//
// The decision-explainability chain shipped with two: a hop resolved or it did not. A decision
// package whose precedent field honestly read "no comparable recommendation has been recorded, so
// nothing is known about how this has gone before" then resolved the precedent hop — because the
// code counted records and a record was present — and the chain reported "explainable end to end
// across all 9 hops" for a recommendation with no precedent whatsoever.
//
// A stated absence had been read as a presence. That is the failure this codebase keeps meeting in
// new clothes, and two states cannot express the difference. Three can:
//
//   RESOLVED  the evidence exists and establishes the claim
//   BROKEN    the evidence was checked and establishes that the claim is invalid
//   UNKNOWN   the available evidence establishes neither
//
// UNKNOWN is not a gentler BROKEN and it is emphatically not a PASS. BROKEN says somebody looked and
// found the thing wrong; UNKNOWN says the question is open. They lead to different institutional
// actions — one is fixed, the other is investigated — which is the whole reason for keeping them
// apart. What they share is that neither continues a chain.
//
// The principle in one line, because it is the thing most easily lost in a refactor:
//
//     absence of evidence is not evidence of compliance, and unknown is not pass.
const EPISTEMIC_STATES = {
  RESOLVED: {
    continuesChain: true, satisfied: true, examined: true, blocking: false,
    means: 'The required evidence exists and establishes the claim.',
    ifReported: 'The claim holds on the evidence recorded. It does not authorise anything.',
  },
  BROKEN: {
    continuesChain: false, satisfied: false, examined: true, blocking: true,
    means: 'The required evidence was checked and establishes that the claim is invalid, inconsistent or violated.',
    ifReported: 'Something is wrong and somebody can go and fix it. This is the actionable state.',
  },
  UNKNOWN: {
    continuesChain: false, satisfied: false, examined: false, blocking: false,
    means: 'The available evidence is insufficient to establish either resolution or failure.',
    ifReported: 'Nobody knows yet. This is a successful verification outcome when the evidence genuinely cannot settle the question, and it must never be rendered as a pass.',
  },
};
const EPISTEMIC_ORDER = ['RESOLVED', 'BROKEN', 'UNKNOWN'];

// The weakest link, not the mean. Used wherever several epistemic results roll up into one.
// BROKEN outranks UNKNOWN outranks RESOLVED: a set containing one broken member is broken, and a set
// containing no broken member but one unknown member is unknown.
function weakest(states = []) {
  const present = states.filter((s) => EPISTEMIC_STATES[s]);
  if (!present.length) return 'UNKNOWN';
  if (present.includes('BROKEN')) return 'BROKEN';
  if (present.includes('UNKNOWN')) return 'UNKNOWN';
  return 'RESOLVED';
}

// --- Contiguous assurance chains -------------------------------------------------------------------
//
// For a sequential chain A → B → C → D → E, if C is UNKNOWN then D and E are not reachable
// conclusions no matter what they individually report. They may each be independently true; the
// chain still does not carry you to them, because C is where the reader's confidence stops.
//
// Two numbers, deliberately kept apart, because conflating them is how a broken chain starts looking
// healthy:
//
//   contiguousNavigableDepth  how far you walk before the first gap. The honest one.
//   resolvedCount             how many steps resolve in total, wherever they sit.
//
// A chain broken at step 1 with steps 2..9 intact has depth 0 and a resolved count of 8. Reporting
// the 8 as depth produces "TRACEABLE THROUGH HOP 8/9" for a package with nothing at the top — the
// percentage this module refuses to print, wearing a count. That exact defect shipped once and is
// what this function exists to make unrepeatable.
//
// And no percentages. Not because a fraction is always wrong, but because "80% compliant" cannot
// distinguish twenty per cent of trivia missing from the first prerequisite being absent, and a
// reader who sees 80 stops asking which it was.
function assuranceChain(steps = [], { subject = null, now = 0 } = {}) {
  const walked = steps.map((s, i) => {
    const state = EPISTEMIC_STATES[s && s.state] ? s.state : 'UNKNOWN';
    return {
      position: i + 1, step: s && s.step ? s.step : `step-${i + 1}`,
      state, ...EPISTEMIC_STATES[state],
      detail: (s && s.detail) || null,
      ifBroken: (s && s.ifBroken) || null,
      resolvedFrom: (s && s.resolvedFrom) || null,
      evidence: Array.isArray(s && s.evidence) ? [...s.evidence] : [],
      resolved: state === 'RESOLVED',
    };
  });

  const firstBreak = walked.find((h) => !h.resolved) || null;
  const contiguous = firstBreak ? walked.indexOf(firstBreak) : walked.length;

  return {
    subject, steps: walked, length: walked.length,
    states: EPISTEMIC_ORDER.map((state) => ({ state, ...EPISTEMIC_STATES[state] })),
    complete: !firstBreak,
    // The chain's own state is the state of the step that stopped it.
    chainState: firstBreak ? firstBreak.state : 'RESOLVED',
    stoppedAt: firstBreak ? firstBreak.step : null,
    stoppedAtPosition: firstBreak ? firstBreak.position : null,
    stoppedBecause: firstBreak ? firstBreak.state : null,
    consequence: firstBreak ? firstBreak.ifBroken : null,
    whatWouldResolveIt: firstBreak ? firstBreak.resolvedFrom : null,
    // THE TWO NUMBERS. Kept apart on purpose.
    contiguousNavigableDepth: contiguous,
    resolvedCount: walked.filter((h) => h.resolved).length,
    // Steps that resolve but sit behind a gap. Individually true, collectively unreachable — the
    // set a reader most needs named, because these are what a depth-as-tally bug counts.
    resolvedButUnreachable: firstBreak ? walked.slice(contiguous + 1).filter((h) => h.resolved).map((h) => h.step) : [],
    unknownSteps: walked.filter((h) => h.state === 'UNKNOWN').map((h) => h.step),
    brokenSteps: walked.filter((h) => h.state === 'BROKEN').map((h) => h.step),
    resolvedSteps: walked.filter((h) => h.resolved).map((h) => h.step),
    summary: firstBreak
      ? `NAVIGABLE THROUGH ${contiguous}/${walked.length} — ${firstBreak.state} AT ${String(firstBreak.step).toUpperCase()}${firstBreak.detail ? `: ${firstBreak.detail}` : ''}`
      : `navigable end to end across all ${walked.length} step(s)`,
    now, informationalOnly: true, authorizes: false,
    note: 'Depth is the walk before the first gap, never the tally of steps that happen to resolve. A chain is reported as stopped AT its first unresolved step and never as a percentage, because a fraction cannot distinguish a missing detail from a missing prerequisite and a reader who sees a high number stops asking which it was.',
  };
}

// --- The machine/human boundary --------------------------------------------------------------------
//
// Part 5 established the shape and it generalises: a control states what it can observe and what it
// cannot, in the output, rather than leaving a reader to infer the limit from behaviour. A checker
// that silently stops at the edge of what it can see is indistinguishable from one that found
// nothing there.
//
// Machine-detectable: structural duplication, missing fields, invalid references, missing evidence,
// stale evidence, broken chains, malformed specifications, inconsistent metadata.
//
// Human judgement: substantive adequacy, material equivalence, legal interpretation, institutional
// sufficiency, policy judgement, operational readiness, whether two alternatives are genuinely
// different, whether evidence is institutionally persuasive.
//
// The pipeline this preserves, and the one it refuses:
//
//     observation → evidence → human judgement → governance decision
//     observation → institutional verdict                              (never)
function machineBoundary({ observed = [], judged = [], verdictIsHuman = true } = {}) {
  return {
    machineDetectable: observed.length ? observed.join('; ') : 'nothing — this control observes no structural condition',
    humanJudgementRequired: judged.length ? judged.join('; ') : null,
    observed: [...observed], judged: [...judged],
    // A machine observation is an input to a governance decision and is never itself one.
    producesInstitutionalVerdict: false,
    verdictIsHuman,
    pipeline: 'observation → evidence → human judgement → governance decision',
    refused: 'observation → institutional verdict',
    authorizes: false,
  };
}

module.exports = {
  EPISTEMIC_STATES, EPISTEMIC_ORDER, weakest,
  assuranceChain, machineBoundary,
};
