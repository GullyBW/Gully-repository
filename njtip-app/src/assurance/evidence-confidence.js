'use strict';
// Evidence Confidence Framework (Phase 11, Part 14), the Multi-Dimensional Readiness Model
// (Part 15) and Engineering Metrics Intelligence (Part 16).
//
// The problem this exists to solve: by Phase 10 the platform produced a great deal of evidence,
// and every piece of it was presented as equally trustworthy. A fitness function that ran two
// seconds ago and a configuration file somebody declared last year both rendered as "evidence".
// They are not the same thing, and a board reading a dashboard has no way to tell.
//
// So every piece of evidence now carries its SOURCE, its COMPLETENESS, its FRESHNESS, the METHOD
// used to compute its confidence, and when it was last verified — and the confidence itself is
// COMPUTED. There is no code path that accepts a hand-entered confidence score; supplying one is
// an error, not an override.
const { hash } = require('../twin');

// --- Part 14: evidence confidence ----------------------------------------------------------------

// What kind of thing produced this evidence, and how much that alone is worth. The ordering is the
// argument: something a machine re-derives on every build beats something a person wrote down once.
const SOURCE_KINDS = {
  'executable-check': { weight: 1.00, description: 'A fitness function or test that re-runs on every build.', reVerified: 'every build' },
  'derived-computation': { weight: 0.90, description: 'Computed deterministically from platform state.', reVerified: 'on read' },
  'recorded-decision': { weight: 0.85, description: 'An immutable, hash-chained record of a human decision.', reVerified: 'chain verification' },
  'declared-configuration': { weight: 0.60, description: 'Declared as data and structurally validated, but not exercised.', reVerified: 'on change' },
  'human-attestation': { weight: 0.50, description: 'A named human asserting something no machine can check.', reVerified: 'at the attestation cadence' },
  'external-report': { weight: 0.40, description: 'A third party\'s assertion, accepted on their authority.', reVerified: 'at their cadence' },
  absent: { weight: 0.00, description: 'No evidence at all.', reVerified: 'never' },
};

// Default staleness horizon per source kind: after this, the evidence carries no freshness credit.
const DEFAULT_MAX_AGE_MS = {
  'executable-check': 24 * 3600_000,
  'derived-computation': 24 * 3600_000,
  'recorded-decision': 365 * 24 * 3600_000,
  'declared-configuration': 90 * 24 * 3600_000,
  'human-attestation': 180 * 24 * 3600_000,
  'external-report': 365 * 24 * 3600_000,
  absent: 0,
};

const CONFIDENCE_BANDS = [
  { floor: 0.85, band: 'high', meaning: 'Suitable to base a governance decision on.' },
  { floor: 0.60, band: 'moderate', meaning: 'Usable, but say out loud what it rests on.' },
  { floor: 0.30, band: 'low', meaning: 'Directional only. Do not decide on this alone.' },
  { floor: 0, band: 'unusable', meaning: 'Treat as absent. Absent evidence is safer than evidence you trust wrongly.' },
];

const CONFIDENCE_METHOD = 'sourceWeight × completeness × freshness, where freshness decays linearly from 1 at verification to 0 at the source kind\'s maximum age';

// Assess one piece of evidence. `confidence` may NOT be supplied — that is the whole point.
function assess({ id, source, completeness = 1, verifiedAt = null, now = 0, maxAgeMs = null, detail = null, confidence } = {}) {
  if (confidence !== undefined) {
    const e = new Error('confidence is computed from source, completeness and freshness — it cannot be supplied');
    e.failClosed = true; throw e;
  }
  if (!id) throw new Error('evidence must be identified');
  const kind = SOURCE_KINDS[source];
  if (!kind) throw new Error(`unknown evidence source '${source}'`);
  if (typeof completeness !== 'number' || completeness < 0 || completeness > 1) throw new Error('completeness must be a number in [0, 1]');

  const horizon = maxAgeMs ?? DEFAULT_MAX_AGE_MS[source];
  let freshness;
  let ageMs = null;
  if (source === 'absent') freshness = 0;
  else if (verifiedAt === null) freshness = 0;              // never verified is not fresh
  else {
    ageMs = Math.max(0, now - verifiedAt);
    freshness = horizon <= 0 ? 0 : Math.max(0, Math.min(1, 1 - ageMs / horizon));
  }
  const value = +(kind.weight * completeness * freshness).toFixed(4);
  const banding = CONFIDENCE_BANDS.find((b) => value >= b.floor);
  return {
    id, source, sourceWeight: kind.weight, completeness: +completeness.toFixed(4),
    freshness: +freshness.toFixed(4), ageMs, maxAgeMs: horizon,
    lastVerifiedAt: verifiedAt, verificationCadence: kind.reVerified,
    confidence: value, band: banding.band, bandMeaning: banding.meaning,
    method: CONFIDENCE_METHOD,
    usable: value >= 0.30,
    detail,
    // The calculation is reproducible from the record itself, so a reader can check the number
    // rather than take it.
    calculation: `${kind.weight} × ${+completeness.toFixed(4)} × ${+freshness.toFixed(4)} = ${value}`,
    manualEntry: false,
  };
}

// A register of assessed evidence, aggregated. Aggregate confidence is the WEAKEST link, not the
// average: a conclusion is only as sound as the least trustworthy thing it rests on, and averaging
// is how a single unusable input disappears behind nine good ones.
class EvidenceRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._history = new Map(); }
  record(spec) {
    const at = spec.now ?? this._clock();
    const a = assess({ now: this._clock(), ...spec });
    this._items.set(a.id, a);
    // --- Verification history (Phase 12, Part 14) ---------------------------------------------
    // Each recording is an OBSERVATION, appended. Overwriting the current value and keeping no
    // history is how "confidence 0.91" hides the fact that it was 0.99 four verifications ago.
    if (!this._history.has(a.id)) this._history.set(a.id, []);
    const series = this._history.get(a.id);
    // A re-record at the same assessment instant is the same observation, not a new one. Without
    // this, a caller could manufacture any trend simply by calling record() repeatedly.
    const prior = series[series.length - 1];
    if (!prior || prior.at !== at || prior.verifiedAt !== a.lastVerifiedAt) {
      series.push({ at, verifiedAt: a.lastVerifiedAt, source: a.source, completeness: a.completeness, freshness: a.freshness, confidence: a.confidence, band: a.band });
    }
    return { ...a };
  }
  get(id) { const a = this._items.get(id); return a ? { ...a } : null; }
  all() { return [...this._items.values()].map((a) => ({ ...a })).sort((x, y) => x.confidence - y.confidence || x.id.localeCompare(y.id)); }

  // --- Verification history, trend and provenance (Phase 12, Part 14) ---------------------------

  history(id) { return (this._history.get(id) || []).map((h) => ({ ...h })); }

  // A trend needs at least two observations. One point is a value, not a direction, and reporting
  // "stable" from a single observation would be an assertion nothing supports.
  confidenceTrend(id, { degradingBy = 0.05 } = {}) {
    const series = this.history(id);
    if (series.length < 2) {
      return { id, observations: series.length, direction: 'insufficient-data', delta: null, reason: 'a trend needs at least two verifications — one observation is a value, not a direction' };
    }
    const first = series[0], last = series[series.length - 1];
    const delta = +(last.confidence - first.confidence).toFixed(4);
    // Consecutive falls matter more than the endpoints: evidence that fell, recovered and fell
    // again has a flat delta and a real problem.
    let consecutiveFalls = 0, run = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i].confidence < series[i - 1].confidence) { run += 1; consecutiveFalls = Math.max(consecutiveFalls, run); } else run = 0;
    }
    const direction = delta <= -degradingBy ? 'degrading' : delta >= degradingBy ? 'improving' : 'stable';
    return {
      id, observations: series.length, first: first.confidence, latest: last.confidence, delta, direction,
      consecutiveFalls, bandChanged: first.band !== last.band, fromBand: first.band, toBand: last.band,
      // High-and-falling is the case a band alone cannot show, and it is the one worth acting on.
      warning: direction === 'degrading' || consecutiveFalls >= 2
        ? `confidence in '${id}' has fallen ${consecutiveFalls >= 2 ? `${consecutiveFalls} verifications running` : `by ${Math.abs(delta)}`} — a high band with a falling trend is a control on its way out, not a control that is working`
        : null,
      reason: `${direction} across ${series.length} verifications`,
    };
  }

  // The provenance report Part 14 asks for: where a figure came from, how it was calculated, every
  // time it has been verified, which way it is moving — and, explicitly, what it does not establish.
  provenanceReport(id) {
    const current = this.get(id);
    if (!current) return { id, known: false, reason: 'no evidence with this identifier has ever been recorded — absence of a record is not evidence of anything', authorizes: false };
    const kind = SOURCE_KINDS[current.source];
    const trend = this.confidenceTrend(id);
    const series = this.history(id);
    return {
      id, known: true,
      source: current.source, sourceMeaning: kind.description, sourceWeight: kind.weight,
      reVerifiedWhen: kind.reVerified,
      confidence: current.confidence, band: current.band, bandMeaning: current.bandMeaning,
      completeness: current.completeness, freshness: current.freshness,
      ageMs: current.ageMs, maxAgeMs: current.maxAgeMs, lastVerifiedAt: current.lastVerifiedAt,
      method: CONFIDENCE_METHOD, calculation: current.calculation,
      // Derived values must never be hand-enterable, and the report says so rather than assuming
      // the reader knows.
      manualEntry: false,
      derivationNote: 'Confidence is computed from source kind, completeness and freshness. It cannot be supplied — assess() refuses a caller-provided confidence and fails closed.',
      verificationHistory: series, verifications: series.length,
      trend,
      usable: current.usable,
      authorizes: false,
      establishes: `That this evidence was verified ${series.length} time(s), most recently at ${current.lastVerifiedAt}, and carries ${current.band} confidence under the stated method.`,
      doesNotEstablish: 'That the thing the evidence describes is correct, approved, or authorized. Evidence supports a human decision; it is never one.',
    };
  }

  // Provenance across the whole register, aggregated to the weakest link and naming what is moving
  // in the wrong direction.
  provenance() {
    const ids = [...this._items.keys()].sort();
    const reports = ids.map((id) => this.provenanceReport(id));
    const trends = ids.map((id) => this.confidenceTrend(id));
    const bySource = {};
    for (const r of reports) (bySource[r.source] = bySource[r.source] || []).push(r.id);
    return {
      evidence: reports, count: reports.length,
      aggregate: this.aggregate(),
      bySource,
      degrading: trends.filter((t2) => t2.direction === 'degrading').map((t2) => t2.id),
      untrended: trends.filter((t2) => t2.direction === 'insufficient-data').map((t2) => t2.id),
      warnings: trends.filter((t2) => t2.warning).map((t2) => ({ id: t2.id, warning: t2.warning })),
      digest: this.digest(),
      authorizes: false,
      note: 'Every figure traces to a source kind, a completeness, a freshness and a verification history. A figure that cannot be traced that way does not appear.',
    };
  }
  aggregate(ids = null) {
    const items = (ids ? ids.map((i) => this._items.get(i)).filter(Boolean) : [...this._items.values()]);
    if (!items.length) return { items: 0, confidence: 0, band: 'unusable', weakest: null, reason: 'no evidence recorded — an empty register is not a confident one' };
    const weakest = items.reduce((w, i) => (i.confidence < w.confidence ? i : w));
    const banding = CONFIDENCE_BANDS.find((b) => weakest.confidence >= b.floor);
    return {
      items: items.length, confidence: weakest.confidence, band: banding.band,
      weakest: weakest.id, weakestSource: weakest.source,
      mean: +(items.reduce((a, i) => a + i.confidence, 0) / items.length).toFixed(4),
      unusable: items.filter((i) => !i.usable).map((i) => i.id),
      method: 'weakest-link — a conclusion is only as sound as the least trustworthy evidence under it',
    };
  }
  digest() { return hash.sha256(this.all().map((a) => ({ id: a.id, source: a.source, confidence: a.confidence }))); }
}

