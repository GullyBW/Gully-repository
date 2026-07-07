'use strict';

const { CircuitBreaker } = require('./circuit.breaker');
const { Bulkhead } = require('./bulkhead');
const { LoadShedder } = require('./load.shed');
const { SelfHealer } = require('./self.healing');
const { withRetry, withDeadline, RetryBudget, defaultClassify } = require('./retry');

/**
 * Resilience facade (Mission 8). Owns the named circuit breakers, bulkheads
 * and retry budgets, plus the load shedder and self-healer, and exposes a
 * single `stats()` for the operations control plane. Breakers/bulkheads/
 * budgets are created lazily on first use with per-compartment defaults, so
 * callers just say `resilience.breaker('redis')`.
 *
 * Additive: nothing is wrapped implicitly. The platform opts specific call
 * sites into protection; everything else is unchanged.
 */
class Resilience {
  constructor({ clock, metrics = null } = {}) {
    this.clock = clock;
    this.metrics = metrics;
    this.breakers = new Map();
    this.bulkheads = new Map();
    this.budgets = new Map();
    // Per-compartment defaults (Mission 8 "isolate: database, redis, outbox,
    // worker pools, external integrations"). Tunable at runtime via stats/ctl.
    this._bulkheadDefaults = {
      redis: { maxConcurrent: 50, maxQueue: 100 },
      outbox: { maxConcurrent: 4, maxQueue: 50 },
      workers: { maxConcurrent: 8, maxQueue: 32 },
      external: { maxConcurrent: 20, maxQueue: 40 },
      database: { maxConcurrent: 30, maxQueue: 60 },
    };
    this.shedder = new LoadShedder({ metrics });
    this.healer = null; // wired once dependencies exist (see attachHealer)
  }

  breaker(name, opts = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, clock: this.clock, metrics: this.metrics, ...opts }));
    }
    return this.breakers.get(name);
  }

  bulkhead(name, opts = {}) {
    if (!this.bulkheads.has(name)) {
      const defaults = this._bulkheadDefaults[name] || {};
      this.bulkheads.set(name, new Bulkhead({ name, metrics: this.metrics, ...defaults, ...opts }));
    }
    return this.bulkheads.get(name);
  }

  budget(name, opts = {}) {
    if (!this.budgets.has(name)) {
      this.budgets.set(name, new RetryBudget({ clock: this.clock, ...opts }));
    }
    return this.budgets.get(name);
  }

  /** Retry with this facade's metrics + the named shared budget by default. */
  retry(fn, { name = 'op', useBudget = true, ...opts } = {}) {
    return withRetry(fn, {
      name,
      metrics: this.metrics,
      budget: useBudget ? this.budget(name) : null,
      ...opts,
    });
  }

  deadline(promise, ms, label) {
    return withDeadline(promise, ms, label);
  }

  /** Attach the self-healer once the dependency engine exists (container wiring). */
  attachHealer({ dependencies, logger }) {
    this.healer = new SelfHealer({ dependencies, clock: this.clock, metrics: this.metrics, logger });
    return this.healer;
  }

  stats() {
    return {
      breakers: [...this.breakers.values()].map((b) => b.stats()),
      bulkheads: [...this.bulkheads.values()].map((b) => b.stats()),
      budgets: [...this.budgets.entries()].map(([name, b]) => ({ name, ...b.stats() })),
      load_shedding: this.shedder.stats(),
      self_healing: this.healer ? this.healer.stats() : { actions: [], history: [] },
    };
  }
}

module.exports = {
  Resilience, CircuitBreaker, Bulkhead, LoadShedder, SelfHealer,
  withRetry, withDeadline, RetryBudget, defaultClassify,
};
