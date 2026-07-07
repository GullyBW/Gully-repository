'use strict';

const NOOP_METRICS = { inc() {}, observe() {} };

/**
 * Self-healing (Mission 8). Watches dependency state TRANSITIONS (from the
 * Mission-1 DependencyHealthEngine) and runs registered recovery actions
 * when a dependency comes back — the automation of what an operator would
 * do by hand after an outage clears:
 *
 *   - redis recovered      → nothing to rebuild (state was fail-closed)
 *   - outbox relay healthy → drain pending events immediately
 *   - exporter recovered   → flush the buffered spans
 *
 * `evaluate()` diffs current states against the last evaluation and fires
 * matching actions; it is invoked after each active probe cycle
 * (`HealthService.readyFull()`), so healing follows detection with no extra
 * scheduler. Actions are fail-safe: a throwing action is recorded, never
 * propagated. Every healing run lands in the history (operational audit).
 */
class SelfHealer {
  constructor({ dependencies, clock, metrics = null, logger = null } = {}) {
    this.dependencies = dependencies; // DependencyHealthEngine
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    this.logger = logger;
    this.actions = []; // { name, dependency, from(set)|any, to(set), action }
    this.lastStates = null; // null until the first evaluation (no false firing at boot)
    this.history = []; // bounded action log
  }

  /**
   * Register a healing action.
   * @param name        action name (audit key)
   * @param dependency  dependency to watch
   * @param from        array of prior states that qualify (default: failed/degraded/recovering)
   * @param to          array of new states that trigger (default: recovering/healthy)
   * @param action      async () => result — the recovery work
   */
  register(name, { dependency, from = ['failed', 'degraded', 'recovering'], to = ['recovering', 'healthy'], action }) {
    this.actions.push({ name, dependency, from, to, action });
    return this;
  }

  /** Diff states since the last evaluation and run matching healing actions. */
  async evaluate() {
    const current = this.dependencies.summary();
    const previous = this.lastStates;
    this.lastStates = current;
    if (!previous) return []; // first sight of the world — nothing transitioned
    const ran = [];
    for (const spec of this.actions) {
      const before = previous[spec.dependency];
      const after = current[spec.dependency];
      if (before === after) continue;
      if (!spec.from.includes(before) || !spec.to.includes(after)) continue;
      const entry = {
        action: spec.name,
        dependency: spec.dependency,
        transition: `${before}→${after}`,
        at: this.clock.nowIso(),
      };
      try {
        entry.result = await spec.action();
        entry.ok = true;
        this.metrics.inc('motse_selfheal_total', { action: spec.name, result: 'ok' });
      } catch (e) {
        entry.ok = false;
        entry.error = e.message;
        this.metrics.inc('motse_selfheal_total', { action: spec.name, result: 'failed' });
      }
      if (this.logger) this.logger.info('self-heal', entry);
      this.history.push(entry);
      if (this.history.length > 200) this.history.shift();
      ran.push(entry);
    }
    return ran;
  }

  stats() {
    return {
      actions: this.actions.map((a) => ({ name: a.name, dependency: a.dependency, from: a.from, to: a.to })),
      history: this.history.slice(-20),
      total_runs: this.history.length,
    };
  }
}

module.exports = { SelfHealer };
