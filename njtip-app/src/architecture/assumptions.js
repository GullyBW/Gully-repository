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

// --- Assumption dependency graph (Phase 14, Part 1) ----------------------------------------------
//
// A registry of independent assumptions is already better than a pile of comments, and it still gets
// one thing badly wrong: assumptions are not independent. ASM-0001 ("every cross-context dependency
// is declared") rests on ASM-0006 ("a fitness identifier names exactly one control"), because the
// evidence cited for the first is a fitness function identified by name. If identifiers ever drifted
// from what they check, the evidence for ASM-0001 would prove nothing — and nothing in the Phase 13
// registry would have said so. The registry would have reported eight assumptions each at their own
// confidence, and one of them would have been silently worthless.
//
// Three rules make the graph a control rather than a diagram:
//
//   1. CONFIDENCE FLOWS DOWNSTREAM AND ONLY DOWNWARD. An assumption can never be made more confident
//      by what it rests on. Inheritance is a CEILING, applied after the intrinsic assessment, so a
//      strong dependent resting on a weak upstream reports the weak level and says which upstream
//      capped it.
//
//   2. A CASCADING FAILURE IS NOT A REDUCED CONFIDENCE. If a `necessary` upstream does not hold, the
//      dependent does not hold either — that is a different fact from being less sure of it, and
//      merging the two would let a broken foundation read as a slightly lower score.
//
//   3. A CYCLE IS REFUSED AT DECLARATION. Two assumptions that justify each other are two assumptions
//      nobody has checked, and a propagation over a cycle either never terminates or quietly picks a
//      starting point that decides the answer.

// How hard an upstream assumption bears on a dependent.
const DEPENDENCY_STRENGTHS = {
  necessary: {
    propagation: 'ceiling', cascades: true,
    description: 'The dependent cannot be true unless the upstream is. Full confidence inheritance, and an invalid upstream invalidates the dependent.',
    ifUpstreamFails: 'The dependent assumption does not hold either. Not "less certain" — not holding.',
  },
  supporting: {
    propagation: 'softened-ceiling', cascades: false,
    description: 'The dependent is weaker without the upstream but does not collapse. Inherits a ceiling one level better than the upstream.',
    ifUpstreamFails: 'The dependent is weakened and reported as such; it is not invalidated.',
  },
  contextual: {
    propagation: 'none', cascades: false,
    description: 'The upstream informs how the dependent is read but does not carry it. Recorded for impact analysis; no confidence propagates.',
    ifUpstreamFails: 'The dependent is listed as affected so a human can judge it. Nothing is derived.',
  },
};

// What KIND of dependency this is. Declared rather than inferred, because the remedy differs: a
// logical dependency is closed by re-reasoning, an evidential one by finding better evidence, an
// operational one by changing how the platform runs, and a temporal one simply expires.
const DEPENDENCY_TYPES = {
  logical: { description: 'The dependent follows from the upstream by reasoning about the system.' },
  evidential: { description: 'The evidence cited for the dependent is only meaningful if the upstream holds.' },
  operational: { description: 'The dependent holds because of how the platform is currently operated.' },
  temporal: { description: 'The dependent holds only while a condition recorded by the upstream persists.' },
};

// --- Assumption maturity (Phase 15, Part 1) -------------------------------------------------------
//
// Confidence answers "how much may we rely on this?". Maturity answers a different and more
// actionable question: "how far has this assumption been taken through the process, and what is the
// next thing somebody has to do?" A registry can be full of low-confidence assumptions because the
// evidence genuinely does not support more, or because nobody has done the work. Those need opposite
// responses and confidence alone cannot tell them apart.
//
// Maturity is DERIVED from what is recorded, never declared. There is no `maturity` parameter on
// `register()`, because a level somebody types in is a claim about their own diligence.
//
// The rule that makes it a control:
//
//   MATURITY MAY NOT REGRESS SILENTLY. An assumption that reaches A3 and falls back to A1 has had
//   something taken away from it — an expiry passed, a verification failed, a control stopped
//   running — and the registry names the regression rather than reporting the new level as though it
//   had always been that.
const MATURITY_LEVELS = {
  A0: { level: 0, name: 'Undocumented', means: 'The platform relies on it and nothing records it. The state every assumption starts in before somebody writes it down.', next: 'Register it, with an owner, a rationale and an expiry.' },
  A1: { level: 1, name: 'Documented', means: 'Registered with an owner, a rationale and an expiry. Nothing supports it yet.', next: 'Cite evidence that resolves to a control that actually runs.' },
  A2: { level: 2, name: 'Evidence attached', means: 'Cites evidence, and the evidence resolves to a control that ran.', next: 'Have somebody independent check it and record the verification.' },
  A3: { level: 3, name: 'Independently verified', means: 'Somebody other than the owner has checked it and recorded that it held.', next: 'Put it under a review cadence that is actually being met.' },
  A4: { level: 4, name: 'Continuously monitored', means: 'Verified, within its review cadence, and re-checked more than once — so a change would be noticed rather than discovered.', next: 'Back it with an executable check that fails the build.' },
  A5: { level: 5, name: 'Automatically validated', means: 'An executable check re-runs on every build and would fail if the assumption stopped holding. The only level that survives everybody leaving.', next: 'Nothing. Keep the control running.' },
};
const MATURITY_ORDER = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

