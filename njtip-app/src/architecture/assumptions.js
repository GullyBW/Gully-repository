'use strict';
// Executable Assumption Registry (Phase 13, Part 2). Extends the architecture bounded context.
//
// Every phase of this platform has rested on assumptions that were written into a comment and then
// stopped being examined. "An investigator's session is pinned for the duration of a case edit."
// "The synthetic topology reflects the production one." "case-throughput is a usable proxy for
// whether people can report." Each is load-bearing, each was true when written, and none of them
// had an owner, an expiry, or anything that would tell you the day it stopped being true.
//
// That is what this registry is for. Three design decisions carry the weight:
//
//   1. DECLARED CONFIDENCE AND ASSESSED CONFIDENCE ARE SEPARATE FIELDS. The owner states what they
//      believe; the registry derives what the evidence supports. Where the first exceeds the second
//      the assumption is an OVERCLAIM and is named as one. A single hand-entered confidence would be
//      unfalsifiable, which is the opposite of the point.
//
//   2. CONTRADICTION IS DETECTED STRUCTURALLY, NOT READ. Each assumption carries a machine-readable
//      claim — subject, predicate, value — so two assumptions that cannot both be true are found by
//      comparison rather than by someone noticing. Prose alone would make this decorative.
//
//   3. AN ASSUMPTION WITH NO EXPIRY IS REFUSED. An assumption that never expires is a belief, and
//      the whole failure mode here is beliefs outliving the conditions that justified them.
const contextMap = require('./context-map');

const CONFIDENCE_LEVELS = ['high', 'moderate', 'low', 'unknown'];

// How an assumption can be checked, and what that method is worth. The ceiling is the highest
// ASSESSED confidence a method can support — an assumption nothing can check may be entirely
// correct, but the registry cannot say so on the platform's behalf.
const VERIFICATION_METHODS = {
  'executable-check': { ceiling: 'high', description: 'A fitness function or test re-runs on every build and would fail if the assumption stopped holding.' },
  'operational-observation': { ceiling: 'moderate', description: 'Something the platform measures would move if the assumption broke, though nothing fails automatically.' },
  'human-attestation': { ceiling: 'low', description: 'A named human periodically confirms it. Better than nothing, and it is not verification.' },
  unverifiable: { ceiling: 'unknown', description: 'Nothing available to this platform could tell us whether this still holds. Recorded so the gap is visible.' },
};

// Structured claims. Two assumptions about the same subject can be compared mechanically.
const PREDICATES = {
  holds: { description: 'The subject is true.', valueRequired: false },
  'does-not-hold': { description: 'The subject is false.', valueRequired: false },
  equals: { description: 'The subject has exactly this value.', valueRequired: true },
  'at-most': { description: 'The subject does not exceed this value.', valueRequired: true },
  'at-least': { description: 'The subject is not below this value.', valueRequired: true },
};

const DAY = 24 * 3600_000;

function confidenceRank(level) { return CONFIDENCE_LEVELS.indexOf(level); }
// Lower rank is stronger (high = 0). "Weaker of the two" therefore takes the higher rank.
function weaker(a, b) { return confidenceRank(a) >= confidenceRank(b) ? a : b; }

