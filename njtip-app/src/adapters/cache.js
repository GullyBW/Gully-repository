'use strict';
// Cache PORT (Redis-shaped): get/set/del/has + TTL expiry, atomic incr, and namespacing.
// Reference implementation is in-memory with a logical clock (deterministic in tests); the
// production driver is Redis (single/cluster) implementing the SAME interface — session
// persistence and distributed cache without any domain change (docs/production-adapters.md).
//
// Values are opaque (JSON-serialisable). The cache never stores identity or case content —
// only non-identifying, short-lived operational state (sessions by opaque token, rate
// counters, projection caches). Enforced by callers + the anonymity/PII invariants.
class MemoryCache {
  constructor({ clock = () => Date.now(), namespace = '' } = {}) { this._clock = clock; this._ns = namespace; this._m = new Map(); }
  _k(k) { return this._ns ? `${this._ns}:${k}` : k; }
  _live(rec) { return rec && (rec.exp === 0 || rec.exp > this._clock()); }

  set(k, v, ttlMs = 0) { this._m.set(this._k(k), { v: clone(v), exp: ttlMs ? this._clock() + ttlMs : 0 }); return true; }
  get(k) { const r = this._m.get(this._k(k)); if (!this._live(r)) { this._m.delete(this._k(k)); return null; } return clone(r.v); }
  has(k) { return this.get(k) !== null; }
  del(k) { return this._m.delete(this._k(k)); }
  ttl(k) { const r = this._m.get(this._k(k)); if (!this._live(r)) return -2; return r.exp === 0 ? -1 : Math.max(0, r.exp - this._clock()); }
  incr(k, by = 1) { const cur = this.get(k) || 0; const next = cur + by; this.set(k, next, this.ttl(k) > 0 ? this.ttl(k) : 0); return next; }
  namespace(ns) { const c = new MemoryCache({ clock: this._clock, namespace: this._ns ? `${this._ns}:${ns}` : ns }); c._m = this._m; return c; }

  // Housekeeping: sweep expired keys (a real Redis expires lazily + actively).
  sweep() { let n = 0; for (const [k, r] of this._m) if (!this._live(r)) { this._m.delete(k); n++; } return n; }
  size() { this.sweep(); return this._m.size; }
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

// Cache-backed session revocation/allow store (distributed session persistence): a token's
// jti maps to a short-lived record; revocation is a delete/tombstone visible to all nodes.
class CacheSessionStore {
  constructor(cache) { this._c = cache.namespace('session'); }
  put(jti, meta, ttlMs) { this._c.set(jti, meta, ttlMs); }
  active(jti) { return this._c.has(jti); }
  revoke(jti) { this._c.del(jti); }
}

function makeCache(cfg = {}) {
  if (cfg.cache && cfg.cache !== 'memory') {
    throw new Error(`cache driver '${cfg.cache}' is a documented drop-in (Redis); not bundled in-repo (docs/production-adapters.md)`);
  }
  return new MemoryCache({ clock: cfg.clock });
}

module.exports = { MemoryCache, CacheSessionStore, makeCache };
