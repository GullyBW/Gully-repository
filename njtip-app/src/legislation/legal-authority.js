'use strict';
// Legal Authority Registry (Phase 15, Part 5). Extends the legislation & regulatory governance
// bounded context; `src/legislation/` is claimed by prefix, so this module is owned the moment it
// exists.
//
// ADR-0009 recorded a debt found by the Phase 14 dependency taxonomy: **nothing in this platform
// records what legally authorises case investigation or service recovery.** The legislative registry
// held one instrument and it mapped to neither. Both reported UNKNOWN on the legal-authority
// dimension and sat in the resilience ratchet.
//
// This is the register that can close it. What it deliberately does NOT do is close it by itself.
//
//   THIS MODULE SHIPS EMPTY OF STATUTORY CLAIMS.
//
// Declaring that a particular Act authorises a particular capability is a legal assertion about the
// Republic of Botswana. It is not a fact this repository can derive, and a plausible-looking statute
// name in a governed register is worse than an empty one: an auditor would read it, an engineer would
// cite it, and nobody would discover it was invented until it mattered. So the framework is
// executable and the instruments are the institution's to record.
//
// What IS declared is the authority that is structural to the platform's own design: which
// capabilities rest on a constitutional mandate rather than an ordinary instrument. That is a
// property of the architecture — it is why anonymous reporting sits in the independent zone — and it
// is recorded here rather than inferred.
const contextMap = require('../architecture/context-map');
const ownership = require('../governance/ownership');

const DAY = 24 * 3600_000;

// The kinds of authority a capability can rest on, weakest last. Each says how it can be withdrawn,
// because that is what actually distinguishes them: a constitutional mandate and a departmental
// policy are both "authority" until somebody wants to remove one.
const AUTHORITY_KINDS = {
  constitutional: {
    rank: 0, withdrawnBy: 'A constitutional amendment.',
    means: 'The mandate is entrenched. It cannot be removed by an ordinary instrument or a change of administration.',
  },
  legislation: {
    rank: 1, withdrawnBy: 'An Act of Parliament.',
    means: 'A statute authorises it. Amendable, on a legislative timescale, in public.',
  },
  'delegated-authority': {
    rank: 2, withdrawnBy: 'The delegating authority, at will.',
    means: 'A power exercised on somebody else\'s behalf. It lasts exactly as long as the delegation does.',
  },
  regulation: {
    rank: 3, withdrawnBy: 'The regulator, by instrument.',
    means: 'A subsidiary instrument. Faster to change than a statute and easier to lose track of.',
  },
  policy: {
    rank: 4, withdrawnBy: 'The issuing body, by decision.',
    means: 'An internal decision. The weakest form of authority, and the one most often mistaken for a legal basis.',
  },
};
const AUTHORITY_ORDER = ['constitutional', 'legislation', 'delegated-authority', 'regulation', 'policy'];

// What a complete declaration must carry. Each field says what its absence means, because "incomplete"
// is not a useful finding on its own.
const AUTHORITY_FIELDS = {
  kind: { required: true, absentMeans: 'Nothing says what KIND of authority this is, so nothing says how it could be withdrawn.' },
  instrument: { required: true, absentMeans: 'No instrument is named, so nobody can go and read what was actually authorised.' },
  approvingOrganization: { required: true, absentMeans: 'No institution stands behind it, so there is nobody to ask when it is questioned.' },
  reviewEveryDays: { required: true, absentMeans: 'Nothing schedules a re-reading, and legal authority decays silently.' },
  expiresAt: { required: true, absentMeans: 'The declaration is permanent by accident, which is how a repealed instrument stays cited for a decade.' },
  evidence: { required: true, absentMeans: 'Nothing links the claim to anything checkable.' },
  scope: { required: true, absentMeans: 'Nothing says what the authority permits, so it will be read as permitting everything.' },
};

// The states a capability's legal authority can be in. `unknown` is not `absent`: one means nobody
// has looked, the other means somebody looked and found nothing, and they need different work.
const AUTHORITY_STATES = {
  unknown: { authorized: false, blocksReadiness: true, means: 'No declaration exists. Nobody has recorded what authorises this capability.' },
  declared: { authorized: false, blocksReadiness: true, means: 'A declaration exists and has not been reviewed by the approving organization.' },
  reviewed: { authorized: true, blocksReadiness: false, means: 'Declared and reviewed within its schedule by the approving organization.' },
  expired: { authorized: false, blocksReadiness: true, means: 'The declaration passed its expiry. The authority may still exist; nothing here can say so.' },
  overdue: { authorized: false, blocksReadiness: true, means: 'The review schedule was missed. An unreviewed legal basis is one nobody has confirmed still stands.' },
  withdrawn: { authorized: false, blocksReadiness: true, means: 'The instrument was repealed, amended away, or the delegation ended.' },
};

