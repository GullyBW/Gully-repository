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
  // issuer/audience are the trust anchors; secret is the active HS256 key (JWKS in prod).
  constructor({ secret, issuer = 'njtip-idp', audience = 'njtip-app', clock = () => Date.now() }) {
    this._iss = issuer; this._aud = audience; this._clock = clock;
    // Key ring keyed by kid → secret (models JWKS with key rotation + verification overlap).
    this._activeKid = 'k1';
    this._keys = new Map([[this._activeKid, secret]]);
    this._revoked = new Set(); // revoked jti (token revocation / logout / compromise)
  }

  // Rotate to a new signing key; old keys stay valid for verification during the overlap
  // window (so tokens issued before rotation still verify) — matches JWKS rotation.
  rotateKey(newSecret, kid = 'k' + (this._keys.size + 1)) { this._keys.set(kid, newSecret); this._activeKid = kid; return kid; }
  jwks() { return [...this._keys.keys()].map((kid) => ({ kid, alg: 'HS256', active: kid === this._activeKid })); }
  revoke(jti) { this._revoked.add(jti); }

  // Reference-only token minting (stands in for the IdP during tests/offline demos).
  issue({ sub, role, ttlMs = 3600_000, acr }) {
    const header = { alg: 'HS256', typ: 'JWT', kid: this._activeKid };
    const now = Math.floor(this._clock() / 1000);
    const claims = { iss: this._iss, aud: this._aud, sub, [ROLE_CLAIM]: role, iat: now, exp: now + Math.floor(ttlMs / 1000), jti: crypto.randomBytes(9).toString('base64url'), acr };
    const signingInput = `${b64url(header)}.${b64url(claims)}`;
    const sig = crypto.createHmac('sha256', this._keys.get(this._activeKid)).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
  }

  verify(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    let header; try { header = JSON.parse(Buffer.from(h, 'base64url').toString()); } catch (_) { return null; }
    const key = this._keys.get(header.kid) || this._keys.get(this._activeKid);
    const expected = crypto.createHmac('sha256', key).update(`${h}.${p}`).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (_) { return null; }
    if (claims.iss !== this._iss || claims.aud !== this._aud) return null; // trust-anchor check
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= this._clock()) return null; // expiry
    if (claims.jti && this._revoked.has(claims.jti)) return null; // revoked
    const role = claims[ROLE_CLAIM];
    if (!ALLOWED_ROLES.has(role)) return null; // no implicit privilege
    return { principal: claims.sub, role, kind: 'oidc', jti: claims.jti, acr: claims.acr };
  }
}

// SAML assertion verifier (reference). Verifies an HMAC-signed, base64 assertion envelope
// with issuer/audience/expiry and maps to {principal, role}. Production verifies real
// XML-DSig against the IdP's certificate — same verify() contract.
class SamlVerifier {
  constructor({ secret, issuer = 'njtip-idp', audience = 'njtip-app', clock = () => Date.now() }) { this._secret = secret; this._iss = issuer; this._aud = audience; this._clock = clock; }
  issue({ sub, role, ttlMs = 3600_000 }) {
    const a = { iss: this._iss, aud: this._aud, sub, role, notOnOrAfter: this._clock() + ttlMs };
    const body = Buffer.from(JSON.stringify(a)).toString('base64');
    const sig = crypto.createHmac('sha256', this._secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  verify(assertion) {
    const [body, sig] = String(assertion).split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', this._secret).update(body).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let a; try { a = JSON.parse(Buffer.from(body, 'base64').toString()); } catch (_) { return null; }
    if (a.iss !== this._iss || a.aud !== this._aud) return null;
    if (a.notOnOrAfter <= this._clock()) return null;
    if (!ALLOWED_ROLES.has(a.role)) return null;
    return { principal: a.sub, role: a.role, kind: 'saml' };
  }
}

function makeOidcVerifier(cfg = {}) {
  return new OidcVerifier({ secret: cfg.OIDC_SECRET || cfg.SESSION_SECRET, issuer: cfg.oidcIssuer, audience: cfg.oidcAudience, clock: cfg.clock });
}

module.exports = { OidcVerifier, SamlVerifier, makeOidcVerifier, ALLOWED_ROLES, ROLE_CLAIM };
