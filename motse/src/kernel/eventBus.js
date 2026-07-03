'use strict';

const { id } = require('./ids');

/**
 * Event backbone (doc §3.3).
 *
 * Domain events are the integration contract between modules
 * (heritage.item.validated, ledger.posting.committed, …). Events are
 * versioned, schema-registered and replayable; consumers MUST be
 * idempotent. In production this is Pub/Sub — here it is an in-process
 * bus with the same contract so projections can be rebuilt from the log.
 */
class EventBus {
  constructor(clock) {
    this.clock = clock;
    this.log = []; // append-only event log — replay source
    this.schemas = new Map(); // type -> { version, requiredFields }
    this.subscribers = new Map(); // type -> [{ name, handler, seen:Set }]
  }

  /** Register an event schema. Publishing an unregistered type throws. */
  register(type, version, requiredFields = []) {
    this.schemas.set(type, { version, requiredFields });
  }

  subscribe(type, name, handler) {
    if (!this.subscribers.has(type)) this.subscribers.set(type, []);
    // Each subscription tracks delivered event ids => at-least-once
    // delivery with idempotent consumption (§3.3).
    this.subscribers.get(type).push({ name, handler, seen: new Set() });
  }

  publish(type, data) {
    const schema = this.schemas.get(type);
    if (!schema) throw new Error(`Unregistered event type: ${type}`);
    for (const field of schema.requiredFields) {
      if (data[field] === undefined) {
        throw new Error(`Event ${type} missing required field "${field}"`);
      }
    }
    const event = {
      id: id('evt'),
      type,
      version: schema.version,
      occurred_at: this.clock.nowIso(),
      data,
    };
    this.log.push(event);
    this._deliver(event);
    return event;
  }

  _deliver(event) {
    for (const sub of this.subscribers.get(event.type) || []) {
      if (sub.seen.has(event.id)) continue; // idempotent delivery
      sub.seen.add(event.id);
      sub.handler(event);
    }
  }

  /**
   * Replay the log into subscribers — how projections (public campaign
   * ledgers, village pages, BigQuery) are rebuilt (§3.3). Consumers that
   * already saw an event skip it; fresh consumers rebuild from zero.
   */
  replay(types = null) {
    for (const event of this.log) {
      if (types && !types.includes(event.type)) continue;
      this._deliver(event);
    }
  }

  eventsOf(type) {
    return this.log.filter((e) => e.type === type);
  }
}

module.exports = { EventBus };
