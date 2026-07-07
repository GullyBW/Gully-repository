'use strict';

/**
 * Injectable clock. Offline-replay and escrow tests need to move time
 * (doc §15.1: "7 days of queued mutations replay cleanly — tested in CI
 * with clock-skew suites"), so nothing in the platform calls Date.now()
 * directly.
 */
class Clock {
  constructor() {
    this._skewMs = 0;
  }

  now() {
    return new Date(Date.now() + this._skewMs);
  }

  nowIso() {
    return this.now().toISOString();
  }

  nowMs() {
    return Date.now() + this._skewMs;
  }

  /** Test helper: advance the clock. */
  advance(ms) {
    this._skewMs += ms;
  }

  reset() {
    this._skewMs = 0;
  }
}

module.exports = { Clock };
