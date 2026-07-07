'use strict';

const { err } = require('./errors');

const DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h (doc §7.1)

/**
 * Idempotency registry (doc §7.1, §8).
 *
 * Every mutating call requires an Idempotency-Key; the gateway
 * deduplicates for 48 hours. This is what makes offline outbox replay
 * safe: a mutation queued on a feature phone for a week and replayed
 * twice lands exactly once.
 */
class IdempotencyRegistry {
  constructor(clock) {
    this.clock = clock;
    this.entries = new Map(); // key -> { at, result }
  }

  _gc() {
    const cutoff = this.clock.nowMs() - DEDUPE_WINDOW_MS;
    for (const [key, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(key);
    }
  }

  /**
   * Run `fn` once per key within the dedupe window. A replay returns the
   * original result, marked replayed (surfaces as IDEMPOTENT_REPLAY).
   */
  execute(key, fn) {
    if (!key) throw err('IDEMPOTENCY_KEY_REQUIRED');
    this._gc();
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.error) throw existing.error;
      return { result: existing.result, replayed: true };
    }
    try {
      const result = fn();
      this.entries.set(key, { at: this.clock.nowMs(), result });
      return { result, replayed: false };
    } catch (e) {
      // Non-retryable domain rejections are memoised too: replaying a
      // rejected mutation must not re-execute it with fresh state.
      if (e && e.retryable === false) {
        this.entries.set(key, { at: this.clock.nowMs(), error: e });
      }
      throw e;
    }
  }

  /** HTTP-layer dedupe: fetch a cached response envelope for a key. */
  getCached(key) {
    this._gc();
    const entry = this.entries.get(key);
    return entry ? entry.result : null;
  }

  /** HTTP-layer dedupe: remember a response envelope for a key. */
  putCached(key, value) {
    if (!this.entries.has(key)) {
      this.entries.set(key, { at: this.clock.nowMs(), result: value });
    }
  }
}

module.exports = { IdempotencyRegistry, DEDUPE_WINDOW_MS };