class LegalAuthorityRegistry {
  constructor({ clock = () => 0 } = {}) {
    this._clock = clock;
    this._declarations = new Map();   // capability -> [declaration]
    this._reviews = new Map();        // capability -> [review]
    this._withdrawals = new Map();    // capability -> [withdrawal]
  }

  // Declare an authority for a capability. Every required field is checked, because a partial legal
  // declaration reads as a complete one to everybody downstream.
  declare(capability, spec = {}) {
    if (!capability) throw new Error('a legal authority declaration must name the capability it authorises');
    const { kind, instrument, approvingOrganization, reviewEveryDays, expiresAt, evidence = [], scope, delegatedFrom = null, policyReferences = [], declaredBy, at = null } = spec;
    if (!declaredBy) { const e = new Error('a legal authority declaration must name who recorded it'); e.failClosed = true; throw e; }
    if (!AUTHORITY_KINDS[kind]) throw new Error(`unknown authority kind '${kind}' — one of ${AUTHORITY_ORDER.join(', ')}`);
    for (const [field, meta] of Object.entries(AUTHORITY_FIELDS)) {
      if (!meta.required) continue;
      const value = { kind, instrument, approvingOrganization, reviewEveryDays, expiresAt, evidence, scope }[field];
      const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
      if (missing) { const e = new Error(`a legal authority declaration must state '${field}' — ${meta.absentMeans}`); e.failClosed = true; throw e; }
    }
    if (!Number.isFinite(reviewEveryDays) || reviewEveryDays <= 0) throw new Error('a review schedule must be a positive number of days');
    if (!Number.isFinite(expiresAt)) throw new Error('an expiry must be a timestamp');
    // Delegated authority that does not say who delegated it is not traceable to anything.
    if (kind === 'delegated-authority' && !delegatedFrom) {
      const e = new Error('delegated authority must name what it was delegated FROM — a delegation with no source cannot be traced to a legal basis');
      e.failClosed = true; throw e;
    }
    const rec = {
      capability, kind, instrument, approvingOrganization, reviewEveryDays, expiresAt,
      evidence: [...evidence], scope, delegatedFrom, policyReferences: [...policyReferences],
      declaredBy, at: at ?? this._clock(),
    };
    if (!this._declarations.has(capability)) this._declarations.set(capability, []);
    this._declarations.get(capability).push(rec);
    return { ...rec };
  }

  // Review is a separate, attributed act — and it must be performed BY the approving organization.
  // A review by anybody else is somebody reading a document.
  review(capability, { by, at = null, stillStands = true, note = null } = {}) {
    const declarations = this._declarations.get(capability);
    if (!declarations || !declarations.length) throw new Error(`no legal authority is declared for '${capability}'`);
    if (!by) { const e = new Error('a legal authority review must name who performed it'); e.failClosed = true; throw e; }
    const latest = declarations[declarations.length - 1];
    if (by !== latest.approvingOrganization) {
      const e = new Error(`'${by}' is not the approving organization for this authority ('${latest.approvingOrganization}') — a review by anybody else is somebody reading a document`);
      e.failClosed = true; throw e;
    }
    const rec = { capability, by, at: at ?? this._clock(), stillStands, note };
    if (!this._reviews.has(capability)) this._reviews.set(capability, []);
    this._reviews.get(capability).push(rec);
    return { ...rec };
  }

  // Withdrawal: the instrument was repealed, or the delegation ended. Recorded rather than deleted,
  // because a capability that was authorised and no longer is has a history worth keeping.
  withdraw(capability, { by, reason, at = null } = {}) {
    if (!this._declarations.has(capability)) throw new Error(`no legal authority is declared for '${capability}'`);
    if (!by || !reason) { const e = new Error('withdrawing a legal authority requires a named authority and a reason'); e.failClosed = true; throw e; }
    const rec = { capability, by, reason, at: at ?? this._clock() };
    if (!this._withdrawals.has(capability)) this._withdrawals.set(capability, []);
    this._withdrawals.get(capability).push(rec);
    return { ...rec };
  }

