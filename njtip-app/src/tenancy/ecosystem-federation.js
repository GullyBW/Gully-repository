'use strict';
// National Digital Ecosystem Federation (Phase 61). Extends the federation bounded context
// from tenant-to-tenant into a NATIONWIDE interoperability framework spanning government,
// municipalities, state-owned enterprises, regulated private sector, and international
// partners. Federation remains EXPLICIT, GOVERNED, TIME-BOXED, AUDITABLE, and HUMAN-APPROVED
// (separation of duties). Deterministic. All shared references are non-identifying.
const { assertShareable } = require('./tenant');

const MEMBER_TYPES = new Set(['government', 'municipality', 'soe', 'regulated-private', 'international']);
const LIFECYCLE = ['proposed', 'active', 'suspended', 'terminated'];

class EcosystemFederation {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._members = new Map(); this._agreements = []; this._services = new Map(); this._audit = []; this._seq = 0; }

  // Register an ecosystem member (typed by sector, with a jurisdiction + trust tier).
  registerMember(id, { type, jurisdiction = 'national', trustTier = 'standard' } = {}) {
    if (!id || !MEMBER_TYPES.has(type)) throw new Error('member id and a valid type are required');
    this._members.set(id, { id, type, jurisdiction, trustTier, status: 'active', since: this._clock() });
    this._log('member-registered', id);
    return this.describeMember(id);
  }
  describeMember(id) { const m = this._members.get(id); return m ? { ...m } : null; }
  members(type) { return [...this._members.values()].filter((m) => !type || m.type === type).map((m) => ({ ...m })); }

  // Cross-domain trust agreement: EXPLICIT, scoped, time-boxed, SoD-authorised.
  establishAgreement({ from, to, scopes = [], ttlMs = 604_800_000, approver, requester }) {
    if (!this._members.has(from) || !this._members.has(to)) throw new Error('unknown member in agreement');
    if (from === to) throw new Error('a member cannot federate with itself');
    if (!scopes.length) throw new Error('a trust agreement requires explicit scopes');
    if (!approver || !requester) throw new Error('federation requires a requester and a distinct human approver');
    if (approver === requester) throw new Error('federation approver must differ from the requester (separation of duties)');
    const a = { id: 'FA-' + (++this._seq).toString().padStart(4, '0'), from, to, scopes: [...scopes], approver, requester, status: 'active', grantedAt: this._clock(), expiresAt: this._clock() + ttlMs };
    this._agreements.push(a); this._log('agreement-established', `${from}->${to}`, approver);
    return { ...a };
  }
  // Is (from → to) federated for a scope right now? Default is NOT federated (isolation).
  isFederated(from, to, scope) { return this._agreements.some((a) => a.status === 'active' && a.expiresAt > this._clock() && a.from === from && a.to === to && a.scopes.includes(scope)); }
  suspendAgreement(id) { const a = this._agreements.find((x) => x.id === id); if (a) { a.status = 'suspended'; this._log('agreement-suspended', id); } return !!a; }

  // Federated service discovery: a member registers services; discovery respects agreements.
  registerService(memberId, service, { scope = 'services' } = {}) { if (!this._members.has(memberId)) throw new Error('unknown member'); if (!this._services.has(memberId)) this._services.set(memberId, []); this._services.get(memberId).push({ service, scope }); return { memberId, service }; }
  discoverServices(fromMember, scope = 'services') {
    const out = [];
    for (const [memberId, svcs] of this._services) {
      if (memberId !== fromMember && !this.isFederated(fromMember, memberId, scope)) continue; // isolation default
      out.push({ member: memberId, services: svcs.filter((s) => s.scope === scope).map((s) => s.service) });
    }
    return out;
  }
  // Federated identity trust: a member accepts another's credentials only under an active
  // 'identity' agreement (fail-closed).
  acceptsIdentityFrom(fromMember, credentialIssuerMember) { return fromMember === credentialIssuerMember || this.isFederated(fromMember, credentialIssuerMember, 'identity'); }

  // Cross-domain policy enforcement: check a shared reference is PII-free before it crosses a
  // federation boundary (privacy-by-design across the whole ecosystem).
  enforceCrossDomain(ref) { assertShareable(ref); return { ok: true }; }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  agreements() { return this._agreements.map((a) => ({ id: a.id, from: a.from, to: a.to, scopes: a.scopes, status: a.status })); }
  _log(event, subject, actor) { this._audit.push({ at: this._clock(), event, subject, actor: actor || 'system' }); }
}

module.exports = { EcosystemFederation, MEMBER_TYPES, LIFECYCLE };
