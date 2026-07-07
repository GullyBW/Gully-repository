'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Platform Event Store (Phase 5, WS2). An immutable, append-only log of
 * every domain event — not just the financial ledger. It taps the event
 * bus (see EventBus.tap) so every published event across identity,
 * heritage, payments, workflows, governance, trusts, tourism,
 * notifications, plugins, AI, search and sync is persisted with a global
 * sequence number and an aggregate stream id.
 *
 * Capabilities:
 *   - replay            fold the log through any handler
 *   - snapshots         checkpoint aggregate state; rebuild = snapshot + tail
 *   - projections       (see ProjectionRegistry, WS3) consume via onAppend
 *   - event versioning  every record carries its schema version
 *   - schema evolution  upcasters transform old versions to the current shape
 *   - time-travel        read the world as of any timestamp
 *
 * The store never mutates or deletes a recorded event; corrections are new
 * events. It is multi-tenant aware (WS1): every record carries a tenant.
 */
class EventStore {
  constructor({ store, clock, bus }) {
    this.store = store;
    this.clock = clock;
    this.bus = bus;
    this.events = store.collection('event_store');
    this.snapshots = store.collection('event_snapshots');
    this.upcasters = new Map(); // `${type}:${fromVersion}` -> fn(data, record) -> { data, version }
    this._seq = 0;
    this._appendSubscribers = []; // projection workers notified on append
    // Persist every domain event the bus publishes.
    if (bus) this._untap = bus.tap((event) => this._record(event));
  }

  /** Persist a bus event. Derives a stream from an explicit id or the domain. */
  _record(busEvent) {
    const data = busEvent.data || {};
    const streamId = data.stream_id || data.aggregate_id || String(busEvent.type).split('.')[0];
    return this.append({
      streamId,
      type: busEvent.type,
      version: busEvent.version,
      data,
      occurredAt: busEvent.occurred_at,
      sourceId: busEvent.id,
      tenant: data.tenant || 'motse',
    });
  }

  /**
   * Append an event to the immutable log. Returns the stored record with
   * its assigned global sequence number.
   */
  append({ streamId, type, version = 1, data = {}, occurredAt, tenant = 'motse', sourceId = null, actorRef = null }) {
    if (!type) throw err('INVALID_ARGUMENT', 'event type is required');
    this._seq += 1;
    const record = this.events.insert({
      id: id('evs'),
      seq: this._seq,
      stream_id: streamId || 'system',
      tenant,
      type,
      version: version || 1,
      occurred_at: occurredAt || this.clock.nowIso(),
      recorded_at: this.clock.nowIso(),
      actor_ref: actorRef,
      source_id: sourceId,
      data,
    });
    for (const sub of this._appendSubscribers) {
      try { sub(record); } catch (e) { /* a projection worker must not break appends */ }
    }
    return record;
  }

  // ── Event versioning & schema evolution (upcasters) ─────────────────

  /** Evolve `type` events at `fromVersion` into the next version's shape. */
  registerUpcaster(type, fromVersion, fn) {
    this.upcasters.set(`${type}:${fromVersion}`, fn);
    return this;
  }

  _upcast(record) {
    let { data, version } = record;
    let up = this.upcasters.get(`${record.type}:${version}`);
    let guard = 0;
    while (up && guard < 50) {
      const next = up(data, record) || {};
      data = next.data !== undefined ? next.data : next;
      version = next.version !== undefined ? next.version : version + 1;
      up = this.upcasters.get(`${record.type}:${version}`);
      guard += 1;
    }
    return { ...record, data, version };
  }

  // ── Reads ───────────────────────────────────────────────────────────

  /** Read events (upcasted to the current shape) with optional filters. */
  read({ stream, type, tenant, fromSeq = 0, toSeq = Infinity, until } = {}) {
    const untilMs = until ? new Date(until).getTime() : Infinity;
    return this.events
      .find((e) =>
        (stream ? e.stream_id === stream : true) &&
        (type ? e.type === type : true) &&
        (tenant ? e.tenant === tenant : true) &&
        e.seq > fromSeq && e.seq <= toSeq &&
        new Date(e.occurred_at).getTime() <= untilMs)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => this._upcast(e));
  }

  /** Fold the (filtered) log through a reducer — the projection primitive. */
  fold(reducer, initial, filter = {}) {
    let state = initial;
    for (const e of this.read(filter)) state = reducer(state, e);
    return state;
  }

  /** Replay the (filtered) log through a side-effecting handler. */
  replay(handler, filter = {}) {
    let replayed = 0;
    for (const e of this.read(filter)) { handler(e); replayed += 1; }
    return { replayed };
  }

  /** Time-travel debugging: the log as it stood at `atIso`. */
  timeTravel(atIso, filter = {}) {
    return this.read({ ...filter, until: atIso });
  }

  /** Notify a worker (projection) of every newly appended event. */
  onAppend(fn) {
    this._appendSubscribers.push(fn);
  }

  // ── Snapshots ───────────────────────────────────────────────────────

  /** Checkpoint aggregate state at the stream's current head. */
  snapshot(streamId, state) {
    const events = this.read({ stream: streamId });
    const head = events.length ? events[events.length - 1].seq : 0;
    return this.snapshots.insert({
      id: id('snp'), stream_id: streamId, seq: head, state, at: this.clock.nowIso(),
    });
  }

  loadSnapshot(streamId) {
    const snaps = this.snapshots.find((s) => s.stream_id === streamId).sort((a, b) => b.seq - a.seq);
    return snaps[0] || null;
  }

  /** Rebuild an aggregate: latest snapshot + the events recorded since. */
  rebuild(streamId, reducer, initial) {
    const snap = this.loadSnapshot(streamId);
    let state = snap ? snap.state : initial;
    for (const e of this.read({ stream: streamId, fromSeq: snap ? snap.seq : 0 })) {
      state = reducer(state, e);
    }
    return state;
  }

  // ── Introspection ───────────────────────────────────────────────────

  stats() {
    const byType = {}; const byStream = {}; const byTenant = {};
    for (const e of this.events.find()) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      byStream[e.stream_id] = (byStream[e.stream_id] || 0) + 1;
      byTenant[e.tenant] = (byTenant[e.tenant] || 0) + 1;
    }
    return {
      total: this.events.count(),
      high_seq: this._seq,
      streams: Object.keys(byStream).length,
      snapshots: this.snapshots.count(),
      by_type: byType,
      by_stream: byStream,
      by_tenant: byTenant,
    };
  }
}

module.exports = { EventStore };
