'use strict';

/**
 * Health & readiness (Phase 3) — Kubernetes-friendly liveness and readiness
 * with pluggable checks. Liveness answers "is the process able to run?"
 * (cheap, dependency-free — a failed liveness probe restarts the pod).
 * Readiness answers "can it serve traffic right now?" (aggregates checks
 * across the Foundation and domain — a failed readiness probe removes the
 * pod from rotation without restarting it).
 *
 * Additive: the existing `/health` and `/health/ready` endpoints and
 * `MonitoringService.readiness()` are unchanged; this composes a richer,
 * Foundation-aware view exposed alongside them.
 */
class HealthService {
  constructor({ platform, clock }) {
    this.platform = platform;
    this.clock = clock;
    this.startedMs = clock.nowMs();
    this.checks = new Map(); // name -> () => { healthy, detail?, degraded? }
    this._registerDefaults();
  }

  /** Register a custom readiness check. */
  register(name, fn) {
    this.checks.set(name, fn);
    return this;
  }

  /** Liveness — the process is up and the event loop responds. */
  live() {
    return {
      status: 'ok',
      uptime_ms: this.clock.nowMs() - this.startedMs,
      at: this.clock.nowIso(),
    };
  }

  /**
   * Deep readiness (Mission 1): actively re-probe every registered
   * dependency, then compose the standard readiness view plus the
   * public-safe dependency state summary. Used by /health/full; the
   * synchronous ready() below keeps serving cached states.
   */
  async readyFull() {
    if (this.platform.dependencies) await this.platform.dependencies.checkAll();
    // Mission 8: self-healing follows detection — recovery actions fire on the
    // dependency-state transitions the probe cycle just observed.
    if (this.platform.resilience && this.platform.resilience.healer) {
      await this.platform.resilience.healer.evaluate();
    }
    const base = this.ready();
    return {
      ...base,
      dependencies: this.platform.dependencies ? this.platform.dependencies.summary() : {},
    };
  }

  /** Readiness — aggregate all checks; ready iff none is unhealthy. */
  ready() {
    const checks = {};
    let ready = true;
    let degraded = false;
    for (const [name, fn] of this.checks) {
      let result;
      try {
        result = fn() || { healthy: false, detail: 'no result' };
      } catch (e) {
        result = { healthy: false, detail: e.message };
      }
      checks[name] = result;
      if (!result.healthy) ready = false;
      if (result.degraded) degraded = true;
    }
    return { ready, degraded, checks, at: this.clock.nowIso() };
  }

  _registerDefaults() {
    const p = this.platform;
    // Ledger invariant — the financial source of truth must balance.
    this.register('ledger', () => ({ healthy: p.ledger.trialBalance().balanced, detail: 'double-entry trial balance' }));
    // Event backbone.
    this.register('event_bus', () => ({ healthy: p.bus.schemas.size > 0, detail: `${p.bus.schemas.size} schemas` }));
    this.register('event_store', () => ({ healthy: !!p.eventStore, detail: `${p.eventStore.stats().total} events` }));
    // Foundation F2 — outbox backlog (a large pending backlog blocks readiness;
    // dead letters are surfaced as a degraded signal, not a readiness failure).
    this.register('outbox', () => {
      const s = p.outbox.stats();
      return { healthy: s.pending < 1000, degraded: s.dead > 0, detail: `pending ${s.pending}, dead ${s.dead}` };
    });
    // Foundation F3 — distributed runtime adapter.
    this.register('distributed', () => ({ healthy: !!p.kv, detail: p.kv.constructor.name }));
    // Domain — payment rails available.
    this.register('payments', () => ({ healthy: p.payments ? p.payments.providers.size > 0 : true, detail: p.payments ? `${p.payments.providers.size} providers` : 'n/a' }));
  }
}

module.exports = { HealthService };
