'use strict';

const { err } = require('../kernel/errors');

const NOOP_METRICS = { inc() {}, observe() {} };

/**
 * Bulkhead (Mission 8). Caps the concurrency a compartment (redis, outbox,
 * external integrations, worker pools…) may consume, with a bounded wait
 * queue — so a slow or failing dependency exhausts ITS compartment, never
 * the whole process (no cascading failure). Overflow beyond the queue is
 * rejected immediately with `UNAVAILABLE` (503, retryable).
 *
 * Additive: callers opt in via `platform.resilience.bulkhead(name)`.
 */
class Bulkhead {
  constructor({ name = 'default', maxConcurrent = 10, maxQueue = 20, metrics = null } = {}) {
    this.name = name;
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.metrics = metrics || NOOP_METRICS;
    this.active = 0;
    this.queue = []; // waiting resolvers
    this.counts = { completed: 0, failed: 0, rejected: 0, peak_active: 0, peak_queued: 0 };
  }

  /** Execute `fn` inside the compartment (waits in the bounded queue if full). */
  async exec(fn) {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        this.counts.rejected += 1;
        this.metrics.inc('motse_bulkhead_total', { name: this.name, result: 'rejected' });
        throw err('UNAVAILABLE', `bulkhead ${this.name} saturated`);
      }
      await new Promise((resolve) => {
        this.queue.push(resolve);
        this.counts.peak_queued = Math.max(this.counts.peak_queued, this.queue.length);
      });
    }
    this.active += 1;
    this.counts.peak_active = Math.max(this.counts.peak_active, this.active);
    try {
      const result = await fn();
      this.counts.completed += 1;
      this.metrics.inc('motse_bulkhead_total', { name: this.name, result: 'completed' });
      return result;
    } catch (e) {
      this.counts.failed += 1;
      this.metrics.inc('motse_bulkhead_total', { name: this.name, result: 'failed' });
      throw e;
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next(); // admit the next waiter into the compartment
    }
  }

  stats() {
    return {
      name: this.name,
      max_concurrent: this.maxConcurrent,
      max_queue: this.maxQueue,
      active: this.active,
      queued: this.queue.length,
      ...this.counts,
    };
  }
}

module.exports = { Bulkhead };