// --- Part 15: multi-dimensional readiness ---------------------------------------------------------
//
// Ten INDEPENDENT dimensions. Independence is the point: a single readiness percentage lets a
// strong dimension mask a broken one, and the question a board actually asks is never "how ready
// overall?" but "which of these is not ready, and who owns it?"
//
// AUTHORIZATION STATUS IS NOT A DIMENSION AND IS NEVER DERIVED. Ten green dimensions still print
// NOT AUTHORIZED, because authorization is a recorded human decision and nothing else.
// Each dimension declares the SIGNALS it reads and what each must satisfy. Declaring them beats
// inferring them: a scorer that guesses polarity from a value's shape will eventually read a
// count of zero findings as a score of zero, and be confidently wrong in the safe-looking
// direction. `kind` is one of must-be-true, ratio-at-least, count-at-most.
const t = (field) => ({ field, kind: 'must-be-true' });
const atLeast = (field, threshold) => ({ field, kind: 'ratio-at-least', threshold });
const atMost = (field, threshold) => ({ field, kind: 'count-at-most', threshold });

const READINESS_DIMENSIONS = {
  technical: { title: 'Technical readiness', question: 'Do the architecture and its invariants hold?', owner: 'assurance', evidence: 'fitness', signals: [t('allHold'), atLeast('heldRatio', 1), atMost('failingCount', 0)] },
  security: { title: 'Security readiness', question: 'Is the security posture verified and are findings closed?', owner: 'security', evidence: 'security', signals: [t('policiesCertified'), t('algorithmIndependence'), atMost('credentialFindings', 0)] },
  privacy: { title: 'Privacy readiness', question: 'Do identity minimisation and the anonymity boundary hold?', owner: 'privacy', evidence: 'privacy', signals: [t('identityMinimized'), t('correlationDefaultDeny')] },
  operational: { title: 'Operational readiness', question: 'Can the platform be run, observed and recovered?', owner: 'infrastructure', evidence: 'operations', signals: [atLeast('readinessScore', 1)] },
  reliability: { title: 'Reliability readiness', question: 'Are the service-level objectives met with budget to spare?', owner: 'observability', evidence: 'reliability', signals: [t('allSlosMet'), t('sloHealthy')] },
  data: { title: 'Data readiness', question: 'Is every record traced and is its quality measured?', owner: 'data-fabric', evidence: 'data', signals: [atLeast('tracedRatio', 1), t('qualityAcceptable'), atLeast('qualityReadiness', 0.9)] },
  governance: { title: 'Governance readiness', question: 'Is accountability complete and does nobody approve themselves?', owner: 'governance-oversight', evidence: 'governance', signals: [t('ownershipComplete'), t('noSelfApproval')] },
  legal: { title: 'Legal readiness', question: 'Is every legal mandate implemented by a holding control?', owner: 'legislation', evidence: 'legislation', signals: [atMost('unimplementedMandates', 0), atLeast('mandatesImplementedRatio', 1)] },
  supplyChain: { title: 'Supply-chain readiness', question: 'Is every artifact attested, trusted and license-clean?', owner: 'supply-chain', evidence: 'supplyChain', signals: [t('attestationsVerified'), atMost('thirdPartyCount', 0)] },
  organisational: { title: 'Organisational readiness', question: 'Is somebody available and accountable for every governance object?', owner: 'governance-oversight', evidence: 'continuity', signals: [t('coverageComplete'), t('noStructuralGaps')] },
};

// Each dimension is scored from its declared signals, and carries the CONFIDENCE of the evidence
// alongside the score — a dimension scoring 1.0 on low-confidence evidence is not ready.
function scoreDimension(id, { sources = {}, evidence = null } = {}) {
  const d = READINESS_DIMENSIONS[id];
  if (!d) throw new Error('unknown readiness dimension: ' + id);
  const src = sources[d.evidence];
  const conf = evidence ? evidence.get(`readiness:${id}`) : null;
  const confidence = conf ? conf.confidence : 0;
  if (src === undefined || src === null) {
    return {
      dimension: id, title: d.title, question: d.question, owner: d.owner,
      score: null, ready: false, status: 'no-evidence', confidence,
      confidenceBand: conf ? conf.band : 'unusable', failing: d.signals.map((s) => s.field),
      reason: `no evidence supplied for '${d.evidence}' — a dimension cannot be assessed blind`,
    };
  }
  const evaluated = d.signals.map((s) => {
    const value = src[s.field];
    if (value === undefined || value === null) return { ...s, value: null, met: false, why: 'signal not present in the evidence' };
    if (s.kind === 'must-be-true') return { ...s, value, met: value === true, why: value === true ? 'holds' : 'is not true' };
    if (s.kind === 'ratio-at-least') return { ...s, value, met: typeof value === 'number' && value >= s.threshold, why: `${value} vs ≥ ${s.threshold}` };
    return { ...s, value, met: typeof value === 'number' && value <= s.threshold, why: `${value} vs ≤ ${s.threshold}` };
  });
  const met = evaluated.filter((s) => s.met);
  const score = +(met.length / evaluated.length).toFixed(4);
  const failing = evaluated.filter((s) => !s.met).map((s) => `${s.field} (${s.why})`);
  return {
    dimension: id, title: d.title, question: d.question, owner: d.owner,
    score, signals: evaluated, confidence, confidenceBand: conf ? conf.band : 'unusable',
    // A dimension is ready only when every signal holds AND the evidence behind it is usable.
    ready: score === 1 && confidence >= 0.30,
    status: 'measured', failing,
    reason: score < 1 ? `not ready: ${failing.join('; ')}`
      : confidence < 0.30 ? 'every signal holds, but on evidence too weak to rely on'
        : 'ready',
  };
}

// --- Evidence quality intelligence (Phase 13, Part 14) --------------------------------------------
//
// Phase 11 computed confidence from source, completeness and freshness. Three inputs is enough to
// rank evidence and not enough to say whether it is any good. Five dimensions were missing, and
// they are the ones an auditor asks about:
//
//   Can you reproduce it? Does anything else agree? Is the corroboration independent? Has it been
//   consistent over time? Can you show it has not been altered?
//
// The rule that makes this more than a longer list: CORROBORATION FROM THE SAME SOURCE IS NOT
// CORROBORATION. Two checks that read the same registry agree by construction, and counting them
// as two would make the strongest-looking evidence the most inbred.
const QUALITY_DIMENSIONS = {
  completeness: { description: 'How much of what should be covered is covered.', weakMeans: 'The evidence is about part of the thing.' },
  freshness: { description: 'How recently it was verified, against the horizon for its kind.', weakMeans: 'It was true once.' },
  provenance: { description: 'Whether the chain from source to figure is recorded.', weakMeans: 'Nobody can say where the number came from.' },
  integrity: { description: 'Whether it can be shown not to have been altered since.', weakMeans: 'It could have been edited and nothing would show.' },
  reproducibility: { description: 'Whether re-running the derivation gives the same answer.', weakMeans: 'The figure depends on when or where it was computed.' },
  corroboration: { description: 'Whether anything else supports the same conclusion.', weakMeans: 'One observation, and no way to tell whether it was a fluke.' },
  independence: { description: 'Whether the corroborating evidence comes from a DIFFERENT source kind.', weakMeans: 'Everything agreeing reads the same registry, so agreement proves nothing.' },
  'historical-consistency': { description: 'Whether it has told the same story over successive verifications.', weakMeans: 'It has been volatile, so the current value is not obviously the true one.' },
};

