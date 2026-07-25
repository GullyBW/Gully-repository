'use strict';
// Responsible AI Governance Platform (Phase 46). Governs the ADVISORY AI ecosystem: an AI
// registry, model lifecycle + versioning, explainability validation, drift detection, bias
// monitoring, human-approval workflows, AI audit trails, and performance metrics. NO AI model
// may operate without governance APPROVAL, and human decision-making remains mandatory.
// Deterministic. Operates over non-identifying signals only.
const LIFECYCLE = ['registered', 'approved', 'deprecated', 'retired'];

class AiRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._models = new Map(); this._audit = []; }

  register(id, { owner, purpose, version = 1 } = {}) {
    if (!id || !owner || !purpose) throw new Error('AI model id, owner, and purpose are required');
    this._models.set(id, { id, owner, purpose, version, status: 'registered', approvedBy: null, metrics: null, baseline: null });
    this._log('registered', id, owner);
    return this.describe(id);
  }
  // Human governance approval — REQUIRED before a model may operate.
  approve(id, { by, rationale } = {}) { const m = this._must(id); if (!by || !rationale) throw new Error('AI approval requires a named human and a rationale'); m.status = 'approved'; m.approvedBy = by; this._log('approved', id, by); return this.describe(id); }
  deprecate(id, { by } = {}) { const m = this._must(id); m.status = 'deprecated'; this._log('deprecated', id, by || 'system'); return this.describe(id); }
  // The governance gate: a model may operate ONLY if it is approved (fail-closed).
  canOperate(id) { const m = this._models.get(id); return { allowed: !!(m && m.status === 'approved'), reason: m ? (m.status === 'approved' ? 'approved' : `status is '${m.status}'`) : 'unregistered' }; }

  // Explainability validation: a model's output must be advisory + carry an explanation.
  validateExplainability(id, sampleOutput) {
    const ok = !!(sampleOutput && sampleOutput.advisoryOnly === true && sampleOutput.autonomous === false && Array.isArray(sampleOutput.explanation) && sampleOutput.explanation.length > 0);
    this._log('explainability-checked', id, 'system');
    return { id, explainable: ok };
  }
  // Record a performance/quality metric baseline, and detect DRIFT against it.
  setBaseline(id, metrics) { this._must(id).baseline = { ...metrics }; return metrics; }
  recordMetrics(id, metrics) { this._must(id).metrics = { ...metrics }; return metrics; }
  detectDrift(id, { threshold = 0.1 } = {}) {
    const m = this._must(id); if (!m.baseline || !m.metrics) return { drift: false, reason: 'insufficient data' };
    const drifted = Object.keys(m.baseline).filter((k) => Math.abs((m.metrics[k] ?? 0) - m.baseline[k]) > threshold);
    return { drift: drifted.length > 0, driftedMetrics: drifted, note: 'Drift is advisory — a human decides whether to re-approve/retire the model.' };
  }
  // Bias monitoring: compare outcome rates across NON-IDENTIFYING group labels (e.g. region).
  monitorBias(id, groupOutcomes, { threshold = 0.2 } = {}) {
    const rates = Object.entries(groupOutcomes).map(([g, o]) => ({ group: g, rate: o.total ? o.positive / o.total : 0 }));
    const max = Math.max(...rates.map((r) => r.rate)); const min = Math.min(...rates.map((r) => r.rate));
    const disparity = +(max - min).toFixed(3);
    return { id, disparity, flagged: disparity > threshold, rates, note: 'Advisory bias signal over non-identifying groups; human review required.' };
  }

  describe(id) { const m = this._must(id); return { id: m.id, owner: m.owner, purpose: m.purpose, version: m.version, status: m.status, approvedBy: m.approvedBy }; }
  catalog() { return [...this._models.keys()].map((id) => this.describe(id)); }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id, actor) { this._audit.push({ at: this._clock(), event, model: id, actor }); }
  _must(id) { const m = this._models.get(id); if (!m) throw new Error('unknown AI model: ' + id); return m; }
}

// Recommendation governance: a recommendation may be surfaced ONLY from an approved model,
// and it still requires human approval (delegated to the existing RecommendationQueue).
function governedRecommendation(registry, modelId, recommendation) {
  const gate = registry.canOperate(modelId);
  if (!gate.allowed) throw new Error(`AI model '${modelId}' may not operate: ${gate.reason}`);
  if (recommendation.advisoryOnly !== true || recommendation.autonomous !== false) throw new Error('only advisory, non-autonomous recommendations may be surfaced');
  return { modelId, recommendation, requiresHumanApproval: true };
}

module.exports = { AiRegistry, governedRecommendation, LIFECYCLE };
