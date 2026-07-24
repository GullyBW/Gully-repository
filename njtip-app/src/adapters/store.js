'use strict';
// Zone-isolated persistence adapter (repository port). Two interchangeable
// implementations behind ONE interface — the production transition swaps the
// implementation without touching business logic:
//   - MemoryStore: deterministic, in-process (default; test/dev).
//   - FileStore:   durable, atomic-write, PER-ZONE isolated directories.
// A real deployment adds a PostgresStore with the SAME interface (see
// docs/component-transition-matrix.md). Zone isolation is enforced by construction:
// a store instance is bound to exactly one zone and cannot read another's namespace.
const fs = require('node:fs');
const path = require('node:path');

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

// Factory bound to a zone + collection. cfg.persistence selects the implementation.
function makeStore(zone, cfg, collection = 'kv') {
  return cfg.persistence === 'file' ? new FileStore(zone, cfg.dataDir, collection) : new MemoryStore(zone);
}

module.exports = { MemoryStore, FileStore, makeStore };
