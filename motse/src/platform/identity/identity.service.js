'use strict';

const { id, sha256, hmac, timingSafeEqual } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

const LEVELS = ['L0', 'L1', 'L2', 'L3'];
const ACCESS_TTL_MS = 15 * 60 * 1000; // short-lived access tokens (§5.3)
const OTP_TTL_MS = 5 * 60 * 1000;

/**
 * Identity service (doc §5) — extracted day one (P6).
 *
 * One identity, many privileges (P2): a single account accrues
 * verification levels L0→L3; features gate on levels, never on separate
 * accounts. Roles are contextual (role, scope) pairs, e.g.
 * custodian(morafe:bakalanga). The ward graph and morafe membership are
 * attested here, server-side, at read time.
 */
class IdentityService {
  constructor({ store, clock, audit, secret = 'motse-dev-secret' }) {
    this.users = store.collection('users');
    this.otps = store.collection('otp_challenges');
    this.sessions = store.collection('sessions');
    this.roles = store.collection('role_grants');
    this.memberships = store.collection('morafe_memberships');
    this.endorsements = store.collection('ward_endorsements');
    this.clock = clock;
    this.audit = audit;
    this.secret = secret;
  }

  // ── Accounts and levels ────────────────────────────────────────────

  /** L0: anonymous install — browse public content, listen. */
  registerAnonymous(deviceId) {
    return this.users.insert({
      id: id('usr'),
      msisdn_hash: null,
      display_name: null,
      langs: ['tn'],
      level: 'L0',
      ward_ref: null,
      morafe_refs: [],
      devices: deviceId ? [deviceId] : [],
      created_at: this.clock.nowIso(),
    });
  }

  /** Start phone verification. In sandbox the code is derived, not sent. */
  requestOtp(msisdn) {
    const code = String(parseInt(sha256(msisdn).slice(0, 6), 16) % 1000000).padStart(6, '0');
    const challenge = {
      id: id('otp'),
      msisdn_hash: sha256(msisdn),
      code_hash: sha256(code),
      expires_at: this.clock.nowMs() + OTP_TTL_MS,
      consumed: false,
    };
    this.otps.insert(challenge);
    // Returned only in sandbox mode; production sends via the SMS gateway.
    return { challenge_id: challenge.id, sandbox_code: code };
  }

  /**
   * Complete OTP → L1 (phone-verified). Reuses the existing account for
   * a known MSISDN — the same identity across app and USSD (§5.3).
   */
  verifyOtp(msisdn, code, { deviceId, userId } = {}) {
    const msisdnHash = sha256(msisdn);
    const challenge = this.otps.findOne(
      (c) => c.msisdn_hash === msisdnHash && !c.consumed && c.expires_at > this.clock.nowMs()
    );
    if (!challenge || !timingSafeEqual(challenge.code_hash, sha256(code))) {
      throw err('INVALID_ARGUMENT', 'OTP invalid or expired');
    }
    this.otps.update(challenge.id, { consumed: true });

    let user = this.users.findOne((u) => u.msisdn_hash === msisdnHash);
    if (!user && userId) {
      // Upgrading an anonymous install in place — one account, more privileges.
      user = this.users.update(userId, { msisdn_hash: msisdnHash, level: 'L1' });
    } else if (!user) {
      user = this.users.insert({
        id: id('usr'),
        msisdn_hash: msisdnHash,
        display_name: null,
        langs: ['tn'],
        level: 'L1',
        ward_ref: null,
        morafe_refs: [],
        devices: [],
        created_at: this.clock.nowIso(),
      });
    } else if (LEVELS.indexOf(user.level) < 1) {
      user = this.users.update(user.id, { level: 'L1' });
    }
    if (deviceId && !user.devices.includes(deviceId)) {
      user = this.users.update(user.id, { devices: [...user.devices, deviceId] });
    }
    const session = this._mintSession(user, deviceId);
    return { user, session };
  }

