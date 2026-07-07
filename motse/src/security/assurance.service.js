'use strict';

const { id, sha256 } = require('../kernel/ids');
const { err } = require('../kernel/errors');

const EARTH_RADIUS_KM = 6371;
const IMPOSSIBLE_KMH = 900; // faster than a commercial flight → impossible
const ATO_FAILURE_THRESHOLD = 5;
const ABUSE_WINDOW_MS = 5 * 60 * 1000;
const ABUSE_THRESHOLD = 40; // 4xx responses in the window
const HOLD_MS = 24 * 3600 * 1000;

/**
 * Security assurance (Phase 2, WS6). A detection layer over the
 * existing primitives: it consumes login/API telemetry, raises typed
 * security events, places time-boxed payout holds, scores device risk,
 * and automates credential rotation. Enforcement stays where it always
 * was (fraud engine, rate limiter, identity) — this service registers
 * checks into those hooks rather than duplicating them.
 */
class AssuranceService {
  constructor({ store, clock, identity, secrets, fraud, audit, bus }) {
    this.events = store.collection('security_events');
    this.logins = store.collection('login_events');
    this.deviceReg = store.collection('device_registrations');
    this.clock = clock;
    this.identity = identity;
    this.secrets = secrets;
    this.fraud = fraud;
    this.audit = audit;
    this.bus = bus;
    this.holds = new Map(); // userRef -> expiry ms
    this.authFailures = new Map(); // msisdnHash -> count since last success
    this.apiFailures = new Map(); // key -> [timestamps]
    this.blocked = new Map(); // key -> expiry ms
    this.rotationPolicies = new Map(); // secretName -> intervalDays

    bus.register('security.event.raised', 1, ['event_id', 'type', 'severity']);

    // Suspicious-payout detection plugs into the EXISTING fraud engine.
    fraud.register('security_hold', (ctx) => {
      if (ctx.kind === 'payout' && ctx.actorRef && this.hasHold(ctx.actorRef)) {
        return { action: 'deny', detail: 'account under a 24h security hold' };
      }
      return null;
    });
    fraud.register('payout_msisdn_mismatch', (ctx) => {
      if (ctx.kind !== 'payout' || !ctx.actorRef || !ctx.msisdn) return null;
      const user = this.identity.users.get(ctx.actorRef);
      if (user && user.msisdn_hash && user.msisdn_hash !== sha256(ctx.msisdn)) {
        return { action: 'review', detail: 'payout msisdn differs from the account msisdn' };
      }
      return null;
    });
  }

  // ── Event stream ───────────────────────────────────────────────────

  raise(type, severity, { subjectRef = null, detail = null, context = {} } = {}) {
    const event = this.events.insert({
      id: id('sec'),
      type,
      severity, // info | medium | high
      subject_ref: subjectRef,
      detail,
      context,
      ts: this.clock.nowIso(),
    });
    this.bus.publish('security.event.raised', {
      event_id: event.id,
      type,
      severity,
      subject_ref: subjectRef,
    });
    return event;
  }

  listEvents({ severity, type } = {}) {
    return this.events.find(
      (e) => (!severity || e.severity === severity) && (!type || e.type === type)
    );
  }

  // ── Login telemetry (wired from the OTP verify route) ──────────────

