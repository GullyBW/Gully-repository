'use strict';

/**
 * Storage-agnostic collection store (repository base).
 *
 * The engineering doc maps each system of record to a managed store
 * (§6.1: Firestore for engagement data, Postgres for money, GCS for
 * media…). Domain services here depend only on this interface, so a
 * Firestore/Postgres adapter is a drop-in replacement — the same
 * repository-pattern discipline the rest of this repo uses.
 *
 * Transactional integrity (F1): a Unit-of-Work is available via
 * `Store.transaction(fn)`. Mutations made inside the callback are
 * journaled so they roll back atomically if the callback throws — the
 * in-memory analogue of a Postgres transaction. Outside a transaction the
 * code path is unchanged (no journaling overhead, byte-identical
 * behaviour), so every existing caller is unaffected.
 */
class Collection {
  constructor(name, store = null) {
    this.name = name;
    this.rows = new Map();
    this.store = store; // owning Store (for transaction journaling)
  }

  insert(row) {
    if (this.rows.has(row.id)) {
      throw new Error(`${this.name}: duplicate id ${row.id}`);
    }
    this.rows.set(row.id, { ...row });
    if (this.store && this.store._txn) {
      const id = row.id;
      this.store._record(() => this.rows.delete(id));
    }
    return { ...row };
  }

  get(id) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  update(id, patch) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`${this.name}: no row ${id}`);
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    if (this.store && this.store._txn) {
      const prev = row; // restore the exact prior value on rollback
      this.store._record(() => this.rows.set(id, prev));
    }
    return { ...next };
  }

  delete(id) {
    if (this.store && this.store._txn) {
      const prev = this.rows.get(id);
      const existed = this.rows.delete(id);
      if (existed) this.store._record(() => this.rows.set(id, prev));
      return existed;
    }
    return this.rows.delete(id);
  }

  find(predicate = () => true) {
    return [...this.rows.values()].filter(predicate).map((r) => ({ ...r }));
  }

  findOne(predicate) {
    const hit = [...this.rows.values()].find(predicate);
    return hit ? { ...hit } : null;
  }

  count(predicate = () => true) {
    return this.find(predicate).length;
  }
}

// A no-op metrics sink so the Store runs identically without observability.
const NOOP_METRICS = { inc() {}, observe() {} };

class Store {
  constructor({ metrics } = {}) {
    this.collections = new Map();
    this._txn = null; // active Unit-of-Work: { journal: [] }
    this.metrics = metrics || NOOP_METRICS; // optional F1 instrumentation
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Collection(name, this));
    return this.collections.get(name);
  }

  /**
   * Run `fn` as a Unit of Work. Mutations commit together; if `fn` throws,
   * every mutation made during the transaction is rolled back (in reverse
   * order) and the error re-thrown. Nested calls join the outer
   * transaction (no independent savepoint), so a failure anywhere rolls the
   * whole unit back.
   */
  transaction(fn) {
    if (this._txn) return fn(); // join the outer unit of work
    const txn = { journal: [] };
    this._txn = txn;
    const started = Date.now();
    try {
      const result = fn();
      this._txn = null; // commit — discard the undo journal
      this.metrics.inc('foundation_transaction_total', { result: 'commit' });
      this.metrics.observe('foundation_transaction_ms', { result: 'commit' }, Date.now() - started);
      return result;
    } catch (e) {
      // Roll back: apply the inverse operations newest-first.
      for (let i = txn.journal.length - 1; i >= 0; i -= 1) txn.journal[i]();
      this._txn = null;
      this.metrics.inc('foundation_transaction_total', { result: 'rollback' });
      this.metrics.observe('foundation_transaction_ms', { result: 'rollback' }, Date.now() - started);
      throw e;
    }
  }

  /** True while a Unit of Work is open. */
  get inTransaction() {
    return this._txn !== null;
  }

  /** Journal an undo operation (called by Collections during a transaction). */
  _record(undoFn) {
    if (this._txn) this._txn.journal.push(undoFn);
  }
}

module.exports = { Store, Collection };