// --- Assumption criticality (Phase 15, Part 7) ----------------------------------------------------
//
// Not every assumption deserves the same attention, and treating them alike is how the important ones
// get lost among the trivial. Criticality is DECLARED — it is a judgement about consequence, and a
// judgement is exactly the thing that should be arguable rather than computed — but the verification
// frequency it implies is derived from it, so declaring something foundational commits you to
// checking it four times a year whether or not anybody wanted to.
const CRITICALITY_LEVELS = {
  informational: { rank: 0, verifyEveryDays: 365, minimumMaturity: 'A1', means: 'Useful to have written down. If it turned out false, something would be slightly less accurate.' },
  important: { rank: 1, verifyEveryDays: 180, minimumMaturity: 'A2', means: 'A capability would be degraded. Work would have to be redone.' },
  critical: { rank: 2, verifyEveryDays: 90, minimumMaturity: 'A3', means: 'A capability would stop, or a control would be enforcing something that is no longer true.' },
  foundational: { rank: 3, verifyEveryDays: 90, minimumMaturity: 'A4', means: 'Other assumptions rest on it. If it fails, so does everything downstream, and the failure is invisible until something else breaks.' },
};
const CRITICALITY_ORDER = ['informational', 'important', 'critical', 'foundational'];

function confidenceRank(level) { return CONFIDENCE_LEVELS.indexOf(level); }
// Lower rank is stronger (high = 0). "Weaker of the two" therefore takes the higher rank.
function weaker(a, b) { return confidenceRank(a) >= confidenceRank(b) ? a : b; }
// One level better, floored at 'high'. A `supporting` dependency degrades the dependent without
// dragging it all the way down to the upstream's level.
function softened(level) { const i = confidenceRank(level); return CONFIDENCE_LEVELS[Math.max(0, i - 1)]; }

