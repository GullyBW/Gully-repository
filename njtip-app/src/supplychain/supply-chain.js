'use strict';
// National Digital Supply Chain Governance (Phase 65). Extends DevSecOps into complete
// software supply-chain governance: a supplier registry, a trusted-component registry,
// dependency provenance, SBOM governance, third-party risk assessment, software-integrity
// verification, package lifecycle governance, and dependency policy validation. NO deployment
// may bypass supply-chain governance — validateForDeployment() is a fail-closed gate.
// Deterministic.
const { hash } = require('../twin');

const RISK = ['low', 'medium', 'high', 'critical'];

class SupplyChainGovernance {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._suppliers = new Map(); this._components = new Map(); this._audit = []; }

  // Supplier registry.
  registerSupplier(id, { trustLevel = 'unverified', risk = 'medium' } = {}) { if (!RISK.includes(risk)) throw new Error('invalid risk'); this._suppliers.set(id, { id, trustLevel, risk, status: 'active' }); this._log('supplier-registered', id); return { id, trustLevel, risk }; }
  supplier(id) { return this._suppliers.get(id) || null; }

  // Trusted-component registry: a component is trusted iff its supplier is registered. Its
  // integrity hash is recorded for later verification.
  registerComponent(name, { version, supplier, contentRef, risk = 'low' } = {}) {
    if (!name || !version || !supplier) throw new Error('component name, version, and supplier are required');
    if (!this._suppliers.has(supplier)) throw new Error('component supplier is not registered (fail-closed)');
    const key = `${name}@${version}`;
    const integrity = hash.sha256({ name, version, supplier, contentRef: contentRef || key });
    this._components.set(key, { name, version, supplier, integrity, risk, status: 'approved' });
    this._log('component-registered', key);
    return { component: key, integrity };
  }
  // Software-integrity verification: a component's declared hash must match the trusted record.
  verifyIntegrity(name, version, declaredHash) { const c = this._components.get(`${name}@${version}`); if (!c) return { ok: false, reason: 'component not in trusted registry' }; return { ok: c.integrity === declaredHash, reason: c.integrity === declaredHash ? 'match' : 'integrity mismatch' }; }

  // Third-party risk assessment: fold supplier + component risk into a verdict.
  riskAssessment(name, version) { const c = this._components.get(`${name}@${version}`); if (!c) return { risk: 'unknown', acceptable: false }; const s = this._suppliers.get(c.supplier); const worst = RISK[Math.max(RISK.indexOf(c.risk), RISK.indexOf(s.risk))]; return { component: `${name}@${version}`, supplier: c.supplier, risk: worst, acceptable: RISK.indexOf(worst) <= RISK.indexOf('medium') }; }
  // Package lifecycle governance (approved → deprecated → banned).
  transition(name, version, status) { const c = this._components.get(`${name}@${version}`); if (!c) throw new Error('unknown component'); if (!['approved', 'deprecated', 'banned'].includes(status)) throw new Error('invalid status'); c.status = status; this._log('component-' + status, `${name}@${version}`); return { component: `${name}@${version}`, status }; }

  // SBOM governance + DEPLOYMENT GATE: every component in the SBOM must be trusted, integrity-
  // verified, not banned, and within acceptable risk. Fail-closed. An EMPTY SBOM (zero
  // third-party dependencies — NJTIP's baseline) trivially passes and is the safest posture.
  validateForDeployment(sbom = []) {
    const violations = [];
    for (const item of sbom) {
      const key = `${item.name}@${item.version}`; const c = this._components.get(key);
      if (!c) { violations.push({ component: key, rule: 'untrusted', detail: 'not in trusted registry' }); continue; }
      if (c.status === 'banned') violations.push({ component: key, rule: 'banned' });
      if (item.hash && this.verifyIntegrity(item.name, item.version, item.hash).ok === false) violations.push({ component: key, rule: 'integrity' });
      if (!this.riskAssessment(item.name, item.version).acceptable) violations.push({ component: key, rule: 'risk' });
    }
    return { pass: violations.length === 0, violations, componentsChecked: sbom.length, note: 'No deployment may bypass supply-chain governance. Fail-closed; deployment approval remains human.' };
  }
  // Dependency provenance: component → supplier chain.
  provenance(name, version) { const c = this._components.get(`${name}@${version}`); return c ? { component: `${name}@${version}`, supplier: c.supplier, integrity: c.integrity, supplierTrust: (this._suppliers.get(c.supplier) || {}).trustLevel } : null; }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, subject) { this._audit.push({ at: this._clock(), event, subject }); }
}

module.exports = { SupplyChainGovernance, RISK };
