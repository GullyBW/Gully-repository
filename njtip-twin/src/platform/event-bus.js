'use strict';
// Event-driven backbone + schema registry (blueprint DDR-07, threats I-6/DD-1/L-2).
// Hard invariant: an event that crosses a zone boundary must be PII-free, and the
// cross-zone direction must be an allowed flow. Enforced at publish time.
const { CROSS_ZONE_FLOWS } = require('../zones');
const { IDENTITY_DENYLIST } = require('../model/report-store');

class SchemaViolation extends Error {}

class EventBus {
  constructor() {
    this._subs = new Map();
    this._published = [];
    this._available = true;
  }

  setAvailable(v) {
    this._available = !!v;
  }

  subscribe(type, zone, handler) {
    const key = `${type}`;
    if (!this._subs.has(key)) this._subs.set(key, []);
    this._subs.get(key).push({ zone, handler });
  }

  _hasPII(payload) {
    for (const k of Object.keys(payload || {})) {
      if (IDENTITY_DENYLIST.includes(k.toLowerCase())) return k;
    }
    return null;
  }

  _crossZoneAllowed(from, to) {
    return CROSS_ZONE_FLOWS.some((f) => f.from === from && f.to === to);
  }

  publish({ type, sourceZone, targetZone, payload }) {
    if (!this._available) {
      const e = new Error('event bus unavailable — publish refused (fail-closed)');
      e.code = 'BUS_UNAVAILABLE';
      throw e;
    }
    if (targetZone && targetZone !== sourceZone) {
      const pii = this._hasPII(payload);
      if (pii) throw new SchemaViolation(`PII field "${pii}" cannot cross zone boundary (I-6/DD-1)`);
      if (!this._crossZoneAllowed(sourceZone, targetZone)) {
        throw new SchemaViolation(`cross-zone flow ${sourceZone}->${targetZone} not permitted`);
      }
    }
    const evt = { type, sourceZone, targetZone, payload, seq: this._published.length };
    this._published.push(evt);
    for (const s of this._subs.get(type) || []) s.handler(evt);
    return evt;
  }

  published() {
    return [...this._published];
  }
}

module.exports = { EventBus, SchemaViolation };
