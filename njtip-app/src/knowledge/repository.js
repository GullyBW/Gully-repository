'use strict';
// National Knowledge & Decision Repository (Phase 67). Institutional memory as an IMMUTABLE,
// hash-chained, fully auditable record: architecture decision records, a governance-decision
// registry, lessons learned, an operational knowledge base, simulation history, recovery-
// exercise history, decision traceability, and searchable institutional memory with lifecycle
// management. Deterministic. Records are non-identifying (personal data is refused fail-closed).
const { hash } = require('../twin');

const RECORD_TYPES = new Set(['adr', 'governance-decision', 'lesson-learned', 'operational', 'simulation', 'recovery-exercise']);
const IDENTITY_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'content']);

class KnowledgeRepository {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._records = []; this._byId = new Map(); this._lastHash = 'GENESIS'; this._seq = 0; }

  // Append an immutable, hash-chained knowledge record. `refs` link to prior records
  // (decision traceability). Body/tags must be non-identifying (fail-closed).
  record({ type, title, tags = [], refs = [], attributes = {} }) {
    if (!RECORD_TYPES.has(type)) throw new Error('unknown record type: ' + type);
    if (!title) throw new Error('title required');
    for (const k of Object.keys(attributes)) if (IDENTITY_FIELDS.has(k.toLowerCase())) throw new Error(`knowledge record refuses personal-data field: ${k}`);
    const id = 'KN-' + (++this._seq).toString().padStart(5, '0');
    const rec = { id, type, title, tags: [...tags], refs: [...refs], attributes: { ...attributes }, status: 'active', at: this._clock(), prevHash: this._lastHash };
    rec.hash = hash.sha256({ id, type, title, tags: rec.tags, refs: rec.refs, attributes: rec.attributes, at: rec.at, prevHash: rec.prevHash });
    this._lastHash = rec.hash; Object.freeze(rec.attributes); Object.freeze(rec);
    this._records.push(rec); this._byId.set(id, rec);
    return { id, hash: rec.hash };
  }

  get(id) { const r = this._byId.get(id); return r ? { id: r.id, type: r.type, title: r.title, tags: [...r.tags], refs: [...r.refs], status: r.status } : null; }
  byType(type) { return this._records.filter((r) => r.type === type).map((r) => this.get(r.id)); }

  // Searchable institutional memory: match query terms against title/type/tags (deterministic).
  search(query) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return this._records
      .map((r) => ({ r, score: terms.filter((t) => `${r.type} ${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
      .map((x) => this.get(x.r.id));
  }
  // Decision traceability: follow refs from a record back through the chain.
  trace(id, seen = new Set()) {
    if (seen.has(id)) return []; seen.add(id);
    const r = this._byId.get(id); if (!r) return [];
    return [this.get(id), ...r.refs.flatMap((ref) => this.trace(ref, seen))];
  }

  // Knowledge lifecycle: supersede a record (immutable — the old record is retained, marked).
  supersede(id, bySummary) { const r = this._byId.get(id); if (!r) throw new Error('unknown record'); // records are frozen; we track supersession in a side map
    this._superseded = this._superseded || new Map(); this._superseded.set(id, { at: this._clock(), by: bySummary }); return { id, superseded: true }; }
  isSuperseded(id) { return !!(this._superseded && this._superseded.has(id)); }

  // Integrity: the whole repository is a valid hash chain (tamper-evident, auditable).
  verify() {
    let prev = 'GENESIS';
    for (const r of this._records) {
      if (r.prevHash !== prev) return { ok: false, brokenAt: r.id, reason: 'chain break' };
      const recomputed = hash.sha256({ id: r.id, type: r.type, title: r.title, tags: r.tags, refs: r.refs, attributes: r.attributes, at: r.at, prevHash: r.prevHash });
      if (recomputed !== r.hash) return { ok: false, brokenAt: r.id, reason: 'hash mismatch (tampered)' };
      prev = r.hash;
    }
    return { ok: true, length: this._records.length };
  }
  size() { return this._records.length; }
}

module.exports = { KnowledgeRepository, RECORD_TYPES };
