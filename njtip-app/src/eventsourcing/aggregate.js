'use strict';
// Aggregate root base (Phase 11). An aggregate protects its invariants and produces
// domain events; its state is derived by applying events (event sourcing). Subclasses
// implement `on<EventType>(data)` handlers. Deterministic and side-effect-free.
class Aggregate {
  constructor(id) { this.id = id; this.version = 0; this._uncommitted = []; }

  // Raise a new domain event: apply it to self AND record it as uncommitted for persistence.
  raise(type, data = {}, meta = {}) { this._apply(type, data); this._uncommitted.push({ type, data, meta }); return this; }
  _apply(type, data) { const h = this['on' + type]; if (typeof h === 'function') h.call(this, data); }

  // Rebuild state from a history of persisted events (optionally starting from a snapshot).
  loadFromHistory(events, snapshot) {
    if (snapshot) { Object.assign(this, snapshot.state); this.version = snapshot.version; }
    for (const e of events) { if (!snapshot || e.version > snapshot.version) { this._apply(e.type, e.data); this.version = e.version; } }
    return this;
  }
  uncommitted() { return [...this._uncommitted]; }
  markCommitted() { const n = this._uncommitted.length; this.version += n; this._uncommitted = []; return n; }
}
module.exports = { Aggregate };
