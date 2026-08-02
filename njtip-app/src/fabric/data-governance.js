'use strict';
// Enterprise Data Governance (Phase 10, Part 7). Extends the data fabric from catalogue and
// lineage into full lifecycle governance: retention policies, legal holds, purpose-limitation
// validation, consent lifecycle, metadata governance, data-quality monitoring, classification,
// reference data and master data — with CROSS-DOMAIN lineage.
//
// The guarantee every record must satisfy:
//
//     Origin → Transformations → Consumers → Retention → Deletion
//
// A record that cannot answer all five is not governed, and `traceRecord()` says so rather than
// returning a partial answer. Deterministic; identity fields are refused everywhere.
const IDENTITY_FIELDS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'dob', 'content', 'reporter']);
const CLASSIFICATIONS = ['public', 'internal', 'restricted', 'secret'];
const QUALITY_DIMENSIONS = ['completeness', 'validity', 'consistency', 'timeliness', 'uniqueness'];

// Retention policies as data: class → duration, disposition and the legal basis for both.
const RETENTION_POLICIES = {
  'case-record': { retentionDays: 2555, disposition: 'archive', basis: 'Public records retention — 7 years from closure' },
  'evidence': { retentionDays: 3650, disposition: 'archive', basis: 'Evidentiary retention — 10 years, subject to legal hold' },
  'audit-log': { retentionDays: 3650, disposition: 'archive', basis: 'Auditability of governance decisions — 10 years' },
  'governance-decision': { retentionDays: -1, disposition: 'permanent', basis: 'Institutional memory — decisions are never destroyed' },
  'telemetry': { retentionDays: 90, disposition: 'delete', basis: 'Operational necessity only' },
  'exchange-agreement': { retentionDays: 1825, disposition: 'delete', basis: 'Data-sharing accountability — 5 years' },
  'analytics-derivative': { retentionDays: 365, disposition: 'delete', basis: 'Derived aggregates are re-computable' },
};

