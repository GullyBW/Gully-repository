'use strict';
// Decision Memory (Phase 13, Part 9). Extends the architecture bounded context.
//
//   ADR → Implementation → Operational Outcome → Lessons Learned → Future ADRs → Improvement
//
// The ADR catalogue records what was decided and why. What it does not record is what HAPPENED —
// whether the thing was built, whether it worked, and whether the next decision knew any of that.
// Without that link, a catalogue is a pile of intentions: ADR-0005 predicted authorization caching
// would scale safely, and nothing in the repository connects that prediction to whether it did.
//
// Two rules keep this from becoming a self-congratulatory log:
//
//   AN OUTCOME MUST BE EVIDENCED. "It worked" is not an outcome; a named control that holds, or a
//   measurement, is. An outcome with no evidence is recorded as CLAIMED and reported separately.
//
//   A DECISION WITH NO RECORDED OUTCOME IS UNEVALUATED, NOT SUCCESSFUL. The default state of every
//   decision is that nobody has checked, and the report says so rather than letting silence read as
//   success.
const adrGovernance = require('./adr-governance');

// What can be recorded against a decision, and what each stage requires to count.
//
// Phase 14, Part 7 added four: intent, unintended, abandoned and reversal. The first two are a pair
// and the pairing is the point — an outcome can only be called UNINTENDED if it was not among the
// intents recorded at decision time, and the platform checks that rather than taking the word of the
// person filing it. Without the check, "unintended consequence" is a phrase institutions use for
// things they did in fact expect and would rather not have written down.
const LINEAGE_STAGES = {
  intent: {
    requires: ['predictions'],
    description: 'What the decision was expected to achieve, recorded at decision time. A prediction filed after the result is not a prediction.',
  },
  implementation: { requires: ['modules'], description: 'The decision was built. Named modules, so a reader can go and look.' },
  outcome: { requires: ['evidence'], description: 'What actually happened once it ran, evidenced by a control or a measurement.' },
  unintended: {
    requires: ['consequence', 'discoveredBy'],
    description: 'Something the decision caused that nobody predicted. Checked against the recorded intents; a predicted outcome filed here is reclassified.',
  },
  abandoned: {
    requires: ['approach', 'whyNot'],
    description: 'An approach that was considered and dropped. Recorded so it is not re-proposed in three years by somebody who was not in the room.',
  },
  lesson: { requires: ['statement'], description: 'What was learned, stated so the next decision can use it.' },
  supersession: { requires: ['adr'], description: 'A later decision that this one led to.' },
  reversal: {
    requires: ['reversedBy', 'reason'],
    description: 'The decision was undone. Deliberately NOT a supersession: building on a decision and retreating from it are different histories, and merging them lets an institution tell itself it evolved.',
  },
};

// How an outcome turned out. `mixed` exists because most real outcomes are, and forcing a binary
// would push every honest entry into the wrong bucket.
const OUTCOME_VERDICTS = {
  'as-predicted': { good: true, description: 'The decision did what the ADR said it would.' },
  mixed: { good: null, description: 'Some of what was predicted, and something else as well.' },
  'not-as-predicted': { good: false, description: 'The decision did not do what the ADR said it would.' },
  'too-early': { good: null, description: 'Not enough has happened yet to say. Distinct from nobody having looked.' },
};

