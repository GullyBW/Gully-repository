'use strict';

const { err } = require('../kernel/errors');

const NOOP_METRICS = { inc() {}, observe() {} };

/**
 * Adaptive retry + timeout budgets (Mission 8).
 *
 * `withRetry(fn, opts)` — exponential backoff with full jitter, bounded
 * attempts, retry CLASSIFICATION (MotseErrors honour their `retryable` flag;
 * infra errors — e.g. what ioredis throws — default to retryable), and an
 * optional shared RetryBudget so a storm of retries cannot amplify an outage
 * (the Finagle model: retries may be at most `ratio` of recent first calls).
 *
 * `withDeadline(promise, ms)` — request deadlines: rejects with UNAVAILABLE
 * when the work outlives its budget, so nothing waits forever.
 *
 * Both are pure utilities: injectable sleep/clock make them deterministic in
 * tests, and nothing existing is wrapped implicitly.
 */

/** Shared retry budget: retries ≤ ratio × recent first-attempt calls. */
class RetryBudget {
  constructor({ ratio = 0.1, minRetries = 2, windowMs = 10 * 1000, clock } = {}) {
    this.ratio = ratio;
    this.minRetries = minRetries;
    this.windowMs = windowMs;
    this.clock = clock || { nowMs: () => Date.now() };
    this.calls = []; // { at, retry: bool }
  }

  _prune() {
    const horizon = this.clock.nowMs() - this.windowMs;
    while (this.calls.length && this.calls[0].at < horizon) this.calls.shift();
  }

  recordCall() {
    this.calls.push({ at: this.clock.nowMs(), retry: false });
  }

  /** True iff a retry is currently affordable (and records it if so). */
  tryAcquire() {
    this._prune();
    const firsts = this.calls.filter((c) => !c.retry).length;
    const retries = this.calls.filter((c) => c.retry).length;
    const allowance = Math.max(this.minRetries, Math.floor(firsts * this.ratio));
    if (retries >= allowance) return false;
    this.calls.push({ at: this.clock.nowMs(), retry: true });
    return true;
  }

  stats() {
    this._prune();
    return {
      window_ms: this.windowMs,
      ratio: this.ratio,
      recent_calls: this.calls.filter((c) => !c.retry).length,
      recent_retries: this.calls.filter((c) => c.retry).length,
    };
  }
}

/** Default classification: MotseErrors say so themselves; infra errors retry. */
function defaultClassify(e) {
  if (e && typeof e.retryable === 'boolean') return e.retryable;
  return true; // plain Error (network/driver failure) — worth another attempt
}

async function withRetry(fn, {
  name = 'op',
  attempts = 3,
  baseMs = 50,
  maxMs = 2000,
  jitter = true,
  budget = null,
  classify = defaultClassify,
  metrics = null,
  sleep = defaultSleep,
  random = Math.random,
} = {}) {
  const m = metrics || NOOP_METRICS;
  if (budget) budget.recordCall();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn(attempt);
      m.inc('motse_retry_total', { name, result: attempt === 1 ? 'first_try' : 'recovered' });
      return result;
    } catch (e) {
      lastError = e;
      if (!classify(e)) {
        m.inc('motse_retry_total', { name, result: 'not_retryable' });
        throw e;
      }
      if (attempt === attempts) break;
      if (budget && !budget.tryAcquire()) {
        m.inc('motse_retry_total', { name, result: 'budget_exhausted' });
        throw e; // amplification guard: give up rather than storm
      }
      m.inc('motse_retry_total', { name, result: 'retried' });
      // Exponential backoff with full jitter (AWS architecture blog model).
      const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      await sleep(jitter ? Math.floor(random() * cap) : cap);
    }
  }
  m.inc('motse_retry_total', { name, result: 'exhausted' });
  throw lastError;
}

/** Request deadline: the promise must settle within `ms` or the caller moves on. */
function withDeadline(promise, ms, label = 'operation') {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(err('UNAVAILABLE', `${label} exceeded its ${ms}ms deadline`)), ms);
    timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });
}

module.exports = { withRetry, withDeadline, RetryBudget, defaultClassify };