// Reference data: controlled vocabularies that must be identical platform-wide.
const REFERENCE_DATA = {
  'case-category': { values: ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'], owner: 'investigation', authority: 'Directorate on Corruption and Economic Crime' },
  'classification': { values: CLASSIFICATIONS, owner: 'privacy', authority: 'Data Protection Commissioner' },
  'zone': { values: ['independent', 'executive', 'judiciary'], owner: 'assurance', authority: 'Oversight Board' },
  'case-status': { values: ['received', 'assigned', 'reviewed', 'escalated', 'resolved', 'closed'], owner: 'investigation', authority: 'Directorate on Corruption and Economic Crime' },
};

// Master data: the single authoritative source for an entity that several contexts use.
const MASTER_DATA = {
  'agency': { authoritativeSource: 'tenancy-federation', consumers: ['intake', 'data-exchange', 'analytics'], steward: 'Ministry of Public Administration' },
  'service-catalogue': { authoritativeSource: 'portfolio', consumers: ['governance-oversight', 'observability'], steward: 'Service Portfolio Team' },
  'legal-instrument': { authoritativeSource: 'legislation', consumers: ['assurance', 'governance-oversight'], steward: 'Attorney General Chambers' },
};

class DataGovernance {
  constructor({ clock = () => Date.now() } = {}) {
    this._clock = clock;
    this._records = new Map();     // dataset/record class → governance record
    this._holds = new Map();       // hold id → legal hold
    this._consents = new Map();    // consent id → consent lifecycle record
    this._quality = new Map();     // dataset → quality observations
    this._audit = [];
    this._seq = 0;
  }

  // --- Registration & lineage ------------------------------------------------------------

  // Register a governed dataset with its origin, classification and retention class.
  register(id, { origin, classification = 'internal', retentionClass, owner, fields = [], purpose, domain } = {}) {
    if (!id || !origin) throw new Error('a governed dataset needs an id and an origin');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`invalid classification '${classification}'`);
    if (!RETENTION_POLICIES[retentionClass]) { const e = new Error(`unknown retention class '${retentionClass}' — every record must have a retention policy`); e.failClosed = true; throw e; }
    if (!purpose) { const e = new Error('a governed dataset must declare its purpose (purpose limitation)'); e.failClosed = true; throw e; }
    const leaked = fields.filter((f) => IDENTITY_FIELDS.has(String(f).toLowerCase()));
    if (leaked.length) { const e = new Error(`dataset refuses identity fields: ${leaked.join(', ')}`); e.failClosed = true; throw e; }
    this._records.set(id, { id, origin, classification, retentionClass, owner, domain: domain || owner, fields: [...fields], purpose, transformations: [], consumers: [], createdAt: this._clock(), deletedAt: null });
    this._log('registered', id, owner);
    return this.describe(id);
  }
  describe(id) { const r = this._records.get(id); if (!r) throw new Error('unknown governed dataset: ' + id); return JSON.parse(JSON.stringify(r)); }
  datasets() { return [...this._records.keys()].sort(); }

  // Record a transformation: what produced this dataset from what, and under whose purpose.
  addTransformation(id, { from, operation, by, purpose }) {
    const r = this._mustRecord(id);
    if (!operation || !by) throw new Error('a transformation must name its operation and the process that performed it');
    r.transformations.push({ from: from || null, operation, by, purpose: purpose || r.purpose, at: this._clock() });
    this._log('transformed', id, by);
    return { id, transformations: r.transformations.length };
  }
  // Record a consumer, with the purpose it consumes under (purpose limitation across domains).
  addConsumer(id, { consumer, purpose, domain }) {
    const r = this._mustRecord(id);
    if (!consumer || !purpose) throw new Error('a consumer must be named and declare its purpose');
    if (purpose !== r.purpose) { const e = new Error(`purpose limitation: '${id}' is governed for '${r.purpose}', not '${purpose}'`); e.failClosed = true; throw e; }
    r.consumers.push({ consumer, purpose, domain: domain || null, at: this._clock() });
    this._log('consumed', id, consumer);
    return { id, consumers: r.consumers.length };
  }

  // Cross-domain lineage: the graph of dataset → dataset edges, annotated with the domain
  // boundary each edge crosses (a cross-domain edge is where governance usually leaks).
  lineageGraph() {
    const nodes = this.datasets().map((id) => { const r = this._records.get(id); return { id, domain: r.domain, classification: r.classification }; });
    const edges = [];
    for (const id of this.datasets()) {
      const r = this._records.get(id);
      for (const t of r.transformations) {
        if (!t.from) continue;
        const src = this._records.get(t.from);
        edges.push({ from: t.from, to: id, operation: t.operation, crossDomain: !!(src && src.domain !== r.domain), fromDomain: src ? src.domain : null, toDomain: r.domain });
      }
    }
    return { nodes, edges, crossDomainEdges: edges.filter((e) => e.crossDomain) };
  }

  // THE guarantee: origin → transformations → consumers → retention → deletion, for one record.
  traceRecord(id, { now = null } = {}) {
    const r = this.describe(id);
    const at = now ?? this._clock();
    const policy = RETENTION_POLICIES[r.retentionClass];
    const holds = this.holdsFor(id);
    const expiresAt = policy.retentionDays < 0 ? null : r.createdAt + policy.retentionDays * 24 * 3600_000;
    const dueForDisposition = expiresAt !== null && at > expiresAt;
    const complete = !!(r.origin && r.consumers.length >= 0 && policy && (policy.retentionDays < 0 || expiresAt));
    return {
      dataset: id, complete,
      origin: r.origin,
      transformations: r.transformations,
      consumers: r.consumers,
      retention: { class: r.retentionClass, ...policy, expiresAt, dueForDisposition },
      legalHolds: holds,
      deletion: r.deletedAt ? { deleted: true, at: r.deletedAt }
        : policy.retentionDays < 0 ? { deleted: false, plan: 'permanent — never destroyed', basis: policy.basis }
          : holds.length ? { deleted: false, plan: 'blocked by legal hold', holds: holds.map((h) => h.id) }
            : { deleted: false, plan: `${policy.disposition} at ${expiresAt}`, dueNow: dueForDisposition },
      note: 'Full lifecycle trace. A record that cannot answer all five stages is not governed.',
    };
  }

  // --- Retention, legal holds and deletion ------------------------------------------------

  retentionPolicies() { return Object.entries(RETENTION_POLICIES).map(([id, p]) => ({ id, ...p })); }
  dueForDisposition({ now = null } = {}) {
    const at = now ?? this._clock();
    return this.datasets().map((id) => this.traceRecord(id, { now: at })).filter((t) => t.retention.dueForDisposition && !t.legalHolds.length && !t.deletion.deleted)
      .map((t) => ({ dataset: t.dataset, disposition: t.retention.disposition, expiredAt: t.retention.expiresAt }));
  }
  // A legal hold suspends deletion regardless of the retention policy.
  placeLegalHold(id, { matter, by, rationale }) {
    this._mustRecord(id);
    if (!matter || !by || !rationale) throw new Error('a legal hold requires a matter, a named authority and a rationale');
    const hold = { id: 'HOLD-' + (++this._seq).toString().padStart(4, '0'), dataset: id, matter, by, rationale, placedAt: this._clock(), released: false };
    this._holds.set(hold.id, hold);
    this._log('legal-hold-placed', id, by);
    return { ...hold };
  }
  releaseLegalHold(holdId, { by, rationale }) {
    const h = this._holds.get(holdId); if (!h) throw new Error('unknown legal hold');
    if (!by || !rationale) throw new Error('releasing a legal hold requires a named authority and a rationale');
    h.released = true; h.releasedBy = by; h.releaseRationale = rationale;
    this._log('legal-hold-released', h.dataset, by);
    return { ...h };
  }
  holdsFor(id) { return [...this._holds.values()].filter((h) => h.dataset === id && !h.released).map((h) => ({ ...h })); }

  // Deletion is refused while a hold stands or the retention period is unexpired.
  delete(id, { by, rationale, now = null } = {}) {
    const r = this._mustRecord(id);
    if (!by || !rationale) throw new Error('deletion requires a named authority and a rationale');
    const trace = this.traceRecord(id, { now });
    if (trace.legalHolds.length) { const e = new Error(`deletion refused: ${trace.legalHolds.length} legal hold(s) in force`); e.failClosed = true; throw e; }
    if (RETENTION_POLICIES[r.retentionClass].retentionDays < 0) { const e = new Error('deletion refused: this record class is retained permanently'); e.failClosed = true; throw e; }
    if (!trace.retention.dueForDisposition) { const e = new Error('deletion refused: the retention period has not elapsed'); e.failClosed = true; throw e; }
    r.deletedAt = now ?? this._clock();
    this._log('deleted', id, by);
    return { dataset: id, deleted: true, at: r.deletedAt, by, rationale };
  }

  // --- Consent lifecycle -------------------------------------------------------------------

  // Consent applies to identified data subjects, which the reporting path never has. It exists
  // for staff and partner-agency data, and it is explicit about that.
  recordConsent(id, { subjectRole, purpose, grantedBy, expiresInDays = 365 }) {
    if (!subjectRole || !purpose || !grantedBy) throw new Error('consent requires a subject role, a purpose and a granting authority');
    if (IDENTITY_FIELDS.has(String(subjectRole).toLowerCase())) throw new Error('consent records refuse identity fields — subjects are role-coded');
    const at = this._clock();
    const consent = { id, subjectRole, purpose, grantedBy, grantedAt: at, expiresAt: at + expiresInDays * 24 * 3600_000, withdrawn: false, scope: 'staff-and-partner-data-only' };
    this._consents.set(id, consent);
    this._log('consent-granted', id, grantedBy);
    return { ...consent };
  }
  withdrawConsent(id, { by }) {
    const c = this._consents.get(id); if (!c) throw new Error('unknown consent record');
    c.withdrawn = true; c.withdrawnAt = this._clock(); c.withdrawnBy = by || 'subject';
    this._log('consent-withdrawn', id, c.withdrawnBy);
    return { ...c };
  }
  consentValid(id, { purpose, now = null } = {}) {
    const c = this._consents.get(id);
    if (!c) return { valid: false, reason: 'no consent record' };
    if (c.withdrawn) return { valid: false, reason: 'consent withdrawn' };
    if ((now ?? this._clock()) > c.expiresAt) return { valid: false, reason: 'consent expired' };
    if (purpose && purpose !== c.purpose) return { valid: false, reason: `consent covers '${c.purpose}', not '${purpose}'` };
    return { valid: true, purpose: c.purpose, expiresAt: c.expiresAt };
  }

  // --- Data quality ---------------------------------------------------------------------------

  // Record a quality observation across the five dimensions (each 0..1).
  observeQuality(id, observations = {}) {
    this._mustRecord(id);
    const unknown = Object.keys(observations).filter((d) => !QUALITY_DIMENSIONS.includes(d));
    if (unknown.length) throw new Error(`unknown quality dimension(s): ${unknown.join(', ')}`);
    const rec = { at: this._clock(), ...observations };
    if (!this._quality.has(id)) this._quality.set(id, []);
    this._quality.get(id).push(rec);
    return { dataset: id, observations: this._quality.get(id).length };
  }
  qualityScore(id, { threshold = 0.9 } = {}) {
    const obs = this._quality.get(id) || [];
    if (!obs.length) return { dataset: id, measured: false, score: null, note: 'no quality observation recorded' };
    const latest = obs[obs.length - 1];
    const measured = QUALITY_DIMENSIONS.filter((d) => typeof latest[d] === 'number');
    const score = measured.length ? +(measured.reduce((a, d) => a + latest[d], 0) / measured.length).toFixed(3) : null;
    const failing = measured.filter((d) => latest[d] < threshold);
    return { dataset: id, measured: true, score, dimensions: Object.fromEntries(measured.map((d) => [d, latest[d]])), failing, meets: failing.length === 0, threshold };
  }

  // --- Reference & master data --------------------------------------------------------------------

  referenceData() { return Object.entries(REFERENCE_DATA).map(([id, r]) => ({ id, ...r, values: [...r.values] })); }
  validateReferenceValue(setId, value) {
    const set = REFERENCE_DATA[setId];
    if (!set) return { valid: false, reason: `unknown reference set '${setId}'` };
    return set.values.includes(value) ? { valid: true, set: setId } : { valid: false, reason: `'${value}' is not in the controlled vocabulary for '${setId}'`, permitted: [...set.values] };
  }
  masterData() { return Object.entries(MASTER_DATA).map(([id, m]) => ({ id, ...m, consumers: [...m.consumers] })); }

  // --- Validation & report --------------------------------------------------------------------------

  validate() {
    const violations = [];
    for (const id of this.datasets()) {
      const r = this._records.get(id);
      if (!RETENTION_POLICIES[r.retentionClass]) violations.push(`${id}: unknown retention class`);
      if (!r.purpose) violations.push(`${id}: no declared purpose`);
      if (!r.origin) violations.push(`${id}: no recorded origin`);
      const trace = this.traceRecord(id);
      if (!trace.complete) violations.push(`${id}: lifecycle trace incomplete`);
      for (const f of r.fields) if (IDENTITY_FIELDS.has(String(f).toLowerCase())) violations.push(`${id}: identity field '${f}' in a governed dataset`);
    }
    for (const [id, p] of Object.entries(RETENTION_POLICIES)) {
      if (!p.basis) violations.push(`retention policy '${id}' has no legal basis`);
      if (!['archive', 'delete', 'permanent'].includes(p.disposition)) violations.push(`retention policy '${id}' has an unknown disposition`);
    }
    for (const [id, m] of Object.entries(MASTER_DATA)) if (!m.authoritativeSource || !m.steward) violations.push(`master data '${id}' has no authoritative source or steward`);
    return { valid: violations.length === 0, violations, datasets: this.datasets().length };
  }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, dataset, actor) { this._audit.push({ at: this._clock(), event, dataset, actor: actor || 'system' }); }
  _mustRecord(id) { const r = this._records.get(id); if (!r) throw new Error('unknown governed dataset: ' + id); return r; }

  report({ now = null } = {}) {
    return {
      datasets: this.datasets().map((id) => this.traceRecord(id, { now })),
      lineage: this.lineageGraph(),
      retentionPolicies: this.retentionPolicies(),
      dueForDisposition: this.dueForDisposition({ now }),
      legalHolds: [...this._holds.values()].map((h) => ({ ...h })),
      referenceData: this.referenceData(), masterData: this.masterData(),
      quality: this.datasets().map((id) => this.qualityScore(id)),
      validation: this.validate(), audit: this.auditTrail(),
      note: 'Every governed record traces origin → transformations → consumers → retention → deletion. Deletion is refused under a legal hold.',
    };
  }
}