  declarations(capability = null) {
    if (capability) return (this._declarations.get(capability) || []).map((d) => ({ ...d }));
    return [...this._declarations.keys()].sort().flatMap((c) => this.declarations(c));
  }
  reviews(capability) { return (this._reviews.get(capability) || []).map((r) => ({ ...r })); }

  // The state of one capability's legal authority. Derived, never declared.
  state(capability, { now = null, controls = [] } = {}) {
    const t = now ?? this._clock();
    const declarations = this._declarations.get(capability) || [];
    if (!declarations.length) {
      return {
        capability, state: 'unknown', ...AUTHORITY_STATES.unknown,
        declaration: null, reason: `no legal authority is declared for '${capability}' — nothing records what permits this capability to exist`,
      };
    }
    const latest = declarations[declarations.length - 1];
    const withdrawals = this._withdrawals.get(capability) || [];
    if (withdrawals.length) {
      const w = withdrawals[withdrawals.length - 1];
      return { capability, state: 'withdrawn', ...AUTHORITY_STATES.withdrawn, declaration: { ...latest }, reason: `withdrawn by ${w.by}: ${w.reason}` };
    }
    if (t >= latest.expiresAt) {
      return { capability, state: 'expired', ...AUTHORITY_STATES.expired, declaration: { ...latest }, reason: `the declaration expired at ${latest.expiresAt}` };
    }
    const reviews = (this._reviews.get(capability) || []).filter((r) => r.at >= latest.at);
    if (!reviews.length) {
      return { capability, state: 'declared', ...AUTHORITY_STATES.declared, declaration: { ...latest }, reason: `declared by ${latest.declaredBy} and not yet reviewed by ${latest.approvingOrganization}` };
    }
    const lastReview = reviews[reviews.length - 1];
    if (!lastReview.stillStands) {
      return { capability, state: 'withdrawn', ...AUTHORITY_STATES.withdrawn, declaration: { ...latest }, reason: `${lastReview.by} reviewed this authority and found it no longer stands` };
    }
    const dueAt = lastReview.at + latest.reviewEveryDays * DAY;
    if (t > dueAt) {
      return { capability, state: 'overdue', ...AUTHORITY_STATES.overdue, declaration: { ...latest }, reason: `review overdue since ${dueAt}; an unreviewed legal basis is one nobody has confirmed still stands` };
    }
    // Evidence is resolved like everything else: a declaration citing a control that does not run
    // is a declaration citing nothing.
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const unresolved = latest.evidence.filter((e) => !known.has(e));
    return {
      capability, state: 'reviewed', ...AUTHORITY_STATES.reviewed,
      declaration: { ...latest }, lastReviewedAt: lastReview.at, lastReviewedBy: lastReview.by,
      unresolvedEvidence: unresolved,
      reason: unresolved.length
        ? `reviewed by ${lastReview.by}, though ${unresolved.length} cited evidence item(s) resolve to no control that ran: ${unresolved.join(', ')}`
        : `reviewed by ${lastReview.by} within schedule`,
    };
  }

