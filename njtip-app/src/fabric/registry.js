'use strict';
// National Government Data Fabric (Phase 14). The integration backbone: a SCHEMA REGISTRY
// (with backward-compatibility enforcement), a SERVICE REGISTRY, a CANONICAL data model, a
// METADATA CATALOG, and DATA LINEAGE. Deterministic. All records are non-identifying
// metadata (structure and provenance), never case content or personal data.

// Schema registry with additive-only (backward-compatible) evolution enforcement.
class SchemaRegistry {
  constructor() { this._subjects = new Map(); }
  register(subject, schema) {
    const versions = this._subjects.get(subject) || [];
    const prev = versions[versions.length - 1];
    if (prev && !backwardCompatible(prev.schema, schema)) throw new Error(`schema for '${subject}' is not backward compatible (breaking change)`);
    const version = versions.length + 1;
    versions.push({ version, schema });
    this._subjects.set(subject, versions);
    return { subject, version };
  }
  latest(subject) { const v = this._subjects.get(subject); return v ? v[v.length - 1] : null; }
  subjects() { return [...this._subjects.keys()]; }
}
// Backward compatible = no required field removed and no field type changed (additive only).
function backwardCompatible(oldS, newS) {
  for (const [k, t] of Object.entries(oldS.fields || {})) {
    if (oldS.required && oldS.required.includes(k) && !(k in (newS.fields || {}))) return false; // removed required field
    if (k in (newS.fields || {}) && newS.fields[k] !== t) return false; // changed type
  }
  return true;
}

// Service registry: discoverable services with declared health endpoints.
class ServiceRegistry {
  constructor() { this._services = new Map(); }
  register(name, { endpoints = [], health = '/healthz', zone } = {}) { this._services.set(name, { name, endpoints, health, zone: zone || null }); return name; }
  discover(name) { return this._services.get(name) || null; }
  list() { return [...this._services.values()]; }
}

// Canonical data model: the shared, agency-neutral vocabulary (non-identifying).
const CANONICAL_MODEL = {
  Case: { fields: { caseCode: 'string', category: 'string', status: 'string', recipient: 'string', stage: 'string' }, required: ['caseCode', 'category', 'status'] },
  EvidenceRef: { fields: { evidenceId: 'string', contentHash: 'string', state: 'string' }, required: ['evidenceId', 'contentHash'] },
  Agency: { fields: { id: 'string', name: 'string' }, required: ['id'] },
};

// Metadata catalog: datasets described by non-identifying metadata + tags.
class MetadataCatalog {
  constructor() { this._datasets = new Map(); }
  register(id, { owner, classification = 'internal', tags = [], canonical } = {}) { this._datasets.set(id, { id, owner, classification, tags, canonical: canonical || null }); return id; }
  get(id) { return this._datasets.get(id) || null; }
  search(tag) { return [...this._datasets.values()].filter((d) => d.tags.includes(tag)); }
}

// Data lineage: a provenance graph of dataset → transform → dataset edges.
class DataLineage {
  constructor() { this._edges = []; }
  record(from, to, transform) { this._edges.push({ from, to, transform }); return this._edges.length; }
  upstream(dataset) { return this._edges.filter((e) => e.to === dataset).map((e) => ({ from: e.from, transform: e.transform })); }
  trace(dataset, seen = new Set()) {
    if (seen.has(dataset)) return []; seen.add(dataset);
    const up = this.upstream(dataset);
    return up.flatMap((u) => [{ dataset: u.from, via: u.transform, into: dataset }, ...this.trace(u.from, seen)]);
  }
}

module.exports = { SchemaRegistry, ServiceRegistry, MetadataCatalog, DataLineage, CANONICAL_MODEL, backwardCompatible };