class AssumptionRegistry {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._verifications = new Map(); }

  register(id, {
    statement, rationale, evidence = [], contexts = [], owner,
    reviewCadenceDays, expiresAt, verificationMethod, confidence = 'unknown', claim = null, at = null,
    dependsOn = [], criticality = null,
  } = {}) {
    if (!id) throw new Error('an assumption needs an identifier');
    if (this._items.has(id)) throw new Error(`assumption '${id}' is already registered — amend it rather than re-registering`);
    if (!statement) throw new Error('an assumption must state what is being assumed');
    if (!rationale) throw new Error('an assumption must state why it was reasonable to make');
    if (!owner) { const e = new Error('an assumption must name an owner — an unowned assumption is one nobody will revisit'); e.failClosed = true; throw e; }
    if (!VERIFICATION_METHODS[verificationMethod]) throw new Error(`unknown verification method '${verificationMethod}' — one of ${Object.keys(VERIFICATION_METHODS).join(', ')}`);
    if (!CONFIDENCE_LEVELS.includes(confidence)) throw new Error(`unknown confidence level '${confidence}'`);
    // Phase 15, Part 7. Declared, because it is a judgement about consequence — but only from the
    // declared set, so "quite important" cannot become a criticality level by being typed.
    // `null` means nobody has judged it, which is a different state from somebody choosing the
    // middle — and the one that belongs in a review queue.
    if (criticality !== null && !CRITICALITY_LEVELS[criticality]) throw new Error(`unknown criticality '${criticality}' — one of ${Object.keys(CRITICALITY_LEVELS).join(', ')}`);
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
      criticality,
      registeredAt, lastReviewedAt: null, lastReviewedBy: null,
      dependsOn: [],
    });
    for (const edge of dependsOn) this.declareDependency(id, edge);
    return this.describe(id);
  }

  // --- Maturity and criticality (Phase 15, Parts 1 & 7) -------------------------------------------

  // Maturity, derived from what is recorded. Every level states why it was reached and what the next
  // step is, so a maturity dashboard is a work queue rather than a score.
  maturity(id, { now = null, controls = [] } = {}) {
    const a = this.describe(id);
    const t = now ?? this._clock();
    const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
    const checks = this.verifications(id);

    // A1: registered with the things `register()` already refuses to be without.
    const documented = !!(a.statement && a.rationale && a.owner && Number.isFinite(a.expiresAt));
    // A2: cites evidence that resolves to a control that actually ran and is not failing.
    const resolved = a.evidence.filter((e) => known.has(e));
    const failing = resolved.filter((e) => holding.get(e) === false);
    const evidenced = documented && resolved.length > 0 && failing.length === 0;
    // A3: somebody OTHER than the owner recorded a verification that held. The independence rule is
    // the same one the compliance lifecycle uses for `verified`: a self-check is not verification.
    const independent = checks.filter((c) => c.holds && c.by && c.by !== a.owner);
    const verified = evidenced && independent.length > 0;
    // A4: more than one check, inside the review cadence. One check is a result; two is monitoring.
    const dueAt = (a.lastReviewedAt ?? a.registeredAt) + a.reviewCadenceDays * DAY;
    const withinCadence = t <= dueAt && t < a.expiresAt;
    const monitored = verified && independent.length >= 2 && withinCadence;
    // A5: an executable check stands behind it and is currently holding.
    const executable = monitored && a.verificationMethod === 'executable-check' && resolved.some((e) => holding.get(e) === true);

    const level = executable ? 'A5' : monitored ? 'A4' : verified ? 'A3' : evidenced ? 'A2' : documented ? 'A1' : 'A0';
    const blockers = [
      ...(documented ? [] : ['not registered with an owner, a rationale and an expiry']),
      ...(documented && !resolved.length ? [`cites no evidence that resolves to a control that ran${a.evidence.length ? `: ${a.evidence.join(', ')}` : ''}`] : []),
      ...(failing.length ? [`cited evidence is failing: ${failing.join(', ')}`] : []),
      ...(evidenced && !independent.length ? [checks.length ? 'every recorded verification was performed by the owner — a self-check is not independent verification' : 'never independently verified'] : []),
      ...(verified && independent.length < 2 ? ['verified once; one check is a result, not monitoring'] : []),
      ...(verified && !withinCadence ? [t >= a.expiresAt ? 'expired' : 'past its review cadence'] : []),
      ...(monitored && a.verificationMethod !== 'executable-check' ? [`verification method '${a.verificationMethod}' cannot reach A5 — only an executable check re-runs on every build`] : []),
    ];
    return {
      assumption: id, owner: a.owner, maturity: level, ...MATURITY_LEVELS[level],
      verifications: checks.length, independentVerifications: independent.length,
      resolvedEvidence: resolved, failingEvidence: failing,
      withinCadence, blockers,
      // The next concrete thing somebody has to do. A dashboard without this is a scoreboard.
      nextStep: level === 'A5' ? MATURITY_LEVELS.A5.next : (blockers[0] || MATURITY_LEVELS[level].next),
    };
  }

  // Criticality is declared on the assumption; anything undeclared is `important`, which is the
  // middle and therefore the choice that flatters nobody.
  criticality(id) {
    const a = this.describe(id);
    const declared = a.criticality !== null && a.criticality !== undefined;
    // Undeclared resolves to `important` for scheduling purposes — the middle, which flatters nobody —
    // and is reported as undeclared, because nobody having judged the consequence is itself a finding.
    const level = declared ? a.criticality : 'important';
    return {
      assumption: id, criticality: level, declared,
      ...CRITICALITY_LEVELS[level],
      note: declared ? null : 'nobody has judged this assumption\'s consequence; `important` is the scheduling default, not an assessment',
    };
  }

  // THE PART 7 RULE: verification frequency scales with criticality automatically. The cadence the
  // owner declared and the cadence the criticality requires are reported separately, because an owner
  // who declared a 365-day cadence on a foundational assumption has made a decision somebody should
  // see rather than one the platform should silently override.
  verificationSchedule(id, { now = null } = {}) {
    const a = this.describe(id);
    const t = now ?? this._clock();
    const c = this.criticality(id);
    const requiredDays = c.verifyEveryDays;
    const checks = this.verifications(id);
    const lastVerifiedAt = checks.length ? checks[checks.length - 1].at : null;
    const dueAt = (lastVerifiedAt ?? a.registeredAt) + requiredDays * DAY;
    return {
      assumption: id, criticality: c.criticality, owner: a.owner,
      declaredCadenceDays: a.reviewCadenceDays, requiredCadenceDays: requiredDays,
      cadenceTooSlow: a.reviewCadenceDays > requiredDays,
      lastVerifiedAt, neverVerified: lastVerifiedAt === null,
      dueAt, overdue: t > dueAt,
      daysOverdue: t > dueAt ? Math.floor((t - dueAt) / DAY) : 0,
      reason: a.reviewCadenceDays > requiredDays
        ? `declared cadence of ${a.reviewCadenceDays} days is slower than the ${requiredDays} days '${c.criticality}' requires`
        : lastVerifiedAt === null ? `never verified; ${c.criticality} requires verification every ${requiredDays} days`
          : t > dueAt ? `verification overdue by ${Math.floor((t - dueAt) / DAY)} days` : 'within the required verification frequency',
    };
  }

  // The estate-wide maturity picture: distribution, the backlog, and what to do next.
  maturityReport({ now = null, controls = [] } = {}) {
    const t = now ?? this._clock();
    const rows = this.ids().map((id) => ({
      ...this.maturity(id, { now: t, controls }),
      ...this.criticality(id),
      schedule: this.verificationSchedule(id, { now: t }),
    }));
    const distribution = Object.fromEntries(MATURITY_ORDER.map((l) => [l, rows.filter((r) => r.maturity === l).length]));
    // Aggregate to the WEAKEST, as everywhere else: an estate is as mature as its least mature
    // foundational assumption, not as its average.
    const foundational = rows.filter((r) => r.criticality === 'foundational');
    const critical = rows.filter((r) => ['critical', 'foundational'].includes(r.criticality));
    const weakest = rows.slice().sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity) || a.assumption.localeCompare(b.assumption))[0] || null;
    // Below the minimum its criticality demands.
    const belowMinimum = rows.filter((r) => MATURITY_ORDER.indexOf(r.maturity) < MATURITY_ORDER.indexOf(CRITICALITY_LEVELS[r.criticality].minimumMaturity));
    return {
      assumptions: rows, count: rows.length,
      levels: MATURITY_ORDER.map((l) => ({ level: l, ...MATURITY_LEVELS[l] })),
      criticalityLevels: CRITICALITY_ORDER.map((c) => ({ criticality: c, ...CRITICALITY_LEVELS[c] })),
      distribution,
      // A single figure, and the sentence that has to travel with it.
      organizationalMaturity: rows.length ? MATURITY_ORDER[Math.min(...rows.map((r) => MATURITY_ORDER.indexOf(r.maturity)))] : null,
      maturityBasis: rows.length
        ? `The estate is as mature as its least mature assumption, not as its average: ${weakest ? `${weakest.assumption} at ${weakest.maturity}` : 'n/a'}. ${Object.entries(distribution).filter(([, n]) => n).map(([l, n]) => `${n}×${l}`).join(', ')}.`
        : 'no assumption is registered, which is A0 for everything the platform relies on',
      belowMinimum: belowMinimum.map((r) => ({ assumption: r.assumption, criticality: r.criticality, maturity: r.maturity, requires: CRITICALITY_LEVELS[r.criticality].minimumMaturity, nextStep: r.nextStep })),
      // The verification backlog, ordered by criticality then by how overdue it is. This is the
      // Part 1 deliverable that is actually usable: a queue, not a score.
      verificationBacklog: rows
        .filter((r) => r.schedule.overdue || r.schedule.neverVerified)
        .sort((a, b) => CRITICALITY_LEVELS[b.criticality].rank - CRITICALITY_LEVELS[a.criticality].rank
          || b.schedule.daysOverdue - a.schedule.daysOverdue
          || a.assumption.localeCompare(b.assumption))
        .map((r) => ({ assumption: r.assumption, owner: r.owner, criticality: r.criticality, maturity: r.maturity, daysOverdue: r.schedule.daysOverdue, neverVerified: r.schedule.neverVerified, nextStep: r.nextStep })),
      reviewPriorities: rows
        .filter((r) => MATURITY_ORDER.indexOf(r.maturity) < MATURITY_ORDER.indexOf('A3'))
        .sort((a, b) => CRITICALITY_LEVELS[b.criticality].rank - CRITICALITY_LEVELS[a.criticality].rank || a.assumption.localeCompare(b.assumption))
        .map((r) => ({ assumption: r.assumption, criticality: r.criticality, maturity: r.maturity, nextStep: r.nextStep })),
      cadenceTooSlow: rows.filter((r) => r.schedule.cadenceTooSlow).map((r) => ({ assumption: r.assumption, declared: r.schedule.declaredCadenceDays, required: r.schedule.requiredCadenceDays })),
      foundationalCount: foundational.length, criticalCount: critical.length,
      now: t, informationalOnly: true, authorizes: false,
      note: 'Maturity is derived from what is recorded; there is no parameter that sets it. Criticality is declared, because it is a judgement about consequence — but the verification frequency it implies is not negotiable, and an owner whose declared cadence is slower than their criticality requires is named rather than silently overridden.',
    };
  }

  // Maturity over time, from snapshots the caller has kept. Regression is reported per assumption,
  // never netted off: three improving and one regressing is not "stable".
  maturityTrend(snapshots = []) {
    if (snapshots.length < 2) {
      return { snapshots: snapshots.length, direction: 'insufficient-data', regressions: [], improvements: [], reason: 'a trend needs at least two snapshots; one is a reading' };
    }
    const first = snapshots[0], last = snapshots[snapshots.length - 1];
    const idx = (m) => MATURITY_ORDER.indexOf(m);
    const ids = [...new Set([...Object.keys(first), ...Object.keys(last)])].sort();
    const moves = ids.map((id) => ({
      assumption: id, from: first[id] || 'A0', to: last[id] || 'A0',
      delta: idx(last[id] || 'A0') - idx(first[id] || 'A0'),
    }));
    const regressions = moves.filter((m) => m.delta < 0);
    const improvements = moves.filter((m) => m.delta > 0);
    return {
      snapshots: snapshots.length, moves,
      regressions, improvements,
      // Regression is reported on its own terms. A net figure would let one assumption falling out of
      // continuous monitoring disappear behind three being written down.
      direction: regressions.length ? 'regressed' : improvements.length ? 'improving' : 'flat',
      reason: regressions.length
        ? `${regressions.length} assumption(s) regressed: ${regressions.map((r) => `${r.assumption} ${r.from}→${r.to}`).join(', ')}. Reported separately from the ${improvements.length} that improved, because a net figure would hide it.`
        : improvements.length ? `${improvements.length} assumption(s) improved and none regressed` : 'no assumption changed maturity level',
      informationalOnly: true, authorizes: false,
    };
  }

  // --- Part 1: the dependency graph ---------------------------------------------------------------

  // Declare that `from` rests on `on`. Separate from registration because the platform's own
  // assumptions depend on each other in both directions of the seeding order, and an API that forced
  // a topological registration order would be an API people worked around.
  declareDependency(from, { on, strength, type, rationale = null } = {}) {
    const a = this._items.get(from);
    if (!a) throw new Error('unknown assumption: ' + from);
    if (!this._items.has(on)) throw new Error(`assumption '${from}' cannot depend on '${on}' — no such assumption is registered`);
    if (from === on) { const e = new Error(`assumption '${from}' cannot depend on itself`); e.failClosed = true; throw e; }
    if (!DEPENDENCY_STRENGTHS[strength]) throw new Error(`unknown dependency strength '${strength}' — one of ${Object.keys(DEPENDENCY_STRENGTHS).join(', ')}`);
    if (!DEPENDENCY_TYPES[type]) throw new Error(`unknown dependency type '${type}' — one of ${Object.keys(DEPENDENCY_TYPES).join(', ')}`);
    if (a.dependsOn.some((d) => d.on === on)) throw new Error(`'${from}' already declares a dependency on '${on}' — amend it rather than declaring it twice`);
    // A cycle would make propagation either non-terminating or dependent on where you started, and
    // two assumptions that justify each other are two assumptions nobody has checked.
    if (this._reaches(on, from)) {
      const e = new Error(`'${from}' → '${on}' would create a cycle — assumptions that justify each other are assumptions nobody has checked`);
      e.failClosed = true; throw e;
    }
    a.dependsOn.push({ on, strength, type, rationale });
    return this.describe(from);
  }

  // Can `start` reach `target` by following upstream edges?
  _reaches(start, target) {
    const seen = new Set();
    const walk = (id) => {
      if (id === target) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (this._items.get(id)?.dependsOn || []).some((d) => walk(d.on));
    };
    return walk(start);
  }

  upstream(id) { const a = this._items.get(id); if (!a) throw new Error('unknown assumption: ' + id); return a.dependsOn.map((d) => ({ ...d })); }
  downstream(id) {
    if (!this._items.has(id)) throw new Error('unknown assumption: ' + id);
    return this.all().flatMap((a) => a.dependsOn.filter((d) => d.on === id).map((d) => ({ assumption: a.id, strength: d.strength, type: d.type, rationale: d.rationale })));
  }

  // The graph as data: nodes, directed edges, roots, leaves and a topological order. Reported rather
  // than drawn, so it cannot drift from the edges propagation actually traverses.
  dependencyGraph() {
    const nodes = this.all().map((a) => ({
      assumption: a.id, owner: a.owner, verificationMethod: a.verificationMethod,
      upstreamCount: a.dependsOn.length, downstreamCount: this.downstream(a.id).length,
    }));
    const edges = this.all().flatMap((a) => a.dependsOn.map((d) => ({ from: a.id, to: d.on, strength: d.strength, type: d.type, rationale: d.rationale })))
      .sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
    // Kahn's algorithm over upstream edges. Anything left over would be a cycle, which declaration
    // refuses — so a non-empty remainder means the guard has been bypassed and is a finding.
    const indegree = new Map(nodes.map((n) => [n.assumption, this._items.get(n.assumption).dependsOn.length]));
    const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const d of this.downstream(id)) {
        const left = indegree.get(d.assumption) - 1;
        indegree.set(d.assumption, left);
        if (left === 0) { queue.push(d.assumption); queue.sort(); }
      }
    }
    return {
      nodes, edges, edgeCount: edges.length,
      strengths: Object.entries(DEPENDENCY_STRENGTHS).map(([id, s]) => ({ strength: id, ...s })),
      types: Object.entries(DEPENDENCY_TYPES).map(([id, s]) => ({ type: id, ...s })),
      // A root rests on nothing recorded here; a leaf carries nothing. Roots are where verification
      // effort pays most, because everything downstream inherits from them.
      roots: nodes.filter((n) => n.upstreamCount === 0).map((n) => n.assumption),
      leaves: nodes.filter((n) => n.downstreamCount === 0).map((n) => n.assumption),
      // Load-bearing: the assumptions the most others rest on, transitively.
      loadBearing: nodes.map((n) => ({ assumption: n.assumption, carries: this._downstreamClosure(n.assumption).length }))
        .filter((r) => r.carries > 0).sort((a, b) => b.carries - a.carries || a.assumption.localeCompare(b.assumption)),
      order, acyclic: order.length === nodes.length,
      unordered: nodes.filter((n) => !order.includes(n.assumption)).map((n) => n.assumption),
    };
  }

  // Is this assumption currently INVALID — as distinct from being held with low confidence? Three
  // ways: the last recorded verification found it did not hold, it has expired, or the caller is
  // asking a what-if and named it.
  invalidity(id, { now = null, invalidated = [] } = {}) {
    const a = this.describe(id);
    const t = now ?? this._clock();
    if (invalidated.includes(id)) return { invalid: true, reason: 'named as invalid by the analysis' };
    const checks = this.verifications(id);
    if (checks.length && checks[checks.length - 1].holds === false) return { invalid: true, reason: 'the most recent verification found it did not hold' };
    if (t >= a.expiresAt) return { invalid: true, reason: 'expired — an expired assumption is not a weaker one, it is one nobody is standing behind' };
    return { invalid: false, reason: null };
  }

  // CONFIDENCE PROPAGATION. Intrinsic assessment first, then the ceiling every upstream imposes,
  // walked in topological order so an upstream's own inherited level is known before it is applied.
  propagateConfidence({ now = null, controls = [], invalidated = [] } = {}) {
    const graph = this.dependencyGraph();
    const rows = new Map();
    const order = graph.acyclic ? graph.order : this.ids();
    for (const id of order) {
      const intrinsic = this.assessConfidence(id, { now, controls }).assessed;
      const invalid = this.invalidity(id, { now, invalidated });
      let effective = intrinsic;
      const caps = [];
      let cascadedFrom = null;
      for (const edge of this.upstream(id)) {
        const up = rows.get(edge.on);
        const upLevel = up ? up.effective : this.assessConfidence(edge.on, { now, controls }).assessed;
        const upInvalid = up ? up.invalid : this.invalidity(edge.on, { now, invalidated }).invalid;
        if (edge.strength === 'necessary') {
          caps.push({ from: edge.on, strength: edge.strength, type: edge.type, ceiling: upLevel, why: `necessary dependency on '${edge.on}', assessed '${upLevel}'` });
          effective = weaker(effective, upLevel);
          // Cascade: an invalid necessary upstream invalidates the dependent, transitively.
          if (upInvalid && !cascadedFrom) cascadedFrom = edge.on;
        } else if (edge.strength === 'supporting') {
          const ceiling = softened(upLevel);
          caps.push({ from: edge.on, strength: edge.strength, type: edge.type, ceiling, why: `supporting dependency on '${edge.on}' (assessed '${upLevel}') caps this at '${ceiling}'` });
          effective = weaker(effective, ceiling);
        } else {
          caps.push({ from: edge.on, strength: edge.strength, type: edge.type, ceiling: null, why: `contextual dependency on '${edge.on}' — recorded for impact, no confidence propagates` });
        }
      }
      const isInvalid = invalid.invalid || cascadedFrom !== null;
      if (isInvalid) effective = 'unknown';
      rows.set(id, {
        assumption: id, owner: this.describe(id).owner,
        intrinsic, effective,
        // Named separately so a reader can see whether the drop came from this assumption or from
        // something it rests on. "Weakened by ASM-0006" is actionable; a bare 'low' is not.
        inherited: effective !== intrinsic,
        limitedBy: caps.filter((c) => c.ceiling !== null && confidenceRank(c.ceiling) >= confidenceRank(effective)).map((c) => c.from),
        upstreamCeilings: caps,
        invalid: isInvalid,
        cascaded: cascadedFrom !== null,
        cascadedFrom,
        invalidReason: invalid.invalid ? invalid.reason : cascadedFrom ? `a necessary upstream ('${cascadedFrom}') does not hold` : null,
      });
    }
    const all = [...rows.values()].sort((a, b) => a.assumption.localeCompare(b.assumption));
    return {
      assumptions: all, count: all.length,
      degraded: all.filter((r) => r.inherited && !r.invalid).map((r) => ({ assumption: r.assumption, from: r.intrinsic, to: r.effective, limitedBy: r.limitedBy })),
      invalid: all.filter((r) => r.invalid).map((r) => r.assumption),
      cascaded: all.filter((r) => r.cascaded).map((r) => ({ assumption: r.assumption, from: r.cascadedFrom })),
      graph,
      method: 'Intrinsic assessment first; then every upstream imposes a ceiling. `necessary` inherits the upstream level in full and cascades invalidity; `supporting` caps one level better; `contextual` propagates nothing.',
      informationalOnly: true, authorizes: false,
      note: 'Confidence flows downstream and only downward — an assumption is never made more confident by what it rests on. An invalid upstream produces a cascading FAILURE, not a lower score.',
    };
  }

  // What does invalidating these assumptions cost? The downstream closure, with the distance and the
  // strength chain that carries the effect, so a reader can disagree with any hop.
  assumptionImpact(id, { now = null, controls = [] } = {}) {
    if (!this._items.has(id)) throw new Error('unknown assumption: ' + id);
    const rows = this._downstreamClosure(id);
    const cascade = this.propagateConfidence({ now, controls, invalidated: [id] });
    return {
      assumption: id, affected: rows, affectedCount: rows.length,
      wouldNotHold: rows.filter((r) => r.viaStrength === 'necessary').map((r) => r.assumption),
      wouldBeWeakened: rows.filter((r) => r.viaStrength === 'supporting').map((r) => r.assumption),
      toJudge: rows.filter((r) => r.viaStrength === 'contextual').map((r) => r.assumption),
      contextsAffected: [...new Set([id, ...rows.map((r) => r.assumption)].flatMap((a) => this.describe(a).contexts))].sort(),
      cascadeConfidence: cascade.assumptions.filter((c) => c.invalid || c.inherited).map((c) => ({ assumption: c.assumption, effective: c.effective, invalid: c.invalid })),
      informationalOnly: true, authorizes: false,
      note: rows.length
        ? `Invalidating '${id}' reaches ${rows.length} other assumption(s). Anything reached by a chain of necessary dependencies does not hold either.`
        : `Nothing recorded rests on '${id}'. That is not proof nothing does — only that no dependency has been declared.`,
    };
  }

  // The transitive downstream set, with the weakest strength along the path. Kept separate from
  // `assumptionImpact` because the graph itself needs it and calling the full impact analysis from
  // `dependencyGraph()` would recurse through propagation and back.
  _downstreamClosure(id) {
    const affected = new Map();
    const walk = (current, distance, path, weakestStrength) => {
      for (const d of this.downstream(current)) {
        const strength = weakestStrength === 'contextual' || d.strength === 'contextual' ? 'contextual'
          : weakestStrength === 'supporting' || d.strength === 'supporting' ? 'supporting' : 'necessary';
        const existing = affected.get(d.assumption);
        // Keep the SHORTEST path and, at equal distance, the strongest chain — the worst case is the
        // one a reader needs.
        if (!existing || distance + 1 < existing.distance) {
          affected.set(d.assumption, {
            assumption: d.assumption, distance: distance + 1, viaStrength: strength, viaType: d.type,
            path: [...path, d.assumption],
            effect: strength === 'necessary' ? 'would not hold' : strength === 'supporting' ? 'would be weakened' : 'is affected — a human must judge how',
          });
          walk(d.assumption, distance + 1, [...path, d.assumption], strength);
        }
      }
    };
    walk(id, 0, [id], 'necessary');
    return [...affected.values()].sort((a, b) => a.distance - b.distance || a.assumption.localeCompare(b.assumption));
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
  health(ids = null, { now = null, controls = [], propagate = true } = {}) {
    const chosen = (ids || this.ids()).filter((id) => this._items.has(id));
    const missing = (ids || []).filter((id) => !this._items.has(id));
    // Phase 14, Part 1: health is assessed on the PROPAGATED confidence, so a scenario resting on an
    // assumption whose own foundation is unsound inherits that rather than reading the surface level.
    const propagated = propagate ? new Map(this.propagateConfidence({ now, controls }).assumptions.map((r) => [r.assumption, r])) : new Map();
    if (!chosen.length) {
      return {
        assumptions: [], count: 0, missing, confidence: 'unknown', sound: false,
        reason: missing.length ? `cites assumptions that are not registered: ${missing.join(', ')}` : 'no assumptions declared — an undeclared assumption is not an absent one, it is an unexamined one',
      };
    }
    const rows = chosen.map((id) => {
      const assessed = this.assessConfidence(id, { now, controls });
      const staleRow = this.stale({ now }).find((s) => s.assumption === id) || null;
      const prop = propagated.get(id) || null;
      return {
        assumption: id, owner: this.describe(id).owner,
        assessed: prop ? prop.effective : assessed.assessed,
        intrinsic: assessed.assessed, declared: assessed.declared,
        inherited: prop ? prop.inherited : false, limitedByUpstream: prop ? prop.limitedBy : [],
        invalid: prop ? prop.invalid : false, cascadedFrom: prop ? prop.cascadedFrom : null,
        stale: !!staleRow, expired: !!(staleRow && staleRow.expired), reasons: assessed.reasons,
      };
    });
    const confidence = rows.reduce((w, r) => weaker(w, r.assessed), 'high');
    return {
      assumptions: rows, count: rows.length, missing,
      confidence, weakest: rows.slice().sort((a, b) => confidenceRank(b.assessed) - confidenceRank(a.assessed) || a.assumption.localeCompare(b.assumption))[0].assumption,
      expired: rows.filter((r) => r.expired).map((r) => r.assumption),
      stale: rows.filter((r) => r.stale).map((r) => r.assumption),
      invalid: rows.filter((r) => r.invalid).map((r) => r.assumption),
      inheritedWeakness: rows.filter((r) => r.inherited).map((r) => ({ assumption: r.assumption, from: r.intrinsic, to: r.assessed, limitedBy: r.limitedByUpstream })),
      sound: missing.length === 0 && rows.every((r) => !r.stale && !r.invalid) && confidenceRank(confidence) <= confidenceRank('moderate'),
      reason: missing.length ? `cites unregistered assumptions: ${missing.join(', ')}`
        : rows.some((r) => r.invalid) ? `rests on assumption(s) that do not hold: ${rows.filter((r) => r.invalid).map((r) => r.assumption).join(', ')}`
          : `weakest assumption is '${confidence}'`,
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
    // Part 1: the graph itself must be well formed. A cycle here would mean the declaration guard was
    // bypassed, and propagation over a cycle answers whatever its starting point decided.
    const graph = this.dependencyGraph();
    if (!graph.acyclic) violations.push(`the dependency graph is cyclic — ${graph.unordered.join(', ')} could not be ordered`);
    for (const e of graph.edges) {
      if (!this._items.has(e.to)) violations.push(`'${e.from}' depends on '${e.to}', which is not registered`);
      if (!DEPENDENCY_STRENGTHS[e.strength]) violations.push(`'${e.from}' → '${e.to}' declares unknown strength '${e.strength}'`);
      if (!DEPENDENCY_TYPES[e.type]) violations.push(`'${e.from}' → '${e.to}' declares unknown type '${e.type}'`);
    }
    return { valid: violations.length === 0, violations, assumptions: this._items.size, edges: graph.edgeCount };
  }

  report({ now = null, controls = [] } = {}) {
    const stale = this.stale({ now });
    const contradictions = this.contradictions();
    const orphaned = this.orphaned();
    const unevidenced = this.unevidenced({ controls });
    const overclaims = this.overclaims({ now, controls });
    const propagation = this.propagateConfidence({ now, controls });
    const byId = new Map(propagation.assumptions.map((r) => [r.assumption, r]));
    const blockers = [
      ...stale.filter((s) => s.expired).map((s) => `${s.assumption}: expired`),
      ...contradictions.map((c) => `${c.assumptions.join(' vs ')}: contradiction on '${c.subject}'`),
      ...orphaned.map((o) => `${o.assumption}: ${o.reason}`),
      ...propagation.cascaded.map((c) => `${c.assumption}: does not hold because '${c.from}' does not hold`),
    ];
    return {
      assumptions: this.all().map((a) => ({
        ...a,
        assessedConfidence: this.assessConfidence(a.id, { now, controls }).assessed,
        effectiveConfidence: (byId.get(a.id) || {}).effective ?? null,
        verifications: this.verifications(a.id).length,
      })),
      propagation, dependencyGraph: propagation.graph,
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
    criticality: 'foundational',
  });
  add('ASM-0002', {
    statement: 'An investigator\'s session remains pinned for the duration of a case edit.',
    rationale: 'ADR-0007 declares read-your-writes for the investigation context. That guarantee is per session, so it is enforceable only while a session survives the edit it is making.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['investigation'],
    owner: 'Directorate on Corruption and Economic Crime', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'moderate',
    claim: { subject: 'investigator-session-affinity', predicate: 'holds' },
    criticality: 'important',
  });
  add('ASM-0003', {
    statement: 'Analytics dashboards are read within a session rather than by anonymous polling.',
    rationale: 'ADR-0007 declares monotonic-reads for analytics. A reader with no identity cannot hold a per-reader guarantee, so the stance would be describing something that is not happening.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['analytics'],
    owner: 'Data Governance Board', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'low',
    claim: { subject: 'analytics-session-scoped-reads', predicate: 'holds' },
    criticality: 'informational',
  });
  add('ASM-0004', {
    statement: 'Case throughput is a usable proxy for whether citizens can file reports.',
    rationale: 'Recorded when the mission chain validator found the constitutional reporting service reached by no business process. Nothing measures reporting availability directly; a report that cannot be filed never enters the pipeline, so throughput moves. It is a proxy, and a fall has other explanations.',
    evidence: ['APP-FIT-MISSION-IMPACT'], contexts: ['observability', 'intake'],
    owner: 'Service Delivery Board', reviewCadenceDays: 90, expiresAt: at + YEAR,
    verificationMethod: 'operational-observation', confidence: 'low',
    claim: { subject: 'throughput-proxies-reporting-availability', predicate: 'holds' },
    criticality: 'critical',
  });
  add('ASM-0005', {
    statement: 'The synthetic service topology reflects the shape of the production deployment.',
    rationale: 'Chaos experiments, blast radius and the operations twin all reason over the declared topology. If production is shaped differently, every one of those rehearsals rehearses the wrong system.',
    evidence: ['APP-FIT-CHAOS-DETECT-RECOVER'], contexts: ['resilience', 'observability'],
    owner: 'Operations Review Board', reviewCadenceDays: 90, expiresAt: at + YEAR,
    verificationMethod: 'human-attestation', confidence: 'low',
    claim: { subject: 'topology-matches-production', predicate: 'holds' },
    criticality: 'critical',
  });
  add('ASM-0006', {
    statement: 'A fitness identifier names exactly one control, and the control it names is the one it checks.',
    rationale: 'Assurance coverage, RACI control ownership, the enterprise graph and compliance mapping all key on fitness identifiers. If an identifier drifted from what it checks, all four would agree with each other and be wrong together.',
    evidence: ['APP-FIT-RACI-GOVERNANCE', 'APP-FIT-ENTERPRISE-GRAPH'], contexts: ['assurance', 'governance-oversight'],
    owner: 'Architecture Review Board', reviewCadenceDays: 180, expiresAt: at + 2 * YEAR,
    verificationMethod: 'executable-check', confidence: 'moderate',
    claim: { subject: 'fitness-identifier-names-one-control', predicate: 'holds' },
    criticality: 'foundational',
  });
  add('ASM-0007', {
    statement: 'Replica staleness is proportional to sequence lag at roughly one second per sequence.',
    rationale: 'The consistency posture converts sequence lag into a staleness estimate so an operator can decide what to shed during a partition. The constant is a modelling choice, not a measurement.',
    evidence: ['APP-FIT-CONSISTENCY-GOVERNANCE'], contexts: ['persistence'],
    owner: 'Operations Review Board', reviewCadenceDays: 180, expiresAt: at + YEAR,
    verificationMethod: 'unverifiable', confidence: 'low',
    claim: { subject: 'lag-to-staleness-ratio', predicate: 'equals', value: 1000 },
    criticality: 'important',
  });
  add('ASM-0009', {
    statement: 'A custody hand-over is always witnessed by a second person, and the witness is recorded.',
    rationale: 'The custody ledger is append-only and hash-chained, which proves the record was not altered. It cannot prove a second person was present — that is an organisational control the platform can require but not observe.',
    evidence: ['APP-FIT-CUSTODY-SIGNED-CHAIN'], contexts: ['custody'],
    owner: 'Directorate of Forensic Services', reviewCadenceDays: 90, expiresAt: at + YEAR,
    verificationMethod: 'human-attestation', confidence: 'low',
    claim: { subject: 'custody-handover-witnessed', predicate: 'holds' },
    criticality: 'critical',
  });
  add('ASM-0008', {
    statement: 'The platform can continue to meet its requirements with zero runtime dependencies.',
    rationale: 'Zero dependencies is what makes the supply chain auditable and the build reproducible offline. It is an assumption about future requirements, not a property of the current code.',
    evidence: ['APP-FIT-SUPPLY-CHAIN-GOVERNANCE'], contexts: ['assurance', 'supply-chain'],
    owner: 'Architecture Review Board', reviewCadenceDays: 365, expiresAt: at + 2 * YEAR,
    verificationMethod: 'executable-check', confidence: 'moderate',
    claim: { subject: 'zero-runtime-dependencies-sufficient', predicate: 'holds' },
    criticality: 'important',
  });

  // PHASE 14, PART 1: the dependencies between these assumptions, declared after every one exists
  // because they do not form a registration order.
  //
  // The edge worth reading twice is the first one. ASM-0001 is evidenced by two fitness functions,
  // cited by identifier. If ASM-0006 stopped holding — if an identifier no longer named the control
  // it checks — then the evidence for ASM-0001 would resolve to a control that checks something else,
  // and ASM-0001 would be resting on nothing while still reporting itself evidenced. Three of the
  // platform's assumptions are evidentially necessary on ASM-0006, which makes it the single most
  // load-bearing belief in the registry and the one nobody had noticed was load-bearing.
  const depend = (from, on, strength, type, rationale) => registry.declareDependency(from, { on, strength, type, rationale });

  depend('ASM-0001', 'ASM-0006', 'necessary', 'evidential',
    'ASM-0001 is evidenced by APP-FIT-CONTEXT-MAP and APP-FIT-OPERATIONS-TWIN, cited by identifier. If an identifier no longer names the control it checks, that evidence proves something else.');
  depend('ASM-0008', 'ASM-0006', 'necessary', 'evidential',
    'Evidenced by APP-FIT-SUPPLY-CHAIN-GOVERNANCE, cited by identifier. The same reasoning applies.');
  depend('ASM-0005', 'ASM-0001', 'necessary', 'logical',
    'The synthetic topology is built from the declared dependency graph. If dependencies exist that nobody declared, the topology is missing them, so it cannot reflect production whatever else is true of it.');
  depend('ASM-0007', 'ASM-0005', 'supporting', 'operational',
    'The lag-to-staleness constant was chosen against the modelled replication paths. A differently shaped production estate would change those paths, which weakens the constant without invalidating it.');
  depend('ASM-0004', 'ASM-0001', 'supporting', 'evidential',
    'The mission chain traverses declared service dependencies. An undeclared path would mean throughput moves for a reason the model cannot see, which weakens the proxy rather than breaking it.');
  depend('ASM-0002', 'ASM-0006', 'supporting', 'evidential',
    'Session affinity is observed through APP-FIT-CONSISTENCY-GOVERNANCE. Identifier drift would weaken that observation without making the affinity itself untrue.');
  depend('ASM-0003', 'ASM-0002', 'contextual', 'operational',
    'Both rest on reads being session-scoped, but analytics readers and investigators are different populations. Recorded so the pair is read together; nothing propagates.');
  return registry;
}

module.exports = {
  AssumptionRegistry, seedPlatformAssumptions,
  CONFIDENCE_LEVELS, VERIFICATION_METHODS, PREDICATES,
  DEPENDENCY_STRENGTHS, DEPENDENCY_TYPES,
  MATURITY_LEVELS, MATURITY_ORDER, CRITICALITY_LEVELS, CRITICALITY_ORDER,
  confidenceRank, weaker, softened, contradicts,
};