  /**
   * USSD identity (§5.3): MSISDN maps to the same account. The operator
   * session authenticates the SIM, so gateway-originated accounts start
   * at L1 (phone-verified) — a Nokia brick is a first-class citizen (P9).
   */
  findOrCreateByMsisdn(msisdn) {
    const msisdnHash = sha256(msisdn);
    const existing = this.users.findOne((u) => u.msisdn_hash === msisdnHash);
    if (existing) return existing;
    return this.users.insert({
      id: id('usr'),
      msisdn_hash: msisdnHash,
      display_name: null,
      langs: ['tn'],
      level: 'L1',
      ward_ref: null,
      morafe_refs: [],
      devices: [],
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * L2: ward verification by endorsement of the headman's office /
   * verification circle, recorded in-app (§5.1).
   */
  endorseWardResidency(userId, wardRef, endorserId) {
    this.requireLevel(endorserId, 'L2');
    if (
      !this.hasRole(endorserId, 'headman_office', `ward:${wardRef}`) &&
      !this.hasRole(endorserId, 'verification_circle', `ward:${wardRef}`)
    ) {
      throw err('PERMISSION_DENIED', 'Endorser is not part of the ward verification circle');
    }
    const user = this._mustGet(userId);
    this.requireLevel(userId, 'L1'); // must be phone-verified first
    this.endorsements.insert({
      id: id('end'),
      user_ref: userId,
      ward_ref: wardRef,
      endorser_ref: endorserId,
      ts: this.clock.nowIso(),
    });
    const updated = this.users.update(userId, {
      ward_ref: wardRef,
      level: LEVELS.indexOf(user.level) < 2 ? 'L2' : user.level,
    });
    this.audit.append(endorserId, 'identity.ward_endorsed', `user:${userId}`, null, {
      ward_ref: wardRef,
    });
    return updated;
  }

  /** L3: institutional / office — documents verified by an existing L3 admin. */
  grantInstitutional(userId, { institution, documentRefs = [] }, grantedBy) {
    if (grantedBy !== 'system:bootstrap') this.requireLevel(grantedBy, 'L3');
    if (!institution) throw err('INVALID_ARGUMENT', 'institution is required');
    const user = this.users.update(userId, { level: 'L3', institution });
    this.audit.append(grantedBy, 'identity.institutional_granted', `user:${userId}`, null, {
      institution,
      document_refs: documentRefs,
    });
    return user;
  }

  requireLevel(userId, requiredLevel) {
    const user = this._mustGet(userId);
    if (LEVELS.indexOf(user.level) < LEVELS.indexOf(requiredLevel)) {
      throw err('AUTH_LEVEL_REQUIRED', `This action requires ${requiredLevel}`, {
        required_level: requiredLevel,
      });
    }
    return user;
  }

  // ── Contextual RBAC (§5.2) ─────────────────────────────────────────

  /** Grant (role, scope) — e.g. custodian, morafe:bakalanga. */
  grantRole(userId, role, scope, grantedBy) {
    this._mustGet(userId);
    const grant = this.roles.insert({
      id: id('rol'),
      user_ref: userId,
      role,
      scope,
      suspended: false,
      granted_by: grantedBy,
      ts: this.clock.nowIso(),
    });
    this.audit.append(grantedBy, 'identity.role_granted', `user:${userId}`, null, { role, scope });
    return grant;
  }

  revokeRole(userId, role, scope, revokedBy) {
    const grant = this.roles.findOne(
      (g) => g.user_ref === userId && g.role === role && g.scope === scope
    );
    if (grant) {
      this.roles.delete(grant.id);
      this.audit.append(revokedBy, 'identity.role_revoked', `user:${userId}`, { role, scope }, null);
    }
  }

  /** Suspend/resume all grants tied to a scope — Ring 3 seat freezes (§10.2). */
  setScopeSuspended(role, scope, suspended, actor) {
    for (const grant of this.roles.find((g) => g.role === role && g.scope === scope)) {
      this.roles.update(grant.id, { suspended });
    }
    this.audit.append(actor, suspended ? 'identity.scope_suspended' : 'identity.scope_resumed',
      `scope:${scope}`, null, { role, suspended });
  }

  hasRole(userId, role, scope) {
    return !!this.roles.findOne(
      (g) => g.user_ref === userId && g.role === role && g.scope === scope && !g.suspended
    );
  }

  /** Policy check used by the API layer; frozen seats read as SEAT_FROZEN. */
  requireRole(userId, role, scope) {
    const active = this.hasRole(userId, role, scope);
    if (active) return true;
    const suspendedGrant = this.roles.findOne(
      (g) => g.user_ref === userId && g.role === role && g.scope === scope && g.suspended
    );
    if (suspendedGrant) throw err('SEAT_FROZEN', `${role}(${scope}) is suspended pending Ring 3`);
    throw err('PERMISSION_DENIED', `Requires ${role}(${scope})`);
  }

  // ── Morafe membership (restricted-content gate, §5.2/§6.4) ─────────

  joinMorafe(userId, morafeRef, attestedBy) {
    this.requireLevel(userId, 'L2'); // morafe membership gates on ward verification
    const user = this._mustGet(userId);
    if (!user.morafe_refs.includes(morafeRef)) {
      this.users.update(userId, { morafe_refs: [...user.morafe_refs, morafeRef] });
    }
    this.memberships.insert({
      id: id('mem'),
      user_ref: userId,
      morafe_ref: morafeRef,
      attested_by: attestedBy,
      ts: this.clock.nowIso(),
    });
    return this.users.get(userId);
  }

  /** Server-side attestation at read time — the restricted read path. */
  attestMembership(userId, morafeRef) {
    const user = this.users.get(userId);
    return !!user && user.morafe_refs.includes(morafeRef);
  }

  // ── Sessions & devices (§5.3) ──────────────────────────────────────

  _mintSession(user, deviceId) {
    const session = {
      id: id('ses'),
      user_ref: user.id,
      device_id: deviceId || null,
      refresh_token: id('rft'),
      created_at: this.clock.nowIso(),
    };
    this.sessions.insert(session);
    return {
      session_id: session.id,
      access_token: this._signAccess(user.id, deviceId, session.id),
      refresh_token: session.refresh_token,
    };
  }

  _signAccess(userId, deviceId, sessionId) {
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        dev: deviceId || null,
        sid: sessionId,
        exp: this.clock.nowMs() + ACCESS_TTL_MS,
      })
    ).toString('base64url');
    return `${payload}.${hmac(this.secret, payload)}`;
  }

