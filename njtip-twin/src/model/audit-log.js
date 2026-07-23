'use strict';
// Tamper-evident, append-only, hash-chained audit log with external anchoring
// (blueprint DDR-13, threats T-2/R-2/R-3). There is deliberately NO update or
// delete method — the only mutation is append().
const { chain, sha256 } = require('../util/hash');

class AuditLog {
  constructor(clock) {
    this._entries = [];
    this._head = null;
    this._clock = clock;
    this._anchors = [];
    this._available = true;
  }

  setAvailable(v) {
    this._available = !!v;
  }

  append({ actor, action, purpose, zone }) {
    // Fail-closed: if the audit store is unavailable, the action must NOT proceed
    // silently — auditability is a precondition for sensitive operations.
    if (!this._available) {
      const e = new Error('audit store unavailable — operation refused (fail-closed)');
      e.code = 'AUDIT_UNAVAILABLE';
      throw e;
    }
    const record = { seq: this._entries.length, actor, action, purpose, zone, ts: this._clock() };
    const hash = chain(this._head, record);
    const entry = { record, prevHash: this._head, hash };
    this._entries.push(entry);
    this._head = hash;
    return entry;
  }

  // Anchor the current head digest to an (synthetic) external transparency log.
  anchor() {
    const digest = { at: this._entries.length, head: this._head, anchoredHash: sha256(this._head || 'EMPTY') };
    this._anchors.push(digest);
    return digest;
  }

  // Recompute the chain from scratch and compare — detects any tampering.
  verifyIntegrity() {
    let prev = null;
    for (const e of this._entries) {
      const expected = chain(prev, e.record);
      if (e.prevHash !== prev || e.hash !== expected) {
        return { ok: false, brokenAt: e.record.seq };
      }
      prev = e.hash;
    }
    return { ok: true, head: prev, length: this._entries.length };
  }

  entries() {
    return this._entries.map((e) => ({ ...e.record }));
  }

  // Capability introspection for the auditability fitness function.
  capabilities() {
    return {
      appendOnly: typeof this.update === 'undefined' && typeof this.delete === 'undefined',
      hashChained: true,
      anchored: this._anchors.length > 0,
    };
  }
}

module.exports = { AuditLog };