  recordLogin(userRef, { deviceId = null, msisdn = null, geo = null } = {}) {
    const now = this.clock.nowMs();

    // Device registration age — feeds the SIM-swap/new-device heuristics.
    if (deviceId) {
      const known = this.deviceReg.findOne(
        (r) => r.user_ref === userRef && r.device_id === deviceId
      );
      if (!known) {
        this.deviceReg.insert({
          id: id('dvr'),
          user_ref: userRef,
          device_id: deviceId,
          first_seen_ms: now,
          first_seen: this.clock.nowIso(),
        });
        this.raise('new_device', 'info', {
          subjectRef: userRef,
          detail: `first login from device`,
          context: { device: sha256(deviceId).slice(0, 12) },
        });
        // Account takeover: repeated OTP failures, then success from a
        // brand-new device → high-severity event + 24h payout hold.
        const msisdnHash = msisdn ? sha256(msisdn) : null;
        if (msisdnHash && (this.authFailures.get(msisdnHash) || 0) >= ATO_FAILURE_THRESHOLD) {
          this.raise('account_takeover_suspected', 'high', {
            subjectRef: userRef,
            detail: `${this.authFailures.get(msisdnHash)} OTP failures then success from a new device`,
          });
          this.placeHold(userRef, 'account_takeover_suspected');
        }
      }
    }
    if (msisdn) this.authFailures.delete(sha256(msisdn));

    // Impossible travel: two logins too far apart, too close in time.
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      const previous = this.logins
        .find((l) => l.user_ref === userRef && l.geo)
        .pop();
      if (previous) {
        const km = AssuranceService.distanceKm(previous.geo, geo);
        const hours = Math.max((now - previous.at_ms) / 3600000, 1 / 60);
        if (km / hours > IMPOSSIBLE_KMH && km > 100) {
          this.raise('impossible_travel', 'high', {
            subjectRef: userRef,
            detail: `${Math.round(km)}km in ${hours.toFixed(2)}h`,
          });
          this.placeHold(userRef, 'impossible_travel');
        }
      }
    }
    this.logins.insert({
      id: id('lgn'),
      user_ref: userRef,
      device_id: deviceId ? sha256(deviceId).slice(0, 12) : null,
      geo: geo || null,
      at_ms: now,
      ts: this.clock.nowIso(),
    });
  }

  recordAuthFailure(msisdn) {
    const key = sha256(msisdn || 'unknown');
    const count = (this.authFailures.get(key) || 0) + 1;
    this.authFailures.set(key, count);
    if (count === ATO_FAILURE_THRESHOLD) {
      this.raise('otp_bruteforce_suspected', 'medium', {
        detail: `${count} consecutive OTP failures`,
        context: { msisdn_hash: key.slice(0, 12) },
      });
    }
  }

  static distanceKm(a, b) {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // ── Holds (enforced through the fraud engine) ──────────────────────

  placeHold(userRef, reason) {
    this.holds.set(userRef, this.clock.nowMs() + HOLD_MS);
    this.audit.append('system:assurance', 'security.hold_placed', `user:${userRef}`, null, { reason });
  }

  releaseHold(userRef, actor) {
    if (this.holds.delete(userRef)) {
      this.audit.append(actor, 'security.hold_released', `user:${userRef}`, null, null);
      return true;
    }
    return false;
  }

  hasHold(userRef) {
    const expiry = this.holds.get(userRef);
    if (!expiry) return false;
    if (expiry < this.clock.nowMs()) {
      this.holds.delete(userRef);
      return false;
    }
    return true;
  }

  deviceAgeMs(userRef, deviceId) {
    if (!deviceId) return null;
    const reg = this.deviceReg.findOne((r) => r.user_ref === userRef && r.device_id === deviceId);
    return reg ? this.clock.nowMs() - reg.first_seen_ms : 0; // unseen device = age 0
  }

  // ── API abuse detection (wired from the app finish hook) ───────────

  recordApiOutcome(key, statusCode) {
    if (statusCode < 400 || statusCode >= 500) return;
    const now = this.clock.nowMs();
    const hits = (this.apiFailures.get(key) || []).filter((t) => now - t < ABUSE_WINDOW_MS);
    hits.push(now);
    this.apiFailures.set(key, hits);
    if (hits.length === ABUSE_THRESHOLD) {
      this.raise('api_abuse', 'medium', {
        detail: `${hits.length} 4xx responses in 5m`,
        context: { key: sha256(String(key)).slice(0, 12) },
      });
      this.blocked.set(key, now + 15 * 60 * 1000);
    }
  }

  isBlocked(key) {
    const expiry = this.blocked.get(key);
    if (!expiry) return false;
    if (expiry < this.clock.nowMs()) {
      this.blocked.delete(key);
      return false;
    }
    return true;
  }

  // ── Device risk scoring ────────────────────────────────────────────

  deviceRisk(userRef, deviceId) {
    let score = 0;
    const reasons = [];
    if (!this.identity.isDeviceTrusted(deviceId)) {
      score += 50;
      reasons.push('root/jailbreak/emulator signal');
    }
    const age = this.deviceAgeMs(userRef, deviceId);
    if (age !== null && age < 24 * 3600 * 1000) {
      score += 20;
      reasons.push('registered <24h ago');
    }
    if (this.hasHold(userRef)) {
      score += 30;
      reasons.push('account under security hold');
    }
    const users = new Set(
      this.deviceReg.find((r) => r.device_id === deviceId).map((r) => r.user_ref)
    );
    if (users.size > 3) {
      score += 10;
      reasons.push(`device shared by ${users.size} accounts`);
    }
    return { score: Math.min(score, 100), level: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low', reasons };
  }

  // ── Credential rotation automation ─────────────────────────────────

  setRotationPolicy(secretName, intervalDays) {
    this.secrets.current(secretName); // must exist
    this.rotationPolicies.set(secretName, intervalDays);
  }

  /** Scheduler entry point: rotate everything past its interval. */
  runRotation(actor = 'system:rotation') {
    const rotated = [];
    for (const [name, intervalDays] of this.rotationPolicies) {
      const current = this.secrets.current(name);
      const ageMs = this.clock.nowMs() - new Date(current.created_at).getTime();
      if (ageMs >= intervalDays * 24 * 3600 * 1000) {
        const next = this.secrets.rotate(name);
        this.audit.append(actor, 'security.secret_rotated', `secret:${name}`, null, {
          version: next.version,
          policy_days: intervalDays,
        });
        rotated.push({ name, version: next.version });
      }
    }
    return rotated;
  }

  // ── Reporting ──────────────────────────────────────────────────────

  report() {
    const byType = {};
    const bySeverity = { info: 0, medium: 0, high: 0 };
    for (const event of this.events.find()) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    }
    const recommendations = [];
    if (bySeverity.high > 0) recommendations.push('Review high-severity events and active holds');
    if (this.fraud.openReviews().length > 0) recommendations.push('Clear the open fraud-review queue');
    const staleSecrets = this.secrets
      .describe()
      .filter((s) => this.rotationPolicies.has(s.name))
      .filter((s) => {
        const ageDays = (this.clock.nowMs() - new Date(s.rotated_at).getTime()) / 86400000;
        return ageDays > this.rotationPolicies.get(s.name);
      });
    if (staleSecrets.length > 0) recommendations.push('Run credential rotation — policies overdue');
    return {
      generated_at: this.clock.nowIso(),
      events: { total: this.events.count(), by_type: byType, by_severity: bySeverity },
      active_holds: [...this.holds.keys()].filter((u) => this.hasHold(u)).length,
      blocked_api_keys: this.blocked.size,
      open_fraud_reviews: this.fraud.openReviews().length,
      rotation: {
        policies: [...this.rotationPolicies.entries()].map(([name, days]) => ({ name, days })),
        overdue: staleSecrets.map((s) => s.name),
      },
      recommendations,
    };
  }
}

module.exports = { AssuranceService };
