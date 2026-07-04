'use strict';

const { LEVELS } = require('../platform/identity/identity.service');

/**
 * Identity Plane (DPI governed plane #1). A hard boundary over the Identity
 * Graph: it exposes ONLY identity assertions and never lets another plane
 * reach into identity's raw stores. The Policy Kernel, AI Gateway and Data
 * Product Plane consume assertions — they never read `identity.users` or
 * `identity.roles` directly.
 *
 * An assertion is a minimal, side-effect-free view of who the subject is
 * right now: verification level, active (non-suspended) role grants, tenant,
 * and the community relationships policy needs (ward/morafe) — nothing else.
 */
class IdentityPlane {
  constructor({ identity }) {
    this.identity = identity;
  }

  /** Produce an identity assertion for a subject (null → anonymous). */
  assert(subject, { deviceId = null, tenant = 'motse' } = {}) {
    if (!subject) {
      return this._anon(tenant, deviceId);
    }
    let user;
    try {
      user = this.identity.get(subject); // throws NOT_FOUND for an unknown subject
    } catch (e) {
      return this._anon(tenant, deviceId, subject);
    }
    const roles = this.identity.roles
      .find((g) => g.user_ref === subject && !g.suspended)
      .map((g) => ({ role: g.role, scope: g.scope }));
    return {
      subject,
      authenticated: true,
      level: user.level,
      roles,
      tenant: user.tenant || tenant,
      suspended: !!user.suspended,
      ward_ref: user.ward_ref || null,
      morafe_refs: user.morafe_refs || [],
      device_id: deviceId,
    };
  }

  _anon(tenant, deviceId, subject = null) {
    return {
      subject, authenticated: false, level: 'L0', roles: [], tenant,
      suspended: false, ward_ref: null, morafe_refs: [], device_id: deviceId,
    };
  }

  /** Convenience predicates over an assertion (used by the Policy Kernel). */
  static hasRole(assertion, role, scope) {
    return assertion.roles.some((r) => r.role === role && (scope === undefined || r.scope === scope));
  }

  static atLeast(assertion, level) {
    return LEVELS.indexOf(assertion.level) >= LEVELS.indexOf(level);
  }
}

module.exports = { IdentityPlane };
