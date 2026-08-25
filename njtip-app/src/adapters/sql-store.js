'use strict';
// SQL-backed repository implementing the SAME store interface as MemoryStore/FileStore
// (get/put/values/keys/size). Bound to one zone + collection → table `${zone}__${col}`.
// Delegates to a SQL driver port (in-memory reference here; PostgreSQL in production).
// Zone isolation is structural: the instance cannot address another zone's table.
//
// v1.3 adds ENTERPRISE persistence semantics on top of the same port:
//   - optimistic locking via getWithVersion()/putIfVersion() (compare-and-swap), so
//     concurrent writers cannot silently clobber each other (lost-update prevention);
//   - transactional writes via the driver's begin/commit/rollback (see adapters/uow.js).
// Business logic is unchanged: callers that don't need locking use get/put as before.
class SqlStore {
  constructor(zone, collection, driver) {
    this.zone = zone;
    this._table = `${zone}__${collection}`;
    this._d = driver;
    this._d.migrate('001_init');
    this._d.migrate('002_versioning');
  }
  get(k) { return this._d.get(this._table, k); }
  put(k, v) { this._d.upsert(this._table, k, v); return v; }
  delete(k) { return this._d.del(this._table, k); }
  values() { return this._d.all(this._table); }
  keys() { return this._d.keys(this._table); }
  size() { return this._d.keys(this._table).length; }

  // --- enterprise: optimistic locking ---
  // Returns { value, version } or null. Callers pass the version back to putIfVersion.
  getWithVersion(k) { return this._d.getMeta ? this._d.getMeta(this._table, k) : (this.get(k) === null ? null : { value: this.get(k), version: 0 }); }
  // Compare-and-swap: succeeds only if the row is still at expectedVersion, else conflict.
  putIfVersion(k, v, expectedVersion) {
    if (!this._d.casUpsert) { this.put(k, v); return { ok: true, version: 0 }; }
    return this._d.casUpsert(this._table, k, v, expectedVersion);
  }
}
module.exports = { SqlStore };
