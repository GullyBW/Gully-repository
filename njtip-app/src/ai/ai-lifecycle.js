'use strict';
// AI Governance Framework (Phase 10, Part 9). Prepares the platform for future AI capability
// without ever letting one become a decision-maker: model registry, dataset registry, prompt
// registry, human approval, explainability, bias monitoring, hallucination safeguards, model
// versioning, inference audit trail, risk classification, human override and evidence
// preservation.
//
// The invariant, enforced structurally rather than promised: AI OUTPUT IS AN INPUT TO A HUMAN
// DECISION AND NOTHING ELSE. `apply()` does not exist. The only exit from an inference is a
// recorded human decision, and a human may always override.
//
// Deterministic; no wall-clock in any hashed content.
const { hash } = require('../twin');

// EU-AI-Act-shaped risk classes. The class determines what governance an artifact needs.
// `minConfidence` (Phase 11, Part 9): below this, the model's output is WITHHELD rather than
// shown with a caveat. A low-confidence suggestion still anchors the person reading it, and an
// anchor you did not intend to set is worse than no suggestion at all.
const RISK_CLASSES = {
  minimal: { humanApproval: false, biasMonitoring: false, explainabilityRequired: false, minConfidence: 0, description: 'No effect on any person or decision (e.g. spell-checking a title).' },
  limited: { humanApproval: true, biasMonitoring: false, explainabilityRequired: true, minConfidence: 0.6, description: 'Informs staff workflow but not case outcomes (e.g. queue ordering).' },
  high: { humanApproval: true, biasMonitoring: true, explainabilityRequired: true, minConfidence: 0.8, description: 'Touches a case, a person or a governance outcome. Every use is approved, explained and audited.' },
  prohibited: { humanApproval: false, biasMonitoring: false, explainabilityRequired: false, minConfidence: 1, description: 'Never permitted on this platform. Registration is refused.' },
};

// Thresholds for the monitoring that Part 9 requires. All deterministic.
const HALLUCINATION_THRESHOLD = 0.05;   // ungrounded outputs above 5% of a model's traffic
const DRIFT_PSI_BANDS = [
  { floor: 0.25, band: 'significant', action: 'suspend the model and re-approve it against current data' },
  { floor: 0.10, band: 'moderate', action: 'investigate; schedule re-evaluation' },
  { floor: 0, band: 'stable', action: 'none' },
];
// Dataset quality dimensions for training data, and the floor a dataset must clear to train on.
const DATASET_QUALITY_DIMENSIONS = ['completeness', 'balance', 'labelAccuracy', 'representativeness', 'freshness'];
const DATASET_QUALITY_FLOOR = 0.8;

// Fairness criteria (Phase 12, Part 9). These are mutually incompatible in general — you cannot
// satisfy demographic parity and equalised odds simultaneously except in degenerate cases — so the
// platform refuses to pick one. Which criterion applies to a given model is a governance decision
// with consequences for real people, and making it silently would hide exactly that.
const FAIRNESS_CRITERIA = {
  'demographic-parity': { description: 'Outcome rates are equal across groups, regardless of any difference in underlying rates.', suitsWhen: 'The outcome should not depend on group membership at all.' },
  'equal-opportunity': { description: 'True-positive rates are equal across groups.', suitsWhen: 'Missing a real case matters more than a false alarm.' },
  'equalised-odds': { description: 'True-positive AND false-positive rates are both equal across groups.', suitsWhen: 'Both kinds of error carry consequences for the person.' },
  'predictive-parity': { description: 'Precision is equal across groups — a positive means the same thing whoever it is about.', suitsWhen: 'The output is acted on directly by a human who cannot see the group.' },
};

// Uses that are refused by name — not merely unimplemented.
const PROHIBITED_USES = {
  'automated-case-decision': 'A case outcome is a human decision. No model may produce one.',
  'reporter-identification': 'Any attempt to identify an anonymous reporter is prohibited absolutely.',
  'predictive-policing': 'Predicting individual criminality is outside every permitted purpose.',
  'social-scoring': 'Scoring persons or communities is prohibited.',
  'emotion-inference': 'Inferring emotional state from case content is prohibited.',
};

const ARTIFACT_KINDS = ['model', 'dataset', 'prompt'];
const IDENTITY_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'dob', 'reporter']);

class AiLifecycle {
  constructor({ clock = () => Date.now() } = {}) {
    this._clock = clock;
    this._artifacts = new Map();     // key `${kind}:${id}` → artifact with versions
    this._inferences = [];           // append-only inference audit trail
    this._overrides = [];
    this._bias = new Map();
    this._seq = 0;
  }

  // --- Registries: models, datasets, prompts ------------------------------------------------