  // Which capabilities require an authority declaration, and what they currently have. The set is
  // read from institutional resilience rather than listed here, so a new critical capability arrives
  // in this report automatically rather than being remembered.
  report({ now = null, controls = [], capabilities = null } = {}) {
    const t = now ?? this._clock();
    const ir = require('../governance/institutional-resilience');
    const required = capabilities || Object.keys(ir.CRITICAL_CAPABILITIES).sort();
    const rows = required.map((c) => {
      const spec = ir.CRITICAL_CAPABILITIES[c] || {};
      const s = this.state(c, { now: t, controls });
      return {
        ...s,
        constitutional: !!spec.constitutional,
        // A constitutional capability whose authority is unknown is the sharpest form of this
        // finding: the platform exists to deliver it and nothing records what permits it to.
        criticalGap: !!spec.constitutional && s.blocksReadiness,
        contexts: spec.contexts || [],
      };
    });
    const blocking = rows.filter((r) => r.blocksReadiness);
    return {
      capabilities: rows, count: rows.length,
      authorityKinds: AUTHORITY_ORDER.map((k) => ({ kind: k, ...AUTHORITY_KINDS[k] })),
      states: Object.entries(AUTHORITY_STATES).map(([state, s]) => ({ state, ...s })),
      fields: Object.entries(AUTHORITY_FIELDS).map(([field, f]) => ({ field, ...f })),
      declared: rows.filter((r) => r.state !== 'unknown').map((r) => r.capability),
      unknown: rows.filter((r) => r.state === 'unknown').map((r) => r.capability),
      authorized: rows.filter((r) => r.authorized).map((r) => r.capability),
      blocking: blocking.map((r) => ({ capability: r.capability, state: r.state, reason: r.reason, constitutional: r.constitutional })),
      criticalGaps: rows.filter((r) => r.criticalGap).map((r) => r.capability),
      // THE PART 5 RULE, checked rather than promised.
      blocksReadiness: blocking.length > 0,
      complete: blocking.length === 0,
      completenessBasis: rows.length
        ? `${rows.filter((r) => r.authorized).length} of ${rows.length} critical capabilities have a reviewed legal authority. Unknown is counted separately from expired and from withdrawn, because nobody having looked, an instrument having lapsed and an instrument having been repealed need three different people to act.`
        : 'no capability requires an authority declaration, which cannot be right',
      now: t, failClosed: true, informationalOnly: true, authorizes: false,
      note: 'This registry ships with no statutory claims. Declaring that a particular Act authorises a particular capability is a legal assertion about the Republic, not something this repository can derive — and a plausible-looking statute name in a governed register is worse than an empty one, because everybody downstream would believe it.',
    };
  }

  validate() {
    const violations = [];
    const ir = require('../governance/institutional-resilience');
    for (const [capability, list] of this._declarations) {
      if (!ir.CRITICAL_CAPABILITIES[capability]) violations.push(`legal authority is declared for '${capability}', which is not a critical capability`);
      for (const d of list) {
        if (!AUTHORITY_KINDS[d.kind]) violations.push(`${capability}: unknown authority kind '${d.kind}'`);
        if (d.expiresAt <= d.at) violations.push(`${capability}: the declaration expires before or when it was made`);
        for (const ctx of (ir.CRITICAL_CAPABILITIES[capability] || {}).contexts || []) {
          if (!contextMap.ids().includes(ctx)) violations.push(`${capability}: names a bounded context the architecture does not contain: ${ctx}`);
        }
        // The approving organization must be an institution the ownership record knows. An authority
        // approved by a body that does not exist is not approved.
        const institutions = new Set(ownership.subsystems().flatMap((s) => [ownership.OWNERSHIP[s].responsibleAuthority, ownership.OWNERSHIP[s].approvingAuthority]));
        if (!institutions.has(d.approvingOrganization)) {
          violations.push(`${capability}: '${d.approvingOrganization}' is not an institution in the accountability record`);
        }
      }
    }
    return { valid: violations.length === 0, violations, declarations: this.declarations().length };
  }
}

// --- Legal dependency intelligence (Phase 16, Part 9) ----------------------------------------------
//
// `state()` answers one capability's question. Part 9 asks the questions that only appear when you
// look at the register as a whole — and every one of them is a way a legal basis can be wrong while
// each individual declaration reads as fine.
//
// The five defects, and why each is its own finding rather than a variant of "not authorized":
const LEGAL_DEFECTS = {
  'missing-authority': {
    severity: 'critical',
    means: 'A capability requires a legal basis and nothing is recorded.',
    detectedBy: 'a critical capability with no declaration',
    ifIgnored: 'The capability operates and nobody can say what permits it to.',
  },
  'expired-authority': {
    severity: 'critical',
    means: 'The declaration passed its own expiry. The instrument may still stand; nothing here can say so.',
    detectedBy: 'the declared expiry against the current time',
    ifIgnored: 'A lapsed citation is quoted as a live one, and the lapse is invisible because nobody withdrew anything.',
  },
  'superseded-authority': {
    severity: 'important',
    means: 'An earlier declaration for the same capability was replaced by a later one and is still being cited elsewhere.',
    detectedBy: 'more than one declaration for a capability, where an earlier instrument differs from the current one',
    ifIgnored: 'Two answers to "what authorises this" exist, and which one somebody quotes depends on where they looked.',
  },
  'duplicated-authority': {
    severity: 'important',
    means: 'The same instrument was declared twice for the same capability. Reviewing one does not review the other.',
    detectedBy: 'repeated instrument names within one capability',
    ifIgnored: 'A review clears one copy, the register still shows an unreviewed declaration, and nobody can tell which is authoritative.',
  },
  'conflicting-authority': {
    severity: 'critical',
    means: 'The same instrument is declared as two different KINDS of authority, or a capability\'s basis was quietly downgraded to a weaker kind.',
    detectedBy: 'one instrument bearing two kinds across the register, or a later declaration weaker than the one it replaced',
    ifIgnored: 'An instrument that is constitutional in one place and a departmental policy in another can be withdrawn by whichever route is easiest.',
  },
};

