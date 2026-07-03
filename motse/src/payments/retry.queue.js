'use strict';

const { id } = require('../kernel/ids');

const BACKOFF_MS = [2000, 4000, 8000, 16000, 32000];

/**
 * Retry queue for transient provider-dispatch failures. Tasks retry
 * with exponential backoff until MAX_ATTEMPTS, then land in the
 * dead-letter list for the admin failed-payments queue. Drained by the
 * scheduler (production: Cloud Tasks / Pub/Sub push; here: explicit
 * drain() calls from the service and tests, clock-driven).
 */
class RetryQueue {
  constructor(clock) {
    this.clock = clock;
    this.tasks = new Map(); // id -> { runAt, attempts, fn, label }
    this.deadLetters = [];
  }

  enqueue(label, fn, { delayMs = BACKOFF_MS[0] } = {}) {
    const taskId = id('rtk');
    this.tasks.set(taskId, {
      id: taskId,
      label,
      fn,
      attempts: 0,
      runAt: this.clock.nowMs() + delayMs,
    });
    return taskId;
  }

  /** Run everything due. Returns { ran, retried, dead }. */
  drain() {
    let ran = 0;
    let retried = 0;
    let dead = 0;
    for (const task of [...this.tasks.values()]) {
      if (task.runAt > this.clock.nowMs()) continue;
      this.tasks.delete(task.id);
      try {
        task.fn();
        ran += 1;
      } catch (e) {
        task.attempts += 1;
        if (task.attempts >= BACKOFF_MS.length) {
          this.deadLetters.push({
            id: task.id,
            label: task.label,
            attempts: task.attempts,
            error: e.message,
            at: this.clock.nowIso(),
          });
          dead += 1;
        } else {
          task.runAt = this.clock.nowMs() + BACKOFF_MS[task.attempts];
          this.tasks.set(task.id, task);
          retried += 1;
        }
      }
    }
    return { ran, retried, dead };
  }

  depth() {
    return this.tasks.size;
  }
}

module.exports = { RetryQueue, BACKOFF_MS };
