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
const LINEAGE_STAGES = {
  implementation: { requires: ['modules'], description: 'The decision was built. Named modules, so a reader can go and look.' },
  outcome: { requires: ['evidence'], description: 'What actually happened once it ran, evidenced by a control or a measurement.' },
  lesson: { requires: ['statement'], description: 'What was learned, stated so the next decision can use it.' },
  supersession: { requires: ['adr'], description: 'A later decision that this one led to.' },
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
    if (!this._entries.has(key)) this._entries.set(key, { adr: key, implementation: [], outcome: [], lesson: [], supersession: [] });
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
    const rec = { stage, by, at: at ?? this._clock(), ...payload };
    this._entry(adr)[stage].push(rec);
    return { ...rec };
  }

  // The lineage of one decision, end to end.
  lineage(adr, { controls = [] } = {}) {
    const key = this._key(adr);
    const e = this._entries.get(key) || { adr: key, implementation: [], outcome: [], lesson: [], supersession: [] };
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
    return {
      adr: key,
      implementation: e.implementation, outcomes, lessons: e.lesson, supersessions: e.supersession,
      built: e.implementation.length > 0,
      // The default state of a decision is that nobody has checked it.
      evaluated: outcomes.length > 0,
      verdict: latest ? latest.verdict : null,
      evidencedOutcome: latest ? latest.state === 'evidenced' : false,
      learned: e.lesson.length > 0,
      ledTo: e.supersession.map((s) => s.adr),
      complete: e.implementation.length > 0 && outcomes.some((o) => o.state === 'evidenced') && e.lesson.length > 0,
      gaps: [
        ...(e.implementation.length ? [] : ['no implementation recorded — nothing says this decision was built']),
        ...(outcomes.length ? [] : ['no outcome recorded — nobody has checked whether it worked, which is not the same as it working']),
        ...(outcomes.length && !outcomes.some((o) => o.state === 'evidenced') ? ['every recorded outcome is claimed rather than evidenced'] : []),
        ...(e.lesson.length ? [] : ['no lesson recorded — nothing here can inform the next decision']),
        ...outcomes.filter((o) => o.contradicted).map((o) => `an outcome recorded as '${o.verdict}' cites failing evidence: ${o.failingEvidence.join(', ')}`),
      ],
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
      now, informationalOnly: true, authorizes: false,
      note: 'A decision with no recorded outcome is UNEVALUATED, not successful. An outcome with no resolving evidence is CLAIMED, not evidenced. Both are reported rather than letting silence read as success.',
    };
  }
}

module.exports = { DecisionMemory, LINEAGE_STAGES, OUTCOME_VERDICTS };