class DecisionMemory {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._entries = new Map(); }

  _adrExists(adr) {
    const n = typeof adr === 'number' ? adr : Number(String(adr).replace(/^ADR-/, ''));
    return adrGovernance.adrFiles().some((f) => Number(f.slice(0, 4)) === n);
  }
  _key(adr) { return typeof adr === 'number' ? `ADR-${String(adr).padStart(4, '0')}` : String(adr); }

  _entry(adr) {
    const key = this._key(adr);
    if (!this._entries.has(key)) {
      this._entries.set(key, Object.fromEntries([['adr', key], ...Object.keys(LINEAGE_STAGES).map((s) => [s, []])]));
    }
    return this._entries.get(key);
  }

  // Record a stage against a decision. The ADR must exist — a lineage entry for a decision nobody
  // wrote is a note about nothing.
  record(adr, stage, { by, at = null, ...payload } = {}) {
    const spec = LINEAGE_STAGES[stage];
    if (!spec) throw new Error(`unknown lineage stage '${stage}' — one of ${Object.keys(LINEAGE_STAGES).join(', ')}`);
    if (!this._adrExists(adr)) throw new Error(`no ADR '${this._key(adr)}' exists — a lineage entry for a decision nobody wrote is a note about nothing`);
    if (!by) { const e = new Error('a decision-memory entry must name who recorded it'); e.failClosed = true; throw e; }
    for (const field of spec.requires) {
      if (payload[field] === undefined || payload[field] === null || (Array.isArray(payload[field]) && !payload[field].length)) {
        throw new Error(`a '${stage}' entry requires '${field}' — ${spec.description}`);
      }
    }
    if (stage === 'outcome') {
      if (!OUTCOME_VERDICTS[payload.verdict]) throw new Error(`an outcome needs a verdict — one of ${Object.keys(OUTCOME_VERDICTS).join(', ')}`);
    }
    if (stage === 'supersession' && !this._adrExists(payload.adr)) throw new Error(`the superseding ADR '${payload.adr}' does not exist`);
    if (stage === 'reversal' && !this._adrExists(payload.reversedBy)) throw new Error(`the reversing ADR '${payload.reversedBy}' does not exist — a reversal nobody decided is a change, not a decision`);

    const entry = this._entry(adr);

    // THE HINDSIGHT RULE. An intent recorded after the outcome is not a prediction, it is a story
    // about what we meant to happen, and it is the single easiest way to make a decision record
    // flatter its authors.
    if (stage === 'intent' && entry.outcome.length) {
      const e = new Error(`an intent cannot be recorded for ${this._key(adr)} after an outcome exists — a prediction filed after the result is not a prediction`);
      e.failClosed = true; throw e;
    }
    if (stage === 'intent') {
      const preds = Array.isArray(payload.predictions) ? payload.predictions : [payload.predictions];
      for (const p of preds) {
        if (!p || !p.subject || !p.expectation) throw new Error('every prediction needs a subject and an expectation, so a later outcome can be matched against it');
      }
    }
    // THE UNINTENDED-CONSEQUENCE CHECK. If the "unintended" consequence names a subject the decision
    // predicted, it was intended and is recorded as such — with the intent that predicted it, so a
    // reader can see the reclassification rather than being told a tidier story.
    let reclassified = null;
    if (stage === 'unintended') {
      const predicted = entry.intent.flatMap((i) => (Array.isArray(i.predictions) ? i.predictions : [i.predictions]));
      const match = predicted.find((p) => p && p.subject === payload.subject);
      if (match) reclassified = { wasPredicted: true, predictedSubject: match.subject, expectation: match.expectation, byIntentOf: entry.intent.find((i) => (Array.isArray(i.predictions) ? i.predictions : [i.predictions]).includes(match)).by };
    }
    const rec = { stage, by, at: at ?? this._clock(), ...payload, ...(reclassified ? { reclassified } : {}) };
    entry[stage].push(rec);
    return { ...rec };
  }

  // The lineage of one decision, end to end.
  lineage(adr, { controls = [] } = {}) {
    const key = this._key(adr);
    const e = this._entries.get(key) || Object.fromEntries([['adr', key], ...Object.keys(LINEAGE_STAGES).map((s) => [s, []])]);
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));

    // An outcome is EVIDENCED only if the evidence it cites resolves to a control that ran.
    const outcomes = e.outcome.map((o) => {
      const cited = Array.isArray(o.evidence) ? o.evidence : [o.evidence];
      const resolved = cited.filter((c) => known.has(c));
      const failing = resolved.filter((c) => holding.get(c) === false);
      return {
        ...o, cited, resolved,
        evidenced: resolved.length > 0,
        // A verdict of 'as-predicted' resting on a FAILING control is the contradiction worth catching.
        contradicted: o.verdict === 'as-predicted' && failing.length > 0,
        failingEvidence: failing,
        state: resolved.length === 0 ? 'claimed' : failing.length ? 'contradicted' : 'evidenced',
      };
    });
    const latest = outcomes.length ? outcomes[outcomes.length - 1] : null;
    // Part 7: an unintended consequence that the decision actually predicted is reported as what it
    // is, rather than being filed under a heading that flatters the decision.
    const unintended = e.unintended.map((u) => ({ ...u, genuinelyUnintended: !u.reclassified }));
    const predictions = e.intent.flatMap((i) => (Array.isArray(i.predictions) ? i.predictions : [i.predictions]).map((p) => ({ ...p, by: i.by, at: i.at })));
    const reversed = e.reversal.length > 0;
    return {
      adr: key,
      intents: e.intent, predictions,
      implementation: e.implementation, outcomes, lessons: e.lesson, supersessions: e.supersession,
      unintended, abandoned: e.abandoned, reversals: e.reversal,
      built: e.implementation.length > 0,
      predicted: predictions.length > 0,
      // The default state of a decision is that nobody has checked it.
      evaluated: outcomes.length > 0,
      verdict: latest ? latest.verdict : null,
      evidencedOutcome: latest ? latest.state === 'evidenced' : false,
      learned: e.lesson.length > 0,
      ledTo: e.supersession.map((s) => s.adr),
      // Reversal and supersession kept apart, deliberately.
      reversed, reversedBy: e.reversal.map((r) => r.reversedBy),
      genuinelyUnintended: unintended.filter((u) => u.genuinelyUnintended).map((u) => u.consequence),
      misfiledAsUnintended: unintended.filter((u) => !u.genuinelyUnintended).map((u) => ({ consequence: u.consequence, wasPredictedBy: u.reclassified.byIntentOf })),
      abandonedApproaches: e.abandoned.map((a) => a.approach),
      complete: e.implementation.length > 0 && outcomes.some((o) => o.state === 'evidenced') && e.lesson.length > 0,
      gaps: [
        ...(e.intent.length ? [] : ['no intended outcome recorded — nothing states what this decision was supposed to achieve, so nothing can be compared against it']),
        ...(e.implementation.length ? [] : ['no implementation recorded — nothing says this decision was built']),
        ...(outcomes.length ? [] : ['no outcome recorded — nobody has checked whether it worked, which is not the same as it working']),
        ...(outcomes.length && !outcomes.some((o) => o.state === 'evidenced') ? ['every recorded outcome is claimed rather than evidenced'] : []),
        ...(e.lesson.length ? [] : ['no lesson recorded — nothing here can inform the next decision']),
        ...outcomes.filter((o) => o.contradicted).map((o) => `an outcome recorded as '${o.verdict}' cites failing evidence: ${o.failingEvidence.join(', ')}`),
        ...unintended.filter((u) => !u.genuinelyUnintended).map((u) => `'${u.consequence}' was filed as unintended and was predicted at decision time by ${u.reclassified.byIntentOf}`),
      ],
    };
  }

  // PART 7: the evolution timeline. Every recorded event in the order it happened, so a reader can
  // see what a decision was for, what it did, what it cost that nobody expected, and whether the
  // institution built on it or backed out of it.
  evolution(adr, { controls = [] } = {}) {
    const l = this.lineage(adr, { controls });
    const events = [
      ...l.intents.map((i) => ({ at: i.at, stage: 'intent', by: i.by, what: `predicted: ${(Array.isArray(i.predictions) ? i.predictions : [i.predictions]).map((p) => `${p.subject} — ${p.expectation}`).join('; ')}` })),
      ...l.abandoned.map((a) => ({ at: a.at, stage: 'abandoned', by: a.by, what: `considered and dropped '${a.approach}': ${a.whyNot}` })),
      ...l.implementation.map((i) => ({ at: i.at, stage: 'implementation', by: i.by, what: `built in ${(i.modules || []).join(', ')}` })),
      ...l.outcomes.map((o) => ({ at: o.at, stage: 'outcome', by: o.by, what: `${o.verdict} (${o.state})`, verdict: o.verdict })),
      ...l.unintended.map((u) => ({ at: u.at, stage: 'unintended', by: u.by, what: u.genuinelyUnintended ? `unforeseen: ${u.consequence}` : `filed as unforeseen, but predicted at decision time: ${u.consequence}`, genuinelyUnintended: u.genuinelyUnintended })),
      ...l.lessons.map((x) => ({ at: x.at, stage: 'lesson', by: x.by, what: x.statement })),
      ...l.supersessions.map((s) => ({ at: s.at, stage: 'supersession', by: s.by, what: `led to ${s.adr}` })),
      ...l.reversals.map((r) => ({ at: r.at, stage: 'reversal', by: r.by, what: `reversed by ${r.reversedBy}: ${r.reason}` })),
    ].sort((a, b) => a.at - b.at || Object.keys(LINEAGE_STAGES).indexOf(a.stage) - Object.keys(LINEAGE_STAGES).indexOf(b.stage));

    // Did it do what it said it would? Answered only where both halves exist.
    const predictionAccuracy = !l.predicted ? null
      : !l.evaluated ? null
        : l.outcomes[l.outcomes.length - 1].verdict;
    return {
      adr: l.adr, events, eventCount: events.length,
      // The three branches Part 7 asks for, kept apart because they mean different things.
      branches: {
        superseded: l.ledTo,
        reversed: l.reversedBy,
        abandoned: l.abandonedApproaches,
      },
      predictionAccuracy,
      predictedButUnevaluated: l.predicted && !l.evaluated,
      unforeseenCount: l.genuinelyUnintended.length,
      misfiledCount: l.misfiledAsUnintended.length,
      // A decision that was reversed and never had a lesson recorded is the most expensive kind:
      // the institution paid for the mistake and did not keep the receipt.
      costWithoutLearning: l.reversed && !l.learned,
      gaps: l.gaps,
      informationalOnly: true, authorizes: false,
      note: l.reversed
        ? 'This decision was REVERSED, not superseded. Building on a decision and retreating from it are different histories and are recorded as such.'
        : 'A timeline of what was intended, what was built, what happened, and what it cost that nobody expected.',
    };
  }

  // --- Organizational learning lifecycle (Phase 15, Part 12) -------------------------------------
  //
  // Phase 14's learning engine asks the question from the INCIDENT end: was this failure corrected,
  // and did anybody learn from it? Part 12 asks it from the DECISION end, which is this module's
  // business: for each ADR, what incident produced it, what was learned, and did anything change?
  //
  // The two are the same chain read in opposite directions and they must not become two engines. So
  // this method takes the improvement records as INPUT and joins them to the decision catalogue; it
  // computes no learning rate of its own and defines no second set of stages.
  //
  // The rule it exists to enforce, restated because it is the one that gets lost:
  //
  //   CORRECTION WITHOUT LEARNING STAYS EXPLICITLY VISIBLE. A decision taken to fix an incident,
  //   with no lesson recorded and nothing that changed afterwards, is the most expensive kind: the
  //   institution paid for the mistake and kept no receipt.
  learningLineage({ improvements = [], controls = [], now = null } = {}) {
    const adrs = adrGovernance.adrFiles().map((f) => `ADR-${f.slice(0, 4)}`);
    // Which improvement records cite each ADR — that is the join between an incident and a decision.
    const byAdr = new Map();
    for (const i of improvements) {
      if (!i.adr) continue;
      if (!byAdr.has(i.adr)) byAdr.set(i.adr, []);
      byAdr.get(i.adr).push(i);
    }
    const rows = adrs.map((adr) => {
      const l = this.lineage(adr, { controls });
      const causedBy = (byAdr.get(adr) || []).map((i) => ({ improvement: i.id, control: i.control, detail: i.detail, stage: i.stage }));
      const closed = causedBy.filter((c) => c.stage === 'outcome-recorded');
      return {
        adr,
        // The chain Part 12 names, read from the decision end.
        incident: causedBy.length ? causedBy.map((c) => c.control) : null,
        correction: causedBy.length > 0,
        rootCauseRecorded: causedBy.length > 0,
        decisionTaken: true,
        lessonRecorded: l.learned,
        outcomeEvidenced: l.evidencedOutcome,
        reversed: l.reversed,
        causedBy, closedImprovements: closed.length,
        // Reactive decisions are the ones an incident produced; the rest were somebody's initiative,
        // and telling them apart is the point of the join.
        reactive: causedBy.length > 0,
        // THE FINDING. A decision that came out of an incident, with no lesson and no evidenced
        // outcome, is a correction the institution has already forgotten.
        correctedWithoutLearning: causedBy.length > 0 && (!l.learned || !l.evidencedOutcome),
        reason: !causedBy.length
          ? 'no recorded incident produced this decision — it was somebody\'s initiative rather than a correction'
          : !l.learned ? 'produced by an incident and no lesson was recorded'
            : !l.evidencedOutcome ? 'produced by an incident, a lesson was recorded, and nothing evidences that it worked'
              : 'produced by an incident, a lesson was recorded, and the outcome is evidenced',
      };
    });
    const reactive = rows.filter((r) => r.reactive);
    const forgotten = rows.filter((r) => r.correctedWithoutLearning);
    return {
      decisions: rows, count: rows.length,
      reactive: reactive.map((r) => r.adr),
      initiative: rows.filter((r) => !r.reactive).map((r) => r.adr),
      // Kept as its own list rather than folded into a rate, because a rate would let three
      // well-documented decisions hide one the institution paid for and forgot.
      correctedWithoutLearning: forgotten.map((r) => ({ adr: r.adr, reason: r.reason })),
      // Only computed over the decisions an incident actually produced. A learning rate over
      // decisions nobody took in response to anything would be a rate over the wrong denominator.
      learningRate: reactive.length ? +(reactive.filter((r) => !r.correctedWithoutLearning).length / reactive.length).toFixed(4) : null,
      learningBasis: reactive.length
        ? `${reactive.filter((r) => !r.correctedWithoutLearning).length} of ${reactive.length} decisions produced by a recorded incident carry both a lesson and an evidenced outcome. Decisions taken on somebody's initiative are excluded, because they were not corrections.`
        : 'no decision in this catalogue is linked to a recorded incident. That is not evidence the institution has had none — it is evidence that nothing joins its incidents to its decisions.',
      measurable: improvements.length > 0,
      now, informationalOnly: true, authorizes: false,
      note: 'The same chain the learning engine walks from the incident end, read from the decision end. Correction without learning is kept as a named list rather than folded into a rate, because a rate would let it disappear.',
    };
  }

  // The whole catalogue's memory: which decisions have been evaluated, which never were, and what
  // the estate has actually learned.
  report({ controls = [], now = null } = {}) {
    const adrs = adrGovernance.adrFiles().map((f) => `ADR-${f.slice(0, 4)}`);
    const rows = adrs.map((a) => this.lineage(a, { controls }));
    const evaluated = rows.filter((r) => r.evaluated);
    const contradicted = rows.filter((r) => r.outcomes.some((o) => o.contradicted));
    return {
      decisions: rows, count: rows.length,
      stages: Object.entries(LINEAGE_STAGES).map(([id, s]) => ({ stage: id, ...s })),
      verdicts: Object.entries(OUTCOME_VERDICTS).map(([id, s]) => ({ verdict: id, ...s })),
      built: rows.filter((r) => r.built).map((r) => r.adr),
      evaluated: evaluated.map((r) => r.adr),
      // The number this exists to surface, and the one nobody usually computes.
      unevaluated: rows.filter((r) => !r.evaluated).map((r) => r.adr),
      evaluationRate: rows.length ? +(evaluated.length / rows.length).toFixed(4) : null,
      claimedOnly: rows.filter((r) => r.evaluated && !r.outcomes.some((o) => o.state === 'evidenced')).map((r) => r.adr),
      contradicted: contradicted.map((r) => r.adr),
      lessons: rows.flatMap((r) => r.lessons.map((l) => ({ adr: r.adr, statement: l.statement, by: l.by, at: l.at }))),
      chains: rows.filter((r) => r.ledTo.length).map((r) => ({ from: r.adr, to: r.ledTo })),
      complete: rows.filter((r) => r.complete).map((r) => r.adr),
      // Part 7: evolution across the catalogue.
      stages: Object.entries(LINEAGE_STAGES).map(([id, s]) => ({ stage: id, ...s })),
      predicted: rows.filter((r) => r.predicted).map((r) => r.adr),
      unpredicted: rows.filter((r) => !r.predicted).map((r) => r.adr),
      reversed: rows.filter((r) => r.reversed).map((r) => ({ adr: r.adr, by: r.reversedBy })),
      superseded: rows.filter((r) => r.ledTo.length).map((r) => r.adr),
      unforeseen: rows.flatMap((r) => r.genuinelyUnintended.map((c) => ({ adr: r.adr, consequence: c }))),
      misfiledAsUnintended: rows.flatMap((r) => r.misfiledAsUnintended.map((m) => ({ adr: r.adr, ...m }))),
      abandonedApproaches: rows.flatMap((r) => r.abandonedApproaches.map((a) => ({ adr: r.adr, approach: a }))),
      // The number worth watching: decisions the institution paid for and kept no lesson from.
      costWithoutLearning: rows.filter((r) => r.reversed && !r.learned).map((r) => r.adr),
      now, informationalOnly: true, authorizes: false,
      note: 'A decision with no recorded outcome is UNEVALUATED, not successful. An outcome with no resolving evidence is CLAIMED, not evidenced. A consequence filed as unintended that was predicted at decision time is reported as predicted. All three are surfaced rather than letting silence read as success.',
    };
  }
}

module.exports = { DecisionMemory, LINEAGE_STAGES, OUTCOME_VERDICTS };
