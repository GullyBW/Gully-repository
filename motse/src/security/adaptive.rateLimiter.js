'use strict';

const crypto = require('crypto');
const { err } = require('../kernel/errors');

/**
 * Adaptive, identity-aware rate limiting (Mission 2).
 *
 * Evidence basis: production validation W1/W7 observed that the /v1 token
 * bucket runs before authentication and keys unauthenticated requests by
 * client IP — so once a shared egress IP (NAT/proxy) exhausts the anonymous
 * bucket, authenticated users behind that IP are throttled too.
 *
 * This limiter classifies the caller BEFORE the quota decision:
 *
 *   admin    — a valid session whose subject holds platform_admin(platform)
 *   api_key  — an X-Api-Key caller (keyed by key hash; scopes checked later)
 *   user     — any other valid Bearer session (keyed by subject)
 *   anonymous— everything else (DELEGATED to the existing platform
 *              rateLimiter, so anonymous behaviour — including tests that
 *              swap `platform.rateLimiter` — is byte-identical)
 *
 * Classification is soft identification for QUOTA KEYING only: a token that
 * fails verification simply falls back to anonymous; real authentication
 * still happens at the route. Per-class quotas, burst capacity (bucket
 * capacity), temporary bans, and an emergency global multiplier are all
 * runtime-adjustable via the admin control surface. Class-level metrics
 * only — per-identity series would be a label-cardinality hazard; top
 * consumers are exposed through the admin endpoint instead.
 */
const DEFAULT_QUOTAS = {
  // anonymous is delegated — listed here only for visibility in admin views.
  anonymous: { capacity: 300, refillPerSecond: 5, delegated: true },
  user: { capacity: 600, refillPerSecond: 10 },
  api_key: { capacity: 1200, refillPerSecond: 20 },
  admin: { capacity: 2400, refillPerSecond: 40 },
};

class AdaptiveRateLimiter {
  constructor({ platform, clock, metrics = null, quotas = {} } = {}) {
    this.platform = platform;
    this.clock = clock;
    this.metrics = metrics || { inc() {}, observe() {} };
    // Per-class deep copy: quota objects must never alias DEFAULT_QUOTAS,
    // or a runtime setQuota on one instance would leak into every other.
    this.quotas = {};
    for (const [cls, q] of Object.entries(DEFAULT_QUOTAS)) this.quotas[cls] = { ...q, ...(quotas[cls] || {}) };
    for (const [cls, q] of Object.entries(quotas)) {
      if (!this.quotas[cls]) this.quotas[cls] = { ...q };
    }
    this.buckets = new Map(); // key -> { tokens, lastRefill, cls, denials, granted }
    this.bans = new Map(); // key -> { until_ms, reason }
    this.overrideMultiplier = 1; // emergency: >1 loosens, <1 tightens (0 blocks non-admin)
  }

  /** Soft identity classification — quota keying only, never authorization. */
  classify(req) {
    const apiKey = req.get && req.get('X-Api-Key');
    if (apiKey) {
      return { cls: 'api_key', key: `ak:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}` };
    }
    const token = ((req.get && req.get('Authorization')) || '').replace(/^Bearer /, '');
    if (token) {
      try {
        const claims = this.platform.identity.verifyAccess(token, { deviceId: req.get('X-Device-Id') });
        let cls = 'user';
        try {
          this.platform.identity.requireRole(claims.sub, 'platform_admin', 'platform');
          cls = 'admin';
        } catch { /* not an admin — plain user quota */ }
        return { cls, key: `${cls}:${claims.sub}` };
      } catch { /* invalid/expired token → anonymous (route auth will reject) */ }
    }
    return { cls: 'anonymous', key: `ip:${req.ip || 'unknown'}` };
  }

  /** Token-bucket decision for identified classes (same math as the base limiter). */
  allow(cls, key, cost = 1) {
    const quota = this.quotas[cls];
    const capacity = quota.capacity * this.overrideMultiplier;
    const now = this.clock.nowMs();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now, cls, denials: 0, granted: 0 };
      this.buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * quota.refillPerSecond * this.overrideMultiplier);
    bucket.lastRefill = now;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      bucket.granted += 1;
      return true;
    }
    bucket.denials += 1;
    return false;
  }

  middleware({ cost = 1 } = {}) {
    return (req, res, next) => {
      const { cls, key } = this.classify(req);
      const ban = this.bans.get(key);
      if (ban && ban.until_ms > this.clock.nowMs()) {
        this.metrics.inc('motse_ratelimit_adaptive_total', { class: cls, result: 'banned' });
        return next(err('RATE_LIMITED', 'Temporarily banned'));
      }
      if (ban) this.bans.delete(key); // expired

      if (cls === 'anonymous') {
        // Delegate: preserves existing anonymous semantics exactly (and any
        // runtime replacement of platform.rateLimiter, as tests rely on).
        const allowed = this.platform.rateLimiter.allow(req.actor || req.ip || 'anonymous', cost);
        this.metrics.inc('motse_ratelimit_adaptive_total', { class: cls, result: allowed ? 'allowed' : 'limited' });
        if (allowed) return next();
        return next(err('RATE_LIMITED', 'Too many requests for this identity'));
      }

      const allowed = this.allow(cls, key, cost);
      this.metrics.inc('motse_ratelimit_adaptive_total', { class: cls, result: allowed ? 'allowed' : 'limited' });
      if (allowed) return next();
      return next(err('RATE_LIMITED', `Quota exceeded for ${cls}`));
    };
  }

  // ── operator control surface (admin routes) ─────────────────────────

  /** Temporarily ban an identity key (abuse response). */
  ban(key, ttlMs, reason = 'operator ban') {
    this.bans.set(key, { until_ms: this.clock.nowMs() + ttlMs, reason });
    return { key, until_ms: this.bans.get(key).until_ms, reason };
  }

  unban(key) {
    return { key, removed: this.bans.delete(key) };
  }

  /** Adjust a class quota at runtime (no restart). */
  setQuota(cls, { capacity, refillPerSecond } = {}) {
    if (!this.quotas[cls]) throw err('INVALID_ARGUMENT', `unknown class ${cls}`);
    if (this.quotas[cls].delegated) throw err('INVALID_ARGUMENT', `${cls} is delegated to the base limiter`);
    if (capacity != null) this.quotas[cls].capacity = capacity;
    if (refillPerSecond != null) this.quotas[cls].refillPerSecond = refillPerSecond;
    return { cls, ...this.quotas[cls] };
  }

  /** Emergency override: scale every identified-class quota at once. */
  setOverride(multiplier) {
    this.overrideMultiplier = multiplier;
    return { override_multiplier: multiplier };
  }

  /** Admin view: quotas, bans, and the hottest consumers (top-N by denials). */
  stats({ top = 10 } = {}) {
    const consumers = [...this.buckets.entries()]
      .map(([key, b]) => ({ key, class: b.cls, granted: b.granted, denials: b.denials, tokens: Math.floor(b.tokens) }))
      .sort((a, b) => (b.denials - a.denials) || (b.granted - a.granted))
      .slice(0, top);
    return {
      quotas: this.quotas,
      override_multiplier: this.overrideMultiplier,
      active_buckets: this.buckets.size,
      bans: [...this.bans.entries()].map(([key, b]) => ({ key, ...b })),
      top_consumers: consumers,
    };
  }
}

module.exports = { AdaptiveRateLimiter, DEFAULT_QUOTAS };
