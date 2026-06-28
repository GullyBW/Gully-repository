'use strict';

const config = require('../config');

/**
 * Cache abstraction. Uses Redis when `REDIS_URL` is configured and `ioredis` is
 * installed (an optionalDependency); otherwise falls back to an in-process store
 * with TTL expiry. The interface is identical either way, so business logic and
 * tests never depend on Redis being present.
 */
class CacheService {
  constructor() {
    this.memory = new Map(); // key -> { value, expiresAt }
    this.redis = null;
    this._initRedis();
  }

  _initRedis() {
    if (!config.redis.url) return;
    try {
      // eslint-disable-next-line global-require
      const IORedis = require('ioredis');
      this.redis = new IORedis(config.redis.url, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.redis.on('error', () => {
        /* fall back silently to memory on redis errors */
      });
    } catch (_err) {
      this.redis = null; // ioredis not installed — use memory
    }
  }

  get backend() {
    return this.redis ? 'redis' : 'memory';
  }

  async get(key) {
    if (this.redis) {
      const raw = await this.redis.get(key);
      return raw ? JSON.parse(raw) : null;
    }
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds = config.redis.defaultTtlSeconds) {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    }
    this.memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }

  async del(key) {
    if (this.redis) {
      await this.redis.del(key);
      return;
    }
    this.memory.delete(key);
  }

  /** Memoise an async producer behind the cache. */
  async wrap(key, ttlSeconds, producer) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) return cached;
    const value = await producer();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async flush() {
    if (this.redis) {
      await this.redis.flushdb();
      return;
    }
    this.memory.clear();
  }

  async close() {
    if (this.redis) await this.redis.quit();
  }
}

module.exports = new CacheService();
