'use strict';
// Certificate LIFECYCLE management (issue → active → renew/rotate → expire → revoke).
// This manages the OPERATIONAL lifecycle around TLS/mTLS certificates: tracking validity
// windows, driving automated rotation before expiry, and maintaining a revocation list —
// the concern behind cert-manager / ACME / an enterprise PKI. Deterministic (injected clock).
//
// 🔒 The actual keypair/CSR/CA signing is HUMAN/PKI-managed (ACME, an internal CA, or an
// HSM) and is NOT generated here — certificate DESCRIPTORS are synthetic and clearly
// labelled. This adapter owns the schedule/inventory/revocation, not the cryptography.
const crypto = require('node:crypto');

class CertificateManager {
  constructor({ clock = () => Date.now(), renewBeforeMs = 30 * 24 * 3600_000 } = {}) {
    this._clock = clock; this._renewBefore = renewBeforeMs; this._certs = new Map(); this._crl = new Set(); this._seq = 0;
  }
  // Record a certificate the PKI issued (synthetic descriptor: serial, subject, validity).
  issue({ subject, validForMs = 90 * 24 * 3600_000 }) {
    const serial = 'CERT-' + (++this._seq).toString().padStart(4, '0') + '-' + crypto.randomBytes(4).toString('hex');
    const now = this._clock();
    const rec = { serial, subject, notBefore: now, notAfter: now + validForMs, revoked: false, synthetic: true, supersedes: null };
    this._certs.set(serial, rec);
    return { ...rec };
  }
  status(serial) { const c = this._certs.get(serial); return c ? { ...c, state: this._state(c) } : null; }
  _state(c) {
    const now = this._clock();
    if (c.revoked || this._crl.has(c.serial)) return 'revoked';
    if (now >= c.notAfter) return 'expired';
    if (now >= c.notAfter - this._renewBefore) return 'renew-due';
    return 'active';
  }
  // Rotate: issue a replacement and link it (the old one stays valid until it expires).
  rotate(serial, validForMs) { const old = this._certs.get(serial); if (!old) return null; const next = this.issue({ subject: old.subject, validForMs }); this._certs.get(next.serial).supersedes = serial; return next; }
  revoke(serial, reason = 'unspecified') { const c = this._certs.get(serial); if (!c) return false; c.revoked = true; c.revokedReason = reason; this._crl.add(serial); return true; }
  isRevoked(serial) { return this._crl.has(serial); }
  crl() { return [...this._crl]; }
  // Certs that need automated rotation now (renew-due or expired) — drives the rotation job.
  dueForRotation() { return [...this._certs.values()].filter((c) => ['renew-due', 'expired'].includes(this._state(c))).map((c) => c.serial); }
  inventory() { return [...this._certs.values()].map((c) => ({ serial: c.serial, subject: c.subject, state: this._state(c), notAfter: c.notAfter })); }
}

function makeCertificateManager(cfg = {}) { return new CertificateManager({ clock: cfg.clock }); }

module.exports = { CertificateManager, makeCertificateManager };
