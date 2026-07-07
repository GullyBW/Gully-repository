'use strict';

const { err } = require('../kernel/errors');

const NOOP_METRICS = { inc() {}, observe() {} };

/**
 * Load shedding (Mission 8). When the process is overloaded — too many
 * requests in flight, or the event loop is stalling — NORMAL-priority
 * requests are rejected fast with `UNAVAILABLE` (503, retryable) while
 * CRITICAL paths (health probes, metrics scrapes, operator webhooks, the
 * admin control plane) always pass: during an incident the platform must
 * shed the traffic that can wait, never the tools needed to fix it.
 *
 * Overload signals:
 *   - in-flight request count above `maxInFlight`
 *   - event-loop lag above `lagThresholdMs` (from an injectable provider —
 *     wired to RuntimeIntelligence; absent provider ⇒ lag never triggers)
 *
 * Defaults are deliberately generous: with in-memory handlers measuring
 * p95 ≈ 23ms at 1,400 rps in validation, 500 concurrent in-flight requests
 * signal genuine distress, not load.
 */
const CRITICAL_PREFIXES = ['/health', '/metrics', '/v1/admin', '/v1/payments/webhooks'];

class LoadShedder {
  constructor({ maxInFlight = 500, lagThresholdMs = 500, lagProvider = null, metrics = null } = {}) {
    this.maxInFlight = maxInFlight;
    this.lagThresholdMs = lagThresholdMs;
    this.lagProvider = lagProvider; // () => current event-loop lag ms
    this.metrics = metrics || NOOP_METRICS;
    this.inFlight = 0;
    this.counts = { passed: 0, shed: 0, critical_passed: 0, peak_in_flight: 0 };
  }

  isCritical(path) {
    return CRITICAL_PREFIXES.some((p) => path.startsWith(p));
  }

  overloaded() {
    if (this.inFlight >= this.maxInFlight) return `in_flight ${this.inFlight} >= ${this.maxInFlight}`;
    if (this.lagProvider) {
      const lag = this.lagProvider();
      if (lag != null && lag > this.lagThresholdMs) return `event_loop_lag ${Math.round(lag)}ms > ${this.lagThresholdMs}ms`;
    }
    return null;
  }

  middleware() {
    return (req, res, next) => {
      const critical = this.isCritical(req.path);
      const reason = critical ? null : this.overloaded();
      if (reason) {
        this.counts.shed += 1;
        this.metrics.inc('motse_loadshed_total', { result: 'shed' });
        return next(err('UNAVAILABLE', `shedding load: ${reason}`));
      }
      this.inFlight += 1;
      this.counts.peak_in_flight = Math.max(this.counts.peak_in_flight, this.inFlight);
      this.counts[critical ? 'critical_passed' : 'passed'] += 1;
      this.metrics.inc('motse_loadshed_total', { result: critical ? 'critical_passed' : 'passed' });
      res.on('finish', () => { this.inFlight -= 1; });
      res.on('close', () => { if (!res.writableFinished) this.inFlight -= 1; }); // aborted requests
      return next();
    };
  }

  stats() {
    return {
      max_in_flight: this.maxInFlight,
      lag_threshold_ms: this.lagThresholdMs,
      in_flight: this.inFlight,
      overloaded: this.overloaded(),
      ...this.counts,
    };
  }
}

module.exports = { LoadShedder, CRITICAL_PREFIXES };
