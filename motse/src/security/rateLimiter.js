'use strict';

const { err } = require('../kernel/errors');

/**
 * Rate limiting + API throttling (doc §13.1 gateway responsibilities).
 * Token bucket per key — key is the authenticated actor when present,
 * else the client IP, so one hot NAT can't starve a whole village and
 * one abusive account can't hide behind rotating IPs.
 *
 * Clock-injected (deterministic in tests); Redis-backed in production
 * behind this same surface.
 */
class RateLimiter {
  constructor({ clock, capacity = 300, refillPerSecond = 5 }) {
    this.clock = clock;
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.buckets = new Map(); // key -> { tokens, lastRefill }
    this.denials = 0;
  }

  /** Returns true if the request may proceed; consumes one token. */
  allow(key, cost = 1) {
    const now = this.clock.nowMs();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.lastRefill = now;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }
    this.denials += 1;
    return false;
  }

  /** Express middleware. Keyed by actor when authenticated, else IP. */
  middleware({ cost = 1 } = {}) {
    return (req, res, next) => {
      const key = req.actor || req.ip || 'anonymous';
      if (this.allow(key, cost)) return next();
      return next(err('RATE_LIMITED', 'Too many requests for this identity'));
    };
  }
}

module.exports = { RateLimiter };