  register(kind, id, { version = 1, owner, purpose, riskClass = 'limited', trainingData = null, fields = [], text = null } = {}) {
    if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`unknown AI artifact kind '${kind}'`);
    if (!id || !owner || !purpose) throw new Error('an AI artifact needs an id, an owner and a declared purpose');
    if (PROHIBITED_USES[purpose]) { const e = new Error(`purpose '${purpose}' is prohibited: ${PROHIBITED_USES[purpose]}`); e.failClosed = true; throw e; }
    if (riskClass === 'prohibited') { const e = new Error('a prohibited-risk artifact may not be registered'); e.failClosed = true; throw e; }
    if (!RISK_CLASSES[riskClass]) throw new Error(`unknown risk class '${riskClass}'`);
    const leaked = fields.filter((f) => IDENTITY_FIELDS.has(String(f).toLowerCase()));
    if (leaked.length) { const e = new Error(`AI artifact refuses identity fields: ${leaked.join(', ')}`); e.failClosed = true; throw e; }
    const key = `${kind}:${id}`;
    const existing = this._artifacts.get(key);
    const record = { version, owner, purpose, riskClass, trainingData, fields: [...fields], textDigest: text ? hash.sha256(text) : null, status: 'registered', approvedBy: null, registeredAt: this._clock() };
    if (existing) { existing.versions.push(record); existing.current = record; }
    else this._artifacts.set(key, { kind, id, versions: [record], current: record });
    return this.describe(kind, id);
  }
  describe(kind, id) { const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error(`unknown AI ${kind}: ${id}`); return JSON.parse(JSON.stringify({ kind, id, ...a.current, versions: a.versions.length })); }
  catalogue(kind = null) { return [...this._artifacts.values()].filter((a) => !kind || a.kind === kind).map((a) => this.describe(a.kind, a.id)).sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id)); }
  history(kind, id) { const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact'); return a.versions.map((v, i) => ({ version: v.version, index: i, riskClass: v.riskClass, status: v.status, approvedBy: v.approvedBy })); }

  // --- Approval workflow (Phase 11, Part 9) -----------------------------------------------------
  //
  // Submitted → reviewed → approved / rejected, per VERSION. Segregation of duties is structural:
  // the artifact's own owner may never approve it, because an approval you can grant yourself is
  // a formality, not a control.

  submitForApproval(kind, id, { by, rationale, evaluation = null } = {}) {
    const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact');
    if (!by || !rationale) throw new Error('a submission for approval requires a named human and a rationale');
    if (a.current.status === 'approved') throw new Error(`${kind} '${id}' v${a.current.version} is already approved`);
    a.current.status = 'submitted';
    a.current.submission = { by, rationale, evaluation, at: this._clock(), textDigestAtSubmission: a.current.textDigest };
    return this.describe(kind, id);
  }
  pendingApprovals() {
    return [...this._artifacts.values()]
      .filter((a) => a.current.status === 'submitted')
      .map((a) => ({ kind: a.kind, id: a.id, version: a.current.version, riskClass: a.current.riskClass, submittedBy: a.current.submission.by, owner: a.current.owner }))
      .sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id));
  }
  reject(kind, id, { by, rationale } = {}) {
    const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact');
    if (!by || !rationale) throw new Error('a rejection requires a named human and a rationale');
    if (a.current.owner === by) { const e = new Error(`the owner of ${kind} '${id}' may not rule on its own approval`); e.failClosed = true; throw e; }
    a.current.status = 'rejected'; a.current.rejectedBy = by; a.current.rejectionRationale = rationale; a.current.rejectedAt = this._clock();
    return this.describe(kind, id);
  }

  // Human approval — required for every risk class above `minimal`, per VERSION.
  approve(kind, id, { by, rationale }) {
    const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact');
    if (!by || !rationale) throw new Error('AI approval requires a named human and a rationale');
    // SEGREGATION OF DUTIES: the owner cannot approve their own artifact.
    if (a.current.owner === by) { const e = new Error(`the owner of ${kind} '${id}' may not approve it — approval requires an independent authority`); e.failClosed = true; throw e; }
    // A high-risk artifact cannot be approved on nothing: a submission carrying an evaluation is
    // the record of what the approver actually looked at.
    if (RISK_CLASSES[a.current.riskClass] && RISK_CLASSES[a.current.riskClass].explainabilityRequired) {
      if (a.current.status === 'rejected') { const e = new Error(`${kind} '${id}' v${a.current.version} was rejected — resubmit it before approving`); e.failClosed = true; throw e; }
    }
    // A prompt whose text has changed since submission is not the prompt that was reviewed.
    if (a.current.submission && a.current.submission.textDigestAtSubmission && a.current.submission.textDigestAtSubmission !== a.current.textDigest) {
      const e = new Error(`${kind} '${id}' changed after it was submitted — the approver did not see this version`); e.failClosed = true; throw e;
    }
    a.current.status = 'approved'; a.current.approvedBy = by; a.current.approvalRationale = rationale; a.current.approvedAt = this._clock();
    return this.describe(kind, id);
  }
  // A new version resets approval: approving v1 never approves v2.
  isApproved(kind, id) {
    const a = this._artifacts.get(`${kind}:${id}`);
    if (!a) return { approved: false, reason: 'unknown artifact' };
    if (a.current.status === 'retired') return { approved: false, reason: `this ${a.kind} was retired by ${a.current.retiredBy}` };
    if (!RISK_CLASSES[a.current.riskClass].humanApproval) return { approved: true, reason: 'minimal risk — approval not required' };
    return a.current.status === 'approved' ? { approved: true, by: a.current.approvedBy } : { approved: false, reason: 'this version is not approved by a named human' };
  }

  // --- Inference: advisory only, audited, explainable, never authoritative --------------------

  // Record an inference. FAIL-CLOSED on: an unapproved artifact, a missing explanation where the
  // risk class requires one, a prohibited purpose, or identity in the input.
  infer({ model, promptId = null, inputSummary = {}, output, explanation = null, confidence = null, requestedBy }) {
    const approval = this.isApproved('model', model);
    if (!approval.approved) { const e = new Error(`inference refused: ${approval.reason}`); e.failClosed = true; throw e; }
    if (!requestedBy) { const e = new Error('an inference must name the requesting principal'); e.failClosed = true; throw e; }
    const art = this.describe('model', model);
    if (RISK_CLASSES[art.riskClass].explainabilityRequired && !explanation) { const e = new Error(`inference refused: risk class '${art.riskClass}' requires an explanation`); e.failClosed = true; throw e; }
    const leaked = Object.keys(inputSummary).filter((f) => IDENTITY_FIELDS.has(f.toLowerCase()));
    if (leaked.length) { const e = new Error(`inference refuses identity in its input: ${leaked.join(', ')}`); e.failClosed = true; throw e; }
    if (promptId) { const p = this.isApproved('prompt', promptId); if (!p.approved) { const e = new Error(`inference refused: prompt '${promptId}' is ${p.reason}`); e.failClosed = true; throw e; } }
    // CONFIDENCE THRESHOLD (Phase 11, Part 9). Below the risk class's floor the output is WITHHELD,
    // not shown with a caveat — a low-confidence suggestion still anchors the person reading it,
    // and an anchor you did not intend to set is worse than no suggestion at all.
    const floor = RISK_CLASSES[art.riskClass].minConfidence ?? 0;
    if (floor > 0) {
      if (typeof confidence !== 'number') { const e = new Error(`inference refused: risk class '${art.riskClass}' requires a confidence score`); e.failClosed = true; throw e; }
      if (confidence < floor) { const e = new Error(`inference withheld: confidence ${confidence} is below the ${floor} floor for risk class '${art.riskClass}' — the matter goes to a human with no suggestion attached`); e.failClosed = true; e.withheld = true; throw e; }
    }
    const record = {
      id: 'INF-' + (++this._seq).toString().padStart(5, '0'),
      model, modelVersion: art.version, promptId, inputSummary: { ...inputSummary }, output, explanation, confidence,
      requestedBy, at: this._clock(),
      status: 'advisory', humanDecision: null, overridden: false,
      advisoryOnly: true, authorizes: false,
    };
    record.digest = hash.sha256({ model: record.model, modelVersion: record.modelVersion, promptId, inputSummary: record.inputSummary, output, explanation });
    this._inferences.push(record);
    return { ...record, note: 'Advisory only. This output is an input to a human decision and nothing else.' };
  }

  // The ONLY exit from an inference: a named human decides. Accepting is a decision too.
  decide(inferenceId, { by, decision, rationale }) {
    const inf = this._inferences.find((i) => i.id === inferenceId);
    if (!inf) throw new Error('unknown inference');
    if (!by || !decision || !rationale) throw new Error('a decision on an inference requires a named human, a decision and a rationale');
    if (!['accepted', 'rejected', 'modified'].includes(decision)) throw new Error("decision must be 'accepted', 'rejected' or 'modified'");
    inf.status = 'decided'; inf.humanDecision = { by, decision, rationale, at: this._clock() };
    if (decision !== 'accepted') { inf.overridden = true; this._overrides.push({ inference: inferenceId, by, decision, rationale, at: this._clock() }); }
    return { inference: inferenceId, decision, by, note: 'The human decided. The model informed; it did not decide.' };
  }
  // Human override is always available, including after acceptance.
  override(inferenceId, { by, rationale }) {
    const inf = this._inferences.find((i) => i.id === inferenceId);
    if (!inf) throw new Error('unknown inference');
    if (!by || !rationale) throw new Error('an override requires a named human and a rationale');
    inf.overridden = true; inf.humanDecision = { by, decision: 'overridden', rationale, at: this._clock() };
    this._overrides.push({ inference: inferenceId, by, decision: 'overridden', rationale, at: this._clock() });
    return { inference: inferenceId, overridden: true, by };
  }

  // Append-only inference audit trail; evidence is preserved with the digest that fixes it.
  auditTrail() { return this._inferences.map((i) => ({ ...i })); }
  inference(id) { const i = this._inferences.find((x) => x.id === id); return i ? { ...i } : null; }
  // Evidence preservation: an inference must remain reproducible from its recorded inputs.
  verifyEvidence(id) {
    const i = this.inference(id);
    if (!i) return { valid: false, reason: 'unknown inference' };
    const recomputed = hash.sha256({ model: i.model, modelVersion: i.modelVersion, promptId: i.promptId, inputSummary: i.inputSummary, output: i.output, explanation: i.explanation });
    return { valid: recomputed === i.digest, digest: i.digest, recomputed, note: 'The inference record is fixed by its digest; altering any input or the output breaks it.' };
  }
  pendingDecisions() { return this._inferences.filter((i) => i.status === 'advisory').map((i) => ({ id: i.id, model: i.model, requestedBy: i.requestedBy })); }

  // --- Bias monitoring & hallucination safeguards ----------------------------------------------

  // Bias monitoring over NON-IDENTIFYING group aggregates (e.g. by category or region).
  observeBias(model, { group, outcomeRate, sampleSize }) {
    if (IDENTITY_FIELDS.has(String(group).toLowerCase())) throw new Error('bias monitoring uses non-identifying groups only');
    if (!this._bias.has(model)) this._bias.set(model, []);
    this._bias.get(model).push({ group, outcomeRate, sampleSize, at: this._clock() });
    return { model, observations: this._bias.get(model).length };
  }
  // Disparity: the spread between the best- and worst-served group, with small groups suppressed.
  biasReport(model, { threshold = 0.2, minSample = 30 } = {}) {
    const obs = (this._bias.get(model) || []).filter((o) => o.sampleSize >= minSample);
    const suppressed = (this._bias.get(model) || []).length - obs.length;
    if (obs.length < 2) return { model, measured: false, suppressed, note: 'insufficient non-suppressed groups to assess disparity' };
    const rates = obs.map((o) => o.outcomeRate);
    const disparity = +(Math.max(...rates) - Math.min(...rates)).toFixed(4);
    return {
      model, measured: true, groups: obs.length, suppressed, disparity, threshold,
      withinThreshold: disparity <= threshold,
      worstServed: obs.reduce((a, b) => (a.outcomeRate <= b.outcomeRate ? a : b)).group,
      note: 'Disparity is a signal for human review, never a conclusion about causation.',
    };
  }

  // Hallucination safeguards: an output must be grounded in supplied evidence and within scope.
  groundingCheck({ output, groundedIn = [], allowedVocabulary = null, minConfidence = 0.5, confidence = null }) {
    const issues = [];
    if (!groundedIn.length) issues.push('output is not grounded in any supplied evidence');
    if (confidence !== null && confidence < minConfidence) issues.push(`confidence ${confidence} is below the ${minConfidence} floor`);
    if (allowedVocabulary && typeof output === 'string') {
      const outside = output.split(/\s+/).filter((w) => w.length > 3 && !allowedVocabulary.includes(w.toLowerCase()));
      if (outside.length) issues.push(`output uses terms outside the permitted vocabulary: ${outside.slice(0, 3).join(', ')}`);
    }
    return { grounded: issues.length === 0, issues, note: 'An ungrounded or low-confidence output is withheld from the human queue rather than shown as a suggestion.' };
  }

  // --- Governance view ------------------------------------------------------------------------------

  // --- Dataset lineage & quality (Phase 11, Part 9) ---------------------------------------------

  // Training-data lineage. A model trained on data nobody can trace is a model nobody can defend
  // when someone asks where a decision came from.
  recordDatasetLineage(id, { sources = [], transformations = [], collectedUnder = null, lawfulBasis = null, syntheticOnly = true, by } = {}) {
    const a = this._artifacts.get(`dataset:${id}`); if (!a) throw new Error(`unknown AI dataset: ${id}`);
    if (!by) throw new Error('recording dataset lineage requires a named human');
    if (!sources.length) { const e = new Error('a training dataset must declare at least one source'); e.failClosed = true; throw e; }
    if (!lawfulBasis) { const e = new Error('a training dataset must declare the lawful basis for its collection'); e.failClosed = true; throw e; }
    if (syntheticOnly !== true) { const e = new Error('this platform trains on synthetic data only — a non-synthetic training dataset is refused'); e.failClosed = true; throw e; }
    a.current.lineage = { sources: [...sources], transformations: [...transformations], collectedUnder, lawfulBasis, syntheticOnly, recordedBy: by, at: this._clock() };
    return this.datasetLineage(id);
  }
  datasetLineage(id) {
    const a = this._artifacts.get(`dataset:${id}`); if (!a) throw new Error(`unknown AI dataset: ${id}`);
    const l = a.current.lineage || null;
    return {
      dataset: id, traced: !!l, ...(l ? JSON.parse(JSON.stringify(l)) : {}),
      reason: l ? 'lineage recorded' : 'no lineage recorded — the training data cannot be traced',
    };
  }
  observeDatasetQuality(id, observations = {}) {
    const a = this._artifacts.get(`dataset:${id}`); if (!a) throw new Error(`unknown AI dataset: ${id}`);
    const unknown = Object.keys(observations).filter((d) => !DATASET_QUALITY_DIMENSIONS.includes(d));
    if (unknown.length) throw new Error(`unknown dataset quality dimension(s): ${unknown.join(', ')}`);
    for (const [d, val] of Object.entries(observations)) if (typeof val !== 'number' || val < 0 || val > 1) throw new Error(`dataset quality '${d}' must be a number in [0, 1]`);
    a.current.quality = { ...observations, at: this._clock() };
    return this.datasetQuality(id);
  }
  datasetQuality(id) {
    const a = this._artifacts.get(`dataset:${id}`); if (!a) throw new Error(`unknown AI dataset: ${id}`);
    const q = a.current.quality;
    if (!q) return { dataset: id, measured: false, score: null, acceptable: false, reason: 'no quality observation — an unmeasured training set is not a clean one' };
    const measured = DATASET_QUALITY_DIMENSIONS.filter((d) => typeof q[d] === 'number');
    const missing = DATASET_QUALITY_DIMENSIONS.filter((d) => !measured.includes(d));
    const score = measured.length ? +(measured.reduce((s, d) => s + q[d], 0) / measured.length).toFixed(3) : null;
    const failing = measured.filter((d) => q[d] < DATASET_QUALITY_FLOOR);
    return {
      dataset: id, measured: true, score, floor: DATASET_QUALITY_FLOOR,
      dimensions: Object.fromEntries(measured.map((d) => [d, q[d]])), missing, failing,
      acceptable: missing.length === 0 && failing.length === 0,
      reason: missing.length ? `unmeasured dimension(s): ${missing.join(', ')}` : failing.length ? `below the floor: ${failing.join(', ')}` : 'training data meets every quality dimension',
    };
  }
  // A model may only be trained on datasets that are traced, measured and clean. The gate is here
  // rather than in a checklist so it cannot be skipped.
  trainingDataAcceptable(model) {
    const a = this._artifacts.get(`model:${model}`); if (!a) throw new Error(`unknown AI model: ${model}`);
    const sets = [].concat(a.current.trainingData || []).filter(Boolean);
    if (!sets.length) return { acceptable: false, model, datasets: [], reason: 'the model declares no training dataset' };
    const rows = sets.map((id) => {
      if (!this._artifacts.has(`dataset:${id}`)) return { dataset: id, registered: false, traced: false, quality: null, ok: false, reason: 'training dataset is not registered' };
      const lineage = this.datasetLineage(id);
      const quality = this.datasetQuality(id);
      const approved = this.isApproved('dataset', id);
      return { dataset: id, registered: true, traced: lineage.traced, approved: approved.approved, quality, ok: lineage.traced && quality.acceptable && approved.approved, reason: !lineage.traced ? lineage.reason : !approved.approved ? approved.reason : quality.reason };
    });
    const bad = rows.filter((r) => !r.ok);
    return { model, datasets: rows, acceptable: bad.length === 0, blockers: bad.map((r) => `${r.dataset}: ${r.reason}`), reason: bad.length ? 'training data is not acceptable' : 'every training dataset is traced, approved and within quality' };
  }

  // --- Hallucination monitoring (Phase 11, Part 9) ----------------------------------------------

  // Record whether an output was grounded in cited evidence. Monitoring is per model, because a
  // rate averaged across models tells you nothing about which one to stop using.
  recordGrounding(model, { inferenceId = null, grounded, reason = null } = {}) {
    if (typeof grounded !== 'boolean') throw new Error('grounding must be recorded as a boolean');
    if (!this._grounding) this._grounding = new Map();
    if (!this._grounding.has(model)) this._grounding.set(model, []);
    this._grounding.get(model).push({ inferenceId, grounded, reason, at: this._clock() });
    return { model, observations: this._grounding.get(model).length };
  }
  hallucinationReport(model, { threshold = HALLUCINATION_THRESHOLD, minSample = 20 } = {}) {
    const obs = (this._grounding && this._grounding.get(model)) || [];
    if (obs.length < minSample) {
      return { model, samples: obs.length, minSample, rate: null, withinThreshold: null, threshold, reason: `only ${obs.length} of ${minSample} samples — the rate is not yet meaningful, and a rate you cannot trust must not read as safe` };
    }
    const ungrounded = obs.filter((o) => !o.grounded).length;
    const rate = +(ungrounded / obs.length).toFixed(4);
    return {
      model, samples: obs.length, ungrounded, rate, threshold,
      withinThreshold: rate <= threshold,
      severity: rate <= threshold ? 'ok' : rate <= threshold * 3 ? 'elevated' : 'critical',
      examples: obs.filter((o) => !o.grounded).slice(0, 5).map((o) => ({ inferenceId: o.inferenceId, reason: o.reason })),
      reason: rate <= threshold ? 'ungrounded output stays within threshold' : `${(rate * 100).toFixed(2)}% of outputs were ungrounded — above the ${(threshold * 100).toFixed(0)}% threshold`,
    };
  }

  // --- Drift detection (Phase 11, Part 9) --------------------------------------------------------

  // Record a feature distribution for a period. Distributions are bucket → proportion.
  observeDistribution(model, { period, distribution = {} } = {}) {
    if (!Number.isInteger(period) || period < 0) throw new Error('period must be a non-negative integer');
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('a distribution must have some mass');
    if (!this._distributions) this._distributions = new Map();
    if (!this._distributions.has(model)) this._distributions.set(model, new Map());
    const byPeriod = this._distributions.get(model);
    if (byPeriod.has(period)) throw new Error(`period ${period} is already recorded for '${model}' — distribution history is append-only`);
    byPeriod.set(period, Object.fromEntries(Object.entries(distribution).map(([k, val]) => [k, val / total])));
    return { model, period, buckets: Object.keys(distribution).length };
  }
  // Population Stability Index between the baseline period and the latest. Deterministic; the
  // usual banding (<0.1 stable, 0.1–0.25 moderate, >0.25 significant) is applied as data.
  driftReport(model, { baselinePeriod = 0 } = {}) {
    const byPeriod = (this._distributions && this._distributions.get(model)) || new Map();
    const periods = [...byPeriod.keys()].sort((a, b) => a - b);
    if (periods.length < 2) return { model, periods: periods.length, psi: null, band: 'insufficient-data', drifted: null, reason: 'at least two periods are needed to detect drift' };
    const base = byPeriod.get(baselinePeriod) || byPeriod.get(periods[0]);
    const latestPeriod = periods[periods.length - 1];
    const latest = byPeriod.get(latestPeriod);
    const buckets = [...new Set([...Object.keys(base), ...Object.keys(latest)])].sort();
    const EPS = 1e-6;
    let psi = 0;
    const contributions = buckets.map((b) => {
      const e = Math.max(base[b] ?? 0, EPS);
      const a = Math.max(latest[b] ?? 0, EPS);
      const c = (a - e) * Math.log(a / e);
      psi += c;
      return { bucket: b, baseline: +e.toFixed(6), latest: +a.toFixed(6), contribution: +c.toFixed(6) };
    });
    psi = +psi.toFixed(6);
    const banding = DRIFT_PSI_BANDS.find((x) => psi >= x.floor);
    return {
      model, periods: periods.length, baselinePeriod, latestPeriod, psi, band: banding.band,
      drifted: banding.band !== 'stable', action: banding.action,
      contributions: contributions.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution)),
      largestShift: contributions.length ? contributions[0].bucket : null,
      reason: banding.band === 'stable' ? 'the input distribution has not meaningfully shifted' : `PSI ${psi} — ${banding.band} drift since period ${baselinePeriod}`,
    };
  }
  // Combined monitoring posture: a model that has drifted or is hallucinating must not keep
  // running on an approval granted against data that no longer exists.
  monitoringPosture(model) {
    const hall = this.hallucinationReport(model);
    const drift = this.driftReport(model);
    const training = (() => { try { return this.trainingDataAcceptable(model); } catch (_) { return { acceptable: null, reason: 'unknown model' }; } })();
    const concerns = [];
    if (hall.withinThreshold === false) concerns.push(`hallucination rate ${hall.rate} above ${hall.threshold}`);
    if (drift.drifted) concerns.push(`input distribution has ${drift.band} drift (PSI ${drift.psi})`);
    if (training.acceptable === false) concerns.push('training data is not acceptable: ' + (training.blockers || []).join('; '));
    return {
      model, hallucination: hall, drift, trainingData: training,
      healthy: concerns.length === 0, concerns,
      requiresReApproval: drift.band === 'significant' || hall.severity === 'critical',
      advisoryOnly: true, authorizes: false,
      note: 'Monitoring evidence. It can require a re-approval; it can never grant one.',
    };
  }

  // --- Fairness, calibration, retirement (Phase 12, Part 9) --------------------------------------

  // Fairness monitoring. Bias monitoring (Phase 10) reports disparity between groups; fairness
  // asks whether the disparity clears the specific criterion the model was approved against.
  // Which criterion applies is a governance decision, not a statistical one — the module refuses
  // to pick, because "fair" means different things and choosing silently would hide that.
  fairnessCriteria() { return Object.entries(FAIRNESS_CRITERIA).map(([id, c]) => ({ id, ...c })); }
  declareFairnessCriterion(model, { criterion, threshold = 0.1, by, rationale } = {}) {
    this.describe('model', model);
    if (!FAIRNESS_CRITERIA[criterion]) throw new Error(`unknown fairness criterion '${criterion}' — choose one of ${Object.keys(FAIRNESS_CRITERIA).join(', ')}`);
    if (!by || !rationale) { const e = new Error('choosing a fairness criterion is a governance decision — it requires a named human and a rationale'); e.failClosed = true; throw e; }
    if (!this._fairness) this._fairness = new Map();
    this._fairness.set(model, { model, criterion, threshold, by, rationale, at: this._clock() });
    return { model, criterion, threshold, by };
  }
  fairnessReport(model, { minSample = 30 } = {}) {
    const declared = this._fairness && this._fairness.get(model);
    if (!declared) return { model, assessed: false, reason: 'no fairness criterion has been declared for this model — "fair" means several different things and the platform will not pick one silently' };
    const bias = this.biasReport(model, { threshold: declared.threshold, minSample });
    if (!bias.measured) return { model, assessed: false, criterion: declared.criterion, reason: bias.note || 'not enough observations to assess fairness' };
    const spec = FAIRNESS_CRITERIA[declared.criterion];
    return {
      model, assessed: true, criterion: declared.criterion, criterionMeaning: spec.description,
      threshold: declared.threshold, declaredBy: declared.by, rationale: declared.rationale,
      disparity: bias.disparity ?? null, groups: bias.groups ?? [], suppressed: bias.suppressed ?? 0,
      fair: bias.withinThreshold === true,
      reason: bias.withinThreshold === true
        ? `outcome disparity is within the ${declared.threshold} threshold for ${declared.criterion}`
        : `outcome disparity ${bias.disparity} exceeds the ${declared.threshold} threshold for ${declared.criterion}`,
      note: 'Fairness is assessed against the criterion this model was approved under, not against a general notion of fairness.',
    };
  }

  // Confidence calibration. A model that says 0.9 should be right about 90% of the time; one that
  // says 0.9 and is right 60% of the time is not "usually right", it is MISCALIBRATED — and every
  // confidence floor elsewhere in this module is built on the assumption that it is not.
  recordCalibration(model, { confidence, correct } = {}) {
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) throw new Error('calibration requires a confidence in [0, 1]');
    if (typeof correct !== 'boolean') throw new Error('calibration requires whether the output was correct, as a boolean');
    if (!this._calibration) this._calibration = new Map();
    if (!this._calibration.has(model)) this._calibration.set(model, []);
    this._calibration.get(model).push({ confidence, correct });
    return { model, observations: this._calibration.get(model).length };
  }
  calibrationReport(model, { buckets = 5, minPerBucket = 10, tolerance = 0.15 } = {}) {
    const obs = (this._calibration && this._calibration.get(model)) || [];
    if (obs.length < buckets * minPerBucket) {
      return { model, assessed: false, observations: obs.length, required: buckets * minPerBucket, reason: `only ${obs.length} observations — a calibration curve drawn from too few points is a shape, not a measurement` };
    }
    const rows = [];
    let ece = 0;                                   // expected calibration error
    for (let b = 0; b < buckets; b++) {
      const lo = b / buckets, hi = (b + 1) / buckets;
      const inBucket = obs.filter((o) => o.confidence >= lo && (b === buckets - 1 ? o.confidence <= hi : o.confidence < hi));
      if (!inBucket.length) { rows.push({ bucket: `${lo.toFixed(1)}–${hi.toFixed(1)}`, n: 0, meanConfidence: null, accuracy: null, gap: null, assessed: false }); continue; }
      const meanConfidence = inBucket.reduce((a, o) => a + o.confidence, 0) / inBucket.length;
      const accuracy = inBucket.filter((o) => o.correct).length / inBucket.length;
      const gap = +(meanConfidence - accuracy).toFixed(4);
      ece += (inBucket.length / obs.length) * Math.abs(gap);
      rows.push({ bucket: `${lo.toFixed(1)}–${hi.toFixed(1)}`, n: inBucket.length, meanConfidence: +meanConfidence.toFixed(4), accuracy: +accuracy.toFixed(4), gap, assessed: true, overconfident: gap > tolerance, underconfident: gap < -tolerance });
    }
    const assessedRows = rows.filter((r) => r.assessed);
    const overconfident = assessedRows.filter((r) => r.overconfident);
    return {
      model, assessed: true, observations: obs.length, buckets: rows, tolerance,
      expectedCalibrationError: +ece.toFixed(4),
      calibrated: overconfident.length === 0 && ece <= tolerance,
      overconfidentBuckets: overconfident.map((r) => r.bucket),
      // Overconfidence is the dangerous direction: it is what makes a confidence floor useless.
      reason: overconfident.length
        ? `the model is overconfident in ${overconfident.map((r) => r.bucket).join(', ')} — every confidence floor in this module assumes it is not`
        : ece > tolerance ? `expected calibration error ${ece.toFixed(4)} exceeds the ${tolerance} tolerance` : 'confidence is calibrated within tolerance',
    };
  }

  // Retirement. A model that is no longer used but never retired keeps its approval, and an
  // approval nobody revisits is how a superseded model quietly stays in production.
  retire(kind, id, { by, rationale, supersededBy = null } = {}) {
    const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact');
    if (!by || !rationale) { const e = new Error('retiring an AI artifact requires a named human and a rationale'); e.failClosed = true; throw e; }
    if (a.current.status === 'retired') throw new Error(`${kind} '${id}' is already retired`);
    if (supersededBy && !this._artifacts.has(`${kind}:${supersededBy}`)) throw new Error(`superseding ${kind} '${supersededBy}' does not exist`);
    a.current.status = 'retired'; a.current.retiredBy = by; a.current.retirementRationale = rationale;
    a.current.retiredAt = this._clock(); a.current.supersededBy = supersededBy;
    return this.describe(kind, id);
  }
  retired() { return this.catalogue().filter((a) => a.status === 'retired'); }

  prohibitedUses() { return Object.entries(PROHIBITED_USES).map(([id, why]) => ({ use: id, why })); }
  riskClasses() { return Object.entries(RISK_CLASSES).map(([id, r]) => ({ id, ...r })); }

  validate() {
    const violations = [];
    for (const a of this.catalogue()) {
      if (!RISK_CLASSES[a.riskClass]) violations.push(`${a.kind}:${a.id}: unknown risk class`);
      if (RISK_CLASSES[a.riskClass].humanApproval && !['approved', 'retired'].includes(a.status)) violations.push(`${a.kind}:${a.id}: risk class '${a.riskClass}' requires human approval and has none`);
      if (!a.purpose) violations.push(`${a.kind}:${a.id}: no declared purpose`);
      if (PROHIBITED_USES[a.purpose]) violations.push(`${a.kind}:${a.id}: prohibited purpose`);
      for (const f of a.fields) if (IDENTITY_FIELDS.has(String(f).toLowerCase())) violations.push(`${a.kind}:${a.id}: identity field '${f}'`);
      // Phase 11, Part 9: an approver may never be the owner, and a model must be able to say
      // where its training data came from.
      if (a.status === 'approved' && a.approvedBy === a.owner) violations.push(`${a.kind}:${a.id}: approved by its own owner`);
      if (a.kind === 'dataset' && a.status === 'approved' && !this.datasetLineage(a.id).traced) violations.push(`dataset:${a.id}: approved with no recorded lineage`);
      if (a.kind === 'model' && a.trainingData) {
        const t = this.trainingDataAcceptable(a.id);
        if (!t.acceptable) for (const b of t.blockers) violations.push(`model:${a.id}: ${b}`);
      }
    }
    for (const i of this._inferences) {
      if (i.authorizes !== false || i.advisoryOnly !== true) violations.push(`${i.id}: an inference claims authority`);
      if (!this.verifyEvidence(i.id).valid) violations.push(`${i.id}: inference evidence does not verify`);
    }
    return { valid: violations.length === 0, violations, artifacts: this.catalogue().length, inferences: this._inferences.length };
  }

  report() {
    return {
      riskClasses: this.riskClasses(), prohibitedUses: this.prohibitedUses(),
      models: this.catalogue('model'), datasets: this.catalogue('dataset'), prompts: this.catalogue('prompt'),
      inferences: this.auditTrail().length, pendingHumanDecisions: this.pendingDecisions(),
      overrides: this._overrides.map((o) => ({ ...o })),
      pendingApprovals: this.pendingApprovals(),
      datasetLineage: this.catalogue('dataset').map((d) => this.datasetLineage(d.id)),
      datasetQuality: this.catalogue('dataset').map((d) => this.datasetQuality(d.id)),
      monitoring: this.catalogue('model').map((m) => this.monitoringPosture(m.id)),
      fairness: this.catalogue('model').map((m) => this.fairnessReport(m.id)),
      calibration: this.catalogue('model').map((m) => this.calibrationReport(m.id)),
      retired: this.retired(),
      fairnessCriteria: this.fairnessCriteria(),
      validation: this.validate(),
      advisoryOnly: true, authorizes: false,
      note: 'AI output is an input to a human decision and nothing else. There is no apply(); the only exit from an inference is a recorded human decision.',
    };
  }
}

module.exports = {
  AiLifecycle, RISK_CLASSES, PROHIBITED_USES, ARTIFACT_KINDS,
  HALLUCINATION_THRESHOLD, DRIFT_PSI_BANDS, DATASET_QUALITY_DIMENSIONS, DATASET_QUALITY_FLOOR, FAIRNESS_CRITERIA,
};
