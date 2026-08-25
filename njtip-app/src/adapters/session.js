'use strict';
// Secure session management (production-shaped, still synthetic identities).
// Issues signed, expiring session tokens (HMAC-SHA256 over payload) with constant-
// time verification and server-side revocation. Replaces the static demo-token map
// while remaining backward-compatible with it. Production swaps issuance for OIDC +
// FIDO2 at the gateway (component-transition-matrix.md) behind this same port.
const crypto = require('node:crypto');

// Legacy synthetic demo tokens (kept for backward compatibility with the MVP/tests).
const LEGACY = {
  'inv-token-synthetic': { principal: 'inv-001', role: 'investigator' },
  'gov-token-synthetic': { principal: 'gov-001', role: 'oversight-board' },
  'admin-token-synthetic': { principal: 'adm-001', role: 'admin' },
};

class SessionManager {
  constructor({ secret, ttlMs = 3600_000, clock = () => Date.now() }) {
    this._secret = secret;
    this._ttl = ttlMs;
    this._clock = clock;
    this._revoked = new Set();
  }

  _sign(payloadB64) {
    return crypto.createHmac('sha256', this._secret).update(payloadB64).digest('base64url');
  }

  // Synthetic "login": in production this follows OIDC/FIDO2 assertion verification.
  issue({ principal, role }) {
    const payload = { principal, role, exp: this._clock() + this._ttl, jti: crypto.randomBytes(9).toString('base64url') };
    const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${b}.${this._sign(b)}`;
  }

  revoke(token) { const p = this._parse(token); if (p) this._revoked.add(p.jti); }

  _parse(token) {
    const [b, sig] = String(token).split('.');
    if (!b || !sig) return null;
    const expected = this._sign(b);
    // Constant-time comparison to avoid signature-timing oracles.
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try { return JSON.parse(Buffer.from(b, 'base64url').toString()); } catch (_) { return null; }
  }

  // Verify a bearer token: session token OR legacy demo token. Returns principal/role or null.
  verify(token) {
    if (LEGACY[token]) return { ...LEGACY[token], kind: 'legacy-synthetic' };
    const p = this._parse(token);
    if (!p) return null;
    if (p.exp <= this._clock()) return null; // expired
    if (this._revoked.has(p.jti)) return null; // revoked
    return { principal: p.principal, role: p.role, kind: 'session' };
  }
}

module.exports = { SessionManager, LEGACY };