// Assess one piece of evidence across all eight. `corroborators` are other evidence ids the caller
// says support the same conclusion; independence is derived from their SOURCE KINDS, not their count.
function evidenceQuality(register, id, { corroborators = [], now = 0, reproducible = null, integrityVerified = null } = {}) {
  const item = register.get(id);
  if (!item) return { evidence: id, known: false, reason: 'no evidence with this identifier has been recorded — absence of a record is not poor quality, it is no evidence at all' };
  const history = register.history(id);
  const trend = register.confidenceTrend(id);

  const others = corroborators.map((c) => register.get(c)).filter(Boolean);
  const distinctKinds = new Set(others.map((o) => o.source));
  distinctKinds.delete(item.source);

  const dimensions = {
    completeness: { score: item.completeness, basis: 'recorded completeness of the observation' },
    freshness: { score: item.freshness, basis: `age ${item.ageMs ?? 'unknown'} against a ${item.maxAgeMs}ms horizon` },
    provenance: { score: item.source && item.calculation ? 1 : 0, basis: item.calculation ? 'source kind and reproducible calculation are both recorded' : 'the derivation is not recorded' },
    integrity: {
      score: integrityVerified === true ? 1 : integrityVerified === false ? 0 : (item.source === 'recorded-decision' ? 1 : 0),
      basis: integrityVerified === null ? 'not independently checked; hash-chained sources are credited, others are not' : 'explicitly checked',
    },
    reproducibility: {
      score: reproducible === true ? 1 : reproducible === false ? 0 : (['executable-check', 'derived-computation'].includes(item.source) ? 1 : 0),
      basis: reproducible === null ? 'inferred from the source kind: a check that re-runs is reproducible, a human attestation is not' : 'explicitly checked',
    },
    corroboration: { score: others.length ? Math.min(1, others.length / 2) : 0, basis: `${others.length} corroborating item(s)` },
    // THE ONE THAT MATTERS: agreement from the same source kind is agreement by construction.
    independence: { score: distinctKinds.size ? Math.min(1, distinctKinds.size / 2) : 0, basis: distinctKinds.size ? `corroborated by ${distinctKinds.size} different source kind(s)` : 'no corroboration from a different source kind — agreement from the same kind is agreement by construction' },
    'historical-consistency': {
      score: history.length < 2 ? 0 : trend.direction === 'degrading' ? 0.3 : trend.consecutiveFalls >= 2 ? 0.5 : 1,
      basis: history.length < 2 ? 'fewer than two verifications — there is no history to be consistent with' : `${history.length} verifications, ${trend.direction}`,
    },
  };
  for (const [k, d] of Object.entries(dimensions)) { d.dimension = k; d.score = +Number(d.score || 0).toFixed(4); d.description = QUALITY_DIMENSIONS[k].description; d.weakMeans = QUALITY_DIMENSIONS[k].weakMeans; }

  const rows = Object.values(dimensions);
  // Weakest link, as everywhere: evidence is as good as its worst dimension, not its average.
  const weakest = rows.reduce((w, d) => (d.score < w.score ? d : w));
  return {
    evidence: id, known: true, source: item.source, confidence: item.confidence, band: item.band,
    dimensions: rows.sort((a, b) => a.dimension.localeCompare(b.dimension)),
    quality: weakest.score, weakestDimension: weakest.dimension,
    mean: +(rows.reduce((a, d) => a + d.score, 0) / rows.length).toFixed(4),
    corroborators: others.map((o) => ({ id: o.id, source: o.source })),
    independentlyCorroborated: distinctKinds.size > 0,
    // Never replaces a human decision, and says so.
    contributesToReadiness: true, replacesAuthorization: false,
    note: `Quality is the weakest dimension (${weakest.dimension}), not the mean. ${weakest.weakMeans}`,
  };
}

// The dashboard: every recorded item, aggregated to the weakest, with the estate's own weak spots
// named by dimension.
function evidenceQualityDashboard(register, { now = 0, corroboration = {}, threshold = 0.6 } = {}) {
  const ids = register.all().map((e) => e.id);
  const rows = ids.map((id) => evidenceQuality(register, id, { corroborators: corroboration[id] || [], now }));
  const byDimension = {};
  for (const r of rows) {
    for (const d of r.dimensions) {
      const b = (byDimension[d.dimension] = byDimension[d.dimension] || { dimension: d.dimension, description: d.description, scores: [] });
      b.scores.push(d.score);
    }
  }
  for (const b of Object.values(byDimension)) {
    b.weakest = b.scores.length ? Math.min(...b.scores) : null;
    b.mean = b.scores.length ? +(b.scores.reduce((a, x) => a + x, 0) / b.scores.length).toFixed(4) : null;
    delete b.scores;
  }
  const below = rows.filter((r) => r.quality < threshold);
  return {
    evidence: rows, count: rows.length, threshold,
    dimensions: Object.entries(QUALITY_DIMENSIONS).map(([id, d]) => ({ dimension: id, ...d })),
    byDimension: Object.values(byDimension).sort((a, b) => a.weakest - b.weakest || a.dimension.localeCompare(b.dimension)),
    weakestDimension: Object.values(byDimension).sort((a, b) => a.weakest - b.weakest || a.dimension.localeCompare(b.dimension))[0] || null,
    belowThreshold: below.map((r) => ({ evidence: r.evidence, quality: r.quality, weakest: r.weakestDimension })),
    quality: rows.length ? Math.min(...rows.map((r) => r.quality)) : null,
    uncorroborated: rows.filter((r) => !r.independentlyCorroborated).map((r) => r.evidence),
    // The whole point, said out loud on the dashboard rather than in a footnote.
    contributesToReadiness: true, replacesAuthorization: false, authorizes: false,
    sound: rows.length > 0 && below.length === 0,
    note: 'Evidence quality contributes to readiness and never replaces human authorization. Corroboration from the same source kind is not corroboration: two checks reading one registry agree by construction.',
  };
}

// --- Readiness dependency analysis (Phase 12, Part 15) --------------------------------------------
//
// The dimensions stay INDEPENDENT — nothing below changes a score, and no dimension inherits another
// one's verdict. What the graph adds is the sentence a flat list cannot say: "security is ready, and
// it rests on a technical dimension that is not."
//
// A DEPENDENCY GRAPH IS NOT AN AGGREGATION. Rolling an unready prerequisite into the dependent's
// score would recreate exactly the single-number problem the ten dimensions exist to avoid: one
// figure, and no way to see which thing is actually broken. The graph reports the foundation; a
// human reads both.
const DIMENSION_DEPENDENCIES = {
  technical: [],
  organisational: [],
  security: [
    { on: 'technical', because: 'a security claim rests on invariants that hold; if the architecture is not verified, "the policy is certified" describes a policy over something unknown.' },
    { on: 'supplyChain', because: 'an unattested artifact makes every runtime security property a statement about code nobody can identify.' },
  ],
  privacy: [
    { on: 'technical', because: 'identity minimisation is enforced by the invariants; unverified invariants make it an intention.' },
    { on: 'security', because: 'an anonymity boundary that authorization does not hold is not a boundary.' },
  ],
  supplyChain: [
    { on: 'technical', because: 'attestation verification is itself an executable check — it is only worth what the check is worth.' },
  ],
  operational: [
    { on: 'technical', because: 'runbooks and recovery procedures are exercised by the invariant suite; unverified, they are documents.' },
  ],
  reliability: [
    { on: 'operational', because: 'an SLO met on a platform nobody can observe or recover is a measurement without a response.' },
  ],
  data: [
    { on: 'technical', because: 'lineage and quality are derived from platform state; if the state is unverified, so are the figures.' },
    { on: 'organisational', because: 'a dataset with no available steward has quality nobody is accountable for.' },
  ],
  governance: [
    { on: 'organisational', because: 'accountability is complete only if somebody is actually available to exercise it.' },
  ],
  legal: [
    { on: 'governance', because: 'a mandate is implemented by a control, and a control with no accountable owner implements nothing.' },
    { on: 'data', because: 'a legal obligation over records cannot be evidenced from records whose lineage is not traced.' },
  ],
};