class AssumptionRegistry {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._verifications = new Map(); }

  register(id, {
    statement, rationale, evidence = [], contexts = [], owner,
    reviewCadenceDays, expiresAt, verificationMethod, confidence = 'unknown', claim = null, at = null,
  } = {}) {
    if (!id) throw new Error('an assumption needs an identifier');
    if (this._items.has(id)) throw new Error(`assumption '${id}' is already registered — amend it rather than re-registering`);
    if (!statement) throw new Error('an assumption must state what is being assumed');
    if (!rationale) throw new Error('an assumption must state why it was reasonable to make');
    if (!owner) { const e = new Error('an assumption must name an owner — an unowned assumption is one nobody will revisit'); e.failClosed = true; throw e; }
    if (!VERIFICATION_METHODS[verificationMethod]) throw new Error(`unknown verification method '${verificationMethod}' — one of ${Object.keys(VERIFICATION_METHODS).join(', ')}`);
    if (!CONFIDENCE_LEVELS.includes(confidence)) throw new Error(`unknown confidence level '${confidence}'`);
    if (!Number.isFinite(reviewCadenceDays) || reviewCadenceDays <= 0) throw new Error('an assumption needs a positive review cadence in days');
    // The rule that makes the registry a control rather than a list.
    if (!Number.isFinite(expiresAt)) { const e = new Error('an assumption must have an expiry — an assumption that never expires is a belief'); e.failClosed = true; throw e; }
    if (claim) {
      if (!claim.subject) throw new Error('a claim must name its subject');
      const p = PREDICATES[claim.predicate];
      if (!p) throw new Error(`unknown claim predicate '${claim.predicate}' — one of ${Object.keys(PREDICATES).join(', ')}`);
      if (p.valueRequired && claim.value === undefined) throw new Error(`predicate '${claim.predicate}' requires a value`);
    }
    const registeredAt = at ?? this._clock();
    this._items.set(id, {
      id, statement, rationale,
      evidence: [...evidence], contexts: [...contexts], owner,
      reviewCadenceDays, expiresAt, verificationMethod,
      declaredConfidence: confidence, claim: claim ? { ...claim } : null,
      registeredAt, lastReviewedAt: null, lastReviewedBy: null,
    });
    return this.describe(id);
  }

  describe(id) { const a = this._items.get(id); if (!a) throw new Error('unknown assumption: ' + id); return JSON.parse(JSON.stringify(a)); }
  ids() { return [...this._items.keys()].sort(); }
  all() { return this.ids().map((id) => this.describe(id)); }

  // Reviewing is an attributed act, and it resets the review clock — nothing else does.
  review(id, { by, at = null, stillHolds = true, note = null } = {}) {
    const a = this._items.get(id); if (!a) throw new Error('unknown assumption: ' + id);
    if (!by) { const e = new Error('reviewing an assumption requires a named human'); e.failClosed = true; throw e; }
    a.lastReviewedAt = at ?? this._clock();
    a.lastReviewedBy = by;
    a.lastReviewHolds = stillHolds;
    a.lastReviewNote = note;
    return this.describe(id);
  }

  // Record that the assumption was actually checked. Append-only and never seeded: the global
  // requirement is to not fabricate historical evidence, so an unverified assumption looks exactly
  // like what it is.
  recordVerification(id, { holds, by, at = null, method = null, detail = null } = {}) {
    if (!this._items.has(id)) throw new Error('unknown assumption: ' + id);
    if (typeof holds !== 'boolean') throw new Error('a verification must record whether the assumption held, as a boolean');
    if (!by) { const e = new Error('a verification must name what performed it'); e.failClosed = true; throw e; }
    if (!this._verifications.has(id)) this._verifications.set(id, []);
    const rec = { at: at ?? this._clock(), holds, by, method: method || this._items.get(id).verificationMethod, detail };
    this._verifications.get(id).push(rec);
    return { ...rec };
  }
  verifications(id) { return (this._verifications.get(id) || []).map((v) => ({ ...v })); }

  // What the evidence actually supports, independent of what the owner claimed.
  assessConfidence(id, { now = null, controls = [] } = {}) {
    const a = this.describe(id);
    const t = now ?? this._clock();
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
    const reasons = [];

    // Start from what the verification method can support at best.
    let level = VERIFICATION_METHODS[a.verificationMethod].ceiling;
    reasons.push(`verification method '${a.verificationMethod}' supports at best '${level}'`);

    // Evidence that does not resolve to a control that ran cannot raise anything.
    const resolved = a.evidence.filter((e) => known.has(e));
    const failing = resolved.filter((e) => holding.get(e) === false);
    if (!a.evidence.length) { level = weaker(level, 'unknown'); reasons.push('no supporting evidence is cited'); }
    else if (!resolved.length) { level = weaker(level, 'low'); reasons.push(`cited evidence does not resolve to any control that ran: ${a.evidence.join(', ')}`); }
    if (failing.length) { level = weaker(level, 'low'); reasons.push(`evidence is failing: ${failing.join(', ')}`); }

    // An assumption nothing has ever checked is not high-confidence, whatever the method allows.
    const checks = this.verifications(id);
    if (!checks.length) { level = weaker(level, 'low'); reasons.push('never verified — no check of this assumption has ever been recorded'); }
    else if (checks[checks.length - 1].holds === false) { level = weaker(level, 'unknown'); reasons.push('the most recent verification found it did NOT hold'); }

    // Expiry and review staleness both degrade it, and expiry is absolute.
    if (t >= a.expiresAt) { level = 'unknown'; reasons.push('expired — an expired assumption supports nothing until it is re-taken'); }
    else {
      const dueAt = (a.lastReviewedAt ?? a.registeredAt) + a.reviewCadenceDays * DAY;
      if (t > dueAt) { level = weaker(level, 'low'); reasons.push(`review overdue since ${dueAt}`); }
    }
    return { assumption: id, assessed: level, reasons, declared: a.declaredConfidence };
  }

  // The control this registry exists to be: an owner may claim more than the evidence supports, and
  // the registry says so by name rather than averaging the two into something meaningless.
  overclaims({ now = null, controls = [] } = {}) {
    return this.ids().map((id) => {
      const a = this.describe(id);
      const assessed = this.assessConfidence(id, { now, controls });
      return {
        assumption: id, owner: a.owner,
        declared: a.declaredConfidence, assessed: assessed.assessed,
        overclaimed: confidenceRank(a.declaredConfidence) < confidenceRank(assessed.assessed),
        gap: confidenceRank(assessed.assessed) - confidenceRank(a.declaredConfidence),
        reasons: assessed.reasons,
      };
    }).filter((r) => r.overclaimed);
  }

  // --- Detection ---------------------------------------------------------------------------------

  // Expired, or past its review cadence. Never reviewed counts from registration, so a new
  // assumption is not stale on day one but cannot sit unexamined for ever either.
  stale({ now = null } = {}) {
    const t = now ?? this._clock();
    return this.all().map((a) => {
      const dueAt = (a.lastReviewedAt ?? a.registeredAt) + a.reviewCadenceDays * DAY;
      const expired = t >= a.expiresAt;
      return {
        assumption: a.id, owner: a.owner, expiresAt: a.expiresAt, reviewDueAt: dueAt,
        expired, reviewOverdue: t > dueAt,
        neverReviewed: a.lastReviewedAt === null,
        daysOverdue: t > dueAt ? Math.floor((t - dueAt) / DAY) : 0,
        reason: expired ? 'expired' : t > dueAt ? (a.lastReviewedAt === null ? 'never reviewed and past its first cadence' : 'review overdue') : 'within cadence',
      };
    }).filter((r) => r.expired || r.reviewOverdue);
  }

  // Two assumptions that cannot both be true, found by comparing structured claims.
  contradictions() {
    const withClaims = this.all().filter((a) => a.claim);
    const out = [];
    for (let i = 0; i < withClaims.length; i++) {
      for (let j = i + 1; j < withClaims.length; j++) {
        const a = withClaims[i], b = withClaims[j];
        if (a.claim.subject !== b.claim.subject) continue;
        const why = contradicts(a.claim, b.claim);
        if (why) out.push({ subject: a.claim.subject, assumptions: [a.id, b.id], owners: [a.owner, b.owner], reason: why });
      }
    }
    return out;
  }

  // An assumption that bears on no bounded context this architecture contains. Either the context
  // was renamed and the assumption was not, or the assumption is about something else entirely.
  orphaned() {
    const known = new Set(contextMap.ids());
    return this.all().map((a) => {
      const unknownContexts = a.contexts.filter((c) => !known.has(c));
      return {
        assumption: a.id, owner: a.owner, contexts: a.contexts, unknownContexts,
        orphaned: a.contexts.length === 0 || unknownContexts.length === a.contexts.length,
        reason: a.contexts.length === 0
          ? 'affects no bounded context — nothing in the architecture depends on it, so why is it recorded?'
          : `names only contexts the architecture does not contain: ${unknownContexts.join(', ')}`,
      };
    }).filter((r) => r.orphaned);
  }

  // Cited no evidence, or cited evidence that does not resolve to a control that ran.
  unevidenced({ controls = [] } = {}) {
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    return this.all().map((a) => {
      const unresolved = a.evidence.filter((e) => !known.has(e));
      return {
        assumption: a.id, owner: a.owner, evidence: a.evidence, unresolved,
        unevidenced: a.evidence.length === 0 || unresolved.length === a.evidence.length,
        reason: a.evidence.length === 0
          ? 'cites no supporting evidence at all'
          : `cites evidence that does not resolve to any control that ran: ${unresolved.join(', ')}`,
      };
    }).filter((r) => r.unevidenced);
  }

  // --- Reporting ----------------------------------------------------------------------------------

  // Assumptions bearing on a bounded context — the query the twin and the drift check both need.
  forContext(context) { return this.all().filter((a) => a.contexts.includes(context)); }

  // Health of a set of assumptions, aggregated to the WEAKEST. A simulation resting on five sound
  // assumptions and one expired one rests on an expired assumption.
  health(ids = null, { now = null, controls = [] } = {}) {
    const chosen = (ids || this.ids()).filter((id) => this._items.has(id));
    const missing = (ids || []).filter((id) => !this._items.has(id));
    if (!chosen.length) {
      return {
        assumptions: [], count: 0, missing, confidence: 'unknown', sound: false,
        reason: missing.length ? `cites assumptions that are not registered: ${missing.join(', ')}` : 'no assumptions declared — an undeclared assumption is not an absent one, it is an unexamined one',
      };
    }
    const rows = chosen.map((id) => {
      const assessed = this.assessConfidence(id, { now, controls });
      const staleRow = this.stale({ now }).find((s) => s.assumption === id) || null;
      return { assumption: id, owner: this.describe(id).owner, assessed: assessed.assessed, declared: assessed.declared, stale: !!staleRow, expired: !!(staleRow && staleRow.expired), reasons: assessed.reasons };
    });
    const confidence = rows.reduce((w, r) => weaker(w, r.assessed), 'high');
    return {
      assumptions: rows, count: rows.length, missing,
      confidence, weakest: rows.slice().sort((a, b) => confidenceRank(b.assessed) - confidenceRank(a.assessed))[0].assumption,
      expired: rows.filter((r) => r.expired).map((r) => r.assumption),
      stale: rows.filter((r) => r.stale).map((r) => r.assumption),
      sound: missing.length === 0 && rows.every((r) => !r.stale) && confidenceRank(confidence) <= confidenceRank('moderate'),
      reason: missing.length ? `cites unregistered assumptions: ${missing.join(', ')}` : `weakest assumption is '${confidence}'`,
    };
  }

  validate({ now = null, controls = [] } = {}) {
    const violations = [];
    for (const a of this.all()) {
      if (!VERIFICATION_METHODS[a.verificationMethod]) violations.push(`${a.id}: unknown verification method`);
      if (!CONFIDENCE_LEVELS.includes(a.declaredConfidence)) violations.push(`${a.id}: unknown declared confidence`);
      if (!Number.isFinite(a.expiresAt)) violations.push(`${a.id}: no expiry`);
      if (a.expiresAt <= a.registeredAt) violations.push(`${a.id}: expires before or when it was registered`);
    }
    for (const c of this.contradictions()) violations.push(`contradiction on '${c.subject}': ${c.assumptions.join(' vs ')} — ${c.reason}`);
    return { valid: violations.length === 0, violations, assumptions: this._items.size };
  }

  report({ now = null, controls = [] } = {}) {
    const stale = this.stale({ now });
    const contradictions = this.contradictions();
    const orphaned = this.orphaned();
    const unevidenced = this.unevidenced({ controls });
    const overclaims = this.overclaims({ now, controls });
    const blockers = [
      ...stale.filter((s) => s.expired).map((s) => `${s.assumption}: expired`),
      ...contradictions.map((c) => `${c.assumptions.join(' vs ')}: contradiction on '${c.subject}'`),
      ...orphaned.map((o) => `${o.assumption}: ${o.reason}`),
    ];
    return {
      assumptions: this.all().map((a) => ({
        ...a,
        assessedConfidence: this.assessConfidence(a.id, { now, controls }).assessed,
        verifications: this.verifications(a.id).length,
      })),
      count: this._items.size,
      confidenceLevels: [...CONFIDENCE_LEVELS],
      verificationMethods: Object.entries(VERIFICATION_METHODS).map(([id, m]) => ({ method: id, ...m })),
      predicates: Object.entries(PREDICATES).map(([id, p]) => ({ predicate: id, ...p })),
      stale, contradictions, orphaned, unevidenced, overclaims,
      byOwner: this.all().reduce((acc, a) => ((acc[a.owner] = (acc[a.owner] || 0) + 1), acc), {}),
      validation: this.validate({ now, controls }),
      blockers, sound: blockers.length === 0,
      failClosed: true, informationalOnly: true, authorizes: false,
      note: 'Declared confidence is what the owner believes; assessed confidence is what the evidence supports. Where the first exceeds the second the assumption is an overclaim, and it is named rather than averaged away.',
    };
  }
}

