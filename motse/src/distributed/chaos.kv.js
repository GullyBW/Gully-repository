'use strict';

/**
 * Chaos KV wrapper (production validation — fault injection). Wraps any KV
 * adapter behind the SAME Redis-shaped interface and injects the failure
 * modes a real Redis exhibits, so reliability tests exercise the actual
 * distributed services (idempotency, rate limiting, locks) under outage,
 * blips, latency and restart — without touching those services.
 *
 * Faults are thrown as plain Errors (not MotseErrors) deliberately: that is
 * what a real client (ioredis) surfaces, so error-propagation paths are
 * validated faithfully.
 *
 * Additive: nothing constructs this in production wiring; the harness and
 * tests wrap an adapter explicitly.
 */
class ChaosKv {
  constructor(inner, { latencyMs = 0 } = {}) {
    this.inner = inner;
    this.isDown = false;
    this.failuresRemaining = 0; // transient blip budget
    this.latencyMs = latencyMs;
    this.calls = 0;
    this.faults = 0;
  }

  /** Hard outage begins: every call fails until up(). */
  down() {
    this.isDown = true;
    return this;
  }

  /** Outage ends. */
  up() {
    this.isDown = false;
    return this;
  }

  /** The next `n` calls fail (a transient network blip). */
  failNext(n) {
    this.failuresRemaining = n;
    return this;
  }

  /** Add fixed latency to every call (network degradation). */
  withLatency(ms) {
    this.latencyMs = ms;
    return this;
  }

  /**
   * Simulate a restart with data loss (an unpersisted Redis coming back
   * empty): swap in a fresh inner adapter. Returns the discarded one.
   */
  restart(freshInner) {
    const old = this.inner;
    this.inner = freshInner;
    this.isDown = false;
    return old;
  }

  stats() {
    return { calls: this.calls, faults: this.faults, down: this.isDown };
  }

  async _gate() {
    this.calls += 1;
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    if (this.isDown) {
      this.faults += 1;
      throw new Error('kv unavailable (chaos: down)');
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      this.faults += 1;
      throw new Error('kv error (chaos: transient)');
    }
  }

  async get(key) {
    await this._gate();
    return this.inner.get(key);
  }

  async set(key, value, ttlMs = null) {
    await this._gate();
    return this.inner.set(key, value, ttlMs);
  }

  async setNx(key, value, ttlMs = null) {
    await this._gate();
    return this.inner.setNx(key, value, ttlMs);
  }

  async incrBy(key, n = 1, ttlMs = null) {
    await this._gate();
    return this.inner.incrBy(key, n, ttlMs);
  }

  async del(key) {
    await this._gate();
    return this.inner.del(key);
  }

  async pttl(key) {
    await this._gate();
    return this.inner.pttl(key);
  }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

module.exports = { ChaosKv };