// The graph as data, with cycle detection and a layering. A cycle here would be a modelling error:
// two dimensions each waiting on the other can never be reasoned about in an order.
function readinessDependencyGraph() {
  const ids = Object.keys(READINESS_DIMENSIONS).sort();
  const violations = [];
  for (const id of ids) {
    if (!DIMENSION_DEPENDENCIES[id]) { violations.push(`${id}: declares no dependency list — "none" must be stated, not omitted`); continue; }
    for (const dep of DIMENSION_DEPENDENCIES[id]) {
      if (!READINESS_DIMENSIONS[dep.on]) violations.push(`${id}: depends on unknown dimension '${dep.on}'`);
      if (dep.on === id) violations.push(`${id}: depends on itself`);
      if (!dep.because) violations.push(`${id} → ${dep.on}: no stated reason — an unexplained edge is an assumption`);
    }
  }
  // Layering by longest path from a root; a dimension that never settles is in a cycle.
  const depth = new Map();
  const inProgress = new Set();
  const cycles = [];
  const resolve = (id, trail = []) => {
    if (depth.has(id)) return depth.get(id);
    if (inProgress.has(id)) { cycles.push([...trail, id].join(' → ')); return 0; }
    inProgress.add(id);
    const deps = (DIMENSION_DEPENDENCIES[id] || []).filter((d) => READINESS_DIMENSIONS[d.on]);
    const d = deps.length ? 1 + Math.max(...deps.map((x) => resolve(x.on, [...trail, id]))) : 0;
    inProgress.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) resolve(id);
  for (const c of cycles) violations.push(`dependency cycle: ${c}`);
  const dependents = Object.fromEntries(ids.map((id) => [id, ids.filter((x) => (DIMENSION_DEPENDENCIES[x] || []).some((d) => d.on === id))]));
  return {
    nodes: ids.map((id) => ({ dimension: id, title: READINESS_DIMENSIONS[id].title, owner: READINESS_DIMENSIONS[id].owner, layer: depth.get(id), dependsOn: (DIMENSION_DEPENDENCIES[id] || []).map((d) => d.on), dependents: dependents[id] })),
    edges: ids.flatMap((id) => (DIMENSION_DEPENDENCIES[id] || []).map((d) => ({ from: id, to: d.on, because: d.because }))),
    roots: ids.filter((id) => !(DIMENSION_DEPENDENCIES[id] || []).length),
    layers: [...new Set([...depth.values()])].sort((a, b) => a - b).map((l) => ({ layer: l, dimensions: ids.filter((id) => depth.get(id) === l) })),
    acyclic: cycles.length === 0, cycles,
    valid: violations.length === 0, violations,
    note: 'The graph explains what a dimension RESTS ON. It never changes a dimension\'s score — dimensions stay independent, and rolling a prerequisite into a dependent would recreate the single number these ten exist to avoid.',
  };
}

// Overlay the graph on a scored readiness model: which ready dimensions rest on unready ones, and
// which unready dimension is a ROOT CAUSE rather than a symptom.
function readinessDependencyAnalysis({ dimensions = [] } = {}) {
  const graph = readinessDependencyGraph();
  const byId = Object.fromEntries(dimensions.map((d) => [d.dimension, d]));
  const rows = graph.nodes.map((n) => {
    const self = byId[n.dimension] || null;
    const unreadyDeps = n.dependsOn.filter((d) => byId[d] && !byId[d].ready);
    return {
      dimension: n.dimension, layer: n.layer, owner: n.owner,
      ready: self ? self.ready : null,
      dependsOn: n.dependsOn, dependents: n.dependents,
      unreadyDependencies: unreadyDeps,
      // The case worth naming: a green dimension standing on a red one.
      restsOnUnready: (self ? self.ready : false) && unreadyDeps.length > 0,
      // A root cause is unready with every dependency ready — fixing it is what unblocks the rest.
      rootCause: (self ? !self.ready : false) && unreadyDeps.length === 0,
      note: unreadyDeps.length
        ? `rests on ${unreadyDeps.join(', ')}, which ${unreadyDeps.length === 1 ? 'is' : 'are'} not ready`
        : 'every dimension this one rests on is ready',
    };
  });
  return {
    graph, dimensions: rows,
    restingOnUnready: rows.filter((r) => r.restsOnUnready).map((r) => r.dimension),
    rootCauses: rows.filter((r) => r.rootCause).map((r) => r.dimension),
    // Repair order: root causes first, then whatever they unblock. Deterministic by layer then name.
    suggestedOrder: rows.filter((r) => r.ready === false).sort((a, b) => a.layer - b.layer || a.dimension.localeCompare(b.dimension)).map((r) => r.dimension),
    // The graph must not be mistaken for a route to a verdict.
    authorizationStatus: 'NOT AUTHORIZED',
    derivedFromReadiness: false, authorizes: false, informationalOnly: true,
    note: 'Dependencies explain what a dimension rests on and suggest a repair order. They do not change a score, do not produce an overall figure, and cannot reach authorization.',
  };
}

// The readiness model. Ten dimensions, each independent, none aggregated into a single number that
// could be mistaken for permission.
function readinessModel({ sources = {}, evidence = null } = {}) {
  const dimensions = Object.keys(READINESS_DIMENSIONS).map((id) => scoreDimension(id, { sources, evidence }));
  const notReady = dimensions.filter((d) => !d.ready);
  return {
    dimensions,
    dimensionCount: dimensions.length,
    readyCount: dimensions.length - notReady.length,
    notReady: notReady.map((d) => ({ dimension: d.dimension, owner: d.owner, reason: d.reason })),
    allDimensionsReady: notReady.length === 0,
    lowConfidence: dimensions.filter((d) => d.confidence < 0.60).map((d) => d.dimension),
    dependencyAnalysis: readinessDependencyAnalysis({ dimensions }),
    // THE INVARIANT. This string is a constant. Nothing computes it, nothing can flip it, and no
    // combination of green dimensions produces anything else.
    authorizationStatus: 'NOT AUTHORIZED',
    authorizationBasis: 'Authorization is a recorded decision by the approving authority for a specific deployment. It is not derived from readiness, and no number on this page can produce it.',
    derivedFromReadiness: false,
    authorizes: false, informationalOnly: true,
    note: 'Ten independent dimensions. They are deliberately not averaged: a single figure lets a strong dimension mask a broken one, and the question is always which dimension is not ready and who owns it.',
  };
}

// --- Part 16: engineering metrics intelligence -----------------------------------------------------
//
// DORA metrics plus the quality and assurance measures the platform can actually derive. Every
// figure is computed from something countable; nothing is estimated, and an unknown reports as
// null rather than as a plausible number.
const DORA_BANDS = {
  deploymentFrequency: [
    { floor: 1, band: 'elite', label: 'on demand (multiple per day)' },
    { floor: 1 / 7, band: 'high', label: 'between once per day and once per week' },
    { floor: 1 / 30, band: 'medium', label: 'between once per week and once per month' },
    { floor: 0, band: 'low', label: 'less than once per month' },
  ],
  leadTimeHours: [
    { ceiling: 24, band: 'elite', label: 'less than one day' },
    { ceiling: 24 * 7, band: 'high', label: 'less than one week' },
    { ceiling: 24 * 30, band: 'medium', label: 'less than one month' },
    { ceiling: Infinity, band: 'low', label: 'more than one month' },
  ],
  changeFailureRate: [
    { ceiling: 0.05, band: 'elite', label: '0–5%' },
    { ceiling: 0.10, band: 'high', label: '5–10%' },
    { ceiling: 0.15, band: 'medium', label: '10–15%' },
    { ceiling: 1, band: 'low', label: 'above 15%' },
  ],
  mttrHours: [
    { ceiling: 1, band: 'elite', label: 'under an hour' },
    { ceiling: 24, band: 'high', label: 'under a day' },
    { ceiling: 24 * 7, band: 'medium', label: 'under a week' },
    { ceiling: Infinity, band: 'low', label: 'over a week' },
  ],
};
function bandFor(metric, value) {
  if (value === null || value === undefined) return { band: 'unknown', label: 'not measured' };
  const spec = DORA_BANDS[metric];
  if (!spec) throw new Error('unknown DORA metric: ' + metric);
  const hit = spec[0].floor !== undefined
    ? spec.find((b) => value >= b.floor)
    : spec.find((b) => value <= b.ceiling);
  return { band: hit.band, label: hit.label };
}

