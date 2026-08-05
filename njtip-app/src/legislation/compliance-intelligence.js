'use strict';
// Automated Compliance Intelligence (Phase 12, Part 19). Extends the legislation & regulatory
// governance bounded context (`src/legislation/`) from "what does this instrument map to?" to
// "something changed — what does it now touch, and what is missing?"
//
// The gap this closes: the registry already records which controls and systems each instrument maps
// to, and the impact analyser already walks that. What neither answers is the question somebody
// actually asks the morning an amendment is gazetted — *which of our bounded contexts, ADRs,
// policies, datasets, workflows and readiness dimensions does this land on, and where are we short?*
//
// Two principles run through everything below.
//
//   AN UNASSESSED CHANGE IS NOT A COMPLIANT ONE. A change nobody has mapped produces a gap, not
//   silence. The register is the list of changes we know about; it is never evidence that there
//   are no others, and the report says so.
//
//   A CONTROL THAT EXISTS BUT DOES NOT HOLD IS NOT A CONTROL. "Mapped" and "holding" are different
//   facts and are reported separately, because a failing control and a missing one need different
//   work from different people.
const contextMap = require('../architecture/context-map');
const adrGovernance = require('../architecture/adr-governance');
const ownership = require('../governance/ownership');
const multiRegion = require('../twin2/multi-region');
const evidenceConfidence = require('../assurance/evidence-confidence');

// The kinds of change this module watches. Each states who normally originates it and what a
// missed one costs — a change kind nobody can say the consequence of is a change kind nobody
// prioritises.
const CHANGE_KINDS = {
  'legislative-change': { originator: 'Parliament', missedMeans: 'The platform enforces a rule that is no longer law, or fails to enforce one that now is.' },
  'regulatory-amendment': { originator: 'A regulator', missedMeans: 'A supervisory expectation goes unimplemented until an inspection finds it.' },
  'policy-update': { originator: 'A governance board', missedMeans: 'Practice and published policy diverge, and the platform is the one that is wrong.' },
  'governance-change': { originator: 'An accountable authority', missedMeans: 'A control keeps an owner who no longer holds the post.' },
  'control-effectiveness': { originator: 'Assurance', missedMeans: 'A control is counted as holding when its evidence says otherwise.' },
};

// How severely a change lands, declared rather than computed — the ordering is a judgement about
// consequence and should be arguable.
const CHANGE_SEVERITY = ['critical', 'major', 'minor'];

// What a change can be mapped onto. Each dimension names the registry it is resolved against, on
// the same rule the operations twin follows: a mapping resolved against nothing is a hand-kept list.
const MAPPING_DIMENSIONS = {
  boundedContexts: { source: 'src/architecture/context-map.js' },
  adrs: { source: 'docs/adr/*.md via src/architecture/adr-governance.js' },
  policies: { source: 'src/twin2/multi-region.js (consistency stances)' },
  controls: { source: 'the executable fitness identifiers supplied by the caller' },
  datasets: { source: 'the data-governance estate supplied by the caller' },
  workflows: { source: 'src/architecture/context-map.js (relationships)' },
  readinessDimensions: { source: 'src/assurance/evidence-confidence.js' },
};

// Which readiness dimension a change kind bears on. Declared, because inferring it from a keyword
// match would eventually put a privacy amendment under supply chain and nobody would notice.
const KIND_READINESS = {
  'legislative-change': ['legal', 'governance'],
  'regulatory-amendment': ['legal', 'governance'],
  'policy-update': ['governance', 'operational'],
  'governance-change': ['governance', 'organisational'],
  'control-effectiveness': ['technical', 'security'],
};

// --- Compliance state lifecycle (Phase 13, Part 4) -----------------------------------------------
//
// The single rule that shapes this: NO UNKNOWN STATE MAY BE REPORTED AS COMPLIANT. Every state
// therefore declares `compliant` explicitly rather than it being inferred from the name, and the
// two states that look like success are kept apart — `compliant` is what we assess ourselves to be,
// `verified` is what somebody independent confirmed. Collapsing them is how self-assessment becomes
// assurance.
const COMPLIANCE_STATES = {
  unknown: { compliant: false, terminal: false, description: 'Nothing has been assessed. Not a neutral state — an obligation nobody has looked at is an obligation nobody can say is met.' },
  'under-assessment': { compliant: false, terminal: false, description: 'Assessment is in progress. Still not compliant: work in progress is not an outcome.' },
  compliant: { compliant: true, terminal: false, description: 'Assessed as met, on our own evidence.' },
  'partially-compliant': { compliant: false, terminal: false, description: 'Some controls hold and others do not. Deliberately NOT compliant — partial compliance with a legal obligation is non-compliance with part of it.' },
  failing: { compliant: false, terminal: false, description: 'Controls exist and do not hold.' },
  'governance-gap': { compliant: false, terminal: false, description: 'No control exists at all. Distinct from failing, because the remedy is to build something rather than to fix something.' },
  remediating: { compliant: false, terminal: false, description: 'A named human is closing a known gap, under a recorded plan.' },
  verified: { compliant: true, terminal: false, description: 'Independently confirmed by somebody other than the party that assessed it.' },
};