// The Part 9 analysis. Derived entirely from the register; nothing here is declared.
function legalDependencyIntelligence(registry, { now = 0, controls = [], capabilities = null } = {}) {
  const ir = require('../governance/institutional-resilience');
  const required = capabilities || Object.keys(ir.CRITICAL_CAPABILITIES).sort();
  const findings = [];
  const add = (defect, capability, detail, extra = {}) => findings.push({
    defect, ...LEGAL_DEFECTS[defect], capability, detail, ...extra,
  });

  // Kinds an instrument has been declared as, across the whole register. An instrument cannot be
  // both a constitutional mandate and a departmental policy, and only a whole-register view sees it.
  const kindsByInstrument = new Map();
  for (const d of registry.declarations()) {
    if (!kindsByInstrument.has(d.instrument)) kindsByInstrument.set(d.instrument, new Set());
    kindsByInstrument.get(d.instrument).add(d.kind);
  }
  for (const [instrument, kinds] of [...kindsByInstrument.entries()].sort()) {
    if (kinds.size > 1) {
      add('conflicting-authority', null,
        `'${instrument}' is declared as ${[...kinds].sort().join(' and ')} — an instrument cannot be two kinds of authority, because each is withdrawn a different way`,
        { instrument, kinds: [...kinds].sort() });
    }
  }

  for (const capability of required) {
    const declarations = registry.declarations(capability);
    if (!declarations.length) {
      add('missing-authority', capability, `nothing records what permits '${capability}' to operate`);
      continue;
    }
    const current = declarations[declarations.length - 1];
    const earlier = declarations.slice(0, -1);
    const state = registry.state(capability, { now, controls });

    if (state.state === 'expired') {
      add('expired-authority', capability, `the declaration for '${capability}' expired at ${current.expiresAt}`, { instrument: current.instrument, expiresAt: current.expiresAt });
    }
    // Superseded: an earlier declaration citing a DIFFERENT instrument. A re-declaration of the same
    // instrument is a duplicate, not a supersession, and the two need different corrections.
    for (const d of earlier) {
      if (d.instrument !== current.instrument) {
        add('superseded-authority', capability,
          `'${d.instrument}' was replaced by '${current.instrument}' for '${capability}' and may still be cited elsewhere`,
          { instrument: d.instrument, replacedBy: current.instrument });
      }
    }
    // Duplicated: the same instrument recorded more than once for the same capability.
    const counts = new Map();
    for (const d of declarations) counts.set(d.instrument, (counts.get(d.instrument) || 0) + 1);
    for (const [instrument, count] of [...counts.entries()].sort()) {
      if (count > 1) add('duplicated-authority', capability, `'${instrument}' is declared ${count} times for '${capability}'; reviewing one does not review the other`, { instrument, count });
    }
    // Downgraded: the current basis is a WEAKER kind than one it replaced. Rank ascends as authority
    // weakens, so a higher rank now than before is a downgrade.
    const strongestEarlier = earlier.reduce((best, d) => (best === null || AUTHORITY_KINDS[d.kind].rank < AUTHORITY_KINDS[best].rank ? d.kind : best), null);
    if (strongestEarlier && AUTHORITY_KINDS[current.kind].rank > AUTHORITY_KINDS[strongestEarlier].rank) {
      add('conflicting-authority', capability,
        `'${capability}' rested on ${strongestEarlier} authority and now rests on ${current.kind}, which is weaker — ${AUTHORITY_KINDS[current.kind].withdrawnBy}`,
        { from: strongestEarlier, to: current.kind, downgrade: true });
    }
  }

  const bySeverity = (s) => findings.filter((f) => f.severity === s);
  return {
    findings: findings.sort((a, b) => a.defect.localeCompare(b.defect) || String(a.capability).localeCompare(String(b.capability))),
    count: findings.length,
    defects: Object.entries(LEGAL_DEFECTS).map(([defect, d]) => ({ defect, ...d, found: findings.filter((f) => f.defect === defect).length })),
    critical: bySeverity('critical').length, important: bySeverity('important').length,
    byDefect: Object.fromEntries(Object.keys(LEGAL_DEFECTS).map((d) => [d, findings.filter((f) => f.defect === d).map((f) => f.capability || f.instrument)])),
    // A clean register is a real state and is reported as such, rather than as an absence of output.
    clean: findings.length === 0,
    capabilitiesExamined: required.length,
    declarationsExamined: registry.declarations().length,
    basis: findings.length
      ? `${findings.length} legal defect(s) across ${required.length} critical capabilities: ${bySeverity('critical').length} critical, ${bySeverity('important').length} important.`
      : `No legal defect found across ${required.length} capabilities and ${registry.declarations().length} declaration(s). On an empty register that means only that there is nothing to be wrong — every capability is separately reported as missing an authority.`,
    now, failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Each defect is its own finding because each needs a different correction: a missing authority needs somebody to find one, an expired one needs a renewal, a superseded one needs citations updated, a duplicate needs a deletion, and a conflict needs a lawyer.',
  };
}

