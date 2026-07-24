'use strict';
// SQL driver PORT + an in-memory reference driver.
// The SqlStore repository (adapters/sql-store.js) speaks ONLY to this narrow driver
// interface, so a real PostgreSQL driver is a thin drop-in that implements the same
// five methods with actual SQL (see db/migrations/001_init.sql and
// docs/production-adapters.md). Zone/collection isolation is preserved: every table
// name is `${zone}__${collection}` and a store instance is bound to one zone.
//
// Driver contract:
//   migrate(ddlName)                  -> record a migration applied (idempotent)
//   upsert(table, key, value)         -> insert or replace one row (value = JSON)
//   get(table, key)  -> value | null
//   all(table)       -> value[]
//   keys(table)      -> string[]
//   del(table, key)  -> boolean
class MemorySqlDriver {
  constructor() { this._tables = new Map(); this._migrations = []; }
  _t(table) { if (!this._tables.has(table)) this._tables.set(table, new Map()); return this._tables.get(table); }
  migrate(name) { if (!this._migrations.includes(name)) this._migrations.push(name); return { applied: name }; }
  migrations() { return [...this._migrations]; }
  upsert(table, key, value) { this._t(table).set(key, JSON.stringify(value)); return true; }
  get(table, key) { const v = this._t(table).get(key); return v === undefined ? null : JSON.parse(v); }
  all(table) { return [...this._t(table).values()].map((v) => JSON.parse(v)); }
  keys(table) { return [...this._t(table).keys()]; }
  del(table, key) { return this._t(table).delete(key); }
  // Introspection (used by an app-level fitness check: no identity columns exist —
  // rows are opaque JSON blobs, so there is no queryable identity column by design).
  tables() { return [...this._tables.keys()]; }
}

module.exports = { MemorySqlDriver };
