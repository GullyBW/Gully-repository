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

class ComplianceIntelligence {
  constructor({ registry = null, clock = () => 0 } = {}) {
    this._registry = registry;
    this._clock = clock;
    this._changes = new Map();
    this._seq = 0;
  }

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

  validate() {
    const violations = [];
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
      gapAnalysis: this.gapAnalysis({ controls, datasets, now }),
      remediation: this.remediation({ controls, datasets, now }),
      validation: this.validate(),
      failClosed: true, authorizes: false,
      note: 'A change nobody has mapped produces a gap, not silence. A control that exists but does not hold is not a control. Both are reported separately because they need different work from different people.',
    };
  }
}

module.exports = { ComplianceIntelligence, CHANGE_KINDS, CHANGE_SEVERITY, MAPPING_DIMENSIONS, KIND_READINESS };
