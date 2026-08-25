'use strict';
// Enterprise Event Governance (Phase 26). A GOVERNANCE layer over the immutable event log:
// a registry/catalog of event types with ownership, versioning, compatibility verification,
// lifecycle (active → deprecated → retired), deprecation policies, dependency mapping,
// retention governance, discovery, and documentation generation. Deterministic.
//
// This governs event CONTRACTS (metadata) — it never mutates the append-only, hash-chained
// log. No existing event contract may be broken: registering an incompatible schema for an
// active type is refused (fail-closed).
const { backwardCompatible } = require('../fabric/registry');

const LIFECYCLE = ['active', 'deprecated', 'retired'];

class EventRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._types = new Map(); }

  // Register (or introduce) an event type contract.
  register(type, { owner, schema = {}, description = '', retentionDays = 3650, dependsOn = [] } = {}) {
    if (!type || !owner) throw new Error('event type and owner are required');
    if (this._types.has(type)) throw new Error('event type already registered: ' + type + ' (use evolve/deprecate)');
    this._types.set(type, { type, owner, versions: [{ version: 1, schema, since: this._clock() }], status: 'active', description, retentionDays, dependsOn: [...dependsOn], deprecatedIn: null });
    return this.describe(type);
  }

  // Evolve a type's schema — MUST be backward compatible (additive only) or it is refused.
  evolve(type, newSchema) {
    const t = this._must(type);
    const prev = t.versions[t.versions.length - 1].schema;
    if (!backwardCompatible(prev, newSchema)) throw new Error(`incompatible schema evolution for '${type}' (would break existing consumers)`);
    t.versions.push({ version: t.versions.length + 1, schema: newSchema, since: this._clock() });
    return { type, version: t.versions.length };
  }
  // Check compatibility WITHOUT registering (governance pre-flight).
  checkCompatibility(type, candidateSchema) {
    const t = this._types.get(type); if (!t) return { compatible: true, reason: 'new type' };
    const prev = t.versions[t.versions.length - 1].schema;
    return { compatible: backwardCompatible(prev, candidateSchema), reason: backwardCompatible(prev, candidateSchema) ? 'additive' : 'breaking change' };
  }

  deprecate(type, { replacedBy } = {}) { const t = this._must(type); t.status = 'deprecated'; t.deprecatedIn = this._clock(); t.replacedBy = replacedBy || null; return this.describe(type); }
  retire(type) { const t = this._must(type); if (t.status !== 'deprecated') throw new Error('an event type must be deprecated before retirement'); t.status = 'retired'; return this.describe(type); }

  describe(type) { const t = this._must(type); return { type: t.type, owner: t.owner, status: t.status, version: t.versions.length, description: t.description, retentionDays: t.retentionDays, dependsOn: [...t.dependsOn], deprecatedIn: t.deprecatedIn, replacedBy: t.replacedBy || null }; }
  catalog() { return [...this._types.keys()].sort().map((t) => this.describe(t)); }
  // Discovery API: filter the catalog by owner/status.
  discover({ owner, status } = {}) { return this.catalog().filter((e) => (!owner || e.owner === owner) && (!status || e.status === status)); }

  // Dependency mapping: type → [types it depends on] (a governance DAG for impact analysis).
  dependencyMap() { const m = {}; for (const e of this.catalog()) m[e.type] = e.dependsOn; return m; }

  // Retention governance: given the live event log + now, which events are past their type's
  // retention window. Advisory (never auto-deletes the immutable log).
  retentionReport(events, now = this._clock()) {
    const out = [];
    for (const e of events) {
      const t = this._types.get(e.type); if (!t) continue;
      const ageDays = (now - e.meta.at) / (24 * 3600_000);
      if (ageDays > t.retentionDays) out.push({ seq: e.seq, type: e.type, ageDays: Math.round(ageDays), retentionDays: t.retentionDays });
    }
    return { pastRetention: out.length, items: out, note: 'Advisory only — the immutable log is never auto-purged; disposition is a human decision.' };
  }

  // Integrity validation: the log verifies AND every event type in the log is registered.
  validate(eventStore) {
    const chain = eventStore.verifyChain();
    const unknown = [...new Set(eventStore.readAll().map((e) => e.type))].filter((t) => !this._types.has(t));
    return { ok: chain.ok && unknown.length === 0, chainOk: chain.ok, unknownTypes: unknown };
  }

  // Documentation generation (deterministic markdown of the catalog).
  generateDocs() {
    const lines = ['# NJTIP Event Catalog', '', '| Event | Owner | Status | Version | Retention (days) | Depends on |', '|---|---|---|---|---|---|'];
    for (const e of this.catalog()) lines.push(`| ${e.type} | ${e.owner} | ${e.status} | v${e.version} | ${e.retentionDays} | ${e.dependsOn.join(', ') || '—'} |`);
    return lines.join('\n') + '\n';
  }
  _must(type) { const t = this._types.get(type); if (!t) throw new Error('unknown event type: ' + type); return t; }
}

// The canonical NJTIP event catalog (seeds the registry; owned by the case bounded context).
function seedCaseEvents(reg) {
  reg.register('CaseSubmitted', { owner: 'case-context', description: 'A case was submitted (anonymous)', dependsOn: [] });
  reg.register('EvidenceAttached', { owner: 'case-context', description: 'Evidence was attached', dependsOn: ['CaseSubmitted'] });
  reg.register('CaseReviewed', { owner: 'case-context', description: 'An investigator reviewed the case', dependsOn: ['CaseSubmitted'] });
  reg.register('CaseTransitioned', { owner: 'case-context', description: 'The case lifecycle advanced', dependsOn: ['CaseSubmitted'] });
  reg.register('CaseAssigned', { owner: 'case-context', description: 'The case was assigned to an investigator', dependsOn: ['CaseSubmitted'] });
  reg.register('StageAdvanced', { owner: 'case-context', description: 'The review chain advanced', dependsOn: ['CaseSubmitted'] });
  reg.register('AppealFiled', { owner: 'case-context', description: 'An appeal was filed', dependsOn: ['CaseTransitioned'] });
  return reg;
}

module.exports = { EventRegistry, seedCaseEvents, LIFECYCLE };
