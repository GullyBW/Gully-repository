'use strict';
// Enterprise Chain of Custody (Phase 16). An immutable, hash-chained, digitally-SIGNED and
// trusted-TIMESTAMPED ledger of evidence handling events, with tamper detection, witness
// verification, and archive validation. Deterministic.
//
// 🔒 Uses the Twin's SYNTHETIC Ed25519 signing identity — it NEVER generates production
// cryptographic material (real signing keys/HSM are human-managed). The ledger records only
// content HASHES and non-identifying handling metadata, never case content or identity.
const { signing, hash } = require('../twin');

class CustodyLedger {
  constructor({ clock = () => Date.now(), tsa } = {}) {
    this._clock = clock;
    this._tsa = tsa || ((digest) => ({ time: this._clock(), token: hash.sha256({ digest, t: this._clock() }) })); // trusted timestamp (synthetic)
    this._entries = []; this._lastHash = 'GENESIS';
  }

  // Append a custody event. contentHash is the evidence bytes' hash (computed elsewhere);
  // the ledger stores the hash, not the content. Each entry is signed + timestamped + chained.
  record({ evidenceId, action, actor, contentHash, witness }) {
    if (!evidenceId || !action || !actor) throw new Error('custody: evidenceId, action, actor required');
    const seq = this._entries.length + 1;
    const ts = this._tsa(contentHash || evidenceId);
    const body = { seq, evidenceId, action, actor, contentHash: contentHash || null, witness: witness || null, at: ts.time, timestampToken: ts.token, prevHash: this._lastHash };
    body.hash = hash.sha256(body);
    body.signature = signing.sign(body.hash); // 🔒 synthetic Ed25519
    this._lastHash = body.hash;
    Object.freeze(body);
    this._entries.push(body);
    return { seq, hash: body.hash };
  }

  entries(evidenceId) { return this._entries.filter((e) => !evidenceId || e.evidenceId === evidenceId).map((e) => ({ ...e })); }

  // Integrity: chain links, hashes, and signatures all valid (tamper detection).
  verify() {
    let prev = 'GENESIS';
    for (const e of this._entries) {
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'chain break' };
      const { hash: h, signature, ...body } = e;
      if (hash.sha256(body) !== h) return { ok: false, brokenAt: e.seq, reason: 'hash mismatch (tampered)' };
      if (!signing.verify(h, signature)) return { ok: false, brokenAt: e.seq, reason: 'signature invalid' };
      prev = h;
    }
    return { ok: true, length: this._entries.length, head: prev };
  }
  // Witness verification: a handling event carried an independent witness attestation.
  witnessVerified(seq) { const e = this._entries[seq - 1]; return !!(e && e.witness); }
  // Archive validation: a deterministic, signed digest over the whole ledger for preservation.
  archive() { const digest = hash.sha256(this._entries.map((e) => e.hash)); return { digest, signature: signing.sign(digest), length: this._entries.length, verified: this.verify().ok, note: 'Long-term preservation digest. Synthetic signature. Evidence ≠ authorization.' }; }
}

module.exports = { CustodyLedger };
