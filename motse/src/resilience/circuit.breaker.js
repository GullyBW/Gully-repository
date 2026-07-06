'use strict';

const { err } = require('../kernel/errors');

// No-op metrics sink so the breaker runs identically without observability.
const NOOP_METRICS = { inc() {}, observe() {}, setGauge() {} };

/**
 * Circuit breaker (Mission 8). Protects callers from a failing dependency by
 * failing FAST instead of hammering it — the chaos harness measured every
 * distributed operation surfacing the raw infra error for the full duration
 * of a KV outage; a breaker converts that into an immediate, typed rejection
 * (or a fallback value) after the failure threshold trips.
 *
 * States:  closed → open        (>= failureThreshold failures in the rolling window)
 *          open   → half_open   (after cooldownMs; admits up to halfOpenMax probes)
 *          half_open → closed   (a probe succeeds — window resets)
 *          half_open → open     (a probe fails — cooldown restarts)
 *
 * Rejections are `UNAVAILABLE` (503, retryable) unless a `fallback` is
 * provided, in which case the fallback value is returned instead (graceful
 * degradation). Additive: nothing is wrapped implicitly — callers opt in via
 * `platform.resilience.breaker(name)`.
 */
class CircuitBreaker {
  constructor({
    name = 'default',
    clock,
    metrics = null,
    failureThreshold = 5,
    windowMs = 30 * 1000,
    cooldownMs = 10 * 1000,
    halfOpenMax = 1,
    fallback = null,
  } = {}) {
    this.name = name;
    this.clock = clock || { nowMs: () => Date.now() };
    this.metrics = metrics || NOOP_METRICS;
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.halfOpenMax = halfOpenMax;
    this.fallback = fallback; // (error) => degraded value
    this.state = 'closed';
    this.outcomes = []; // rolling window of { at, ok }
    this.openedAt = null;
    this.halfOpenInFlight = 0;
    this.counts = { success: 0, failure: 0, short_circuited: 0, fallbacks: 0, transitions: [] };
  }

  /** Execute `fn` under the breaker. */
  async exec(fn) {
    const now = this.clock.nowMs();
    if (this.state === 'open') {
      if (now - this.openedAt >= this.cooldownMs) {
        this._transition('half_open');
      } else {
        return this._reject();
      }
    }
    if (this.state === 'half_open') {
      if (this.halfOpenInFlight >= this.halfOpenMax) return this._reject();
      this.halfOpenInFlight += 1;
    }
    try {
      const result = await fn();
      this._record(true);
      if (this.state === 'half_open') {
        this._transition('closed');
        this.outcomes = []; // fresh window after recovery
      }
      return result;
    } catch (e) {
      this._record(false);
      if (this.state === 'half_open') {
        this._transition('open'); // the probe failed — restart the cooldown
        this.openedAt = this.clock.nowMs();
      } else if (this._failuresInWindow() >= this.failureThreshold) {
        this._transition('open');
        this.openedAt = this.clock.nowMs();
      }
      if (this.fallback) {
        this.counts.fallbacks += 1;
        this.metrics.inc('motse_breaker_total', { name: this.name, result: 'fallback' });
        return this.fallback(e);
      }
      throw e;
    } finally {
      if (this.halfOpenInFlight > 0) this.halfOpenInFlight -= 1;
    }
  }

  _reject() {
    this.counts.short_circuited += 1;
    this.metrics.inc('motse_breaker_total', { name: this.name, result: 'short_circuited' });
    if (this.fallback) {
      this.counts.fallbacks += 1;
      this.metrics.inc('motse_breaker_total', { name: this.name, result: 'fallback' });
      return this.fallback(err('UNAVAILABLE', `circuit ${this.name} is open`));
    }
    throw err('UNAVAILABLE', `circuit ${this.name} is open`);
  }

  _record(ok) {
    const now = this.clock.nowMs();
    this.outcomes.push({ at: now, ok });
    const horizon = now - this.windowMs;
    while (this.outcomes.length && this.outcomes[0].at < horizon) this.outcomes.shift();
    this.counts[ok ? 'success' : 'failure'] += 1;
    this.metrics.inc('motse_breaker_total', { name: this.name, result: ok ? 'success' : 'failure' });
  }

  _failuresInWindow() {
    const horizon = this.clock.nowMs() - this.windowMs;
    return this.outcomes.filter((o) => !o.ok && o.at >= horizon).length;
  }

  _transition(state) {
    this.counts.transitions.push({ from: this.state, to: state, at: this.clock.nowMs() });
    this.state = state;
  }

  /** Operator escape hatch: force the breaker closed (post-incident). */
  reset() {
    this._transition('closed');
    this.outcomes = [];
    this.openedAt = null;
    return this.stats();
  }

  stats() {
    return {
      name: this.name,
      state: this.state,
      failures_in_window: this._failuresInWindow(),
      failure_threshold: this.failureThreshold,
      ...this.counts,
      transitions: this.counts.transitions.slice(-10),
    };
  }
}

module.exports = { CircuitBreaker };
