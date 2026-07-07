'use strict';

const { err } = require('../kernel/errors');
const { hmac, timingSafeEqual } = require('../kernel/ids');

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Webhook signing + replay protection (doc §13.2 "payment provider
 * webhook forgery: HMAC signatures, replay windows").
 *
 * Canonical signature: HMAC-SHA256(secret, `${ts}.${nonce}.${rawBody}`)
 * carried in X-Motse-Signature / X-Motse-Timestamp / X-Motse-Nonce.
 * Verification accepts current+previous secret versions (rotation-safe)
 * and rejects stale timestamps and reused nonces.
 */
class ReplayGuard {
  constructor(clock) {
    this.clock = clock;
    this.seenNonces = new Map(); // nonce -> expiry ms
  }

  _gc() {
    const now = this.clock.nowMs();
    for (const [nonce, expiry] of this.seenNonces) {
      if (expiry < now) this.seenNonces.delete(nonce);
    }
  }

  /** Throws on stale timestamp or nonce reuse; records the nonce. */
  assertFresh(timestamp, nonce) {
    this._gc();
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(this.clock.nowMs() - ts) > REPLAY_WINDOW_MS) {
      throw err('PERMISSION_DENIED', 'Webhook timestamp outside the replay window');
    }
    if (!nonce) throw err('PERMISSION_DENIED', 'Webhook nonce missing');
    if (this.seenNonces.has(nonce)) {
      throw err('PERMISSION_DENIED', 'Webhook nonce replayed');
    }
    this.seenNonces.set(nonce, this.clock.nowMs() + REPLAY_WINDOW_MS * 2);
  }
}

function signPayload(secretValue, timestamp, nonce, rawBody) {
  return hmac(secretValue, `${timestamp}.${nonce}.${rawBody}`);
}

/** Try every verify-valid secret version; constant-time comparisons. */
function verifySignature(secretVersions, { timestamp, nonce, rawBody, signature }) {
  if (!signature) return false;
  return secretVersions.some((entry) =>
    timingSafeEqual(signPayload(entry.value, timestamp, nonce, rawBody), signature)
  );
}

module.exports = { ReplayGuard, signPayload, verifySignature, REPLAY_WINDOW_MS };
