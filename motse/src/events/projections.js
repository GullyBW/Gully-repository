'use strict';

const { err } = require('../kernel/errors');

/**
 * CQRS projections (Phase 5, WS3). Writes flow through the domain services
 * into the Event Store (the command side); reads are served from
 * materialized views maintained here (the query side). Dashboards consume
 * these projections, never the transactional collections.
 *
 * A projection is a named reducer map `{ eventType: (state, event) => state }`
 * folded over the event log into a single materialized document. Projection
 * workers advance incrementally as events are appended (live) and can be
 * rebuilt from zero at any time (replay), so a new report is just a new
 * projection with no schema migration.
 */
class ProjectionRegistry {
  constructor({ store, clock, eventStore }) {
    this.store = store;
    this.clock = clock;
    this.eventStore = eventStore;
    this.projections = new Map(); // name -> { name, on, initial, col, position }
    // Live updates: advance every projection as new events land.
    eventStore.onAppend((record) => this._dispatch(record));
  }

  /**
   * Register (and backfill) a projection.
   * @param {string} name
   * @param {object} on       { eventType: (state, event) => state }
   * @param {object} initial  starting materialized state
   */
  register({ name, on, initial = {} }) {
    if (this.projections.has(name)) return this.projections.get(name);
    const col = this.store.collection(`projection_${name}`);
    const proj = { name, on, initial, col, position: 0 };
    col.insert({ id: name, state: clone(initial), position: 0, updated_at: this.clock.nowIso() });
    this.projections.set(name, proj);
    // Backfill from the events already in the store.
    for (const record of this.eventStore.read({})) this._apply(proj, record);
    return proj;
  }

  _dispatch(record) {
    for (const proj of this.projections.values()) this._apply(proj, record);
  }

  _apply(proj, record) {
    if (record.seq <= proj.position) return; // already folded (idempotent)
    const reducer = proj.on[record.type];
    if (reducer) {
      const doc = proj.col.get(proj.name);
      const nextState = reducer(doc.state, record);
      proj.col.update(proj.name, { state: nextState, updated_at: this.clock.nowIso() });
    }
    proj.position = record.seq;
    proj.col.update(proj.name, { position: proj.position });
  }

  /** The materialized read model. */
  read(name) {
    const proj = this._get(name);
    return proj.col.get(proj.name).state;
  }

  /** Read model + worker position (dashboards / lag monitoring). */
  view(name) {
    const proj = this._get(name);
    const doc = proj.col.get(proj.name);
    return { name, state: doc.state, position: doc.position, lag: this.eventStore._seq - doc.position, updated_at: doc.updated_at };
  }

  /** Rebuild a single projection from the log (replay). */
  rebuild(name) {
    const proj = this._get(name);
    proj.col.update(proj.name, { state: clone(proj.initial), position: 0 });
    proj.position = 0;
    for (const record of this.eventStore.read({})) this._apply(proj, record);
    return this.read(name);
  }

  list() {
    return [...this.projections.keys()].map((name) => {
      const doc = this._get(name).col.get(name);
      return { name, position: doc.position, lag: this.eventStore._seq - doc.position, updated_at: doc.updated_at };
    });
  }

  _get(name) {
    const proj = this.projections.get(name);
    if (!proj) throw err('NOT_FOUND', `No projection ${name}`);
    return proj;
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Seed projections wired at boot (WS3/WS18). Each folds domain events into a
 * dashboard-ready view. Adding a report never touches a transactional table.
 */
const SEED_PROJECTIONS = [
  {
    name: 'platform_activity',
    initial: { total: 0, by_type: {} },
    // A catch-all counter is impractical per-type; a small curated set keeps
    // the projection meaningful for the executive dashboard (WS18).
    on: buildCounter([
      'payments.intent.completed', 'card.captured', 'card.refunded', 'card.chargeback',
      'heritage.item.published', 'heritage.item.validated',
      'kgetsi.contribution.received', 'loeto.booking.settled',
      'qr.generated', 'qr.scanned', 'qr.revoked',
    ]),
  },
  {
    name: 'payments_summary',
    initial: { captured_minor: 0, refunded_minor: 0, chargebacks: 0, captures: 0 },
    on: {
      'card.captured': (s, e) => ({ ...s, captured_minor: s.captured_minor + (e.data.amount_minor || 0), captures: s.captures + 1 }),
      'card.refunded': (s, e) => ({ ...s, refunded_minor: s.refunded_minor + (e.data.amount_minor || 0) }),
      'card.chargeback': (s) => ({ ...s, chargebacks: s.chargebacks + 1 }),
    },
  },
  {
    name: 'qr_activity',
    initial: { generated: 0, scanned: 0, revoked: 0, by_kind: {} },
    on: {
      'qr.generated': (s, e) => ({ ...s, generated: s.generated + 1, by_kind: bump(s.by_kind, e.data.kind) }),
      'qr.scanned': (s) => ({ ...s, scanned: s.scanned + 1 }),
      'qr.revoked': (s) => ({ ...s, revoked: s.revoked + 1 }),
    },
  },
];

function buildCounter(types) {
  const on = {};
  for (const t of types) on[t] = (s) => ({ ...s, total: s.total + 1, by_type: bump(s.by_type, t) });
  return on;
}

function bump(map, key) {
  const k = key || 'unknown';
  return { ...map, [k]: (map[k] || 0) + 1 };
}

module.exports = { ProjectionRegistry, SEED_PROJECTIONS };
