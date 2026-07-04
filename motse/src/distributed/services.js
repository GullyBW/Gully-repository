'use strict';

const crypto = require('crypto');
const { err } = require('../kernel/errors');

/**
 * Distributed runtime services (Foundation F3) built on the KV abstraction,
 * so they enforce correctly across pods when backed by Redis and behave
 * identically single-process when backed by the in-memory adapter.
 *
 *   - DistributedIdempotency: exactly-once execution per key across pods.
 *   - DistributedRateLimiter:  a shared fixed-window counter.
 *   - DistributedLock:         mutual exclusion with a fencing token + TTL.
 *
 * These are additive: the existing in-process `IdempotencyRegistry` and
 * `RateLimiter` are untouched. Multi-pod deployments opt in by pointing the
 * KV at Redis; the request path can then adopt these without further change.
 */
class DistributedIdempotency {
  constructor({ kv, ttlMs = 48 * 3600 * 1000, prefix = 'idem:' } = {}) {
    this.kv = kv;
    this.ttlMs = ttlMs;
    this.prefix = prefix;
  }

  /** Win the reservation for `key` (true iff this caller is the first). */
  async reserve(key) {
    return this.kv.setNx(this.prefix + key, '1', this.ttlMs);
  }

  async seen(key) {
    return (await this.kv.get(this.prefix + key)) != null;
  }

  /**
   * Execute `fn` exactly once per key across all pods. A second caller with
   * the same key gets `{ ran: false }` without re-executing. If `fn` throws,
   * the reservation is released so the operation can be retried.
   */
  async runOnce(key, fn) {
    const won = await this.reserve(key);
    if (!won) return { ran: false };
    try {
      const result = await fn();
      return { ran: true, result };
    } catch (e) {
      await this.kv.del(this.prefix + key);
      throw e;
    }
  }
}

class DistributedRateLimiter {
  constructor({ kv, clock, capacity = 300, windowMs = 60 * 1000, prefix = 'rl:' } = {}) {
    this.kv = kv;
    this.clock = clock || { nowMs: () => Date.now() };
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.prefix = prefix;
  }

  /**
   * Consume `cost` tokens for `identity` in the current fixed window.
   * Returns { allowed, remaining, limit, reset_ms }. The counter is a shared
   * atomic incr, so N pods enforce ONE global limit.
   */
  async take(identity, cost = 1) {
    const now = this.clock.nowMs();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const key = `${this.prefix}${identity}:${windowStart}`;
    const count = await this.kv.incrBy(key, cost, this.windowMs);
    const remaining = Math.max(0, this.capacity - count);
    return {
      allowed: count <= this.capacity,
      remaining,
      limit: this.capacity,
      reset_ms: windowStart + this.windowMs - now,
    };
  }
}

class DistributedLock {
  constructor({ kv, ttlMs = 10 * 1000, prefix = 'lock:' } = {}) {
    this.kv = kv;
    this.ttlMs = ttlMs;
    this.prefix = prefix;
  }

  /** Acquire `name` with a fencing token; true iff acquired. */
  async acquire(name, token, ttlMs = this.ttlMs) {
    return this.kv.setNx(this.prefix + name, token, ttlMs);
  }

  /** Release only if we still hold it (token match) — never steal a lock. */
  async release(name, token) {
    const held = await this.kv.get(this.prefix + name);
    if (held === token) {
      await this.kv.del(this.prefix + name);
      return true;
    }
    return false;
  }

  /**
   * Run `fn` under mutual exclusion. Throws STATE_CONFLICT if the lock is
   * already held; always releases (if still owned) afterwards.
   */
  async withLock(name, fn, { token = crypto.randomBytes(8).toString('hex'), ttlMs = this.ttlMs } = {}) {
    const acquired = await this.acquire(name, token, ttlMs);
    if (!acquired) throw err('STATE_CONFLICT', `lock ${name} is held`);
    try {
      return await fn();
    } finally {
      await this.release(name, token);
    }
  }
}

module.exports = { DistributedIdempotency, DistributedRateLimiter, DistributedLock };