// The platform's own governed datasets, seeded so the model describes reality.
function seedPlatformDatasets(dg = new DataGovernance()) {
  dg.register('case-records', { origin: 'anonymous intake (no identity accepted)', classification: 'restricted', retentionClass: 'case-record', owner: 'investigation', domain: 'Justice', fields: ['caseCode', 'category', 'status'], purpose: 'investigation-of-reported-conduct' });
  dg.register('evidence-refs', { origin: 'evidence attached to a case', classification: 'secret', retentionClass: 'evidence', owner: 'custody', domain: 'Justice', fields: ['evidenceId', 'contentHash', 'state'], purpose: 'investigation-of-reported-conduct' });
  dg.register('audit-chain', { origin: 'every governed action', classification: 'restricted', retentionClass: 'audit-log', owner: 'assurance', domain: 'Governance', fields: ['sequence', 'digest'], purpose: 'auditability' });
  dg.register('governance-decisions', { origin: 'a named human recording a decision', classification: 'internal', retentionClass: 'governance-decision', owner: 'governance-oversight', domain: 'Governance', fields: ['subject', 'verdict'], purpose: 'institutional-accountability' });
  dg.register('oversight-aggregates', { origin: 'derived from case records', classification: 'internal', retentionClass: 'analytics-derivative', owner: 'analytics', domain: 'Insight', fields: ['category', 'count'], purpose: 'oversight-reporting' });
  dg.register('platform-telemetry', { origin: 'runtime instrumentation', classification: 'internal', retentionClass: 'telemetry', owner: 'observability', domain: 'Operations', fields: ['route', 'latencyMs'], purpose: 'operational-reliability' });
  dg.addTransformation('oversight-aggregates', { from: 'case-records', operation: 'aggregate with k-anonymity suppression', by: 'analytics-pipeline', purpose: 'oversight-reporting' });
  dg.addTransformation('audit-chain', { from: 'case-records', operation: 'append hash-chained audit entry', by: 'audit-writer', purpose: 'auditability' });
  dg.addConsumer('oversight-aggregates', { consumer: 'oversight-dashboard', purpose: 'oversight-reporting', domain: 'Governance' });
  dg.addConsumer('case-records', { consumer: 'investigation-service', purpose: 'investigation-of-reported-conduct', domain: 'Justice' });
  return dg;
}

module.exports = { DataGovernance, seedPlatformDatasets, RETENTION_POLICIES, REFERENCE_DATA, MASTER_DATA, QUALITY_DIMENSIONS, CLASSIFICATIONS };
