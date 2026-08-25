'use strict';
// Event Sourcing — an append-only, HASH-CHAINED, immutable event log (Phase 11). Every
// domain state change is recorded as an immutable event; the current state is a fold over
// the events. This is ADDITIVE to the existing repositories (backward compatible): the
// read-model projections keep serving queries; the event store is the write-side source of
// truth and the audit spine.
//
// Guarantees: append-only (no update/delete), per-stream optimistic concurrency, a global
// hash chain for tamper-evidence, deterministic under an injected clock, schema versioning
// via upcasters, and snapshotting for fast rebuilds. Zero dependencies.
const { hash } = require('../twin');

class EventStore {
  constructor({ clock = () => Date.now(), upcasters = {} } = {}) {
    this._clock = clock;
    this._events = [];                 // global, ordered, immutable
    this._byStream = new Map();         // streamId -> event[]
    this._snapshots = new Map();        // streamId -> { version, state }
    this._upcasters = upcasters;        // `${type}:${fromV}` -> (data) => data  (schema evolution)
    this._lastHash = 'GENESIS';
  }

  streamVersion(streamId) { return (this._byStream.get(streamId) || []).length; }

  // Append events to a stream with optimistic concurrency. Returns the appended records.
  // expectedVersion === -1 means "no concurrency check".
  append(streamId, events, expectedVersion = -1) {
    if (!streamId) throw new Error('event-store: streamId required');
    const list = this._byStream.get(streamId) || [];
    if (expectedVersion !== -1 && expectedVersion !== list.length) {
      const e = new Error(`event-store: concurrency conflict on ${streamId} (expected ${expectedVersion}, actual ${list.length})`); e.conflict = true; throw e;
    }
    const appended = [];
    for (const ev of [].concat(events)) {
      if (!ev || !ev.type) throw new Error('event-store: event.type required');
      const version = list.length + 1;
      const rec = {
        streamId, seq: this._events.length + 1, version,
        type: ev.type, v: ev.v || 1, data: clone(ev.data || {}),
        meta: { at: this._clock(), actor: (ev.meta && ev.meta.actor) || 'system' },
        prevHash: this._lastHash,
      };
      rec.hash = hash.sha256({ streamId: rec.streamId, version: rec.version, type: rec.type, v: rec.v, data: rec.data, at: rec.meta.at, actor: rec.meta.actor, prevHash: rec.prevHash });
      this._lastHash = rec.hash;
      Object.freeze(rec.data); Object.freeze(rec.meta); Object.freeze(rec); // immutability
      this._events.push(rec); list.push(rec); appended.push(rec);
    }
    this._byStream.set(streamId, list);
    return appended;
  }

  // Read a stream (optionally applying upcasters to migrate old event schemas on read).
  readStream(streamId, { fromVersion = 0 } = {}) {
    return (this._byStream.get(streamId) || []).filter((e) => e.version > fromVersion).map((e) => this._upcast(e));
  }
  // Read the whole log up to a point in time / seq (time-travel / replay).
  readAll({ untilSeq = Infinity, untilAt = Infinity } = {}) {
    return this._events.filter((e) => e.seq <= untilSeq && e.meta.at <= untilAt).map((e) => this._upcast(e));
  }
  _upcast(e) {
    let data = e.data, v = e.v;
    while (this._upcasters[`${e.type}:${v}`]) { data = this._upcasters[`${e.type}:${v}`](data); v += 1; }
    return v === e.v ? e : { ...e, data, v };
  }

  // Snapshotting: persist a rebuilt aggregate state at a version for fast reloads.
  saveSnapshot(streamId, version, state) { this._snapshots.set(streamId, { version, state: clone(state) }); }
  getSnapshot(streamId) { const s = this._snapshots.get(streamId); return s ? clone(s) : null; }

  // Integrity: the whole log is a valid hash chain and is append-only (tamper-evident).
  verifyChain() {
    let prev = 'GENESIS';
    for (const e of this._events) {
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'prevHash mismatch' };
      const h = hash.sha256({ streamId: e.streamId, version: e.version, type: e.type, v: e.v, data: e.data, at: e.meta.at, actor: e.meta.actor, prevHash: e.prevHash });
      if (h !== e.hash) return { ok: false, brokenAt: e.seq, reason: 'hash mismatch (tampered)' };
      prev = e.hash;
    }
    return { ok: true, length: this._events.length, head: prev };
  }
  size() { return this._events.length; }
  streams() { return [...this._byStream.keys()]; }
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

module.exports = { EventStore };