// Do two claims about the same subject contradict? Deliberately conservative: it reports only what
// it can demonstrate, because a false contradiction would train people to ignore the report.
function contradicts(a, b) {
  const truthy = new Set(['holds', 'does-not-hold']);
  if (truthy.has(a.predicate) && truthy.has(b.predicate)) {
    return a.predicate !== b.predicate ? `one assumes it holds and the other that it does not` : null;
  }
  if (a.predicate === 'equals' && b.predicate === 'equals') {
    return a.value !== b.value ? `both claim an exact value, but ${JSON.stringify(a.value)} ≠ ${JSON.stringify(b.value)}` : null;
  }
  const bound = (x, y) => (x.predicate === 'at-most' && y.predicate === 'at-least' && y.value > x.value
    ? `at-most ${x.value} cannot hold alongside at-least ${y.value}` : null);
  return bound(a, b) || bound(b, a) || null;
}

// The platform's own assumptions, seeded from the ones this codebase actually makes. Several were
// discovered while building earlier phases and recorded only in a comment; recording them here gives
// each an owner, a cadence and an expiry, which a comment never had.
function seedPlatformAssumptions(registry, { at = 0 } = {}) {
  const YEAR = 365 * DAY;
  const add = (id, spec) => registry.register(id, { at, ...spec });

  add('ASM-0001', {
    statement: 'Every dependency between bounded contexts is declared in the context map.',
    rationale: 'Blast radius, impact analysis and the operations twin all traverse declared dependencies. If a dependency exists that nobody declared, every one of those answers is a lower bound rather than an answer.',
    evidence: ['APP-FIT-CONTEXT-MAP', 'APP-FIT-OPERATIONS-TWIN'], contexts: ['assurance', 'resilience'],
    owner: 'Office of the Chief Architect', reviewCadenceDays: 180, expiresAt: at + 2 * YEAR,
    verificationMethod: 'executable-check', confidence: 'moderate',
    claim: { subject: 'declared-dependencies-complete', predicate: 'holds' },
  });
  add('ASM-0002', {
    statement: 'An investigator\'s session remains pinned for the duration of a case edit.',
    rationale: 'ADR-0007 declares read-your-writes for the investigation context. That guarantee is per session, so it is enforceable only while a session survives the edit it is making.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['investigation'],
    owner: 'Directorate on Corruption and Economic Crime', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'moderate',
    claim: { subject: 'investigator-session-affinity', predicate: 'holds' },
  });
  add('ASM-0003', {
    statement: 'Analytics dashboards are read within a session rather than by anonymous polling.',
    rationale: 'ADR-0007 declares monotonic-reads for analytics. A reader with no identity cannot hold a per-reader guarantee, so the stance would be describing something that is not happening.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['analytics'],
    owner: 'Data Governance Board', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'low',
    claim: { subject: 'analytics-session-scoped-reads', predicate: 'holds' },
  });
  add('ASM-0004', {
    statement: 'Case throughput is a usable proxy for whether citizens can file reports.',
    rationale: 'Recorded when the mission chain validator found the constitutional reporting service reached by no business process. Nothing measures reporting availability directly; a report that cannot be filed never enters the pipeline, so throughput moves. It is a proxy, and a fall has other explanations.',
    evidence: ['APP-FIT-MISSION-IMPACT'], contexts: ['observability', 'intake'],
    owner: 'Service Delivery Board', reviewCadenceDays: 90, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'low',
    claim: { subject: 'throughput-proxies-reporting-availability', predicate: 'holds' },
  });
  add('ASM-0005', {
    statement: 'The synthetic service topology reflects the shape of the production deployment.',
    rationale: 'Chaos experiments, blast radius and the operations twin all reason over the declared topology. If production is shaped differently, every one of those rehearsals rehearses the wrong system.',
    evidence: ['APP-FIT-CHAOS-DETECT-RECOVER'], contexts: ['resilience', 'observability'],
    owner: 'Operations Review Board', reviewCadenceDays: 90, expiresAt: at + YEAR,
    verificationMethod: 'human-attestation', confidence: 'low',
    claim: { subject: 'topology-matches-production', predicate: 'holds' },
  });
  add('ASM-0006', {
    statement: 'A fitness identifier names exactly one control, and the control it names is the one it checks.',
    rationale: 'Assurance coverage, RACI control ownership, the enterprise graph and compliance mapping all key on fitness identifiers. If an identifier drifted from what it checks, all four would agree with each other and be wrong together.',
    evidence: ['APP-FIT-RACI-GOVERNANCE', 'APP-FIT-ENTERPRISE-GRAPH'], contexts: ['assurance', 'governance-oversight'],
    owner: 'Architecture Review Board', reviewCadenceDays: 180, expiresAt: at + 2 * YEAR,
    verificationMethod: 'executable-check', confidence: 'moderate',
    claim: { subject: 'fitness-identifier-names-one-control', predicate: 'holds' },
  });
  add('ASM-0007', {
    statement: 'Replica staleness is proportional to sequence lag at roughly one second per sequence.',
    rationale: 'The consistency posture converts sequence lag into a staleness estimate so an operator can decide what to shed during a partition. The constant is a modelling choice, not a measurement.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['persistence'],
    owner: 'Operations Review Board', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'unverifiable', confidence: 'low',
    claim: { subject: 'lag-to-staleness-ratio', predicate: 'equals', value: 1000 },
  });
  add('ASM-0008', {
    statement: 'The platform can continue to meet its requirements with zero runtime dependencies.',
    rationale: 'Zero dependencies is what makes the supply chain auditable and the build reproducible offline. It is an assumption about future requirements, not a property of the current code.',
    evidence: ['APP-FIT-SUPPLY-CHAIN-GOVERNANCE'], contexts: ['assurance', 'supply-chain'],
    owner: 'Architecture Review Board', reviewCadenceDays: 365, expiresAt: at + 2 * YEAR,
    verificationMethod: 'executable-check', confidence: 'moderate',
    claim: { subject: 'zero-runtime-dependencies-sufficient', predicate: 'holds' },
  });
  return registry;
}

module.exports = {
  AssumptionRegistry, seedPlatformAssumptions,
  CONFIDENCE_LEVELS, VERIFICATION_METHODS, PREDICATES,
  confidenceRank, weaker, contradicts,
};
