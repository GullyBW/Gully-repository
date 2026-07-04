'use strict';

const { err } = require('../kernel/errors');

/**
 * Distributed key/value abstraction (Foundation F3). A tiny, Redis-shaped
 * async interface so the distributed services (idempotency, rate limiting,
 * locks) work identically single-process and across pods.
 *
 *   get / set / setNx / incrBy / del / pttl
 *
 * The default `InMemoryKvAdapter` preserves today's single-process
 * behaviour (so every existing test is unaffected); `RedisKvAdapter` maps
 * the same interface onto a real Redis client for multi-pod deployments.
 * Selection is configuration (REDIS_URL) — no service above the KV changes.
 */
class InMemoryKvAdapter {
  constructor({ clock } = {}) {
    this.map = new Map(); // key -> { value, exp:ms|null }
    this.clock = clock || { nowMs: () => Date.now() };
  }

  _now() {
    return this.clock.nowMs();
  }

  _live(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.exp != null && entry.exp <= this._now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    const entry = this._live(key);
    return entry ? entry.value : null;
  }

  async set(key, value, ttlMs = null) {
    this.map.set(key, { value, exp: ttlMs != null ? this._now() + ttlMs : null });
    return 'OK';
  }

  /** Atomic set-if-absent — the primitive behind idempotency + locks. */
  async setNx(key, value, ttlMs = null) {
    if (this._live(key)) return false;
    this.map.set(key, { value, exp: ttlMs != null ? this._now() + ttlMs : null });
    return true;
  }

  /** Atomic increment; sets the TTL only when the counter is first created. */
  async incrBy(key, n = 1, ttlMs = null) {
    const entry = this._live(key);
    const current = entry ? Number(entry.value) : 0;
    const next = current + n;
    const exp = entry ? entry.exp : (ttlMs != null ? this._now() + ttlMs : null);
    this.map.set(key, { value: next, exp });
    return next;
  }

  async del(key) {
    return this.map.delete(key) ? 1 : 0;
  }

  async pttl(key) {
    const entry = this._live(key);
    if (!entry) return -2;
    return entry.exp == null ? -1 : Math.max(0, entry.exp - this._now());
  }
}

/** Maps the same interface onto a real Redis client (e.g. ioredis). */
class RedisKvAdapter {
  constructor({ client }) {
    if (!client) throw err('INVALID_ARGUMENT', 'RedisKvAdapter requires a client');
    this.client = client;
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, ttlMs = null) {
    return ttlMs != null ? this.client.set(key, String(value), 'PX', ttlMs) : this.client.set(key, String(value));
  }

  async setNx(key, value, ttlMs = null) {
    const args = [key, String(value), 'NX'];
    if (ttlMs != null) args.push('PX', ttlMs);
    const res = await this.client.set(...args);
    return res === 'OK';
  }

  async incrBy(key, n = 1, ttlMs = null) {
    const value = await this.client.incrby(key, n);
    if (ttlMs != null && value === n) await this.client.pexpire(key, ttlMs); // first write → set TTL
    return value;
  }

  async del(key) {
    return this.client.del(key);
  }

  async pttl(key) {
    return this.client.pttl(key);
  }
}

/**
 * Build the KV adapter from configuration. An injected `client` (or a
 * REDIS_URL with ioredis installed) selects Redis; otherwise in-memory.
 */
function createKv({ clock, redisUrl = process.env.REDIS_URL, client = null, redisFactory = null } = {}) {
  if (client) return new RedisKvAdapter({ client });
  if (redisUrl) {
    const make = redisFactory || defaultRedisFactory;
    return new RedisKvAdapter({ client: make(redisUrl) });
  }
  return new InMemoryKvAdapter({ clock });
}

/* istanbul ignore next: exercised only when a real REDIS_URL is configured */
function defaultRedisFactory(redisUrl) {
  let Redis;
  try {
    // eslint-disable-next-line global-require
    Redis = require('ioredis');
  } catch (e) {
    throw err('INTERNAL', 'REDIS_URL is set but the ioredis package is not installed');
  }
  return new Redis(redisUrl);
}

module.exports = { InMemoryKvAdapter, RedisKvAdapter, createKv };