  /** Verify a device-bound access token. */
  verifyAccess(token, { deviceId } = {}) {
    if (!token) throw err('UNAUTHENTICATED');
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig || !timingSafeEqual(hmac(this.secret, payload), sig)) {
      throw err('UNAUTHENTICATED', 'Invalid token signature');
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp < this.clock.nowMs()) throw err('UNAUTHENTICATED', 'Token expired');
    if (claims.dev && deviceId && claims.dev !== deviceId) {
      throw err('UNAUTHENTICATED', 'Token bound to a different device');
    }
    return claims;
  }

  /** Rotating refresh (§5.3): old refresh token is invalidated. */
  refreshSession(refreshToken) {
    const session = this.sessions.findOne((s) => s.refresh_token === refreshToken);
    if (!session) throw err('UNAUTHENTICATED', 'Unknown refresh token');
    const rotated = this.sessions.update(session.id, { refresh_token: id('rft') });
    const user = this._mustGet(session.user_ref);
    return {
      session_id: session.id,
      access_token: this._signAccess(user.id, session.device_id, session.id),
      refresh_token: rotated.refresh_token,
    };
  }

  _mustGet(userId) {
    const user = this.users.get(userId);
    if (!user) throw err('NOT_FOUND', `No user ${userId}`);
    return user;
  }

  get(userId) {
    return this._mustGet(userId);
  }
}

module.exports = { IdentityService, LEVELS };
