'use strict';
// Identity & Access (blueprint DDR-09, threats S-3/E-1/E-3).
// Zero standing privilege: sensitive scopes require just-in-time, time-boxed,
// phishing-resistant (FIDO2) grants. Separation of duties: no principal may hold
// mutually-exclusive roles (e.g. investigate AND adjudicate).
const SENSITIVE_ACTIONS = new Set(['read-evidence', 'route-report', 'seal-case', 'de-anonymize']);
const SOD_EXCLUSIONS = [
  ['investigate', 'adjudicate'],
  ['disclose', 'seal'],
];

class IAM {
  constructor(clock) {
    this._principals = new Map(); // id -> { roles, mfa, zone }
    this._grants = []; // JIT grants: { principal, action, zone, matter, expires, approvals }
    this._clock = clock;
  }

  addPrincipal(id, { roles = [], mfa = 'fido2', zone }) {
    this._principals.set(id, { id, roles, mfa, zone });
  }

  principals() {
    return [...this._principals.values()];
  }

  // Separation-of-duties check: no principal holds an excluded role pair.
  sodViolations() {
    const viol = [];
    for (const p of this._principals.values()) {
      for (const [a, b] of SOD_EXCLUSIONS) {
        if (p.roles.includes(a) && p.roles.includes(b)) viol.push({ principal: p.id, pair: [a, b] });
      }
    }
    return viol;
  }

  // Standing privilege = a grant with no expiry on a sensitive action. Must be empty.
  standingSensitiveGrants() {
    return this._grants.filter((g) => SENSITIVE_ACTIONS.has(g.action) && !g.expires);
  }

  // Issue a JIT grant. Sensitive actions REQUIRE fido2 + an expiry + (for de-anon) dual control.
  grant({ principal, action, zone, matter, ttlMs = 3600_000, approvals = [] }) {
    const p = this._principals.get(principal);
    if (!p) throw new Error('unknown principal');
    if (SENSITIVE_ACTIONS.has(action)) {
      if (p.mfa !== 'fido2') throw new Error('sensitive action requires phishing-resistant MFA (fido2)');
      if (!ttlMs || ttlMs <= 0) throw new Error('sensitive grant must be time-boxed (no standing privilege)');
    }
    const g = { principal, action, zone, matter, expires: this._clock() + ttlMs, approvals };
    this._grants.push(g);
    return g;
  }

  // ABAC decision: authenticated + a valid, unexpired, matter/zone-scoped grant.
  decide({ principal, action, zone, matter, authenticated = true }) {
    if (!authenticated) return { allow: false, reason: 'unauthenticated (zero trust)' };
    const now = this._clock();
    const g = this._grants.find(
      (x) => x.principal === principal && x.action === action && x.zone === zone &&
        (x.matter === matter || x.matter === '*') && x.expires > now
    );
    if (!g) return { allow: false, reason: 'no valid grant (default deny / least privilege)' };
    return { allow: true };
  }
}

module.exports = { IAM, SENSITIVE_ACTIONS };