// Engineering metrics from countable inputs. Anything not supplied is null — never zero, because
// zero is a measurement and null is an admission.
function engineeringMetrics({
  tests = {}, invariants = {}, coverage = null, mutationScore = null,
  deployments = null, windowDays = null, leadTimeHours = null,
  failedDeployments = null, mttdHours = null, mttrHours = null,
  debtTrend = [], riskTrend = [], assuranceTrend = [],
} = {}) {
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const deploymentFrequency = num(deployments) !== null && num(windowDays) ? +(deployments / windowDays).toFixed(4) : null;
  const changeFailureRate = num(failedDeployments) !== null && num(deployments) ? +(failedDeployments / Math.max(1, deployments)).toFixed(4) : null;
  const testTotal = Object.values(tests).reduce((a, b) => a + (num(b) || 0), 0);
  const invariantTotal = Object.values(invariants).reduce((a, b) => a + (num(b) || 0), 0);
  const trend = (series) => {
    if (!Array.isArray(series) || series.length < 2) return { direction: 'insufficient-data', slope: 0, n: series.length || 0 };
    const n = series.length;
    const meanX = (n - 1) / 2;
    const meanY = series.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = i - meanX; sxy += dx * (series[i] - meanY); sxx += dx * dx; }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    return { n, slope: +slope.toFixed(8), first: series[0], latest: series[n - 1], direction: Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'rising' : 'falling' };
  };
  // Phase 12: the six named test types are reported whether or not the caller mentioned them. A
  // type nobody runs must appear as unmeasured rather than simply be absent from the list.
  const byType = Object.fromEntries(Object.keys(TEST_TYPES).map((k) => [k, num(tests[k])]));
  for (const [k, val] of Object.entries(tests)) if (!(k in byType)) byType[k] = num(val);
  const unmeasuredTypes = Object.keys(TEST_TYPES).filter((k) => byType[k] === null);
  return {
    tests: {
      byType, total: testTotal,
      types: Object.entries(TEST_TYPES).map(([id, spec]) => ({ type: id, count: byType[id], ...spec })),
      unmeasuredTypes,
      typeCoverage: +((Object.keys(TEST_TYPES).length - unmeasuredTypes.length) / Object.keys(TEST_TYPES).length).toFixed(4),
    },
    invariants: { byLayer: { ...invariants }, total: invariantTotal },
    coverage: num(coverage), mutationScore: num(mutationScore),
    dora: {
      deploymentFrequency: { perDay: deploymentFrequency, ...bandFor('deploymentFrequency', deploymentFrequency) },
      leadTimeHours: { value: num(leadTimeHours), ...bandFor('leadTimeHours', num(leadTimeHours)) },
      changeFailureRate: { value: changeFailureRate, ...bandFor('changeFailureRate', changeFailureRate) },
      mttrHours: { value: num(mttrHours), ...bandFor('mttrHours', num(mttrHours)) },
    },
    mttdHours: num(mttdHours),
    trends: {
      // Falling debt and risk are improvements; rising assurance is. The polarity is stated so a
      // direction is never read the wrong way round.
      technicalDebt: { ...trend(debtTrend), better: 'falling' },
      risk: { ...trend(riskTrend), better: 'falling' },
      assurance: { ...trend(assuranceTrend), better: 'rising' },
    },
    unmeasured: Object.entries({ coverage: num(coverage), mutationScore: num(mutationScore), deploymentFrequency, leadTimeHours: num(leadTimeHours), changeFailureRate, mttdHours: num(mttdHours), mttrHours: num(mttrHours) })
      .filter(([, v]) => v === null).map(([k]) => k),
    informationalOnly: true, authorizes: false,
    note: 'Every figure is computed from something countable. An unmeasured metric reports null, because zero is a measurement and null is an admission.',
  };
}

// Engineering maturity, banded from the metrics rather than asserted. An unmeasured metric cannot
// contribute to a maturity level — that is how maturity models usually inflate.
const MATURITY_LEVELS = [
  { level: 5, name: 'Optimising', requires: 'Elite DORA bands, mutation testing in place, and debt and risk both falling.' },
  { level: 4, name: 'Measured', requires: 'Every DORA metric measured, coverage and mutation score known.' },
  { level: 3, name: 'Automated', requires: 'Deployment frequency and change failure rate measured; invariants enforced in CI.' },
  { level: 2, name: 'Instrumented', requires: 'Tests and invariants counted by type and layer.' },
  { level: 1, name: 'Initial', requires: 'Something is measured.' },
];
function maturity(metrics) {
  const m = metrics;
  const measured = (x) => x !== null && x !== undefined;
  const doraAll = ['deploymentFrequency', 'leadTimeHours', 'changeFailureRate', 'mttrHours']
    .every((k) => measured(k === 'deploymentFrequency' ? m.dora.deploymentFrequency.perDay : m.dora[k].value));
  const eliteAll = ['deploymentFrequency', 'leadTimeHours', 'changeFailureRate', 'mttrHours'].every((k) => m.dora[k].band === 'elite');
  const reasons = [];
  let level = 0;
  if (m.tests.total > 0 || m.invariants.total > 0) level = 1; else reasons.push('nothing is measured');
  if (level >= 1 && m.tests.total > 0 && m.invariants.total > 0) level = 2; else if (level >= 1) reasons.push('tests or invariants are not counted');
  if (level >= 2 && measured(m.dora.deploymentFrequency.perDay) && measured(m.dora.changeFailureRate.value)) level = 3; else if (level >= 2) reasons.push('deployment frequency or change failure rate is not measured');
  if (level >= 3 && doraAll && measured(m.coverage) && measured(m.mutationScore)) level = 4; else if (level >= 3) reasons.push('a DORA metric, coverage or the mutation score is unmeasured');
  if (level >= 4 && eliteAll && m.trends.technicalDebt.direction === 'falling' && m.trends.risk.direction === 'falling') level = 5; else if (level >= 4) reasons.push('DORA bands are not all elite, or debt and risk are not both falling');
  const spec = MATURITY_LEVELS.find((x) => x.level === level) || { level: 0, name: 'Unmeasured', requires: '—' };
  return {
    level, name: spec.name, requires: spec.requires,
    blockedBy: reasons, levels: MATURITY_LEVELS.map((x) => ({ ...x })),
    note: 'Maturity is banded from measured metrics. An unmeasured metric cannot raise a level — that is how maturity models usually inflate.',
    authorizes: false,
  };
}

// --- Engineering intelligence (Phase 12, Part 16) --------------------------------------------------
//
// Phase 11 counted tests by whatever keys the caller passed. That makes the breakdown a description
// of what somebody chose to report rather than of what the platform actually verifies — and the
// gap between them is invisible. The six types below are NAMED, each with what it proves, so a type
// nobody runs is reported as unmeasured instead of simply not appearing.
const TEST_TYPES = {
  unit: { proves: 'A single unit behaves as specified in isolation.', missingMeans: 'Defects are found later, by something slower.' },
  integration: { proves: 'Components agree across a boundary inside the platform.', missingMeans: 'Each part works and the assembly does not.' },
  contract: { proves: 'A published interface still satisfies what its consumers depend on.', missingMeans: 'A consumer discovers the breakage in production.' },
  resilience: { proves: 'The platform degrades and recovers as designed under failure.', missingMeans: 'Recovery is a plan rather than a demonstrated property.' },
  chaos: { proves: 'A fault is DETECTED, contained, recovered and verified — not merely survived.', missingMeans: 'Silent survival is mistaken for resilience.' },
  policy: { proves: 'Authorization and governance rules hold over their whole input domain.', missingMeans: 'A rule is checked on the cases somebody thought of.' },
};

// Assurance coverage: what fraction of the declared controls has an EXECUTABLE check behind it.
// A control with a documented procedure and no check is not covered — that is the whole distinction
// this figure exists to draw.
function assuranceCoverage({ controls = [], executableCheckIds = [] } = {}) {
  const checks = new Set(executableCheckIds);
  const rows = controls.map((c) => {
    const id = typeof c === 'string' ? c : c.id;
    const verifiedBy = (typeof c === 'object' && Array.isArray(c.verifiedBy)) ? c.verifiedBy : [id];
    const holding = verifiedBy.filter((x) => checks.has(x));
    return { control: id, verifiedBy, holdingChecks: holding, covered: holding.length > 0, reason: holding.length ? `verified by ${holding.join(', ')}` : 'no executable check verifies this control — a documented procedure is not a control' };
  });
  const covered = rows.filter((r) => r.covered);
  return {
    controls: rows, total: rows.length, covered: covered.length,
    coverage: rows.length ? +(covered.length / rows.length).toFixed(4) : null,
    uncovered: rows.filter((r) => !r.covered).map((r) => r.control),
    // No controls declared is not full coverage. It is nothing to cover, and it must not read as 1.
    reason: rows.length === 0 ? 'no controls declared — coverage is undefined, not complete' : `${covered.length} of ${rows.length} controls have an executable check behind them`,
    complete: rows.length > 0 && covered.length === rows.length,
  };
}

// Governance maturity, from the governance evidence rather than from a self-assessment. Each level
// names what it needs; an unmeasured input cannot raise a level, exactly as in engineering maturity.
const GOVERNANCE_MATURITY_LEVELS = [
  { level: 5, name: 'Continuously assured', requires: 'Every control covered by an executable check, active ownership complete, and the ADR catalogue sound.' },
  { level: 4, name: 'Owned', requires: 'Active ownership complete — available, current and certified — with no structural gaps.' },
  { level: 3, name: 'Verified', requires: 'Assurance coverage measured and above 0.9.' },
  { level: 2, name: 'Recorded', requires: 'Ownership recorded and the ADR catalogue valid.' },
  { level: 1, name: 'Declared', requires: 'Controls and owners are declared somewhere.' },
];
function governanceMaturity({ assurance = null, activeOwnershipComplete = null, structuralGaps = null, adrCatalogueValid = null, adrCatalogueSound = null, controlsDeclared = null } = {}) {
  const reasons = [];
  let level = 0;
  const known = (x) => x !== null && x !== undefined;
  if (controlsDeclared) level = 1; else reasons.push('no controls are declared');
  if (level >= 1 && adrCatalogueValid === true) level = 2; else if (level >= 1) reasons.push(known(adrCatalogueValid) ? 'the ADR catalogue is not valid' : 'ADR catalogue validity is unmeasured');
  if (level >= 2 && assurance && known(assurance.coverage) && assurance.coverage >= 0.9) level = 3;
  else if (level >= 2) reasons.push(assurance && known(assurance.coverage) ? `assurance coverage ${assurance.coverage} is below 0.9` : 'assurance coverage is unmeasured');
  if (level >= 3 && activeOwnershipComplete === true && structuralGaps === 0) level = 4;
  else if (level >= 3) reasons.push(known(activeOwnershipComplete) ? 'active ownership is incomplete or structurally gapped' : 'active ownership is unmeasured');
  if (level >= 4 && assurance && assurance.complete === true && adrCatalogueSound === true) level = 5;
  else if (level >= 4) reasons.push('not every control has an executable check, or the ADR catalogue is not sound');
  const spec = GOVERNANCE_MATURITY_LEVELS.find((x) => x.level === level) || { level: 0, name: 'Unmeasured', requires: '—' };
  return {
    level, name: spec.name, requires: spec.requires, blockedBy: reasons,
    levels: GOVERNANCE_MATURITY_LEVELS.map((x) => ({ ...x })),
    note: 'Banded from governance evidence, not from a self-assessment. An unmeasured input cannot raise a level.',
    authorizes: false,
  };
}