// Which transitions are legal. Recorded as a machine, so a jump from `unknown` straight to
// `verified` — the transition a hurried audit most wants to make — is refused.
const COMPLIANCE_TRANSITIONS = {
  unknown: ['under-assessment'],
  'under-assessment': ['compliant', 'partially-compliant', 'failing', 'governance-gap', 'unknown'],
  compliant: ['verified', 'under-assessment', 'failing', 'partially-compliant'],
  'partially-compliant': ['remediating', 'under-assessment', 'failing'],
  failing: ['remediating', 'under-assessment'],
  'governance-gap': ['remediating', 'under-assessment'],
  remediating: ['under-assessment', 'compliant', 'partially-compliant', 'failing'],
  verified: ['under-assessment', 'failing', 'partially-compliant'],
};

// --- Transition governance (Phase 14, Part 4) -----------------------------------------------------
//
// Phase 13 gave the lifecycle a state machine and refused `unknown → verified`. Part 4 asks the
// harder question: what happens when somebody genuinely needs that jump? A machine with no escape
// hatch does not stop the jump — it moves it outside the system, where somebody edits a state by hand
// and no audit trail records that anything unusual happened.
//
// So exceptions exist, and everything about them is designed to make using one expensive:
//
//   AN EXCEPTION IS A DECISION, NOT A BYPASS. It names a board, states a rationale, expires, and
//   applies to ONE obligation and ONE transition. It never widens the machine for everybody.
//
//   AN EXCEPTION IS PERMANENT IN THE AUDIT TRAIL. The state it produced can be moved on from, and the
//   record that it was reached by exception never goes away. That is the deterrent.
//
//   ONE RULE NO EXCEPTION CAN LIFT: independent verification. `verified` means somebody other than
//   the assessor confirmed it. An exception that could waive that would make `verified` mean
//   `compliant` with extra steps, and the distinction is the entire point of having both.
const TRANSITION_LEGALITY = {
  'by-default': { description: 'The state machine permits this move.', governed: false },
  'by-exception': { description: 'The machine refuses it and a named board granted a time-bound, single-obligation exception.', governed: true },
  refused: { description: 'The machine refuses it and no exception covers it. Recorded so the attempt is visible.', governed: true },
};

// Boards that may grant a transition exception. Read from the governance model rather than listed
// here, so a board that is dissolved cannot keep granting exceptions.
function exceptionAuthorities() {
  return new Set(ownership.boards().flatMap((b) => [b.id, b.name]));
}

