'use strict';
// Government Capability Marketplace (Phase 68). Extends the Developer Platform into a reusable
// CAPABILITY ecosystem: a capability registry, an API/workflow/policy/connector/template
// marketplace, shared governance artifacts, capability certification, versioning, and
// compatibility validation. Marketplace PUBLICATION is GOVERNED and HUMAN-APPROVED (nothing
// is publicly listed without a certified, human-approved publication). Deterministic.
const CAPABILITY_TYPES = new Set(['api', 'workflow', 'policy', 'connector', 'template', 'governance-artifact']);

class CapabilityMarketplace {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._caps = new Map(); this._audit = []; }

  // Register a capability version (starts 'draft'). Versions are additive.
  register(id, { type, owner, spec = {}, compatibleWith = [] } = {}) {
    if (!id || !CAPABILITY_TYPES.has(type) || !owner) throw new Error('capability id, a valid type, and an owner are required');
    const versions = this._caps.get(id) || [];
    const version = versions.length + 1;
    versions.push({ id, type, owner, version, spec, compatibleWith: [...compatibleWith], status: 'draft', certified: false, published: false });
    this._caps.set(id, versions);
    this._log('registered', id, owner);
    return { id, version, status: 'draft' };
  }
  _latest(id) { const v = this._caps.get(id); return v ? v[v.length - 1] : null; }

  // Certification: a lightweight quality gate (must have a spec + an owner).
  certify(id) { const c = this._must(id); c.certified = !!(c.spec && Object.keys(c.spec).length && c.owner); this._log('certified:' + c.certified, id); return { id, version: c.version, certified: c.certified }; }

  // Compatibility validation: is candidate compatible with a target capability id?
  checkCompatibility(id, targetId) { const c = this._must(id); return { id, targetId, compatible: c.compatibleWith.includes(targetId) }; }

  // PUBLICATION — governed + human-approved. Requires certification + a named human + rationale.
  publish(id, { by, rationale } = {}) {
    const c = this._must(id);
    if (!c.certified) throw new Error('capability must be certified before publication');
    if (!by || !rationale) throw new Error('marketplace publication requires a named human and a rationale');
    c.status = 'published'; c.published = true; c.publishedBy = by; this._log('published', id, by);
    return { id, version: c.version, status: 'published', publishedBy: by };
  }
  // Discovery: only PUBLISHED capabilities appear in the marketplace catalogue.
  discover({ type } = {}) { return [...this._caps.keys()].map((id) => this._latest(id)).filter((c) => c.published && (!type || c.type === type)).map((c) => ({ id: c.id, type: c.type, owner: c.owner, version: c.version, certified: c.certified })); }
  describe(id) { const c = this._latest(id); return c ? { id: c.id, type: c.type, owner: c.owner, version: c.version, status: c.status, certified: c.certified, published: c.published } : null; }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id, actor) { this._audit.push({ at: this._clock(), event, capability: id, actor: actor || 'system' }); }
  _must(id) { const c = this._latest(id); if (!c) throw new Error('unknown capability: ' + id); return c; }
}

module.exports = { CapabilityMarketplace, CAPABILITY_TYPES };