// Historical dashboard. Snapshots are supplied by the caller — this module does not own a clock or
// a store — and are sorted and de-duplicated by their period label so a series cannot be padded.
function engineeringHistory({ snapshots = [] } = {}) {
  const byPeriod = new Map();
  for (const s of snapshots) {
    if (!s || !s.period) throw new Error('every engineering snapshot must carry a period label');
    byPeriod.set(s.period, { ...s });
  }
  const series = [...byPeriod.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const track = ['coverage', 'mutationScore', 'testTotal', 'invariantTotal', 'changeFailureRate', 'mttrHours', 'assuranceCoverage'];
  const metrics = {};
  for (const key of track) {
    const points = series.map((s) => ({ period: s.period, value: typeof s[key] === 'number' ? s[key] : null }));
    const measured = points.filter((p) => p.value !== null);
    metrics[key] = {
      points, measuredPeriods: measured.length,
      first: measured.length ? measured[0].value : null,
      latest: measured.length ? measured[measured.length - 1].value : null,
      delta: measured.length >= 2 ? +(measured[measured.length - 1].value - measured[0].value).toFixed(6) : null,
      // A gap in a series is a gap, not a flat line. Interpolating would invent measurements.
      gaps: points.filter((p) => p.value === null).map((p) => p.period),
      direction: measured.length < 2 ? 'insufficient-data'
        : measured[measured.length - 1].value > measured[0].value ? 'rising'
          : measured[measured.length - 1].value < measured[0].value ? 'falling' : 'flat',
    };
  }
  return {
    periods: series.map((s) => s.period), snapshots: series.length, metrics,
    // Reported so a reader knows how much of the picture is actually there.
    completeness: series.length ? +(track.reduce((a, k) => a + metrics[k].measuredPeriods, 0) / (track.length * series.length)).toFixed(4) : 0,
    informationalOnly: true, authorizes: false,
    note: 'History is what was recorded. A period with no measurement is shown as a gap; interpolating one would invent a measurement nobody took.',
  };
}

// Predictive engineering report: where each tracked metric is heading, and when it crosses a target
// if the current direction holds. An unprojectable metric reports `unknown` — never a comfortable
// default.
function engineeringForecast({ history = null, targets = {}, periodsAhead = 3 } = {}) {
  const h = history || engineeringHistory({ snapshots: [] });
  const defaults = { coverage: 0.9, mutationScore: 0.8, changeFailureRate: 0.05, mttrHours: 1, assuranceCoverage: 1 };
  const higherIsBetter = { coverage: true, mutationScore: true, testTotal: true, invariantTotal: true, assuranceCoverage: true, changeFailureRate: false, mttrHours: false };
  const rows = Object.entries(h.metrics).map(([metric, m]) => {
    const measured = m.points.filter((p) => p.value !== null).map((p) => p.value);
    if (measured.length < 2) {
      return { metric, projectable: false, direction: 'unknown', projected: null, target: targets[metric] ?? defaults[metric] ?? null, periodsToTarget: null, reason: `only ${measured.length} measured period(s) — a projection from fewer than two points is a guess with a decimal point` };
    }
    const n = measured.length, meanX = (n - 1) / 2, meanY = measured.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = i - meanX; sxy += dx * (measured[i] - meanY); sxx += dx * dx; }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const latest = measured[n - 1];
    const projected = +(latest + slope * periodsAhead).toFixed(6);
    const target = targets[metric] ?? defaults[metric] ?? null;
    const better = higherIsBetter[metric];
    let periodsToTarget = null;
    if (target !== null && slope !== 0) {
      const p = (target - latest) / slope;
      periodsToTarget = p > 0 ? +p.toFixed(2) : null;   // already past it, or moving away
    }
    const meetsTarget = target === null ? null : better === false ? latest <= target : latest >= target;
    return {
      metric, projectable: true, slope: +slope.toFixed(6), latest, projected, periodsAhead,
      target, higherIsBetter: better ?? null, meetsTarget,
      direction: Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'rising' : 'falling',
      improving: better === undefined || better === null ? null : (better ? slope > 0 : slope < 0),
      periodsToTarget,
      reason: meetsTarget === true ? 'already at or past target'
        : periodsToTarget !== null ? `on the current trend, ${periodsToTarget} period(s) to target`
          : 'not moving toward the target on the current trend',
    };
  });
  const regressing = rows.filter((r) => r.projectable && r.improving === false);
  return {
    metrics: rows, periodsAhead,
    unprojectable: rows.filter((r) => !r.projectable).map((r) => r.metric),
    regressing: regressing.map((r) => r.metric),
    offTarget: rows.filter((r) => r.meetsTarget === false).map((r) => r.metric),
    // The forecast never says "healthy". It says what is measured and which way it is going.
    healthyClaim: null,
    informationalOnly: true, authorizes: false,
    note: 'A projection is a statement about the trend, not about the future. An unprojectable metric reports unknown rather than a comfortable default, and no projection can produce an authorization.',
  };
}

function validate() {
  const violations = [];
  // Confidence must be computable, weighted, and refuse manual entry.
  for (const [id, k] of Object.entries(SOURCE_KINDS)) {
    if (typeof k.weight !== 'number' || k.weight < 0 || k.weight > 1) violations.push(`source kind '${id}': weight out of range`);
    if (!k.description || !k.reVerified) violations.push(`source kind '${id}': incompletely specified`);
    if (DEFAULT_MAX_AGE_MS[id] === undefined) violations.push(`source kind '${id}': no staleness horizon`);
  }
  if (!(SOURCE_KINDS['executable-check'].weight > SOURCE_KINDS['human-attestation'].weight)) {
    violations.push('an executable check does not outweigh a human attestation');
  }
  if (SOURCE_KINDS.absent.weight !== 0) violations.push('absent evidence carries non-zero weight');
  // The readiness model must have ten independent dimensions, each owned and evidence-backed.
  const dims = Object.entries(READINESS_DIMENSIONS);
  if (dims.length !== 10) violations.push(`the readiness model has ${dims.length} dimensions, not 10`);
  for (const [id, d] of dims) {
    for (const f of ['title', 'question', 'owner', 'evidence']) if (!d[f]) violations.push(`readiness dimension '${id}': missing ${f}`);
    if (!Array.isArray(d.signals) || !d.signals.length) violations.push(`readiness dimension '${id}': declares no signals — it could only be scored by guessing`);
    for (const s of d.signals || []) {
      if (!s.field) violations.push(`readiness dimension '${id}': a signal names no field`);
      if (!['must-be-true', 'ratio-at-least', 'count-at-most'].includes(s.kind)) violations.push(`readiness dimension '${id}': signal '${s.field}' has an unknown kind`);
      if (s.kind !== 'must-be-true' && typeof s.threshold !== 'number') violations.push(`readiness dimension '${id}': signal '${s.field}' has no threshold`);
    }
  }
  if (READINESS_DIMENSIONS.authorization) violations.push('authorization is modelled as a readiness dimension — it must never be one');
  return { valid: violations.length === 0, violations, sourceKinds: Object.keys(SOURCE_KINDS).length, dimensions: dims.length };
}

function report({ sources = {}, evidence = null, metrics = {} } = {}) {
  const em = engineeringMetrics(metrics);
  return {
    sourceKinds: Object.entries(SOURCE_KINDS).map(([id, k]) => ({ id, ...k, maxAgeMs: DEFAULT_MAX_AGE_MS[id] })),
    confidenceBands: CONFIDENCE_BANDS.map((b) => ({ ...b })),
    confidenceMethod: CONFIDENCE_METHOD,
    evidence: evidence ? evidence.all() : [],
    aggregateConfidence: evidence ? evidence.aggregate() : null,
    readiness: readinessModel({ sources, evidence }),
    engineering: em, maturity: maturity(em),
    validation: validate(),
    informationalOnly: true, authorizes: false,
    note: 'Confidence is computed, never entered. Readiness is multi-dimensional and never aggregated into permission. The platform reports NOT AUTHORIZED.',
  };
}

