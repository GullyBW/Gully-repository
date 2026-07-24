'use strict';
// Enterprise Metadata Platform (Phase 32). Centralised metadata GOVERNANCE built on the Data
// Fabric: dataset ownership, DATA CLASSIFICATION, stewardship, provenance/lineage, data-
// quality metrics, metadata search, VERSIONING, and retention policies. Deterministic. All
// metadata is non-identifying (describes structure/provenance, never personal data).
const CLASSIFICATIONS = ['public', 'internal', 'restricted', 'secret'];

class MetadataGovernance {
  constructor({ clock = () => Date.now(), lineage } = {}) { this._clock = clock; this._datasets = new Map(); this._lineage = lineage || null; }

  // Register/version a dataset's metadata (versioned — each change bumps the version).
  register(id, { owner, steward, classification = 'internal', tags = [], canonical, retentionDays = 3650 } = {}) {
    if (!CLASSIFICATIONS.includes(classification)) throw new Error('invalid classification: ' + classification);
    const prev = this._datasets.get(id);
    const version = prev ? prev.version + 1 : 1;
    this._datasets.set(id, { id, owner, steward: steward || owner, classification, tags: [...tags], canonical: canonical || null, retentionDays, version, updatedAt: this._clock(), quality: prev ? prev.quality : null });
    return this.describe(id);
  }
  describe(id) { const d = this._datasets.get(id); return d ? { ...d, tags: [...d.tags] } : null; }
  catalog() { return [...this._datasets.values()].map((d) => this.describe(d.id)); }
  search({ tag, classification, owner } = {}) { return this.catalog().filter((d) => (!tag || d.tags.includes(tag)) && (!classification || d.classification === classification) && (!owner || d.owner === owner)); }

  // Record data-quality metrics for a dataset (completeness/validity/timeliness in [0,1]).
  recordQuality(id, { completeness = 1, validity = 1, timeliness = 1 } = {}) {
    const d = this._must(id); d.quality = { completeness, validity, timeliness, score: +((completeness + validity + timeliness) / 3).toFixed(3), at: this._clock() }; return d.quality;
  }
  // Provenance/lineage trace (delegates to the Data Fabric lineage graph if wired).
  provenance(id) { return this._lineage ? this._lineage.trace(id) : []; }
  // Retention governance: datasets past their retention window (advisory).
  retentionReport(now = this._clock()) { return this.catalog().filter((d) => now - d.updatedAt > d.retentionDays * 24 * 3600_000).map((d) => ({ id: d.id, classification: d.classification })); }
  // Stewardship report: datasets grouped by steward for accountability.
  stewardship() { const m = {}; for (const d of this.catalog()) (m[d.steward] = m[d.steward] || []).push(d.id); return m; }
  _must(id) { const d = this._datasets.get(id); if (!d) throw new Error('unknown dataset: ' + id); return d; }
}

module.exports = { MetadataGovernance, CLASSIFICATIONS };
