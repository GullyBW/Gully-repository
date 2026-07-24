'use strict';
// SQL-backed repository implementing the SAME store interface as MemoryStore/FileStore
// (get/put/values/keys/size). Bound to one zone + collection → table `${zone}__${col}`.
// Delegates to a SQL driver port (in-memory reference here; PostgreSQL in production).
// Zone isolation is structural: the instance cannot address another zone's table.
class SqlStore {
  constructor(zone, collection, driver) {
    this.zone = zone;
    this._table = `${zone}__${collection}`;
    this._d = driver;
    this._d.migrate('001_init');
  }
  get(k) { return this._d.get(this._table, k); }
  put(k, v) { this._d.upsert(this._table, k, v); return v; }
  delete(k) { return this._d.del(this._table, k); }
  values() { return this._d.all(this._table); }
  keys() { return this._d.keys(this._table); }
  size() { return this._d.keys(this._table).length; }
}
module.exports = { SqlStore };