// --- Statistical confidence evolution (Phase 15, Part 10) -----------------------------------------
//
// Phase 14 put an interval on every governance forecast, computed from the observation count. Part 10
// asks for the same discipline where the estimates actually live, and for one more thing: an estimate
// should get STRONGER as evidence accumulates, and the reader should be able to see that happening.
//
// Two distinctions carry this module, and both are ones the platform makes everywhere else:
//
//   UNKNOWN IS NOT LOW. `low` means the evidence is thin and points somewhere. `unknown` means there
//   is no evidence at all and the estimate points nowhere. A dashboard that renders them the same
//   colour has told a board that "we looked and it is bad" and "we never looked" are the same
//   situation, and they need opposite responses.
//
//   AN INTERVAL IS A CLAIM ABOUT THE EVIDENCE, NOT ABOUT THE ANSWER. It is computed only from the
//   sample size, is deliberately coarse, and says on every row that it is not a statistical
//   confidence interval — because this platform does not have the sample sizes for one and printing
//   a narrow band it cannot support would be worse than printing nothing.
const ESTIMATE_STATES = {
  unknown: { usable: false, means: 'No observations at all. The estimate points nowhere, which is different from pointing somewhere bad.' },
  provisional: { usable: false, means: 'Fewer than three observations. A reading, not a rate.' },
  indicative: { usable: true, means: 'Enough observations for a direction, not enough for a number to be quoted.' },
  established: { usable: true, means: 'Enough observations that the interval constrains the answer.' },
};
const ESTABLISHED_FROM = 17;   // where the 1/√n half-width first falls below a quarter of the scale
const INDICATIVE_FROM = 3;

// The canonical interval. Half-width 1/√n, capped at [0,1]. Deliberately coarse and honest about it.
function interval(point, observations) {
  if (point === null || point === undefined) {
    return { point: null, interval: null, halfWidth: null, method: 'no point estimate could be derived, so no interval is offered — an interval around nothing is a picture of nothing' };
  }
  if (!observations) {
    return { point, interval: [0, 1], halfWidth: 1, method: 'no observations: the evidence does not constrain this figure at all, and the interval says so rather than flattering the estimate' };
  }
  const half = Math.min(1, 1 / Math.sqrt(observations));
  return {
    point: +point.toFixed(4),
    interval: [+Math.max(0, point - half).toFixed(4), +Math.min(1, point + half).toFixed(4)],
    halfWidth: +half.toFixed(4),
    method: `half-width 1/√${observations} = ${half.toFixed(4)}. A coarse standard-error analogue over the observation count, NOT a statistical confidence interval — this platform has too few observations for one and says so rather than printing a narrow band it cannot support.`,
  };
}

// An estimate that carries everything Part 10 requires, so a reader can decide whether to use it
// without going and finding the sample.
function statisticalEstimate({ subject, successes = null, observations = 0, quality = null, history = [], limitations = [] } = {}) {
  if (!subject) throw new Error('an estimate must name what it is an estimate of');
  const n = Number(observations) || 0;
  const point = n > 0 && successes !== null && successes !== undefined ? successes / n : null;
  const band = interval(point, n);
  const state = n === 0 ? 'unknown' : n < INDICATIVE_FROM ? 'provisional' : n < ESTABLISHED_FROM ? 'indicative' : 'established';

  // Historical stability: how much the estimate has moved across the supplied history. Volatility is
  // reported rather than smoothed, because a figure that swings is a different thing from one that
  // sits still, even when their averages match.
  let stability = null;
  if (history.length >= 2) {
    const deltas = history.slice(1).map((h, i) => Math.abs(h - history[i]));
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    stability = {
      observations: history.length, meanAbsoluteChange: +mean.toFixed(4),
      range: [+Math.min(...history).toFixed(4), +Math.max(...history).toFixed(4)],
      stable: mean < 0.05,
      reason: mean < 0.05 ? 'the estimate has moved little across the recorded history' : `the estimate has moved by ${mean.toFixed(3)} on average between periods — a volatile figure and a steady one at the same level are not the same evidence`,
    };
  }

  return {
    subject, ...band,
    sampleSize: n, successes,
    state, ...ESTIMATE_STATES[state],
    // Evidence quality is the caller's assessment from `evidenceQuality()`; absent, it is unknown
    // rather than assumed adequate.
    evidenceQuality: quality ? { band: quality.band ?? null, weakest: quality.weakestDimension ?? null, sound: quality.sound ?? null } : null,
    qualityAssessed: quality !== null && quality !== undefined,
    historicalStability: stability,
    // Stated on every estimate, so a reader never has to go and find out what it does not cover.
    statisticalLimitations: [
      'The interval is a function of the sample size alone. It says nothing about whether the sample is representative.',
      'It is not a statistical confidence interval, and no significance is claimed or implied.',
      ...(n === 0 ? ['There are no observations. The point estimate is null and the interval spans the whole range.'] : []),
      ...(n > 0 && n < INDICATIVE_FROM ? [`${n} observation(s) is a reading rather than a rate.`] : []),
      ...(stability && !stability.stable ? ['The estimate is volatile across the recorded history; the current value is not a settled one.'] : []),
      ...(!quality ? ['Evidence quality was not assessed, so how good the observations are is unknown.'] : []),
      ...limitations,
    ],
    // The sentence a reader needs when the estimate is null.
    reason: state === 'unknown'
      ? `no observation of '${subject}' has been recorded. UNKNOWN is not a low estimate — it is the absence of one, and the two need opposite responses.`
      : `${successes} of ${n} observations; the interval reflects the sample size and nothing else.`,
    informationalOnly: true, authorizes: false,
  };
}

// How an estimate has evolved as evidence accumulated. The point of Part 10: a reader should be able
// to see it getting stronger, or see that it is not.
function confidenceEvolution({ subject, snapshots = [] } = {}) {
  if (snapshots.length < 2) {
    return { subject, snapshots: snapshots.length, direction: 'insufficient-data', reason: 'an evolution needs at least two snapshots; one is a reading' };
  }
  const rows = snapshots.map((s) => statisticalEstimate({ subject, successes: s.successes, observations: s.observations }));
  const first = rows[0], last = rows[rows.length - 1];
  const narrowed = last.halfWidth !== null && first.halfWidth !== null && last.halfWidth < first.halfWidth;
  return {
    subject, snapshots: rows.length, estimates: rows,
    sampleGrowth: [first.sampleSize, last.sampleSize],
    firstHalfWidth: first.halfWidth, lastHalfWidth: last.halfWidth,
    // The thing Part 10 asks to be visible.
    strengthening: narrowed,
    stateChange: `${first.state} → ${last.state}`,
    direction: narrowed ? 'strengthening' : last.halfWidth === first.halfWidth ? 'flat' : 'weakening',
    reason: narrowed
      ? `the interval narrowed from ±${first.halfWidth} to ±${last.halfWidth} as the sample grew from ${first.sampleSize} to ${last.sampleSize}`
      : last.sampleSize < first.sampleSize
        ? 'the sample shrank, so the estimate is weaker than it was — evidence can be lost as well as gained'
        : 'the sample did not grow, so the estimate is no better supported than it was',
    informationalOnly: true, authorizes: false,
  };
}

// --- Verified improvement (Phase 17, Part 1) --------------------------------------------------------
//
// The primitive the rest of Phase 17 is built on, and it exists because of one observation:
//
//   THERE ARE THREE WAYS A GOVERNANCE FIGURE RISES AND ONLY ONE OF THEM IS PROGRESS.
//     1. The institution did something, and there is evidence of it.
//     2. The way the figure is computed changed.
//     3. Nobody knows.
//
// Sixteen phases of dashboards report the number and cannot tell the three apart. A maturity level
// that went from L1 to L3 because a domain was reassessed looks exactly like one that rose because
// people were trained — and the second is worth celebrating while the first is worth investigating.
//
// So every trend in this phase routes through this one function, and a rise with nothing
// independently verified behind it is recorded as a VIOLATION of the phase invariant rather than as
// good news. That is the whole idea: unearned credit is a finding.
const IMPROVEMENT_STATES = {
  unknown: {
    improved: false, verified: false, violatesInvariant: false,
    means: 'Fewer than two observations. Nothing has been compared, so nothing has improved or regressed as far as anybody can tell.',
  },
  regressed: {
    improved: false, verified: false, violatesInvariant: false,
    means: 'The figure moved against the declared direction. That is a different problem, reported elsewhere — this invariant is about unearned credit, so it never blocks on this invariant.',
  },
  steady: {
    improved: false, verified: false, violatesInvariant: false,
    means: 'The figure moved by less than the declared tolerance. Noise is not a direction.',
  },
  'unverified-improvement': {
    improved: true, verified: false, violatesInvariant: true,
    means: 'The figure rose and nothing independently verified supports the rise. This is a finding, not good news.',
  },
  'verified-improvement': {
    improved: true, verified: true, violatesInvariant: false,
    means: 'The figure rose and something independent — an observed outcome, an independent verification, or a recorded act — supports the rise.',
  },
};

// How much movement counts as movement. Declared rather than implicit, so it can be argued with.
const IMPROVEMENT_TOLERANCE = 0.02;

// What can support a rise, and what merely explains one. The distinction is the point: a
// self-assessment and a measurement change are both real information and neither is evidence that
// anything got better.
const IMPROVEMENT_EVIDENCE_KINDS = {
  'observed-outcome': { independent: true, means: 'Something was recorded as having happened, by somebody other than the party the figure is about.' },
  'independent-verification': { independent: true, means: 'A party independent of the owner examined the thing and recorded a conclusion.' },
  'recorded-act': { independent: true, means: 'A governance act was performed and recorded — a training completed, a review held, a control rebuilt.' },
  'self-assessment': { independent: false, means: 'The party the figure is about says it improved. That is the claim under examination, not evidence for it.' },
  'measurement-change': { independent: false, means: 'The way the figure is computed changed. This EXPLAINS a rise and is the opposite of supporting it.' },
};

