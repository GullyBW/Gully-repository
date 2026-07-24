'use strict';
// Federated Multi-Tenant Collaboration (Phase 34). Extends the tenancy platform with
// CONTROLLED federation: isolation remains the DEFAULT and federation requires EXPLICIT,
// time-boxed, human-authorized grants (separation of duties). Supports cross-agency
// investigations, delegated authority, shared (PII-free) evidence references, temporary
// collaboration spaces, cross-tenant auditing, and federated search. Deterministic.
const { assertShareable } = require('./tenant');

class FederationRegistry {
  constructor({ clock = () => Date.now(), registry } = {}) { this._clock = clock; this._reg = registry; this._grants = []; this._spaces = new Map(); this._seq = 0; this._audit = []; }

  // Establish a federation grant between two tenants. EXPLICIT + time-boxed + SoD.
  authorize({ fromTenant, toTenant, scopes = [], ttlMs = 86_400_000, approver, requester }) {
    if (this._reg && (!this._reg.has(fromTenant) || !this._reg.has(toTenant))) throw new Error('unknown tenant in federation grant');
    if (fromTenant === toTenant) throw new Error('cannot federate a tenant with itself');
    if (!approver || !requester) throw new Error('federation requires a requester and a distinct human approver');
    if (approver === requester) throw new Error('federation approver must differ from the requester (separation of duties)');
    if (!scopes.length) throw new Error('federation requires explicit scopes');
    const grant = { id: 'FED-' + (++this._seq).toString().padStart(4, '0'), fromTenant, toTenant, scopes: [...scopes], approver, requester, grantedAt: this._clock(), expiresAt: this._clock() + ttlMs, active: true };
    this._grants.push(grant);
    this._audit.push({ at: this._clock(), event: 'federation-authorized', fromTenant, toTenant, scopes, by: approver });
    return { ...grant };
  }
  // Is (from → to) federated for a scope RIGHT NOW? Default is NOT federated (isolation).
  isFederated(fromTenant, toTenant, scope) {
    return this._grants.some((g) => g.active && g.expiresAt > this._clock() && g.fromTenant === fromTenant && g.toTenant === toTenant && g.scopes.includes(scope));
  }
  revoke(id) { const g = this._grants.find((x) => x.id === id); if (g) { g.active = false; this._audit.push({ at: this._clock(), event: 'federation-revoked', id }); } return !!g; }

  // Delegated authority: a scoped, time-boxed delegation recorded on the federation audit.
  delegate({ fromTenant, toTenant, scope, ttlMs, approver, requester }) {
    if (!this.isFederated(fromTenant, toTenant, scope)) throw new Error('delegation requires an active federation grant for the scope');
    this._audit.push({ at: this._clock(), event: 'authority-delegated', fromTenant, toTenant, scope, by: approver, requester });
    return { delegated: true, scope };
  }

  // Temporary collaboration space for a cross-agency investigation (TTL-bound, PII-free refs).
  createSpace({ tenants, reason, ttlMs = 604_800_000 }) {
    if (!Array.isArray(tenants) || tenants.length < 2) throw new Error('a collaboration space needs at least two tenants');
    const id = 'SPACE-' + (this._spaces.size + 1);
    this._spaces.set(id, { id, tenants: [...tenants], reason, refs: [], expiresAt: this._clock() + ttlMs });
    return { id, tenants };
  }
  shareRef(spaceId, ref) { const s = this._spaces.get(spaceId); if (!s || s.expiresAt <= this._clock()) throw new Error('collaboration space not found or expired'); assertShareable(ref); s.refs.push(ref); return { spaceId, refCount: s.refs.length }; }
  space(spaceId) { const s = this._spaces.get(spaceId); return s ? { id: s.id, tenants: s.tenants, refs: [...s.refs], active: s.expiresAt > this._clock() } : null; }

  // Federated search: query across ONLY the tenants federated to the caller for the scope.
  federatedSearch(fromTenant, scope, tenantStores, query) {
    const results = [];
    for (const [tenantId, store] of Object.entries(tenantStores)) {
      if (tenantId !== fromTenant && !this.isFederated(fromTenant, tenantId, scope)) continue; // isolation default
      results.push({ tenant: tenantId, matches: store.searchCases ? store.searchCases(query) : [] });
    }
    return results;
  }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  grants() { return this._grants.map((g) => ({ id: g.id, fromTenant: g.fromTenant, toTenant: g.toTenant, scopes: g.scopes, active: g.active && g.expiresAt > this._clock() })); }
}

module.exports = { FederationRegistry };