// What falls if a named instrument is withdrawn. The question a legal adviser actually asks, and
// which nothing could answer before: the register knew what authorised what, and never the reverse.
function legalImpact(registry, instrument, { now = 0, controls = [] } = {}) {
  if (!instrument) throw new Error('a legal impact analysis must name the instrument being withdrawn');
  const ir = require('../governance/institutional-resilience');
  const ownership = require('../governance/ownership');
  const rows = [];
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES).sort()) {
    const declarations = registry.declarations(capability);
    const current = declarations.length ? declarations[declarations.length - 1] : null;
    if (!current || current.instrument !== instrument) continue;
    const spec = ir.CRITICAL_CAPABILITIES[capability];
    const contexts = spec.contexts || [];
    // Alternatives are earlier declarations citing a different instrument. A capability whose only
    // recorded basis is the instrument being withdrawn has none.
    const alternatives = declarations.filter((d) => d.instrument !== instrument).map((d) => d.instrument);
    rows.push({
      capability, constitutional: !!spec.constitutional, contexts,
      institutions: [...new Set(contexts.map((c) => (ownership.OWNERSHIP[c] || {}).responsibleAuthority).filter(Boolean))].sort(),
      currentState: registry.state(capability, { now, controls }).state,
      alternatives: [...new Set(alternatives)],
      // The finding that matters: nothing else recorded would permit this capability to continue.
      strandedWithoutAlternative: alternatives.length === 0,
    });
  }
  const stranded = rows.filter((r) => r.strandedWithoutAlternative);
  const constitutional = rows.filter((r) => r.constitutional);
  return {
    instrument, capabilities: rows, count: rows.length,
    strandedCapabilities: stranded.map((r) => r.capability),
    constitutionalCapabilities: constitutional.map((r) => r.capability),
    affectedContexts: [...new Set(rows.flatMap((r) => r.contexts))].sort(),
    affectedInstitutions: [...new Set(rows.flatMap((r) => r.institutions))].sort(),
    // Withdrawal is a legal act by a legislature or a regulator. This is what it would cost, not a
    // recommendation about whether to do it.
    impact: rows.length
      ? `withdrawing '${instrument}' removes the recorded legal basis for ${rows.length} capability(ies), ${constitutional.length} of them constitutional, across ${[...new Set(rows.flatMap((r) => r.institutions))].length} institution(s). ${stranded.length} would be left with no recorded alternative.`
      : `no capability currently rests on '${instrument}', so withdrawing it removes no recorded legal basis. That is not the same as it having no effect — this register only knows what has been declared to it.`,
    now, informationalOnly: true, authorizes: false,
    note: 'This says what would fall, not whether the instrument should be withdrawn. Withdrawal is an act of a legislature or a regulator, and no analysis here is an argument for or against one.',
  };
}

module.exports = {
  LegalAuthorityRegistry, AUTHORITY_KINDS, AUTHORITY_ORDER, AUTHORITY_FIELDS, AUTHORITY_STATES,
  LEGAL_DEFECTS, legalDependencyIntelligence, legalImpact,
};
