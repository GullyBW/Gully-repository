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
  constructor(keyManager, { clock = () => Date.now() } = {}) { this._km = keyManager; this._clock = clock; this._buckets = new Map(); this._objVersions = new Map(); }
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

  // --- enterprise: object VERSIONING under a stable logical key (like S3 versioning) ---
  _vkey(zone, logicalKey) { return `${zone}::${logicalKey}`; }
  putVersion(zone, logicalKey, blob) {
    const { ref, bytes } = this.put(zone, blob); // still ciphertext-only + content-addressed
    const vkey = this._vkey(zone, logicalKey);
    if (!this._objVersions.has(vkey)) this._objVersions.set(vkey, []);
    const versions = this._objVersions.get(vkey);
    const versionId = versions.length + 1;
    versions.push({ versionId, ref, createdAt: this._clock(), bytes, tier: 'hot' });
    return { logicalKey, versionId, ref, bytes };
  }
  versions(zone, logicalKey) { return (this._objVersions.get(this._vkey(zone, logicalKey)) || []).map((v) => ({ ...v })); }
  getVersion(zone, logicalKey, versionId) {
    const versions = this._objVersions.get(this._vkey(zone, logicalKey)) || [];
    const v = versionId ? versions.find((x) => x.versionId === versionId) : versions[versions.length - 1];
    return v ? this.get(zone, v.ref) : null;
  }

  // --- enterprise: LIFECYCLE management (retention/transition/expiry rules) ---
  // rules: { keepLatest?: n, expireAfterMs?: ms, transitionAfterMs?: ms }. Applies per
  // logical key. Returns a report of what was transitioned/expired. Deterministic (uses
  // the injected clock). Retention/legal-hold governs whether evidence may be expired.
  applyLifecycle(zone, rules = {}) {
    const now = this._clock();
    const report = { transitioned: 0, expired: 0 };
    for (const [vkey, versions] of this._objVersions) {
      if (!vkey.startsWith(`${zone}::`)) continue;
      let live = versions.filter((v) => !v.expired);
      // keepLatest: expire all but the N most recent versions.
      if (rules.keepLatest && live.length > rules.keepLatest) {
        for (const v of live.slice(0, live.length - rules.keepLatest)) { expire(this, zone, v); report.expired++; }
        live = versions.filter((v) => !v.expired);
      }
      for (const v of live) {
        if (rules.transitionAfterMs && v.tier === 'hot' && now - v.createdAt >= rules.transitionAfterMs) { v.tier = 'archive'; report.transitioned++; }
        if (rules.expireAfterMs && now - v.createdAt >= rules.expireAfterMs && !v.legalHold) { expire(this, zone, v); report.expired++; }
      }
    }
    return report;
  }
  setLegalHold(zone, logicalKey, versionId, held = true) {
    const versions = this._objVersions.get(this._vkey(zone, logicalKey)) || [];
    const v = versions.find((x) => x.versionId === versionId); if (v) v.legalHold = held; return !!v;
  }
}

function expire(store, zone, v) { v.expired = true; v.tier = 'expired'; store.delete(zone, v.ref); }

// Factory: cfg.objectStore selects the driver ('memory' reference, or 's3'/'minio'/'gcs'
// in production). The cloud drivers are documented drop-ins implementing the same port;
// they are not bundled, so requesting one fails closed rather than silently using memory.
function makeObjectStore(keyManager, cfg = {}) {
  if (cfg.objectStore && cfg.objectStore !== 'memory') {
    throw new Error(`object-store driver '${cfg.objectStore}' is a documented drop-in; not bundled in-repo (docs/production-adapters.md)`);
  }
  return new ObjectStore(keyManager, { clock: cfg.clock });
}

module.exports = { ObjectStore, makeObjectStore };
