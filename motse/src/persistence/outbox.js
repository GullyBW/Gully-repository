'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

// No-op metrics sink so the outbox runs identically without observability.
const NOOP_METRICS = { inc() {}, observe() {} };

/**
 * Transactional Outbox (Foundation F2) + enterprise event platform
 * (Mission 3). Guarantees that a domain state change and the events it
 * emits commit atomically, and that events are delivered at-least-once
 * even across process crashes.
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
 * Event-platform extensions (all additive; defaults preserve F2 behaviour):
 *   - PENDING INDEX: the relay reads an in-memory index of pending row ids
 *     instead of scanning the whole collection. Evidence basis: validation
 *     W9 measured the full-scan drain growing ~115µs → ~866µs/op as
 *     published rows accumulated. The index is transaction-safe — ids are
 *     appended only AFTER the Unit of Work commits — and is rebuilt by one
 *     scan on the first drain of a fresh process (crash recovery).
 *   - SCHEDULED / DELAYED events: `stage(type, data, { deliverAt })` defers
 *     publication until due; deferred rows stay pending without burning
 *     retry attempts.
 *   - PRIORITY: `stage(type, data, { priority })` — higher publishes first;
 *     equal priority preserves strict staging (seq) order, so the default
 *     (0) keeps today's ordering guarantee untouched.
 *   - CORRELATION: `stage(type, data, { correlationId })` for replay-by-
 *     correlation and cross-system tracing.
 *   - RETENTION: `prune()` archives published rows to `outbox_archive`
 *     (bounding relay-adjacent storage); opt-in automatic retention via the
 *     `retention` constructor option. Archived events remain replayable.
 *   - REPLAY: `replayWhere({ type, since, until, correlationId })`
 *     republishes delivered events (same stable `outbox_id`, so idempotent
 *     consumers dedupe) — recovery by time / type / correlation.
 *
 * This is additive: existing services keep calling `bus.publish` directly.
 * New/critical flows use the outbox to get atomic state+event semantics.
 * Consumers stay idempotent (the Event Bus already dedupes by event id, and
 * every published event carries a stable `outbox_id`).
 */
class OutboxService {
  constructor({ store, clock, bus, maxAttempts = 5, metrics = null, tracer = null, retention = null } = {}) {
    this.store = store;
    this.clock = clock;
    this.bus = bus;
    this.outbox = store.collection('outbox');
    this.dlq = store.collection('outbox_dlq');
    this.archive = store.collection('outbox_archive');
    this.maxAttempts = maxAttempts;
    this._seq = 0;
    this.metrics = metrics || NOOP_METRICS; // optional F2 instrumentation
    this.tracer = tracer; // optional distributed tracing
    // Pending index (Mission 3): ids of pending rows, maintained post-commit.
    this._pendingIndex = [];
    this._indexBuilt = false;
    // Opt-in retention: { keepPublished: N, everyDrains: M } — archive all but
    // the newest N published rows every M drains. Default null = no pruning,
    // byte-identical F2 behaviour.
    this.retention = retention;
    this._drainsSincePrune = 0;
  }

  /**
   * Run domain work and stage its events atomically, then drain.
   * @param {(ctx: { stage: (type, data, opts?) => void }) => any} work
   *   stage opts (all optional): { deliverAt: ms|ISO, priority: number, correlationId }
   * @returns the value returned by `work`.
   */
  run(work) {
    const staged = [];
    const stage = (type, data, opts = {}) => {
      if (!type) throw err('INVALID_ARGUMENT', 'event type is required');
      staged.push({ type, data: data || {}, opts });
    };
    const insertedIds = [];
    const result = this.store.transaction(() => {
      const r = work({ stage });
      // Stage events INSIDE the unit of work so they roll back on failure.
      for (const evt of staged) {
        this._seq += 1;
        const rowId = id('obx');
        this.outbox.insert({
          id: rowId,
          seq: this._seq,
          type: evt.type,
          data: evt.data,
          status: 'pending',
          attempts: 0,
          priority: evt.opts.priority || 0,
          correlation_id: evt.opts.correlationId || null,
          deliver_at_ms: parseDeliverAt(evt.opts.deliverAt),
          staged_at: this.clock.nowIso(),
          published_at: null,
        });
        insertedIds.push(rowId);
      }
      return r;
    });
    // Committed — only now do the new rows enter the pending index, so a
    // rolled-back transaction can never leave dangling index entries.
    if (this._indexBuilt) this._pendingIndex.push(...insertedIds);
    // In production this is an async relay; here it is synchronous but the
    // semantics (at-least-once + retry + DLQ) are real.
    this.drain();
    return result;
  }

  /**
   * Relay: publish due pending rows (priority desc, then staging order),
   * at-least-once, with bounded retry and a dead-letter queue. Safe to call
   * repeatedly (published rows are skipped) — this is how a crashed relay
   * recovers. Not-yet-due scheduled rows are deferred without an attempt.
   */
  drain() {
    const run = () => this._drain();
    return this.tracer ? this.tracer.withSpan('outbox.drain', run) : run();
  }

