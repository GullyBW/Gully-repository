'use strict';
// Immutable, hash-chained, signed evidence archive with synthetic trusted
// timestamps (RFC-3161-style: a signed digest + monotonic sequence). Supports
// long-term preservation and INDEPENDENT verification: verify() recomputes the
// chain and checks every signature — anyone with the public key can re-verify.
const fs = require('node:fs');
const path = require('node:path');
const { sha256, chain } = require('../util/hash');
const { sign, verify, publicKeyPem } = require('./signing');

class EvidenceArchive {
  constructor(file) {
    this.file = file;
    this._entries = [];
    this._load();
  }

  _load() {
    try { this._entries = JSON.parse(fs.readFileSync(this.file, 'utf8')).entries || []; } catch (_) { this._entries = []; }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ publicKey: publicKeyPem(), entries: this._entries }, null, 2));
  }

  // Append an evidence digest (content digest of a bundle). Returns the archive entry.
  append(contentDigest, meta = {}) {
    const seq = this._entries.length;
    const prevHash = seq ? this._entries[seq - 1].entryHash : null;
    const timestamp = { seq, logical: seq, note: 'synthetic trusted timestamp (monotonic sequence)' };
    const record = { seq, contentDigest, prevHash, timestamp, meta };
    const entryHash = chain(prevHash, record);
    const signature = sign(entryHash); // sign the chained entry hash
    const entry = { ...record, entryHash, signature };
    this._entries.push(entry);
    this._save();
    return entry;
  }

  // Independent verification: chain integrity + every signature.
  verify() {
    let prev = null;
    for (const e of this._entries) {
      const record = { seq: e.seq, contentDigest: e.contentDigest, prevHash: e.prevHash, timestamp: e.timestamp, meta: e.meta };
      if (e.prevHash !== prev) return { ok: false, reason: 'chain-break', seq: e.seq };
      if (e.entryHash !== chain(prev, record)) return { ok: false, reason: 'hash-mismatch', seq: e.seq };
      if (!verify(e.entryHash, e.signature)) return { ok: false, reason: 'bad-signature', seq: e.seq };
      prev = e.entryHash;
    }
    return { ok: true, length: this._entries.length, head: prev };
  }

  entries() { return this._entries.map((e) => ({ ...e })); }
}

module.exports = { EvidenceArchive };
