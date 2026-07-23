'use strict';
// Ciphertext-only backup vault (blueprint design/04 §5, DDR-02).
// Backups contain ONLY ciphertext (never plaintext, never keys co-located).
// Integrity is a manifest hash over the ciphertext objects; corruption is detected.
const { sha256 } = require('../util/hash');
const { isCiphertext } = require('../platform/crypto');

class BackupVault {
  constructor(clock) {
    this._snapshots = [];
    this._clock = clock;
  }

  // Snapshot ciphertext objects. Rejects anything that is not ciphertext (defense
  // against accidentally backing up plaintext).
  snapshot(id, ciphertextObjects) {
    for (const o of ciphertextObjects) {
      if (!isCiphertext(o.cipher)) throw new Error(`refusing to back up non-ciphertext object ${o.id}`);
    }
    const payload = ciphertextObjects.map((o) => ({ id: o.id, contentHash: o.contentHash, cipher: o.cipher }));
    const manifestHash = sha256(payload);
    const snap = { id, at: this._clock(), payload, manifestHash };
    this._snapshots.push(snap);
    return { id, manifestHash, count: payload.length };
  }

  verify(id) {
    const s = this._snapshots.find((x) => x.id === id);
    if (!s) return { ok: false, reason: 'not-found' };
    const recomputed = sha256(s.payload);
    return { ok: recomputed === s.manifestHash, expected: s.manifestHash, actual: recomputed };
  }

  // Restore returns ciphertext objects; there is no way to get plaintext from a backup
  // (keys are not in the backup).
  restore(id) {
    const s = this._snapshots.find((x) => x.id === id);
    if (!s) return null;
    return s.payload.map((p) => ({ ...p }));
  }

  containsPlaintext(id) {
    const s = this._snapshots.find((x) => x.id === id);
    return s ? JSON.stringify(s.payload).match(/synthetic-(dr|evidence|secret)/i) !== null : false;
  }

  // Test hook: simulate backup corruption.
  _corrupt(id) {
    const s = this._snapshots.find((x) => x.id === id);
    if (s && s.payload[0]) s.payload[0].contentHash = sha256('CORRUPT');
  }
}

module.exports = { BackupVault };
