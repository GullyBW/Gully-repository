'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Transactional Outbox (Foundation F2). Guarantees that a domain state
 * change and the events it emits commit atomically, and that events are
 * delivered at-least-once even across process crashes.
 *
 * Pattern:
 *   1. `run(work)` executes the domain mutations AND stages the events in
 *      the SAME Unit of Work (Store.transaction) — so if the work throws,
 *      both the state changes and the outbox rows roll back together.
 *   2. After the transaction commits, the relay (`drain`) publishes pending
 *      outbox rows to the Event Bus, marking each published. Failures are
 *      retried with bounded attempts; exhausted rows move to a dead-letter
 *      queue for operator replay.
 *
 * This is additive: existing services keep calling `bus.publish` directly.
 * New/critical flows use the outbox to get atomic state+event semantics.
 * Consumers stay idempotent (the Event Bus already dedupes by event id, and
 * every published event carries a stable `outbox_id`).
 */
class OutboxService {
  constructor({ store, clock, bus, maxAttempts = 5 } = {}) {
    this.store = store;
    this.clock = clock;
    this.bus = bus;
    this.outbox = store.collection('outbox');
    this.dlq = store.collection('outbox_dlq');
    this.maxAttempts = maxAttempts;
    this._seq = 0;
  }

  /**
   * Run domain work and stage its events atomically, then drain.
   * @param {(ctx: { stage: (type, data) => void }) => any} work
   * @returns the value returned by `work`.
   */
  run(work) {
    const staged = [];
    const stage = (type, data) => {
      if (!type) throw err('INVALID_ARGUMENT', 'event type is required');
      staged.push({ type, data: data || {} });
    };
    const result = this.store.transaction(() => {
      const r = work({ stage });
      // Stage events INSIDE the unit of work so they roll back on failure.
      for (const evt of staged) {
        this._seq += 1;
        this.outbox.insert({
          id: id('obx'),
          seq: this._seq,
          type: evt.type,
          data: evt.data,
          status: 'pending',
          attempts: 0,
          staged_at: this.clock.nowIso(),
          published_at: null,
        });
      }
      return r;
    });
    // Committed → publish. In production this is an async relay; here it is
    // synchronous but the semantics (at-least-once + retry + DLQ) are real.
    this.drain();
    return result;
  }

  /**
   * Relay: publish pending rows in sequence order, at-least-once, with
   * bounded retry and a dead-letter queue. Safe to call repeatedly
   * (published rows are skipped) — this is how a crashed relay recovers.
   */
  drain() {
    const out = { published: 0, retried: 0, dead: 0 };
    const pending = this.outbox.find((r) => r.status === 'pending').sort((a, b) => a.seq - b.seq);
    for (const row of pending) {
      try {
        this.bus.publish(row.type, { ...row.data, outbox_id: row.id });
        this.outbox.update(row.id, { status: 'published', published_at: this.clock.nowIso() });
        out.published += 1;
      } catch (e) {
        const attempts = row.attempts + 1;
        if (attempts >= this.maxAttempts) {
          this.outbox.update(row.id, { status: 'dead', attempts });
          this.dlq.insert({
            id: id('dlq'), outbox_id: row.id, type: row.type, data: row.data,
            error: e.message, at: this.clock.nowIso(),
          });
          out.dead += 1;
        } else {
          this.outbox.update(row.id, { status: 'pending', attempts });
          out.retried += 1;
        }
      }
    }
    return out;
  }

  /** Move a dead-lettered row back to pending for another delivery attempt. */
  replayDead(dlqId) {
    const entry = this.dlq.get(dlqId);
    if (!entry) throw err('NOT_FOUND', `No dead-letter ${dlqId}`);
    this.outbox.update(entry.outbox_id, { status: 'pending', attempts: 0 });
    this.dlq.delete(dlqId);
    const result = this.drain();
    return { replayed: entry.outbox_id, ...result };
  }

  stats() {
    const rows = this.outbox.find();
    const by = { pending: 0, published: 0, dead: 0 };
    for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
    return {
      total: rows.length,
      pending: by.pending || 0,
      published: by.published || 0,
      dead: by.dead || 0,
      dead_letters: this.dlq.count(),
      high_seq: this._seq,
    };
  }

  deadLetters() {
    return this.dlq.find();
  }
}

module.exports = { OutboxService };
