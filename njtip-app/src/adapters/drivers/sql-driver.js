'use strict';
// SQL driver PORT + an in-memory reference driver.
// The SqlStore repository (adapters/sql-store.js) speaks ONLY to this narrow driver
// interface, so a real PostgreSQL driver is a thin drop-in that implements the same
// methods with actual SQL (see db/migrations/*.sql and docs/production-adapters.md).
// Zone/collection isolation is preserved: every table name is `${zone}__${collection}`
// and a store instance is bound to one zone.
//
// Core contract (v1.2 — unchanged, backward compatible):
//   migrate(ddlName)                  -> record a migration applied (idempotent)
//   upsert(table, key, value)         -> insert or replace one row (value = JSON)
//   get(table, key)  -> value | null
//   all(table)       -> value[]
//   keys(table)      -> string[]
//   del(table, key)  -> boolean
//
// Enterprise extensions (v1.3 — a production PgDriver implements these with real SQL):
//   getMeta(table, key)                       -> { value, version } | null   (row version)
//   casUpsert(table, key, value, expected)    -> { ok, version, conflict? }  (optimistic lock)
//   begin() / commit() / rollback()           -> transaction (snapshot isolation here;
//                                                 BEGIN/COMMIT/ROLLBACK in Postgres)
// A real driver maps casUpsert → `UPDATE ... SET value=$, version=version+1 WHERE key=$
// AND version=$` (0 rows affected == conflict), and begin/commit/rollback → SQL txns.
class MemorySqlDriver {
  constructor() { this._tables = new Map(); this._migrations = []; this._txSnapshot = null; }
  _t(table) { if (!this._tables.has(table)) this._tables.set(table, new Map()); return this._tables.get(table); }
  migrate(name) { if (!this._migrations.includes(name)) this._migrations.push(name); return { applied: name }; }
  migrations() { return [...this._migrations]; }

  // --- core (rows carry an internal version; core methods expose the value only) ---
  upsert(table, key, value) { const t = this._t(table); const prev = t.get(key); t.set(key, { value: clone(value), version: (prev ? prev.version : 0) + 1 }); return true; }
  get(table, key) { const r = this._t(table).get(key); return r === undefined ? null : clone(r.value); }
  all(table) { return [...this._t(table).values()].map((r) => clone(r.value)); }
  keys(table) { return [...this._t(table).keys()]; }
  del(table, key) { return this._t(table).delete(key); }

  // --- enterprise: optimistic locking (compare-and-swap on row version) ---
  getMeta(table, key) { const r = this._t(table).get(key); return r === undefined ? null : { value: clone(r.value), version: r.version }; }
  casUpsert(table, key, value, expectedVersion) {
    const t = this._t(table); const prev = t.get(key);
    const current = prev ? prev.version : 0;
    if (expectedVersion !== current) return { ok: false, conflict: true, version: current };
    t.set(key, { value: clone(value), version: current + 1 });
    return { ok: true, version: current + 1 };
  }

  // --- enterprise: transactions (snapshot isolation; single writer in-process) ---
  begin() {
    if (this._txSnapshot) throw new Error('nested transactions are not supported');
    // Deep snapshot so rollback restores exactly.
    this._txSnapshot = new Map([...this._tables].map(([name, rows]) => [name, new Map([...rows].map(([k, r]) => [k, { value: clone(r.value), version: r.version }]))]));
    return true;
  }
  commit() { if (!this._txSnapshot) throw new Error('no active transaction'); this._txSnapshot = null; return true; }
  rollback() { if (!this._txSnapshot) throw new Error('no active transaction'); this._tables = this._txSnapshot; this._txSnapshot = null; return true; }
  inTransaction() { return this._txSnapshot !== null; }

  // Introspection (used by an app-level fitness check: no identity columns exist —
  // rows are opaque JSON blobs, so there is no queryable identity column by design).
  tables() { return [...this._tables.keys()]; }
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

module.exports = { MemorySqlDriver };
