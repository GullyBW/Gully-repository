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
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); }
  record(spec) {
    const a = assess({ now: this._clock(), ...spec });
    this._items.set(a.id, a);
    return { ...a };
  }
  get(id) { const a = this._items.get(id); return a ? { ...a } : null; }
  all() { return [...this._items.values()].map((a) => ({ ...a })).sort((x, y) => x.confidence - y.confidence || x.id.localeCompare(y.id)); }
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
  return {
    tests: { byType: { ...tests }, total: testTotal },
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

module.exports = {
  SOURCE_KINDS, DEFAULT_MAX_AGE_MS, CONFIDENCE_BANDS, CONFIDENCE_METHOD,
  READINESS_DIMENSIONS, DORA_BANDS, MATURITY_LEVELS,
  assess, EvidenceRegister, scoreDimension, readinessModel,
  bandFor, engineeringMetrics, maturity, validate, report,
};