class TransitionExceptions {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = []; }

  grant({ obligation, from, to, by, rationale, expiresAt, at = null } = {}) {
    if (!obligation) throw new Error('an exception must name the obligation it applies to — a blanket exception is a change to the state machine, and that is an ADR');
    if (!COMPLIANCE_STATES[from] || !COMPLIANCE_STATES[to]) throw new Error(`an exception must name two known compliance states, not '${from}' → '${to}'`);
    if (!by || !rationale) { const e = new Error('granting a transition exception requires a named authority and a rationale'); e.failClosed = true; throw e; }
    if (!exceptionAuthorities().has(by)) {
      const e = new Error(`'${by}' is not a recognised governance board — only a board may grant a compliance transition exception`);
      e.failClosed = true; throw e;
    }
    if (!Number.isFinite(expiresAt)) { const e = new Error('a transition exception must expire — a permanent exception is a state machine nobody amended'); e.failClosed = true; throw e; }
    // The rule no exception lifts. Written as a refusal rather than as a check inside `transition`,
    // so it cannot be reached at all.
    if (to === 'verified') {
      const e = new Error('`verified` may never be reached by exception — it means somebody independent confirmed it, and an exception that waived that would make `verified` mean `compliant` with extra steps');
      e.failClosed = true; throw e;
    }
    const rec = { obligation, from, to, by, rationale, expiresAt, at: at ?? this._clock() };
    this._items.push(rec);
    return { ...rec };
  }

  covering(obligation, from, to, { now = null } = {}) {
    const t = now ?? this._clock();
    return this._items.find((e) => e.obligation === obligation && e.from === from && e.to === to && t < e.expiresAt) || null;
  }
  active({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((e) => t < e.expiresAt).map((e) => ({ ...e })); }
  expired({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((e) => t >= e.expiresAt).map((e) => ({ ...e })); }
  all() { return this._items.map((e) => ({ ...e })); }
}

class ComplianceIntelligence {
  constructor({ registry = null, clock = () => 0, exceptions = null } = {}) {
    this._registry = registry;
    this._clock = clock;
    this._changes = new Map();
    this._seq = 0;
    this._exceptions = exceptions;
    // Refused transitions are RECORDED. An attempt somebody made and the machine turned down is
    // exactly the signal an auditor wants, and throwing it away leaves only the successes.
    this._refusals = [];
  }

  exceptions() { return this._exceptions; }
  useExceptions(register) { this._exceptions = register; return this; }
  refusals() { return this._refusals.map((r) => ({ ...r })); }

  changeKinds() { return Object.entries(CHANGE_KINDS).map(([id, k]) => ({ kind: id, ...k })); }
  mappingDimensions() { return Object.entries(MAPPING_DIMENSIONS).map(([id, d]) => ({ dimension: id, ...d })); }

  // Record a change. Attributed and timestamped, like every other governance record here: a change
  // nobody is recorded as having observed cannot be chased up with anybody.
  observe({ kind, summary, instrument = null, severity = 'major', observedBy, at = null, affects = {} } = {}) {
    if (!CHANGE_KINDS[kind]) throw new Error(`unknown change kind '${kind}' — one of ${Object.keys(CHANGE_KINDS).join(', ')}`);
    if (!summary) throw new Error('a change must be summarised');
    if (!observedBy) { const e = new Error('a compliance change must name the human or system that observed it'); e.failClosed = true; throw e; }
    if (!CHANGE_SEVERITY.includes(severity)) throw new Error(`unknown severity '${severity}'`);
    if (instrument && this._registry && !this._registry.registryList().some((i) => i.id === instrument)) {
      throw new Error(`unknown legal instrument '${instrument}' — a change cannot cite an instrument the registry does not hold`);
    }
    const id = `CHG-${String(++this._seq).padStart(4, '0')}`;
    const rec = {
      id, kind, summary, instrument, severity, observedBy,
      at: at ?? this._clock(),
      affects: { contexts: [...(affects.contexts || [])], controls: [...(affects.controls || [])], datasets: [...(affects.datasets || [])] },
      assessed: false, assessedBy: null, assessedAt: null,
    };
    this._changes.set(id, rec);
    return { ...rec };
  }

  // Assessment is a recorded human act, separate from observation. An observed change that nobody
  // has assessed is exactly the state this module exists to make visible.
  assess(id, { by, conclusion } = {}) {
    const c = this._changes.get(id);
    if (!c) throw new Error('unknown change: ' + id);
    if (!by || !conclusion) { const e = new Error('assessing a compliance change requires a named human and a stated conclusion'); e.failClosed = true; throw e; }
    c.assessed = true; c.assessedBy = by; c.assessedAt = this._clock(); c.conclusion = conclusion;
    return { ...c };
  }

  changes({ kind = null, assessed = null } = {}) {
    return [...this._changes.values()]
      .filter((c) => (!kind || c.kind === kind) && (assessed === null || c.assessed === assessed))
      .map((c) => ({ ...c }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // Map one change onto every dimension it touches. Everything is RESOLVED against a registry —
  // a context named in `affects` that the architecture does not contain is reported as unresolved
  // rather than quietly carried through, because that is how a typo becomes a compliance record.
  mapChange(id, { controls = [], datasets = [] } = {}) {
    const c = this._changes.get(id);
    if (!c) throw new Error('unknown change: ' + id);

    const knownContexts = new Set(contextMap.ids());
    const contexts = c.affects.contexts.filter((x) => knownContexts.has(x));
    const unresolvedContexts = c.affects.contexts.filter((x) => !knownContexts.has(x));

    // Workflows and data flows crossing any affected context — read from the architecture, not
    // listed by the person filing the change.
    const workflows = [];
    for (const ctx of contexts) {
      for (const dep of contextMap.describe(ctx).dependsOn || []) workflows.push(`${ctx} → ${dep.context}`);
      for (const other of contextMap.ids()) {
        if ((contextMap.describe(other).dependsOn || []).some((d) => d.context === ctx)) workflows.push(`${other} → ${ctx}`);
      }
    }

    // Policies: any consistency stance governing an affected context.
    const policies = multiRegion.contextConsistency().filter((p) => contexts.includes(p.context))
      .map((p) => ({ policy: `consistency:${p.context}`, model: p.model, adr: p.adr || null }));

    // ADRs: those citing an affected context, plus every ADR named by an affected policy. An ADR is
    // matched on its text rather than on a curated index — a curated index is another thing to keep
    // in step, and the ADR text is the record of what was actually decided.
    const adrs = [];
    for (const file of adrGovernance.adrFiles()) {
      const parsed = adrGovernance.parse(file);
      const citedByPolicy = policies.some((p) => p.adr && parsed.raw.includes(p.adr.replace('ADR-', 'ADR-')) && `ADR-${String(parsed.number).padStart(4, '0')}` === p.adr);
      const mentionsContext = contexts.some((ctx) => new RegExp(`\\b${ctx.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(parsed.raw));
      if (citedByPolicy || mentionsContext) adrs.push({ adr: `ADR-${String(parsed.number).padStart(4, '0')}`, title: parsed.title, status: parsed.status, via: citedByPolicy ? 'cited by an affected policy' : 'names an affected bounded context' });
    }

    // Controls: the change's own declared controls, resolved against the checks that actually ran.
    const declaredControls = [...new Set([...c.affects.controls, ...(this._registry && c.instrument ? this._registry.describe(c.instrument).mapsToControls : [])])].sort();
    const known = new Set(controls.map((x) => (typeof x === 'string' ? x : x.id)));
    const holding = new Map(controls.filter((x) => typeof x === 'object').map((x) => [x.id, x.pass]));
    const controlRows = declaredControls.map((ctl) => ({
      control: ctl,
      exists: known.has(ctl),
      holds: known.has(ctl) ? (holding.has(ctl) ? holding.get(ctl) : null) : false,
      state: !known.has(ctl) ? 'missing' : holding.get(ctl) === false ? 'failing' : holding.get(ctl) === true ? 'holding' : 'unverified',
    }));

    const knownDatasets = new Set(datasets);
    const datasetRows = c.affects.datasets.map((d) => ({ dataset: d, governed: knownDatasets.has(d) }));

    // Readiness dimensions the change bears on, from the declared map plus anything an affected
    // dataset implies.
    const dims = new Set(KIND_READINESS[c.kind] || []);
    if (datasetRows.length) dims.add('data');
    const readinessDimensions = [...dims].filter((d) => evidenceConfidence.READINESS_DIMENSIONS[d]).sort();

    // Ownership: who has to do something about this. Derived from the readiness dimensions' owners
    // rather than asked for on the form.
    const owners = [...new Set(readinessDimensions.map((d) => evidenceConfidence.READINESS_DIMENSIONS[d].owner))].sort()
      .map((subsystem) => {
        try { const o = ownership.describe(subsystem); return { subsystem, responsibleAuthority: o.responsibleAuthority, board: o.board ? o.board.name : null }; }
        catch (_) { return { subsystem, responsibleAuthority: null, board: null, note: 'no ownership record for this subsystem' }; }
      });

    return {
      change: { ...c },
      boundedContexts: contexts.sort(), unresolvedContexts,
      workflows: [...new Set(workflows)].sort(),
      policies, adrs,
      controls: controlRows,
      datasets: datasetRows,
      readinessDimensions, owners,
      mappedFrom: Object.fromEntries(Object.entries(MAPPING_DIMENSIONS).map(([k, d]) => [k, d.source])),
      // Nothing here decides anything; it says where the change lands.
      informationalOnly: true, authorizes: false,
    };
  }

  // Gap analysis across every recorded change. This is the report a compliance officer reads.
  gapAnalysis({ controls = [], datasets = [], now = null } = {}) {
    const rows = this.changes().map((c) => {
      const m = this.mapChange(c.id, { controls, datasets });
      const gaps = [];
      // An unassessed change is not a compliant one.
      if (!c.assessed) gaps.push({ gap: 'unassessed', detail: `${c.id} has been observed but not assessed by a named human`, severity: c.severity });
      for (const ctl of m.controls) {
        if (ctl.state === 'missing') gaps.push({ gap: 'no-control', detail: `'${ctl.control}' is mapped to this change but no executable check of that name ran`, severity: 'critical' });
        else if (ctl.state === 'failing') gaps.push({ gap: 'control-failing', detail: `'${ctl.control}' ran and did not hold — a control that exists but does not hold is not a control`, severity: 'critical' });
        else if (ctl.state === 'unverified') gaps.push({ gap: 'control-unverified', detail: `'${ctl.control}' exists but its result was not supplied — unverified is not holding`, severity: 'major' });
      }
      if (!m.controls.length) gaps.push({ gap: 'no-mapped-control', detail: `${c.id} maps to no control at all — nothing in the platform demonstrably responds to it`, severity: 'critical' });
      for (const ctx of m.unresolvedContexts) gaps.push({ gap: 'unresolved-context', detail: `'${ctx}' is named by ${c.id} but is not in the architecture-of-record`, severity: 'major' });
      for (const d of m.datasets.filter((x) => !x.governed)) gaps.push({ gap: 'ungoverned-dataset', detail: `'${d.dataset}' is affected by ${c.id} but is not in the governed estate`, severity: 'major' });
      if (!m.adrs.length && c.severity === 'critical') gaps.push({ gap: 'no-adr', detail: `${c.id} is critical and no ADR records a decision touching what it affects`, severity: 'major' });
      return { change: c.id, kind: c.kind, severity: c.severity, summary: c.summary, mapping: m, gaps };
    });
    const all = rows.flatMap((r) => r.gaps.map((g) => ({ ...g, change: r.change })));
    return {
      changes: rows, totalChanges: rows.length,
      gaps: all, gapCount: all.length,
      byGap: all.reduce((acc, g) => ((acc[g.gap] = (acc[g.gap] || 0) + 1), acc), {}),
      critical: all.filter((g) => g.severity === 'critical'),
      unassessed: this.changes({ assessed: false }).map((c) => c.id),
      clear: all.length === 0,
      // Said explicitly, because a clean report is the one most likely to be over-read.
      coverageCaveat: 'This is an analysis of the changes that have been RECORDED. A clear result means no recorded change has an open gap; it is not evidence that no unrecorded change exists.',
      now, failClosed: true, authorizes: false,
    };
  }

  // Remediation recommendations. RECOMMENDATIONS: each names what to do, who owns it and what it was
  // derived from. Nothing here is applied — the module has no path that changes a control.
  remediation({ controls = [], datasets = [], now = null } = {}) {
    const analysis = this.gapAnalysis({ controls, datasets, now });
    const items = [];
    for (const row of analysis.changes) {
      const owners = row.mapping.owners.map((o) => o.responsibleAuthority).filter(Boolean);
      for (const g of row.gaps) {
        const action = {
          'unassessed': 'Assign a named human to assess this change and record a conclusion.',
          'no-control': 'Implement an executable check for this control, or remove the mapping if the obligation no longer applies.',
          'control-failing': 'Fix the failing control, or record a time-bound, attributed acceptance of the residual risk.',
          'control-unverified': 'Run the control in the assurance suite so its result is supplied rather than assumed.',
          'no-mapped-control': 'Map this change to at least one executable control, or record why nothing in the platform needs to respond to it.',
          'unresolved-context': 'Correct the context name, or add the context to the architecture-of-record if it is real.',
          'ungoverned-dataset': 'Register the dataset in the governed estate so its retention and quality can be reasoned about.',
          'no-adr': 'Record an ADR for the architectural response to this change, or state why none is needed.',
        }[g.gap] || 'Review this gap.';
        items.push({
          change: row.change, gap: g.gap, severity: g.severity, detail: g.detail,
          recommendedAction: action,
          owners: owners.length ? owners : ['UNASSIGNED — no readiness dimension owner resolved for this change'],
          derivedFrom: row.mapping.mappedFrom,
        });
      }
    }
    const order = { critical: 0, major: 1, minor: 2 };
    return {
      recommendations: items.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || a.change.localeCompare(b.change) || a.gap.localeCompare(b.gap)),
      count: items.length,
      unassigned: items.filter((i) => i.owners[0].startsWith('UNASSIGNED')).length,
      recommendationsOnly: true, authorizes: false,
      note: 'Recommendations, ranked by severity. Nothing here is applied: there is no code path in this module that changes a control, a policy or an ADR. Each recommendation is carried out by the named owner and recorded as their decision.',
    };
  }

  // --- Compliance state lifecycle (Phase 13, Part 4) ---------------------------------------------

  complianceStates() { return Object.entries(COMPLIANCE_STATES).map(([id, s]) => ({ state: id, ...s, transitionsTo: [...(COMPLIANCE_TRANSITIONS[id] || [])] })); }
  state(obligation) { return (this._states && this._states.get(obligation)) || { obligation, state: 'unknown', since: null, by: null, rationale: null, history: [] }; }

  // Move an obligation to a new state. Attributed, transition-checked and appended to a timeline;
  // there is no path that sets a state without recording who said so and why.
  transition(obligation, { to, by, rationale, at = null, independent = false } = {}) {
    if (!COMPLIANCE_STATES[to]) throw new Error(`unknown compliance state '${to}' — one of ${Object.keys(COMPLIANCE_STATES).join(', ')}`);
    if (!by || !rationale) { const e = new Error('a compliance state change requires a named human and a rationale'); e.failClosed = true; throw e; }
    if (!this._states) this._states = new Map();
    const current = this.state(obligation);
    const legal = COMPLIANCE_TRANSITIONS[current.state] || [];
    const t0 = at ?? this._clock();
    // Phase 14, Part 4: illegal by default, unless a board granted a time-bound exception for this
    // obligation and this exact move. Either way the audit trail records which it was.
    let exception = null;
    if (!legal.includes(to)) {
      exception = this._exceptions ? this._exceptions.covering(obligation, current.state, to, { now: t0 }) : null;
      if (!exception) {
        this._refusals.push({ obligation, from: current.state, to, by, at: t0, rationale, legality: 'refused', legalMoves: [...legal] });
        const e = new Error(`'${current.state}' → '${to}' is not a legal transition (from '${current.state}' the legal moves are: ${legal.join(', ')})`);
        e.failClosed = true; throw e;
      }
    }
    // The one state that cannot be self-declared. Verified means somebody OTHER than the assessor
    // confirmed it; without that, `verified` and `compliant` would mean the same thing.
    if (to === 'verified') {
      if (!independent) { const e = new Error('`verified` requires independent confirmation — mark it on the verifier\'s authority, not the assessor\'s'); e.failClosed = true; throw e; }
      if (by === current.by) { const e = new Error(`'${by}' assessed this obligation and cannot also be its independent verifier`); e.failClosed = true; throw e; }
    }
    const t = t0;
    const entry = {
      obligation, from: current.state, to, by, rationale, at: t, independent,
      legality: exception ? 'by-exception' : 'by-default',
      // Carried forever. An exception that vanishes from the record once it expires is an exception
      // nobody is deterred by.
      exception: exception ? { by: exception.by, rationale: exception.rationale, grantedAt: exception.at, expiresAt: exception.expiresAt } : null,
    };
    const history = [...(current.history || []), entry];
    this._states.set(obligation, { obligation, state: to, since: t, by, rationale, independent, history });
    return { ...this._states.get(obligation) };
  }

  // The Part 4 audit trail: every transition that happened, every one that was refused, and every
  // exception that made one possible — across the whole estate.
  transitionAudit({ now = null } = {}) {
    const t = now ?? this._clock();
    const obligations = this._registry ? this._registry.registryList().map((i) => i.id) : [...(this._states || new Map()).keys()];
    const entries = obligations.flatMap((id) => (this.state(id).history || []).map((h) => ({ ...h, legality: h.legality || 'by-default' })))
      .sort((a, b) => a.at - b.at || a.obligation.localeCompare(b.obligation));
    const byException = entries.filter((e) => e.legality === 'by-exception');
    const active = this._exceptions ? this._exceptions.active({ now: t }) : [];
    const expired = this._exceptions ? this._exceptions.expired({ now: t }) : [];
    return {
      now: t, entries, transitions: entries.length,
      refusals: this.refusals(), refusalCount: this._refusals.length,
      byExceptionCount: byException.length,
      byException: byException.map((e) => ({ obligation: e.obligation, from: e.from, to: e.to, movedBy: e.by, exceptionBy: e.exception.by, rationale: e.exception.rationale, at: e.at })),
      exceptions: { active, expired, granted: this._exceptions ? this._exceptions.all().length : 0 },
      legality: Object.entries(TRANSITION_LEGALITY).map(([id, s]) => ({ legality: id, ...s })),
      // Every state reached by exception is still reachable by exception only. An estate where a
      // growing share of moves are exceptional has a state machine that no longer describes practice,
      // and the remedy is an ADR amending it — not more exceptions.
      exceptionRate: entries.length ? +(byException.length / entries.length).toFixed(4) : null,
      machineDescribesPractice: entries.length === 0 || byException.length / entries.length < 0.1,
      governedStates: Object.keys(COMPLIANCE_STATES),
      informationalOnly: true, authorizes: false,
      note: 'An exception is a decision, not a bypass: one board, one obligation, one transition, with an expiry. The record that a state was reached by exception is permanent, which is what makes using one expensive.',
    };
  }

  // What the evidence says the state should be, independent of what anyone declared. Derived, so it
  // cannot be talked up; the caller compares it against the declared state and acts on the gap.
  deriveState(obligation, { controls = [] } = {}) {
    const declared = this._registry && this._registry.registryList().find((i) => i.id === obligation);
    const mapped = declared ? declared.mapsToControls : [];
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
    if (!mapped.length) return { obligation, derived: 'governance-gap', reason: 'no control is mapped to this obligation — nothing in the platform demonstrably responds to it' };
    const missing = mapped.filter((c) => !known.has(c));
    const failing = mapped.filter((c) => holding.get(c) === false);
    const unverified = mapped.filter((c) => known.has(c) && !holding.has(c));
    if (missing.length === mapped.length) return { obligation, derived: 'governance-gap', reason: `no mapped control ran: ${missing.join(', ')}` };
    if (failing.length && failing.length === mapped.length) return { obligation, derived: 'failing', reason: `every mapped control ran and failed: ${failing.join(', ')}` };
    if (failing.length || missing.length) return { obligation, derived: 'partially-compliant', reason: `some controls hold and others do not (failing: ${failing.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})` };
    if (unverified.length) return { obligation, derived: 'under-assessment', reason: `results were not supplied for: ${unverified.join(', ')} — unverified is not compliant` };
    return { obligation, derived: 'compliant', reason: 'every mapped control ran and held' };
  }

  // Declared state against derived state. An obligation declared compliant whose evidence says
  // otherwise is the finding this whole lifecycle exists to surface.
  stateReconciliation({ controls = [] } = {}) {
    const obligations = this._registry ? this._registry.registryList().map((i) => i.id) : [...(this._states || new Map()).keys()];
    const rows = obligations.map((id) => {
      const declared = this.state(id);
      const derived = this.deriveState(id, { controls });
      const declaredCompliant = COMPLIANCE_STATES[declared.state].compliant;
      const derivedCompliant = COMPLIANCE_STATES[derived.derived].compliant;
      return {
        obligation: id, declared: declared.state, derived: derived.derived, reason: derived.reason,
        declaredBy: declared.by, since: declared.since,
        overstated: declaredCompliant && !derivedCompliant,
        understated: !declaredCompliant && derivedCompliant,
        agrees: declared.state === derived.derived,
      };
    });
    return {
      obligations: rows,
      overstated: rows.filter((r) => r.overstated).map((r) => r.obligation),
      understated: rows.filter((r) => r.understated).map((r) => r.obligation),
      // The invariant, checked rather than asserted.
      noUnknownReportedCompliant: rows.every((r) => !(r.declared === 'unknown' && COMPLIANCE_STATES[r.declared].compliant)),
      sound: rows.every((r) => !r.overstated),
      note: 'Declared state is what somebody recorded; derived state is what the controls demonstrate. An obligation declared compliant whose evidence disagrees is reported, not reconciled away.',
    };
  }

  // The timeline Part 4 asks for: every state this obligation has been in, who moved it and why.
  timeline(obligation) {
    const s = this.state(obligation);
    const entries = (s.history || []).map((h, i, all) => ({
      ...h,
      durationMs: i + 1 < all.length ? all[i + 1].at - h.at : null,
      compliantDuring: COMPLIANCE_STATES[h.to].compliant,
    }));
    return {
      obligation, current: s.state, since: s.since, entries, transitions: entries.length,
      // An obligation with an empty timeline has never been assessed, and that is not the same as
      // having been assessed and found compliant.
      neverAssessed: entries.length === 0,
      note: entries.length ? null : 'no state change has ever been recorded — this obligation is unknown, which is not a form of compliant',
    };
  }

  // Historical evolution across every obligation: how the estate's compliance has moved over time.
  evolution({ now = null, controls = [] } = {}) {
    const t = now ?? this._clock();
    const obligations = this._registry ? this._registry.registryList().map((i) => i.id) : [...(this._states || new Map()).keys()];
    const all = obligations.flatMap((id) => this.timeline(id).entries);
    const byState = {};
    for (const id of obligations) { const st = this.state(id).state; byState[st] = (byState[st] || 0) + 1; }
    const compliant = obligations.filter((id) => COMPLIANCE_STATES[this.state(id).state].compliant);
    const verified = obligations.filter((id) => this.state(id).state === 'verified');
    // Direction over the recorded transitions: did obligations move toward compliance or away?
    const ordered = all.slice().sort((a, b) => a.at - b.at);
    const scored = ordered.map((e) => (COMPLIANCE_STATES[e.to].compliant ? 1 : 0) - (COMPLIANCE_STATES[e.from].compliant ? 1 : 0));
    const net = scored.reduce((a, b) => a + b, 0);
    // Net movement and the LATEST movement are different facts and are reported separately. An
    // estate that went unknown → compliant → failing has a net of zero: it began non-compliant and
    // ended non-compliant, which is true and hides the thing a reader needs to see.
    const lastMove = scored.length ? scored[scored.length - 1] : 0;
    return {
      now: t, obligations: obligations.length, byState,
      compliant: compliant.length, verified: verified.length,
      complianceRate: obligations.length ? +(compliant.length / obligations.length).toFixed(3) : null,
      verificationRate: obligations.length ? +(verified.length / obligations.length).toFixed(3) : null,
      transitions: all.length,
      direction: all.length < 2 ? 'insufficient-data' : net > 0 ? 'improving' : net < 0 ? 'regressing' : 'flat',
      recentDirection: !ordered.length ? 'insufficient-data' : lastMove > 0 ? 'improving' : lastMove < 0 ? 'regressing' : 'flat',
      latestTransition: ordered.length ? { ...ordered[ordered.length - 1] } : null,
      neverAssessed: obligations.filter((id) => this.timeline(id).neverAssessed),
      reconciliation: this.stateReconciliation({ controls }),
      informationalOnly: true, authorizes: false,
      note: 'A rate computed over obligations that were never assessed would flatter the estate, so those are counted and named separately. `direction` is net movement across the window; `recentDirection` is the latest move, because an estate that rose and then fell has a net of zero and a problem.',
    };
  }

  validate() {
    const violations = [];
    for (const [state, spec] of Object.entries(COMPLIANCE_STATES)) {
      if (typeof spec.compliant !== 'boolean') violations.push(`compliance state '${state}' does not declare whether it counts as compliant`);
      if (!spec.description) violations.push(`compliance state '${state}' has no description`);
      if (!COMPLIANCE_TRANSITIONS[state]) violations.push(`compliance state '${state}' declares no legal transitions`);
      for (const to of COMPLIANCE_TRANSITIONS[state] || []) if (!COMPLIANCE_STATES[to]) violations.push(`'${state}' transitions to unknown state '${to}'`);
    }
    // THE PART 4 INVARIANT, checked structurally rather than promised.
    if (COMPLIANCE_STATES.unknown.compliant) violations.push('the unknown state is declared compliant — an obligation nobody has assessed may never read as met');
    if (COMPLIANCE_STATES['partially-compliant'].compliant) violations.push('partial compliance is declared compliant — partial compliance with a legal obligation is non-compliance with part of it');
    for (const [kind, spec] of Object.entries(CHANGE_KINDS)) {
      if (!spec.originator || !spec.missedMeans) violations.push(`change kind '${kind}' does not say who originates it or what a missed one costs`);
      if (!KIND_READINESS[kind] || !KIND_READINESS[kind].length) violations.push(`change kind '${kind}' bears on no readiness dimension — then why is it watched?`);
      for (const d of KIND_READINESS[kind] || []) if (!evidenceConfidence.READINESS_DIMENSIONS[d]) violations.push(`change kind '${kind}' maps to unknown readiness dimension '${d}'`);
    }
    for (const [dim, spec] of Object.entries(MAPPING_DIMENSIONS)) if (!spec.source) violations.push(`mapping dimension '${dim}' names no source registry`);
    return { valid: violations.length === 0, violations };
  }

  report({ controls = [], datasets = [], now = null } = {}) {
    return {
      changeKinds: this.changeKinds(), mappingDimensions: this.mappingDimensions(),
      changes: this.changes(),
      complianceStates: this.complianceStates(),
      transitionAudit: this.transitionAudit({ now }),
      evolution: this.evolution({ now, controls }),
      gapAnalysis: this.gapAnalysis({ controls, datasets, now }),
      remediation: this.remediation({ controls, datasets, now }),
      validation: this.validate(),
      failClosed: true, authorizes: false,
      note: 'A change nobody has mapped produces a gap, not silence. A control that exists but does not hold is not a control. Both are reported separately because they need different work from different people.',
    };
  }
}

module.exports = {
  ComplianceIntelligence, CHANGE_KINDS, CHANGE_SEVERITY, MAPPING_DIMENSIONS, KIND_READINESS,
  COMPLIANCE_STATES, COMPLIANCE_TRANSITIONS,
  TRANSITION_LEGALITY, TransitionExceptions, exceptionAuthorities,
};