function verifiedImprovement({
  subject = 'unnamed figure', series = [], evidence = [],
  tolerance = IMPROVEMENT_TOLERANCE, higherIsBetter = true,
} = {}) {
  const points = (Array.isArray(series) ? series : []).filter((x) => Number.isFinite(x));
  const supporting = evidence.filter((e) => e && IMPROVEMENT_EVIDENCE_KINDS[e.kind] && IMPROVEMENT_EVIDENCE_KINDS[e.kind].independent);
  const measurementChanges = evidence.filter((e) => e && e.kind === 'measurement-change');

  if (points.length < 2) {
    return {
      subject, state: 'unknown', ...IMPROVEMENT_STATES.unknown,
      from: points[0] ?? null, to: points[points.length - 1] ?? null, delta: null,
      observations: points.length, tolerance, higherIsBetter,
      supportingEvidence: supporting.map((e) => ({ kind: e.kind, detail: e.detail || null, by: e.by || null })),
      measurementChanges: measurementChanges.map((e) => ({ kind: e.kind, detail: e.detail || null })),
      reason: `${subject} has ${points.length} observation(s); at least two are needed before anything can be said to have moved`,
      informationalOnly: true, authorizes: false,
    };
  }

  const from = points[0];
  const to = points[points.length - 1];
  const delta = +(to - from).toFixed(6);
  const moved = Math.abs(delta) > tolerance;
  const rose = higherIsBetter ? delta > 0 : delta < 0;

  const state = !moved ? 'steady'
    : !rose ? 'regressed'
      : supporting.length ? 'verified-improvement' : 'unverified-improvement';

  return {
    subject, state, ...IMPROVEMENT_STATES[state],
    from, to, delta, observations: points.length, tolerance, higherIsBetter,
    supportingEvidence: supporting.map((e) => ({ kind: e.kind, detail: e.detail || null, by: e.by || null })),
    measurementChanges: measurementChanges.map((e) => ({ kind: e.kind, detail: e.detail || null })),
    reason: state === 'verified-improvement'
      ? `${subject} rose from ${from} to ${to}, supported by ${supporting.length} independently verified item(s): ${supporting.map((e) => e.kind).join(', ')}`
      : state === 'unverified-improvement'
        ? `${subject} rose from ${from} to ${to} and NOTHING independently verified supports the rise${measurementChanges.length ? `; the way it is computed also changed (${measurementChanges.map((e) => e.detail || 'unspecified').join('; ')})` : ''}`
        : state === 'regressed' ? `${subject} moved from ${from} to ${to}, against the declared direction`
          : `${subject} moved from ${from} to ${to}, within the declared tolerance of ${tolerance}`,
    informationalOnly: true, authorizes: false,
  };
}

// A whole set of trends, with the invariant's verdict over them.
function improvementReport({ trends = [], now = 0 } = {}) {
  const rows = trends.map((t) => verifiedImprovement(t));
  const unverified = rows.filter((r) => r.violatesInvariant);
  return {
    trends: rows, count: rows.length,
    states: Object.entries(IMPROVEMENT_STATES).map(([state, s]) => ({ state, ...s })),
    evidenceKinds: Object.entries(IMPROVEMENT_EVIDENCE_KINDS).map(([kind, k]) => ({ kind, ...k })),
    tolerance: IMPROVEMENT_TOLERANCE,
    verifiedImprovements: rows.filter((r) => r.state === 'verified-improvement').map((r) => r.subject),
    unverifiedImprovements: unverified.map((r) => ({ subject: r.subject, delta: r.delta, reason: r.reason })),
    regressions: rows.filter((r) => r.state === 'regressed').map((r) => r.subject),
    unknown: rows.filter((r) => r.state === 'unknown').map((r) => r.subject),
    // THE PHASE 17 RULE, computed rather than promised. One unverified rise among twenty is a
    // violation: this aggregates to the weakest link, never to the mean.
    everyImprovementVerified: unverified.length === 0,
    violationCount: unverified.length,
    basis: rows.length
      ? `${rows.filter((r) => r.state === 'verified-improvement').length} verified improvement(s), ${unverified.length} unverified, ${rows.filter((r) => r.state === 'regressed').length} regression(s), ${rows.filter((r) => r.state === 'unknown').length} with too few observations to say.`
      : 'no trend was supplied, so nothing has improved or regressed as far as this report knows',
    now, informationalOnly: true, authorizes: false,
    note: 'There are three ways a governance figure rises and only one is progress: the institution did something and there is evidence; the measurement changed; or nobody knows. An improvement with no independently verified evidence behind it is reported as UNVERIFIED-IMPROVEMENT — a finding, not good news.',
  };
}

// --- Evidence quality evolution (Phase 17, Part 16) ------------------------------------------------
//
// `evidenceQualityDashboard` reports the corpus as it stands. Part 16 asks whether it is getting
// better — and there is a specific way this figure rises without anybody improving anything:
//
//   EVIDENCE CAN BE REMOVED. Drop the weakest items and mean quality rises. Every other trend in
//   this platform is about a figure moving; this one also has to watch the DENOMINATOR, because a
//   corpus that shrank and got better is a corpus somebody edited.
//
// So each snapshot carries its own size, a shrinking corpus is named, and a rise that coincides with
// one is fed to `verifiedImprovement` as a measurement change — which is exactly what it is.
function evidenceQualityEvolution({ snapshots = [], evidence = [], now = 0 } = {}) {
  const dimensions = Object.keys(QUALITY_DIMENSIONS);
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      snapshots: snapshots.length, dimensions: [], count: 0, measurable: false,
      corpusGrowth: null, corpusShrank: null, corpusSizes: [],
      improving: [], unverifiedImprovements: [], regressing: [], unknown: [],
      everyImprovementVerified: true,
      basis: `${snapshots.length} snapshot(s) supplied; at least two are needed before any quality trend exists`,
      now, informationalOnly: true, authorizes: false,
      note: 'A corpus that shrank while quality rose is a corpus somebody edited. This trend watches the denominator as well as the figure.',
    };
  }
  const sizeOf = (s) => (Number.isFinite(s.count) ? s.count : null);
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const corpusGrowth = sizeOf(first) !== null && sizeOf(last) !== null ? sizeOf(last) - sizeOf(first) : null;
  const corpusShrank = corpusGrowth !== null && corpusGrowth < 0;

  // A shrinking corpus explains a rise and does not support it.
  const shared = [
    ...evidence,
    ...(corpusShrank ? [{ kind: 'measurement-change', detail: `the corpus shrank from ${sizeOf(first)} to ${sizeOf(last)} item(s); dropping weak evidence raises mean quality without improving anything` }] : []),
  ];

  const rows = dimensions.map((dimension) => {
    const series = snapshots.map((s) => (s.byDimension && Number.isFinite(s.byDimension[dimension]) ? s.byDimension[dimension] : null));
    return {
      dimension, ...QUALITY_DIMENSIONS[dimension],
      series,
      trend: verifiedImprovement({ subject: `evidence ${dimension}`, series, evidence: shared }),
    };
  });
  const measured = rows.filter((r) => r.trend.state !== 'unknown');
  const unverified = rows.filter((r) => r.trend.violatesInvariant);
  return {
    snapshots: snapshots.length, dimensions: rows, count: rows.length,
    measurable: measured.length > 0,
    corpusGrowth, corpusShrank,
    corpusSizes: snapshots.map(sizeOf),
    improving: rows.filter((r) => r.trend.state === 'verified-improvement').map((r) => r.dimension),
    unverifiedImprovements: unverified.map((r) => r.dimension),
    regressing: rows.filter((r) => r.trend.state === 'regressed').map((r) => r.dimension),
    unknown: rows.filter((r) => r.trend.state === 'unknown').map((r) => r.dimension),
    everyImprovementVerified: unverified.length === 0,
    basis: measured.length
      ? `${measured.length} of ${rows.length} quality dimensions moved measurably across ${snapshots.length} snapshot(s)${corpusShrank ? `, while the corpus SHRANK by ${Math.abs(corpusGrowth)} item(s)` : ''}.`
      : `${snapshots.length} snapshot(s) supplied and no dimension carried a figure in more than one of them, so no quality trend can be derived.`,
    now, informationalOnly: true, authorizes: false,
    note: 'Evidence can be removed, and dropping the weakest items raises mean quality without improving anything. This trend watches the denominator as well as the figure: a corpus that shrank while quality rose is reported as a measurement change rather than as progress.',
  };
}

module.exports = {
  IMPROVEMENT_STATES, IMPROVEMENT_TOLERANCE, IMPROVEMENT_EVIDENCE_KINDS,
  verifiedImprovement, improvementReport, evidenceQualityEvolution,
  SOURCE_KINDS, DEFAULT_MAX_AGE_MS, CONFIDENCE_BANDS, CONFIDENCE_METHOD,
  ESTIMATE_STATES, ESTABLISHED_FROM, INDICATIVE_FROM,
  interval, statisticalEstimate, confidenceEvolution,
  READINESS_DIMENSIONS, DORA_BANDS, MATURITY_LEVELS,
  DIMENSION_DEPENDENCIES, TEST_TYPES, GOVERNANCE_MATURITY_LEVELS, QUALITY_DIMENSIONS,
  evidenceQuality, evidenceQualityDashboard,
  assess, EvidenceRegister, scoreDimension, readinessModel,
  readinessDependencyGraph, readinessDependencyAnalysis,
  assuranceCoverage, governanceMaturity, engineeringHistory, engineeringForecast,
  bandFor, engineeringMetrics, maturity, validate, report,
};
