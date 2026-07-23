'use strict';
// Trusted time source with skew detection (supports trusted timestamping, cert
// expiry, and time-synchronisation-failure simulations). Deterministic: driven by
// the logical clock, not the wall clock.
class TimeSource {
  constructor(clock, { maxSkewMs = 30_000 } = {}) {
    this._clock = clock;
    this._maxSkew = maxSkewMs;
    this._offset = 0; // injected skew for chaos/sim
  }

  now() {
    return this._clock() + this._offset;
  }

  // Compare against a reference time; flag if skew exceeds tolerance (time-sync failure).
  checkSync(referenceMs) {
    const skew = Math.abs(this.now() - referenceMs);
    return { ok: skew <= this._maxSkew, skew, tolerance: this._maxSkew };
  }

  // Certificate validity check against this time source.
  certValid(cert) {
    const t = this.now();
    return { valid: t >= cert.notBefore && t <= cert.notAfter, at: t };
  }

  // Chaos/sim hooks.
  _injectSkew(ms) {
    this._offset = ms;
  }
  _reset() {
    this._offset = 0;
  }
}

module.exports = { TimeSource };
