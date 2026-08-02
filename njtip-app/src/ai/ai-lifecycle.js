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
const RISK_CLASSES = {
  minimal: { humanApproval: false, biasMonitoring: false, explainabilityRequired: false, description: 'No effect on any person or decision (e.g. spell-checking a title).' },
  limited: { humanApproval: true, biasMonitoring: false, explainabilityRequired: true, description: 'Informs staff workflow but not case outcomes (e.g. queue ordering).' },
  high: { humanApproval: true, biasMonitoring: true, explainabilityRequired: true, description: 'Touches a case, a person or a governance outcome. Every use is approved, explained and audited.' },
  prohibited: { humanApproval: false, biasMonitoring: false, explainabilityRequired: false, description: 'Never permitted on this platform. Registration is refused.' },
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

  // Human approval — required for every risk class above `minimal`, per VERSION.
  approve(kind, id, { by, rationale }) {
    const a = this._artifacts.get(`${kind}:${id}`); if (!a) throw new Error('unknown artifact');
    if (!by || !rationale) throw new Error('AI approval requires a named human and a rationale');
    a.current.status = 'approved'; a.current.approvedBy = by; a.current.approvalRationale = rationale; a.current.approvedAt = this._clock();
    return this.describe(kind, id);
  }
  // A new version resets approval: approving v1 never approves v2.
  isApproved(kind, id) {
    const a = this._artifacts.get(`${kind}:${id}`);
    if (!a) return { approved: false, reason: 'unknown artifact' };
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

  prohibitedUses() { return Object.entries(PROHIBITED_USES).map(([id, why]) => ({ use: id, why })); }
  riskClasses() { return Object.entries(RISK_CLASSES).map(([id, r]) => ({ id, ...r })); }

  validate() {
    const violations = [];
    for (const a of this.catalogue()) {
      if (!RISK_CLASSES[a.riskClass]) violations.push(`${a.kind}:${a.id}: unknown risk class`);
      if (RISK_CLASSES[a.riskClass].humanApproval && a.status !== 'approved') violations.push(`${a.kind}:${a.id}: risk class '${a.riskClass}' requires human approval and has none`);
      if (!a.purpose) violations.push(`${a.kind}:${a.id}: no declared purpose`);
      if (PROHIBITED_USES[a.purpose]) violations.push(`${a.kind}:${a.id}: prohibited purpose`);
      for (const f of a.fields) if (IDENTITY_FIELDS.has(String(f).toLowerCase())) violations.push(`${a.kind}:${a.id}: identity field '${f}'`);
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
      validation: this.validate(),
      advisoryOnly: true, authorizes: false,
      note: 'AI output is an input to a human decision and nothing else. There is no apply(); the only exit from an inference is a recorded human decision.',
    };
  }
}

module.exports = { AiLifecycle, RISK_CLASSES, PROHIBITED_USES, ARTIFACT_KINDS };
