'use strict';
// Key-management PORT (encryption at rest). A KeyManager exposes a stable interface —
// encrypt(zone, plaintext) → ciphertext blob, decrypt(blob) → plaintext, and
// isCiphertext(blob) — so the object store and any at-rest persistence depend only on
// this port, never on a concrete crypto/KMS implementation.
//
// 🔒 The REFERENCE implementation delegates to the Twin's SYNTHETIC envelope crypto
// (per-zone data keys, keys never co-located with ciphertext). The PRODUCTION driver is
// a real KMS/HSM + threshold key custody integration that is HUMAN-EXPERT-BUILT and
// ISRB-signed (blueprint DDR-10) — it is NEVER autonomously generated. This adapter only
// defines the seam where that human-built driver plugs in (docs/production-adapters.md).
const twinCrypto = require('../twin').crypto;

// Reference KeyManager: production-shaped control flow, synthetic key material.
class SyntheticKeyManager {
  constructor() { this.synthetic = true; this.keyRefPrefix = 'synthetic-kms://'; }
  encrypt(zone, plaintext) { return twinCrypto.envelopeEncrypt(zone, plaintext); }
  decrypt(blob) { return twinCrypto.decrypt(blob); }
  isCiphertext(blob) { return twinCrypto.isCiphertext(blob); }
  // Per-object key rotation is a KMS concern; the port exposes the intent so a real
  // driver can implement re-wrap without the domain knowing. Reference is a no-op re-wrap.
  rewrap(zone, blob) { return this.encrypt(zone, this.decrypt(blob)); }
}

// Factory: cfg.kms selects the driver. 'synthetic' (default) or 'kms' (human-built,
// wired in production only — importing it here would be a placeholder, so it is not).
function makeKeyManager(cfg = {}) {
  if (cfg.kms === 'kms') {
    // In production this returns a human-built KMS/HSM driver implementing the same port.
    // It is intentionally absent from this repo: 🔒 crypto is never machine-generated.
    throw new Error('production KMS driver is human-built and ISRB-signed; not provided in-repo');
  }
  return new SyntheticKeyManager();
}

module.exports = { SyntheticKeyManager, makeKeyManager };
