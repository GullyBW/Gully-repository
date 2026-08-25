'use strict';
// Zone-isolated persistence adapter (repository port). Interchangeable
// implementations behind ONE interface — the production transition swaps the
// implementation without touching business logic:
//   - MemoryStore: deterministic, in-process (default; test/dev).
//   - FileStore:   durable, atomic-write, PER-ZONE isolated directories.
//   - SqlStore:    SQL-backed via a driver port (in-memory reference driver here;
//                  PostgreSQL in production — db/migrations/001_init.sql).
// All three share the SAME interface (get/put/values/keys/size/delete), so a real
// deployment swaps persistence with no business-logic change (see
// docs/production-adapters.md). Zone isolation is enforced by construction:
// a store instance is bound to exactly one zone and cannot read another's namespace.
const fs = require('node:fs');
const path = require('node:path');
const { SqlStore } = require('./sql-store');
const { MemorySqlDriver } = require('./drivers/sql-driver');

class MemoryStore {
  constructor(zone) { this.zone = zone; this._m = new Map(); }
  get(k) { const v = this._m.get(k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  put(k, v) { this._m.set(k, JSON.parse(JSON.stringify(v))); return v; }
  delete(k) { return this._m.delete(k); }
  values() { return [...this._m.values()].map((v) => JSON.parse(JSON.stringify(v))); }
  keys() { return [...this._m.keys()]; }
  size() { return this._m.size; }
}

class FileStore {
  constructor(zone, dataDir, collection = 'kv') {
    this.zone = zone;
    // PER-ZONE, PER-COLLECTION directory → namespace isolation (no cross-zone path,
    // no cross-collection key collision).
    this._dir = path.join(dataDir, 'zones', zone, collection);
    fs.mkdirSync(this._dir, { recursive: true });
  }
  _f(k) { return path.join(this._dir, encodeURIComponent(k) + '.json'); }
  get(k) { try { return JSON.parse(fs.readFileSync(this._f(k), 'utf8')); } catch (_) { return null; } }
  put(k, v) {
    const tmp = this._f(k) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(v)); // atomic: write temp then rename
    fs.renameSync(tmp, this._f(k));
    return v;
  }
  delete(k) { try { fs.unlinkSync(this._f(k)); return true; } catch (_) { return false; } }
  values() { return this.keys().map((k) => this.get(k)).filter(Boolean); }
  keys() { try { return fs.readdirSync(this._dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json')).map((f) => decodeURIComponent(f.replace(/\.json$/, ''))); } catch (_) { return []; } }
  size() { return this.keys().length; }
}

// One SQL driver per app (shared across all zones/collections; isolation is by table
// name, `${zone}__${collection}`). Memoized off a WeakMap keyed by cfg so it is NOT a
// cfg property — it never appears in config.redacted() dumps or logs. In production the
// factory returns a PostgreSQL driver here (pooled connection) instead of the reference.
const _sqlDrivers = new WeakMap();
function sqlDriver(cfg) {
  let d = _sqlDrivers.get(cfg);
  if (!d) { d = (cfg.sqlDriverFactory ? cfg.sqlDriverFactory() : new MemorySqlDriver()); _sqlDrivers.set(cfg, d); }
  return d;
}

// Factory bound to a zone + collection. cfg.persistence selects the implementation.
function makeStore(zone, cfg, collection = 'kv') {
  if (cfg.persistence === 'file') return new FileStore(zone, cfg.dataDir, collection);
  if (cfg.persistence === 'sql') return new SqlStore(zone, collection, sqlDriver(cfg));
  return new MemoryStore(zone);
}

module.exports = { MemoryStore, FileStore, makeStore, sqlDriver };
