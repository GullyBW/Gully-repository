'use strict';
// National Digital Identity & Trust Framework (Phase 51). Extends IAM into a sovereign
// identity platform for GOVERNED principals (staff, agencies, devices, services) — NEVER for
// anonymous reporters, whose unlinkability is preserved. Identities are OPAQUE ids plus
// non-identifying attributes (assurance level, role, issuer); personal data is refused
// (fail-closed). Verifiable-credential support is REFERENCE-ONLY (synthetic signatures).
// Deterministic and auditable. 🔒 real credential crypto is human-managed.
const { signing, hash } = require('../twin');

const IDENTITY_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'dob', 'passport', 'content']);
const IDENTITY_TYPES = new Set(['person', 'device', 'service', 'agency']);
const ASSURANCE_LEVELS = ['IAL1', 'IAL2', 'IAL3']; // identity assurance levels

function assertNonIdentifying(attrs = {}) {
  for (const k of Object.keys(attrs)) if (IDENTITY_FIELDS.has(k.toLowerCase())) throw new Error(`identity registry refuses personal-data field: ${k}`);
}

class IdentityRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._ids = new Map(); this._creds = new Map(); this._revoked = new Set(); this._issuers = new Map(); this._audit = []; }

  // Register a governed identity (opaque id + assurance level + non-identifying attributes).
  register(id, { type, assuranceLevel = 'IAL1', attributes = {} } = {}) {
    if (!id) throw new Error('identity id required');
    if (!IDENTITY_TYPES.has(type)) throw new Error('unknown identity type: ' + type);
    if (!ASSURANCE_LEVELS.includes(assuranceLevel)) throw new Error('unknown assurance level: ' + assuranceLevel);
    assertNonIdentifying(attributes);
    this._ids.set(id, { id, type, assuranceLevel, attributes: { ...attributes }, status: 'active', since: this._clock() });
    this._log('identity-registered', id);
    return this.describe(id);
  }
  describe(id) { const i = this._ids.get(id); return i ? { id: i.id, type: i.type, assuranceLevel: i.assuranceLevel, status: i.status, attributes: { ...i.attributes } } : null; }

  // Trust registry: register a credential issuer with a trust level (a trust anchor).
  registerIssuer(issuerId, { trustLevel = 'accredited' } = {}) { this._issuers.set(issuerId, { issuerId, trustLevel, since: this._clock() }); return { issuerId, trustLevel }; }
  isTrustedIssuer(issuerId) { return this._issuers.has(issuerId); }

  // Digital credential lifecycle: issue a verifiable credential (reference; synthetic proof).
  issueCredential({ credId, subject, issuer, claims = {}, assuranceLevel = 'IAL1', ttlMs = 31_536_000_000 }) {
    if (!credId || !subject || !issuer) throw new Error('credId, subject, and issuer are required');
    if (!this.isTrustedIssuer(issuer)) throw new Error('issuer is not in the trust registry (fail-closed)');
    assertNonIdentifying(claims);
    const vc = { credId, subject, issuer, assuranceLevel, claims: { ...claims }, issuedAt: this._clock(), expiresAt: this._clock() + ttlMs };
    vc.digest = hash.sha256({ credId, subject, issuer, assuranceLevel, claims: vc.claims, issuedAt: vc.issuedAt, expiresAt: vc.expiresAt });
    vc.proof = signing.sign(vc.digest); // 🔒 synthetic Ed25519 reference proof
    this._creds.set(credId, vc);
    this._log('credential-issued', credId, issuer);
    return { credId, subject, issuer, digest: vc.digest };
  }
  // Credential revocation registry.
  revoke(credId) { if (!this._creds.has(credId)) return false; this._revoked.add(credId); this._log('credential-revoked', credId); return true; }
  isRevoked(credId) { return this._revoked.has(credId); }

  // Verify a credential: valid signature + trusted issuer + not expired + not revoked (fail-closed).
  verifyCredential(credId) {
    const vc = this._creds.get(credId); if (!vc) return { valid: false, reason: 'unknown credential' };
    if (this.isRevoked(credId)) return { valid: false, reason: 'revoked' };
    if (vc.expiresAt <= this._clock()) return { valid: false, reason: 'expired' };
    if (!this.isTrustedIssuer(vc.issuer)) return { valid: false, reason: 'issuer no longer trusted' };
    if (!signing.verify(vc.digest, vc.proof)) return { valid: false, reason: 'invalid proof' };
    return { valid: true, subject: vc.subject, assuranceLevel: vc.assuranceLevel, issuer: vc.issuer };
  }
  // Trust chain validation: credential → trusted issuer → identity active.
  validateTrustChain(credId) {
    const v = this.verifyCredential(credId);
    if (!v.valid) return { ok: false, reason: v.reason };
    const subj = this._ids.get(v.subject);
    return { ok: !!(subj && subj.status === 'active'), links: ['credential', 'issuer', 'identity'], subjectActive: !!(subj && subj.status === 'active') };
  }

  // Delegated identity: a scoped, time-boxed delegation (audited; never silent).
  delegate({ from, to, scope, ttlMs = 3600_000, approver }) {
    if (!this._ids.has(from) || !this._ids.has(to)) throw new Error('unknown identity in delegation');
    if (!approver) throw new Error('delegation requires a human approver');
    this._log('identity-delegated', `${from}->${to}:${scope}`, approver);
    return { from, to, scope, expiresAt: this._clock() + ttlMs };
  }
  // Compatibility validation: an assurance-level change must not DOWNGRADE silently.
  checkAssuranceChange(id, newLevel) { const i = this._ids.get(id); if (!i) return { ok: false, reason: 'unknown identity' }; const downgrade = ASSURANCE_LEVELS.indexOf(newLevel) < ASSURANCE_LEVELS.indexOf(i.assuranceLevel); return { ok: !downgrade, downgrade, from: i.assuranceLevel, to: newLevel }; }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, subject, actor) { this._audit.push({ at: this._clock(), event, subject, actor: actor || 'system' }); }
}

module.exports = { IdentityRegistry, ASSURANCE_LEVELS, IDENTITY_TYPES };
