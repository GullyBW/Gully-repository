'use strict';

/**
 * Dependency health engine (Mission 1 — intelligent health & dependency
 * awareness). Replaces passive "does the object exist" readiness with ACTIVE
 * dependency probes and a per-dependency state machine:
 *
 *   healthy → failed        (a probe fails or times out)
 *   failed  → recovering    (a probe succeeds again)
 *   recovering → healthy    (N consecutive successes — no flapping)
 *   any     ↔ maintenance   (operator-set; probes continue but don't page)
 *   healthy → degraded      (probe succeeds but reports { degraded: true })
 *
 * Each dependency tracks availability, probe latency, version, last success/
 * failure, consecutive counts, degradation reason and operational impact.
 * `summary()` is public-safe (states only); `diagnostics()` is the full
 * admin view.
 *
 * Evidence basis: production validation W6 showed a simulated Redis outage
 * left readiness green because the check only verified the adapter existed.
 * The KV probe here does a real setNx/get/del round-trip, so an outage is
 * detected on the next probe cycle.
 *
 * Additive: nothing existing is replaced. `HealthService.ready()` stays
 * synchronous over cached states; `checkAll()` refreshes them (the async
 * /health/full path and the admin endpoints drive refreshes).
 */
const STATES = ['healthy', 'degraded', 'recovering', 'maintenance', 'failed'];

class DependencyHealthEngine {
  constructor({ clock, timeoutMs = 1500, recoveryThreshold = 2 } = {}) {
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.timeoutMs = timeoutMs;
    this.recoveryThreshold = recoveryThreshold; // consecutive successes to leave `recovering`
    this.deps = new Map(); // name -> record
  }

  /**
   * Register a dependency probe.
   * @param name       dependency name (redis, event_bus, …)
   * @param probe      async () => { version?, degraded?, reason?, detail? } — throws on failure
   * @param critical   a failed critical dependency makes the platform unready
   * @param impact     operator-facing impact statement for diagnostics
   */
  register(name, { probe, critical = true, impact = '' } = {}) {
    this.deps.set(name, {
      name,
      probe,
      critical,
      impact,
      state: 'healthy', // optimistic until the first probe says otherwise
      version: null,
      latency_ms: null,
      last_success_at: null,
      last_failure_at: null,
      consecutive_failures: 0,
      consecutive_successes: 0,
      degradation_reason: null,
      checked_at: null,
    });
    return this;
  }

  /** Operator control: park a dependency in (or out of) maintenance. */
  setMaintenance(name, on, reason = 'scheduled maintenance') {
    const dep = this._dep(name);
    if (on) {
      dep.prev_state = dep.state;
      dep.state = 'maintenance';
      dep.degradation_reason = reason;
    } else {
      dep.state = dep.prev_state || 'healthy';
      dep.prev_state = null;
      dep.degradation_reason = null;
    }
    return this._public(dep);
  }

  /** Probe one dependency and advance its state machine. */
  async check(name) {
    const dep = this._dep(name);
    const started = this.clock.nowMs();
    let outcome;
    try {
      outcome = (await this._withTimeout(dep.probe())) || {};
      dep.latency_ms = this.clock.nowMs() - started;
      dep.last_success_at = this.clock.nowIso();
      dep.consecutive_failures = 0;
      dep.consecutive_successes += 1;
      if (outcome.version) dep.version = outcome.version;
      if (dep.state !== 'maintenance') {
        if (outcome.degraded) {
          dep.state = 'degraded';
          dep.degradation_reason = outcome.reason || 'degraded';
        } else if (dep.state === 'failed') {
          dep.state = 'recovering';
          dep.degradation_reason = 'recovering from failure';
        } else if (dep.state === 'recovering' && dep.consecutive_successes >= this.recoveryThreshold) {
          dep.state = 'healthy';
          dep.degradation_reason = null;
        } else if (dep.state === 'degraded' && !outcome.degraded) {
          dep.state = 'healthy';
          dep.degradation_reason = null;
        }
      }
      dep.detail = outcome.detail || null;
    } catch (e) {
      dep.latency_ms = this.clock.nowMs() - started;
      dep.last_failure_at = this.clock.nowIso();
      dep.consecutive_successes = 0;
      dep.consecutive_failures += 1;
      dep.degradation_reason = e.message;
      if (dep.state !== 'maintenance') dep.state = 'failed';
    }
    dep.checked_at = this.clock.nowIso();
    return this._public(dep);
  }

  /** Probe every dependency in parallel; returns the diagnostics view. */
  async checkAll() {
    await Promise.all([...this.deps.keys()].map((name) => this.check(name)));
    return this.diagnostics();
  }

  /** Public-safe view: states only, no internals/reasons/versions. */
  summary() {
    const out = {};
    for (const dep of this.deps.values()) out[dep.name] = dep.state;
    return out;
  }

  /** Full admin diagnostics (never exposed on public endpoints). */
  diagnostics() {
    return [...this.deps.values()].map((dep) => this._public(dep));
  }

  /**
   * Readiness verdict over CACHED states (synchronous — safe for the
   * existing HealthService checks): unready iff a critical dependency has
   * FAILED. Degraded/recovering/maintenance never break readiness.
   */
  verdict() {
    const failedCritical = [...this.deps.values()].filter((d) => d.critical && d.state === 'failed');
    const attention = [...this.deps.values()].filter((d) => d.state !== 'healthy');
    return {
      healthy: failedCritical.length === 0,
      degraded: attention.length > 0,
      failed: failedCritical.map((d) => d.name),
      attention: attention.map((d) => `${d.name}:${d.state}`),
    };
  }

  _dep(name) {
    const dep = this.deps.get(name);
    if (!dep) throw new Error(`unknown dependency ${name}`);
    return dep;
  }

  _public(dep) {
    const { probe, prev_state: _prev, ...rest } = dep;
    void probe; void _prev;
    return { ...rest };
  }

  _withTimeout(promise) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`probe timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
      timer.unref(); // never hold the process open
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }
}

module.exports = { DependencyHealthEngine, STATES };
