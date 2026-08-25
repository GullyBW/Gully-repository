'use strict';
// Multi-Tenant Government Platform (Phase 22). Multiple agencies operate on shared platform
// services while remaining LOGICALLY and CRYPTOGRAPHICALLY isolated. A tenant has its own
// namespace, its own policy set, its own per-tenant encryption key REFERENCE, and its own
// audit trail. Cross-tenant access is FAIL-CLOSED by construction: a tenant-scoped store can
// only ever address its own prefix, so it cannot see another tenant's data.
//
// 🔒 Real per-tenant key material is HSM/KMS-managed (human-built). Here each tenant carries
// a synthetic keyRef only — the isolation model, not the cryptography.
const { PolicySet, DEFAULT_POLICIES } = require('../iam/policy-engine');

class TenantRegistry {
  constructor() { this._tenants = new Map(); }
  register(id, { name, policies } = {}) {
    if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('tenant id must be a slug');
    if (this._tenants.has(id)) throw new Error('tenant already registered: ' + id);
    this._tenants.set(id, { id, name: name || id, keyRef: `synthetic-kms://tenant/${id}`, policies: new PolicySet(policies || DEFAULT_POLICIES) });
    return this.get(id);
  }
  get(id) { return this._tenants.get(id) || null; }
  list() { return [...this._tenants.values()].map((t) => ({ id: t.id, name: t.name, keyRef: t.keyRef })); }
  has(id) { return this._tenants.has(id); }
}

// Tenant-scoped store: wraps any store (get/put/values/keys/size/delete) and confines it to
// one tenant's namespace. Keys are transparently prefixed; a scoped store CANNOT read or
// write outside its tenant prefix (structural isolation).
class TenantScopedStore {
  constructor(inner, tenantId) { if (!tenantId) throw new Error('tenant id required'); this._inner = inner; this._p = `t:${tenantId}:`; this.tenantId = tenantId; }
  _k(k) { return this._p + k; }
  _strip(k) { return k.slice(this._p.length); }
  get(k) { return this._inner.get(this._k(k)); }
  put(k, v) { return this._inner.put(this._k(k), v); }
  delete(k) { return this._inner.delete(this._k(k)); }
  keys() { return this._inner.keys().filter((k) => k.startsWith(this._p)).map((k) => this._strip(k)); }
  values() { return this.keys().map((k) => this.get(k)); }
  size() { return this.keys().length; }
}

// Cross-agency collaboration must be EXPLICIT and PII-free: a share is a request from one
// tenant to another, carrying only non-identifying references (never raw case content).
const SHARE_DENIED = new Set(['content', 'body', 'plaintext', 'omang', 'name', 'email', 'phone']);
function assertShareable(payload) {
  const scan = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (SHARE_DENIED.has(k.toLowerCase())) throw new Error(`cross-tenant share refuses field: ${k}`); scan(o[k]); } };
  scan(payload);
}

class CollaborationBroker {
  constructor(registry) { this._reg = registry; this._shares = []; }
  share({ fromTenant, toTenant, ref, reason }) {
    if (!this._reg.has(fromTenant) || !this._reg.has(toTenant)) throw new Error('unknown tenant in share');
    if (fromTenant === toTenant) throw new Error('cannot share to self');
    assertShareable(ref);
    const rec = { id: 'SH-' + (this._shares.length + 1), fromTenant, toTenant, ref, reason, accepted: false };
    this._shares.push(rec); return { ...rec };
  }
  accept(id, toTenant) { const s = this._shares.find((x) => x.id === id && x.toTenant === toTenant); if (!s) throw new Error('share not found for tenant'); s.accepted = true; return { ...s }; }
  inbox(toTenant) { return this._shares.filter((s) => s.toTenant === toTenant).map((s) => ({ ...s })); }
}

module.exports = { TenantRegistry, TenantScopedStore, CollaborationBroker, assertShareable };