  _drain() {
    const out = { published: 0, retried: 0, dead: 0, deferred: 0 };
    if (!this._indexBuilt) {
      // One scan per process lifetime (boot/crash recovery), then incremental.
      this._pendingIndex = this.outbox
        .find((r) => r.status === 'pending')
        .sort((a, b) => a.seq - b.seq)
        .map((r) => r.id);
      this._indexBuilt = true;
    }
    const now = this.clock.nowMs();
    const due = [];
    const remaining = [];
    for (const rowId of this._pendingIndex) {
      const row = this.outbox.get(rowId);
      if (!row || row.status !== 'pending') continue; // resolved elsewhere
      if (row.deliver_at_ms != null && row.deliver_at_ms > now) {
        remaining.push(rowId); // scheduled for later — no attempt burned
        out.deferred += 1;
        continue;
      }
      due.push(row);
    }
    due.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.seq - b.seq);
    for (const row of due) {
      const started = Date.now();
      try {
        this.bus.publish(row.type, { ...row.data, outbox_id: row.id });
        this.outbox.update(row.id, { status: 'published', published_at: this.clock.nowIso() });
        this.metrics.inc('foundation_outbox_published_total', { type: row.type });
        this.metrics.observe('foundation_outbox_publish_ms', {}, Date.now() - started);
        out.published += 1;
      } catch (e) {
        const attempts = row.attempts + 1;
        if (attempts >= this.maxAttempts) {
          this.outbox.update(row.id, { status: 'dead', attempts });
          this.dlq.insert({
            id: id('dlq'), outbox_id: row.id, type: row.type, data: row.data,
            error: e.message, at: this.clock.nowIso(),
          });
          this.metrics.inc('foundation_outbox_dead_total', { type: row.type });
          out.dead += 1;
        } else {
          this.outbox.update(row.id, { status: 'pending', attempts });
          this.metrics.inc('foundation_outbox_retried_total', { type: row.type });
          out.retried += 1;
          remaining.push(row.id);
        }
      }
    }
    this._pendingIndex = remaining;
    this.metrics.observe('foundation_outbox_backlog', {}, remaining.length); // gauge-as-sample
    if (this.retention) {
      this._drainsSincePrune += 1;
      if (this._drainsSincePrune >= (this.retention.everyDrains || 100)) {
        this._drainsSincePrune = 0;
        this.prune({ keepLast: this.retention.keepPublished });
      }
    }
    return out;
  }

  /** Move a dead-lettered row back to pending for another delivery attempt. */
  replayDead(dlqId) {
    const entry = this.dlq.get(dlqId);
    if (!entry) throw err('NOT_FOUND', `No dead-letter ${dlqId}`);
    this.outbox.update(entry.outbox_id, { status: 'pending', attempts: 0 });
    if (this._indexBuilt) this._pendingIndex.push(entry.outbox_id);
    this.dlq.delete(dlqId);
    const result = this.drain();
    return { replayed: entry.outbox_id, ...result };
  }

  /**
   * Retention (Mission 3): archive published rows out of the live outbox.
   * Archived events keep their id/type/data/correlation and stay replayable.
   * @param olderThanMs  archive published rows older than this age
   * @param keepLast     keep only the newest N published rows live
   */
  prune({ olderThanMs = null, keepLast = null } = {}) {
    let candidates = this.outbox
      .find((r) => r.status === 'published')
      .sort((a, b) => a.seq - b.seq);
    if (olderThanMs != null) {
      const cutoff = this.clock.nowMs() - olderThanMs;
      candidates = candidates.filter((r) => new Date(r.published_at).getTime() < cutoff);
    }
    if (keepLast != null) {
      const excess = candidates.length - keepLast;
      candidates = excess > 0 ? candidates.slice(0, excess) : [];
    }
    for (const row of candidates) {
      this.archive.insert({ ...row, archived_at: this.clock.nowIso() });
      this.outbox.delete(row.id);
    }
    if (candidates.length > 0) {
      this.metrics.inc('foundation_outbox_archived_total', {}, candidates.length);
    }
    return { archived: candidates.length, live_published: this.outbox.count((r) => r.status === 'published') };
  }

  /**
   * Replay delivered events (Mission 3) by time window, type and/or
   * correlation id — from the live outbox AND the archive. Republished
   * events carry their original stable `outbox_id`, so idempotent consumers
   * treat duplicates correctly (at-least-once, replay-safe).
   */
  replayWhere({ type = null, since = null, until = null, correlationId = null, limit = 1000 } = {}) {
    const match = (r) =>
      (r.status === 'published' || r.archived_at) &&
      (!type || r.type === type) &&
      (!correlationId || r.correlation_id === correlationId) &&
      (!since || r.staged_at >= since) &&
      (!until || r.staged_at <= until);
    const rows = this.outbox.find(match)
      .concat(this.archive.find(match))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    for (const row of rows) {
      this.bus.publish(row.type, { ...row.data, outbox_id: row.id });
      this.metrics.inc('foundation_outbox_replayed_total', { type: row.type });
    }
    return { replayed: rows.length, ids: rows.map((r) => r.id) };
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
      archived: this.archive.count(),
      high_seq: this._seq,
    };
  }

  deadLetters() {
    return this.dlq.find();
  }
}

function parseDeliverAt(deliverAt) {
  if (deliverAt == null) return null;
  if (typeof deliverAt === 'number') return deliverAt;
  const ms = Date.parse(deliverAt);
  return Number.isNaN(ms) ? null : ms;
}

module.exports = { OutboxService };
