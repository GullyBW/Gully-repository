'use strict';
// Data Provenance Platform (Phase 43). Expands metadata/lineage into complete, TAMPER-EVIDENT
// provenance: end-to-end lineage, transformation history, and provenance for evidence,
// reports, and analytics. Every generated artifact is TRACEABLE to its originating data.
// Deterministic. Records reference non-identifying artifact ids + transforms, never content.
const { hash } = require('../twin');

class ProvenanceLedger {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._records = []; this._byArtifact = new Map(); this._lastHash = 'GENESIS'; }

  // Record that `artifactId` (of `kind`) was derived from `derivedFrom` via `transform`.
  // Hash-chained + immutable → tamper-evident provenance.
  record({ artifactId, kind = 'dataset', derivedFrom = [], transform = 'identity', actor = 'system' }) {
    if (!artifactId) throw new Error('provenance: artifactId required');
    const rec = { seq: this._records.length + 1, artifactId, kind, derivedFrom: [...derivedFrom], transform, actor, at: this._clock(), prevHash: this._lastHash };
    rec.hash = hash.sha256({ seq: rec.seq, artifactId, kind, derivedFrom: rec.derivedFrom, transform, actor, at: rec.at, prevHash: rec.prevHash });
    this._lastHash = rec.hash; Object.freeze(rec);
    this._records.push(rec); this._byArtifact.set(artifactId, rec);
    return { seq: rec.seq, hash: rec.hash };
  }

  // Full upstream provenance DAG for an artifact (transformation history).
  trace(artifactId, seen = new Set()) {
    if (seen.has(artifactId)) return [];
    seen.add(artifactId);
    const rec = this._byArtifact.get(artifactId);
    if (!rec) return [];
    const edges = rec.derivedFrom.map((src) => ({ from: src, to: artifactId, transform: rec.transform }));
    return [...edges, ...rec.derivedFrom.flatMap((src) => this.trace(src, seen))];
  }
  // Roots an artifact ultimately derives from (originating data).
  roots(artifactId) {
    const rec = this._byArtifact.get(artifactId); if (!rec) return [artifactId];
    if (!rec.derivedFrom.length) return [artifactId];
    return [...new Set(rec.derivedFrom.flatMap((s) => this.roots(s)))].sort();
  }
  // Every generated artifact must be traceable to an originating root of an expected kind.
  verifyTraceable(artifactId, { rootPrefix } = {}) {
    const roots = this.roots(artifactId);
    const ok = roots.length > 0 && (!rootPrefix || roots.every((r) => String(r).startsWith(rootPrefix)));
    return { artifactId, roots, traceable: ok };
  }
  // Provenance chain integrity (tamper-evidence).
  verify() {
    let prev = 'GENESIS';
    for (const r of this._records) {
      if (r.prevHash !== prev) return { ok: false, brokenAt: r.seq, reason: 'chain break' };
      const { hash: h, ...body } = r;
      if (hash.sha256(body) !== h) return { ok: false, brokenAt: r.seq, reason: 'hash mismatch (tampered)' };
      prev = h;
    }
    return { ok: true, length: this._records.length };
  }
  // Provenance query + visualization (edge list / DOT for rendering).
  query({ kind, artifactId } = {}) { return this._records.filter((r) => (!kind || r.kind === kind) && (!artifactId || r.artifactId === artifactId)).map((r) => ({ artifactId: r.artifactId, kind: r.kind, derivedFrom: r.derivedFrom, transform: r.transform })); }
  toDot(artifactId) { const edges = this.trace(artifactId); return 'digraph provenance {\n' + edges.map((e) => `  "${e.from}" -> "${e.to}" [label="${e.transform}"];`).join('\n') + '\n}\n'; }
}

module.exports = { ProvenanceLedger };
