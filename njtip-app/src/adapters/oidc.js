'use strict';
// OIDC / OAuth2 token-verification PORT. In production, portal users authenticate at an
// external IdP (enterprise IAM) and present a signed JWT bearer token; the gateway
// verifies it here and maps claims → { principal, role }. This adapter exposes the SAME
// verify(token) → {principal, role} | null contract as the SessionManager, so the server's
// auth middleware depends only on the port (docs/production-adapters.md).
//
// The REFERENCE verifier validates a compact JWS (HS256) against a shared secret and a
// deterministic claim set — enough to exercise the control flow offline and in tests.
// The PRODUCTION driver verifies RS256/ES256 against the IdP's JWKS (rotating keys),
// checks iss/aud/exp/nbf, and enforces FIDO2/MFA acr — same port, real trust anchor.
const crypto = require('node:crypto');

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }

// Map IdP roles/claims to platform roles. Kept explicit (no implicit privilege).
const ROLE_CLAIM = 'njtip_role';
const ALLOWED_ROLES = new Set(['investigator', 'oversight-board', 'admin', 'citizen']);

class OidcVerifier {
  // issuer/audience are the trust anchors; secret is the HS256 key (JWKS in production).
  constructor({ secret, issuer = 'njtip-idp', audience = 'njtip-app', clock = () => Date.now() }) {
    this._secret = secret; this._iss = issuer; this._aud = audience; this._clock = clock;
  }

  // Reference-only token minting (stands in for the IdP during tests/offline demos).
  issue({ sub, role, ttlMs = 3600_000 }) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(this._clock() / 1000);
    const claims = { iss: this._iss, aud: this._aud, sub, [ROLE_CLAIM]: role, iat: now, exp: now + Math.floor(ttlMs / 1000) };
    const signingInput = `${b64url(header)}.${b64url(claims)}`;
    const sig = crypto.createHmac('sha256', this._secret).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
  }

  verify(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const expected = crypto.createHmac('sha256', this._secret).update(`${h}.${p}`).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (_) { return null; }
    if (claims.iss !== this._iss || claims.aud !== this._aud) return null; // trust-anchor check
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= this._clock()) return null; // expiry
    const role = claims[ROLE_CLAIM];
    if (!ALLOWED_ROLES.has(role)) return null; // no implicit privilege
    return { principal: claims.sub, role, kind: 'oidc' };
  }
}

function makeOidcVerifier(cfg = {}) {
  return new OidcVerifier({ secret: cfg.OIDC_SECRET || cfg.SESSION_SECRET, issuer: cfg.oidcIssuer, audience: cfg.oidcAudience, clock: cfg.clock });
}

module.exports = { OidcVerifier, makeOidcVerifier, ALLOWED_ROLES, ROLE_CLAIM };
