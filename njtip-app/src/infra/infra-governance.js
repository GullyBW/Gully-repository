'use strict';
// Sovereign Infrastructure Governance Platform (Phase 52). Extends platform governance to
// INFRASTRUCTURE: a resource registry (compute/storage/network), a sovereign-cloud POLICY
// registry with DATA-RESIDENCY rules, compliance validation, drift detection, and lifecycle
// governance. Infrastructure decisions are ADVISORY until human approval. Deterministic.
const crypto = require('node:crypto');

const KINDS = new Set(['compute', 'storage', 'network']);

class InfrastructureRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._resources = new Map(); this._policies = { allowedRegions: [], allowedProviders: [], residency: {} }; this._baseline = null; }

  register(id, { kind, region, provider, zone, dataClassification = 'internal' } = {}) {
    if (!id || !KINDS.has(kind)) throw new Error('resource id and a valid kind are required');
    this._resources.set(id, { id, kind, region, provider, zone: zone || null, dataClassification, state: 'active', since: this._clock() });
    return this.describe(id);
  }
  describe(id) { const r = this._resources.get(id); return r ? { ...r } : null; }
  list(kind) { return [...this._resources.values()].filter((r) => !kind || r.kind === kind).map((r) => ({ ...r })); }

  // Sovereign-cloud policy registry: allowed regions/providers + per-classification residency.
  setPolicy({ allowedRegions = [], allowedProviders = [], residency = {} } = {}) { this._policies = { allowedRegions, allowedProviders, residency }; return this._policies; }
  policy() { return JSON.parse(JSON.stringify(this._policies)); }

  // Compliance validation: each resource must sit in an allowed region/provider and satisfy
  // the residency rule for its data classification (fail-closed reporting).
  validateCompliance() {
    const violations = [];
    for (const r of this._resources.values()) {
      if (this._policies.allowedRegions.length && !this._policies.allowedRegions.includes(r.region)) violations.push({ id: r.id, rule: 'region', detail: r.region });
      if (this._policies.allowedProviders.length && r.provider && !this._policies.allowedProviders.includes(r.provider)) violations.push({ id: r.id, rule: 'provider', detail: r.provider });
      const requiredRegion = this._policies.residency[r.dataClassification];
      if (requiredRegion && r.region !== requiredRegion) violations.push({ id: r.id, rule: 'residency', detail: `${r.dataClassification} must reside in ${requiredRegion}` });
    }
    return { compliant: violations.length === 0, violations };
  }

  // Infrastructure drift detection against a human-reviewed baseline signature.
  signature() { const facts = this.list().map((r) => `${r.id}:${r.kind}:${r.region}:${r.provider || ''}`).sort(); return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex'); }
  recordBaseline() { this._baseline = this.signature(); return this._baseline; }
  detectDrift() { if (!this._baseline) return { drift: false, reason: 'no baseline recorded' }; const cur = this.signature(); return { drift: cur !== this._baseline, baseline: this._baseline, current: cur }; }

  // Lifecycle governance: resource states (active → draining → decommissioned).
  transition(id, state) { const r = this._resources.get(id); if (!r) throw new Error('unknown resource'); if (!['active', 'draining', 'decommissioned'].includes(state)) throw new Error('invalid state'); r.state = state; return { id, state }; }

  // Readiness assessment (ADVISORY, human-gated) — compliance + no drift.
  readiness() { const c = this.validateCompliance(); const d = this.detectDrift(); return { compliant: c.compliant, drift: d.drift, ready: c.compliant && !d.drift, humanGate: true, note: 'Infrastructure readiness is advisory; provisioning/changes remain human-approved.' }; }
}

module.exports = { InfrastructureRegistry, KINDS };
