'use strict';
// Object-storage PORT for evidence blobs (large, opaque, encrypted-at-rest artifacts).
// The domain stores/retrieves evidence through put(zone, blob)/get(zone, ref) without
// knowing the backend. Reference implementation is in-memory; production drivers are
// S3 / MinIO / GCS with the SAME interface and per-zone buckets (docs/production-adapters.md).
//
// CIPHERTEXT-ONLY INVARIANT (fail-closed): this store REFUSES to persist anything that is
// not a ciphertext blob (blueprint: evidence is encrypted at rest; keys are never
// co-located with ciphertext). Plaintext can therefore not reach object storage even by
// mistake — enforced here, and independently checked by an app-level fitness function.
const crypto = require('node:crypto');

class ObjectStore {
  // keyManager provides isCiphertext() (the KMS port). Zone isolation is structural:
  // each zone gets its own namespace ("bucket") and a ref cannot cross zones.
  constructor(keyManager) { this._km = keyManager; this._buckets = new Map(); }
  // Writes materialize a bucket; reads never do (a read must not create a zone namespace).
  _bucket(zone) { if (!this._buckets.has(zone)) this._buckets.set(zone, new Map()); return this._buckets.get(zone); }

  // Persist a ciphertext blob; returns an opaque content-addressed ref. Rejects plaintext.
  put(zone, blob) {
    if (!this._km.isCiphertext(blob)) throw new Error('object-store refuses plaintext: evidence must be encrypted at rest');
    const ref = 'obj://' + zone + '/' + crypto.createHash('sha256').update(JSON.stringify(blob)).digest('hex').slice(0, 32);
    this._bucket(zone).set(ref, blob);
    return { ref, zone, bytes: blob.cipher ? Buffer.from(blob.cipher, 'base64').length : 0 };
  }
  get(zone, ref) { const b = this._buckets.get(zone); const v = b && b.get(ref); return v === undefined ? null : v; }
  has(zone, ref) { const b = this._buckets.get(zone); return !!(b && b.has(ref)); }
  delete(zone, ref) { const b = this._buckets.get(zone); return b ? b.delete(ref) : false; }
  keys(zone) { const b = this._buckets.get(zone); return b ? [...b.keys()] : []; }
  buckets() { return [...this._buckets.keys()]; }
}

// Factory: cfg.objectStore selects the driver ('memory' reference, or 's3'/'minio'/'gcs'
// in production). The cloud drivers are documented drop-ins implementing the same port;
// they are not bundled, so requesting one fails closed rather than silently using memory.
function makeObjectStore(keyManager, cfg = {}) {
  if (cfg.objectStore && cfg.objectStore !== 'memory') {
    throw new Error(`object-store driver '${cfg.objectStore}' is a documented drop-in; not bundled in-repo (docs/production-adapters.md)`);
  }
  return new ObjectStore(keyManager);
}

module.exports = { ObjectStore, makeObjectStore };
