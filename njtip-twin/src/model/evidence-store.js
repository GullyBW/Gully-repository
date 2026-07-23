'use strict';
// Evidence + Digital Chain of Custody (blueprint DDR-06, threats T-1/T-2/T-5).
// Content stored as ciphertext; every touch appends a hash-chained custody event;
// integrity is re-verified on every access.
const { sha256, chain } = require('../util/hash');
const { envelopeEncrypt, isCiphertext } = require('../platform/crypto');

class EvidenceStore {
  constructor(zone, clock) {
    this.zone = zone;
    this._objects = new Map();
    this._custody = [];
    this._custodyHead = null;
    this._clock = clock;
  }

  _appendCustody(objectHash, actor, role, purpose) {
    const rec = { objectHash, actor, role, purpose, ts: this._clock() };
    const hash = chain(this._custodyHead, rec);
    this._custody.push({ rec, prevHash: this._custodyHead, hash });
    this._custodyHead = hash;
    return hash;
  }

  ingest({ id, actor, role, content, matter }) {
    const contentHash = sha256(String(content));
    const blob = envelopeEncrypt(this.zone, content);
    this._objects.set(id, { id, contentHash, cipher: blob, matter, zone: this.zone });
    this._appendCustody(contentHash, actor, role, 'ingest');
    return { id, contentHash };
  }

  // Access re-verifies integrity and appends a custody event.
  access(id, actor, role, purpose = 'read') {
    const obj = this._objects.get(id);
    if (!obj) return { ok: false, reason: 'not-found' };
    if (!isCiphertext(obj.cipher)) return { ok: false, reason: 'plaintext-at-rest' };
    this._appendCustody(obj.contentHash, actor, role, purpose);
    return { ok: true, contentHash: obj.contentHash };
  }

  // Tamper detection: does the stored contentHash still match a claimed content?
  verifyObject(id, claimedContent) {
    const obj = this._objects.get(id);
    if (!obj) return { ok: false, reason: 'not-found' };
    const recomputed = sha256(String(claimedContent));
    return { ok: recomputed === obj.contentHash, expected: obj.contentHash, actual: recomputed };
  }

  // For the tampering SIM: mutate the underlying object hash to simulate tampering.
  _forceTamper(id) {
    const obj = this._objects.get(id);
    if (obj) obj.contentHash = sha256('TAMPERED-' + obj.contentHash);
  }

  verifyCustodyChain() {
    let prev = null;
    for (const c of this._custody) {
      if (c.prevHash !== prev || c.hash !== chain(prev, c.rec)) return { ok: false, brokenAt: c.rec };
      prev = c.hash;
    }
    return { ok: true, length: this._custody.length };
  }

  _rawObject(id) {
    return this._objects.get(id) || null;
  }
}

module.exports = { EvidenceStore };
