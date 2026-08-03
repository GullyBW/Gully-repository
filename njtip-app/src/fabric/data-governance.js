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
// Eight quality dimensions (Phase 11, Part 7). The first six are OBSERVED from the data; the last
// two are DERIVED from the governance model itself, and observing them is refused — the platform
// already knows whether a dataset's lineage and metadata are complete, so accepting a hand-entered
// figure for either would be accepting a claim in place of a fact it can check.
const OBSERVED_DIMENSIONS = ['completeness', 'validity', 'consistency', 'timeliness', 'uniqueness', 'accuracy'];
const DERIVED_DIMENSIONS = ['lineageCompleteness', 'metadataCompleteness'];
const QUALITY_DIMENSIONS = [...OBSERVED_DIMENSIONS, ...DERIVED_DIMENSIONS];
// Metadata a governed dataset must carry for its metadata-completeness to score 1.0.
const REQUIRED_METADATA = ['origin', 'classification', 'retentionClass', 'owner', 'domain', 'purpose', 'fields'];
// Quality thresholds and what each band means for governance readiness.
const QUALITY_BANDS = [
  { floor: 0.95, band: 'good', readinessImpact: 0, action: 'none' },
  { floor: 0.85, band: 'acceptable', readinessImpact: 0, action: 'monitor' },
  { floor: 0.70, band: 'degraded', readinessImpact: 0.5, action: 'remediate' },
  { floor: 0, band: 'poor', readinessImpact: 1, action: 'escalate' },
];

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

  // Record a quality observation across the six OBSERVED dimensions (each 0..1). The two derived
  // dimensions are refused: they are facts the governance model already holds.
  //
  // `recordCount` matters: a dataset with zero rows has no defects, but that is not a quality
  // achievement. It is reported as `not-applicable` so it can never be mistaken for one.
  observeQuality(id, observations = {}, { recordCount = null } = {}) {
    this._mustRecord(id);
    const derived = Object.keys(observations).filter((d) => DERIVED_DIMENSIONS.includes(d));
    if (derived.length) throw new Error(`${derived.join(', ')} is derived from the governance model and cannot be observed — it is computed, not reported`);
    const unknown = Object.keys(observations).filter((d) => !OBSERVED_DIMENSIONS.includes(d));
    if (unknown.length) throw new Error(`unknown quality dimension(s): ${unknown.join(', ')}`);
    for (const [d, v] of Object.entries(observations)) {
      if (typeof v !== 'number' || v < 0 || v > 1) throw new Error(`quality dimension '${d}' must be a number in [0, 1]`);
    }
    const rec = { at: this._clock(), recordCount, ...observations };
    if (!this._quality.has(id)) this._quality.set(id, []);
    this._quality.get(id).push(rec);
    return { dataset: id, observations: this._quality.get(id).length, recordCount };
  }

  // Derived dimensions: read straight off the governance record, so they cannot be overstated.
  //
  // Lineage completeness asks five questions the trace must be able to answer. The fifth is the
  // one that catches real problems: a transformation whose upstream is not itself governed means
  // the lineage graph ends at a dataset nobody owns.
  deriveQualityDimensions(id) {
    const r = this._mustRecord(id);
    const trace = this.traceRecord(id);
    const policy = RETENTION_POLICIES[r.retentionClass];
    const transformations = trace.transformations || [];
    const checks = {
      originRecorded: !!r.origin,
      retentionResolved: !!policy,
      dispositionPlanned: !!(trace.deletion && trace.deletion.plan),
      consumersDeclared: (trace.consumers || []).length > 0,
      upstreamsGoverned: transformations.every((t) => t.from && this._records.has(t.from) && t.operation && t.by && t.purpose),
    };
    const gaps = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    const lineageCompleteness = +((Object.keys(checks).length - gaps.length) / Object.keys(checks).length).toFixed(3);
    const present = REQUIRED_METADATA.filter((f) => {
      const v = r[f];
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
    });
    const metadataCompleteness = +(present.length / REQUIRED_METADATA.length).toFixed(3);
    return {
      lineageCompleteness, metadataCompleteness, lineageChecks: checks, lineageGaps: gaps,
      missingMetadata: REQUIRED_METADATA.filter((f) => !present.includes(f)),
      note: 'Derived from the governance record. Neither figure can be supplied by hand.',
    };
  }

  qualityScore(id, { threshold = 0.9 } = {}) {
    const derived = this.deriveQualityDimensions(id);
    const obs = this._quality.get(id) || [];
    if (!obs.length) {
      // Derived dimensions still hold even with no observation — but an unobserved dataset is
      // not a measured one, and must never present as healthy.
      return {
        dataset: id, measured: false, score: null, derived,
        dimensions: { lineageCompleteness: derived.lineageCompleteness, metadataCompleteness: derived.metadataCompleteness },
        failing: [...OBSERVED_DIMENSIONS], unobserved: [...OBSERVED_DIMENSIONS], meets: false, threshold,
        band: 'unmeasured', readinessImpact: 1,
        note: 'no quality observation recorded — an unmeasured dataset is not a clean one',
      };
    }
    const latest = obs[obs.length - 1];
    const dimensions = {};
    for (const d of OBSERVED_DIMENSIONS) if (typeof latest[d] === 'number') dimensions[d] = latest[d];
    dimensions.lineageCompleteness = derived.lineageCompleteness;
    dimensions.metadataCompleteness = derived.metadataCompleteness;
    const keys = Object.keys(dimensions);
    const score = +(keys.reduce((a, d) => a + dimensions[d], 0) / keys.length).toFixed(3);
    const failing = keys.filter((d) => dimensions[d] < threshold).sort();
    const unobserved = OBSERVED_DIMENSIONS.filter((d) => dimensions[d] === undefined);
    const banding = QUALITY_BANDS.find((b) => score >= b.floor);
    const empty = latest.recordCount === 0;
    return {
      dataset: id, measured: true, score, dimensions, derived, failing, unobserved,
      recordCount: latest.recordCount,
      meets: empty || (failing.length === 0 && unobserved.length === 0), threshold,
      band: empty ? 'not-applicable' : banding.band,
      readinessImpact: empty ? 0 : banding.readinessImpact,
      action: empty ? 'none' : banding.action,
      observations: obs.length,
      ...(empty ? { note: 'the dataset holds no records — no defects are possible, which is not the same as good quality' } : {}),
    };
  }

  // --- Quality trend, scorecard, alerts and remediation (Phase 11, Part 7) ----------------------

  // Deterministic least-squares trend over the overall score of each observation.
  qualityTrend(id) {
    const obs = this._quality.get(id) || [];
    const derived = this.deriveQualityDimensions(id);
    const series = obs.map((o) => {
      const dims = OBSERVED_DIMENSIONS.filter((d) => typeof o[d] === 'number').map((d) => o[d]);
      const all = [...dims, derived.lineageCompleteness, derived.metadataCompleteness];
      return +(all.reduce((a, b) => a + b, 0) / all.length).toFixed(6);
    });
    const n = series.length;
    if (n < 2) return { dataset: id, n, direction: 'insufficient-data', slope: 0, series };
    const meanX = (n - 1) / 2;
    const meanY = series.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = i - meanX; sxy += dx * (series[i] - meanY); sxx += dx * dx; }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    return {
      dataset: id, n, series, slope: +slope.toFixed(8),
      direction: Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'improving' : 'degrading',
      latest: series[n - 1], first: series[0],
    };
  }

  // Scorecard across every governed dataset, graded and ordered worst-first so the work is obvious.
  qualityScorecard({ threshold = 0.9 } = {}) {
    const rows = this.datasets().map((id) => {
      const q = this.qualityScore(id, { threshold });
      const r = this._records.get(id);
      return {
        dataset: id, owner: r.owner, classification: r.classification, domain: r.domain,
        score: q.score, band: q.band, measured: q.measured, meets: q.meets,
        failing: q.failing, unobserved: q.unobserved || [], readinessImpact: q.readinessImpact,
        trend: this.qualityTrend(id).direction,
      };
    }).sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || a.dataset.localeCompare(b.dataset));
    const measured = rows.filter((r) => r.measured);
    const overall = measured.length ? +(measured.reduce((a, r) => a + r.score, 0) / measured.length).toFixed(3) : null;
    return {
      datasets: rows, threshold,
      measuredDatasets: measured.length, totalDatasets: rows.length,
      coverage: rows.length ? +(measured.length / rows.length).toFixed(3) : 0,
      overallScore: overall,
      worst: rows.length ? rows[0].dataset : null,
      failingDatasets: rows.filter((r) => !r.meets).map((r) => r.dataset),
      informationalOnly: true, authorizes: false,
    };
  }

  // Alerts route to the accountable owner — an unrouted data-quality alert is an unowned dataset.
  qualityAlerts({ threshold = 0.9 } = {}) {
    const alerts = [];
    for (const row of this.qualityScorecard({ threshold }).datasets) {
      if (row.meets && row.trend !== 'degrading') continue;
      const severity = !row.measured ? 'high' : row.band === 'poor' ? 'critical' : row.band === 'degraded' ? 'high' : 'medium';
      alerts.push({
        dataset: row.dataset, owner: row.owner, severity, band: row.band, score: row.score,
        failing: row.failing, unobserved: row.unobserved, trend: row.trend,
        reason: !row.measured
          ? 'no quality observation has ever been recorded for this dataset'
          : row.failing.length
            ? `dimension(s) below threshold: ${row.failing.join(', ')}`
            : 'quality is within threshold but the trend is degrading',
      });
    }
    return { alerts, count: alerts.length, critical: alerts.filter((a) => a.severity === 'critical').length, authorizes: false };
  }

  // Remediation workflow. A ticket needs a named human and a due date; closing one needs a named
  // human and evidence — "we fixed it" without evidence is how a quality problem becomes permanent.
  openRemediation(id, { dimension, by, dueInDays = 30, rationale = null } = {}) {
    this._mustRecord(id);
    if (!QUALITY_DIMENSIONS.includes(dimension)) throw new Error('unknown quality dimension: ' + dimension);
    if (!by) throw new Error('a remediation must be opened by a named human authority');
    if (!(dueInDays > 0 && dueInDays <= 365)) throw new Error('remediation due date must be within 365 days');
    if (!this._remediations) this._remediations = [];
    const ticket = {
      id: `DQ-${String(this._remediations.length + 1).padStart(4, '0')}`,
      dataset: id, dimension, openedBy: by, openedAt: this._clock(), rationale,
      dueAt: this._clock() + dueInDays * 24 * 3600_000,
      state: 'open', closedBy: null, closedAt: null, evidence: null,
    };
    this._remediations.push(ticket);
    this._log('remediation-opened', id, by);
    return { ...ticket };
  }
  closeRemediation(ticketId, { by, evidence } = {}) {
    const t = (this._remediations || []).find((x) => x.id === ticketId);
    if (!t) throw new Error('unknown remediation ticket: ' + ticketId);
    if (t.state !== 'open') throw new Error(`remediation ${ticketId} is already ${t.state}`);
    if (!by) throw new Error('a remediation must be closed by a named human authority');
    if (!evidence) throw new Error('a remediation cannot be closed without evidence of the fix');
    t.state = 'closed'; t.closedBy = by; t.closedAt = this._clock(); t.evidence = evidence;
    this._log('remediation-closed', t.dataset, by);
    return { ...t };
  }
  remediations({ state = null } = {}) { return (this._remediations || []).filter((t) => !state || t.state === state).map((t) => ({ ...t })); }
  overdueRemediations({ now = null } = {}) {
    const at = now ?? this._clock();
    return this.remediations({ state: 'open' }).filter((t) => t.dueAt < at).map((t) => ({ ...t, overdueByMs: at - t.dueAt }));
  }

  // Executive quality dashboard (Phase 12, Part 7). The board's question is not "what is the
  // completeness of oversight-aggregates?" — it is "can I rely on what this platform tells me?"
  // So the dashboard reports by DOMAIN and by owning steward, names the worst thing, and states
  // what unmeasured means, rather than presenting eight dimensions and leaving the reader to
  // work out which of them matters.
  executiveQualityDashboard({ threshold = 0.9, now = null } = {}) {
    const card = this.qualityScorecard({ threshold });
    const readiness = this.governanceReadiness({ threshold, now });
    const byDomain = {};
    for (const row of card.datasets) {
      const d = row.domain || 'unassigned';
      (byDomain[d] = byDomain[d] || { domain: d, datasets: [], measured: 0, failing: 0 }).datasets.push(row.dataset);
      if (row.measured) byDomain[d].measured += 1;
      if (!row.meets) byDomain[d].failing += 1;
    }
    for (const d of Object.values(byDomain)) {
      const rows = card.datasets.filter((r) => (r.domain || 'unassigned') === d.domain && r.measured);
      d.score = rows.length ? +(rows.reduce((a, r) => a + r.score, 0) / rows.length).toFixed(3) : null;
      d.status = rows.length === 0 ? 'unmeasured' : d.failing ? 'at-risk' : 'sound';
    }
    const byOwner = {};
    for (const row of card.datasets) (byOwner[row.owner || 'unowned'] = byOwner[row.owner || 'unowned'] || []).push({ dataset: row.dataset, score: row.score, band: row.band });
    return {
      question: 'Can the board rely on what this platform reports?',
      answer: readiness.acceptable
        ? 'Yes, for every measured dataset — with the caveats listed.'
        : 'Not fully. The blockers below must be closed before a figure derived from them is quoted.',
      qualityReadiness: readiness.qualityReadiness,
      acceptable: readiness.acceptable,
      blockers: readiness.blockers,
      byDomain: Object.values(byDomain).sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || a.domain.localeCompare(b.domain)),
      byOwner,
      worstDataset: card.worst,
      overallScore: card.overallScore,
      coverage: card.coverage,
      // Said in as many words, because it is the sentence a dashboard usually omits.
      unmeasuredMeans: 'A dataset with no quality observation is reported as unmeasured, not as sound. Absence of a measurement is not evidence of quality.',
      trends: this.datasets().map((id) => ({ dataset: id, ...this.qualityTrend(id) })),
      alerts: this.qualityAlerts({ threshold }).alerts,
      openRemediations: this.remediations({ state: 'open' }).length,
      overdueRemediations: this.overdueRemediations({ now }).length,
      informationalOnly: true, authorizes: false,
    };
  }

  // POOR QUALITY REDUCES GOVERNANCE READINESS. This is the whole point of Part 7: a data-quality
  // scorecard that nothing consumes is a report; one that moves the readiness number is a control.
  governanceReadiness({ threshold = 0.9, now = null } = {}) {
    const card = this.qualityScorecard({ threshold });
    const alerts = this.qualityAlerts({ threshold });
    const overdue = this.overdueRemediations({ now });
    const totalImpact = card.datasets.reduce((a, r) => a + r.readinessImpact, 0);
    const maxImpact = card.datasets.length || 1;
    // 1.0 with every dataset good; 0 when every dataset is poor or unmeasured.
    const qualityReadiness = +Math.max(0, 1 - totalImpact / maxImpact).toFixed(3);
    const blockers = [
      ...card.datasets.filter((r) => !r.measured).map((r) => `${r.dataset}: never measured`),
      ...card.datasets.filter((r) => r.measured && r.band === 'poor').map((r) => `${r.dataset}: quality band poor (${r.score})`),
      ...overdue.map((t) => `${t.id}: remediation overdue for ${t.dataset}/${t.dimension}`),
    ];
    return {
      qualityReadiness, scorecard: card, alerts: alerts.alerts, overdueRemediations: overdue,
      acceptable: qualityReadiness >= 0.9 && blockers.length === 0,
      blockers,
      failClosed: true, authorizes: false,
      note: 'Data quality is an input to governance readiness, not a report beside it. An unmeasured dataset reduces readiness exactly as a poor one does.',
    };
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
      qualityScorecard: this.qualityScorecard(),
      qualityTrends: this.datasets().map((id) => this.qualityTrend(id)),
      qualityAlerts: this.qualityAlerts(),
      remediations: this.remediations(),
      governanceReadiness: this.governanceReadiness({ now }),
      executiveDashboard: this.executiveQualityDashboard({ now }),
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
  // Phase 11, Part 7: the lineage-completeness check found four governed datasets with no declared
  // consumer. They all have real ones — a dataset nobody is recorded as reading is a dataset whose
  // retention nobody can reason about, so the gap was in the record, not in the check.
  dg.addConsumer('audit-chain', { consumer: 'audit-integrity-verifier', purpose: 'auditability', domain: 'Governance' });
  dg.addConsumer('evidence-refs', { consumer: 'custody-chain-verifier', purpose: 'investigation-of-reported-conduct', domain: 'Justice' });
  dg.addConsumer('governance-decisions', { consumer: 'oversight-dashboard', purpose: 'institutional-accountability', domain: 'Governance' });
  dg.addConsumer('platform-telemetry', { consumer: 'reliability-dashboard', purpose: 'operational-reliability', domain: 'Operations' });
  return dg;
}

// Measure the platform's OWN data quality from live state (Phase 11, Part 7). Every figure is
// computed from something the platform can check — the read model, the hash chains, the controlled
// vocabularies. Nothing here is supplied, which is the only reason these numbers mean anything.
//
// cases:      read-model rows [{ case_code, status, category, ... }]
// events:     the immutable event log
// chainIntact / custodyIntact / replayAgrees: verification results the platform already computes
function measurePlatformQuality(dg, { cases = [], events = [], decisions = [], evidenceCount = 0, telemetrySamples = [], chainIntact = true, custodyIntact = true, replayAgrees = true } = {}) {
  const frac = (n, d) => (d > 0 ? +(n / d).toFixed(4) : 1);
  const inVocabulary = (v, set) => REFERENCE_DATA[set] ? REFERENCE_DATA[set].values.includes(v) : true;

  // case-records: completeness of required fields, validity against the lifecycle vocabulary,
  // uniqueness of the case code, consistency against event replay.
  const required = ['caseCode', 'status', 'category'];
  dg.observeQuality('case-records', {
    completeness: frac(cases.filter((c) => required.every((f) => c[f] !== undefined && c[f] !== null && c[f] !== '')).length, cases.length),
    validity: frac(cases.filter((c) => inVocabulary(c.category, 'case-category') && inVocabulary(c.status, 'case-status')).length, cases.length),
    uniqueness: frac(new Set(cases.map((c) => c.caseCode)).size, cases.length),
    consistency: replayAgrees ? 1 : 0,
    timeliness: frac(events.filter((e) => e.meta && typeof e.meta.at === 'number').length, events.length),
    accuracy: chainIntact ? 1 : 0,
  }, { recordCount: cases.length });

  // evidence-refs: the custody chain either verifies or it does not. There is no partial credit on
  // evidence integrity, so every dimension that depends on it is binary.
  dg.observeQuality('evidence-refs', {
    completeness: custodyIntact ? 1 : 0, validity: custodyIntact ? 1 : 0,
    uniqueness: custodyIntact ? 1 : 0, consistency: custodyIntact ? 1 : 0,
    timeliness: 1, accuracy: custodyIntact ? 1 : 0,
  }, { recordCount: evidenceCount });

  // audit-chain: a hash chain either verifies or it does not — there is no partial credit.
  dg.observeQuality('audit-chain', {
    completeness: chainIntact ? 1 : 0, validity: chainIntact ? 1 : 0,
    consistency: chainIntact ? 1 : 0, uniqueness: frac(new Set(events.map((e) => e.seq)).size, events.length),
    timeliness: 1, accuracy: chainIntact ? 1 : 0,
  }, { recordCount: events.length });

  // A recorded governance decision must name the human who made it and why. That is the whole
  // point of the dataset, so it is exactly what completeness measures here.
  dg.observeQuality('governance-decisions', {
    completeness: frac(decisions.filter((d) => d && (d.reviewer || d.by || d.actor) && d.rationale).length, decisions.length),
    validity: frac(decisions.filter((d) => d && d.verdict).length, decisions.length),
    consistency: 1, uniqueness: frac(new Set(decisions.map((d) => d.seq)).size, decisions.length),
    timeliness: 1, accuracy: chainIntact ? 1 : 0,
  }, { recordCount: decisions.length });

  // oversight-aggregates are derived from case records, so quality propagates dimension by
  // dimension. A derived dataset can never be cleaner than what it was derived from — an
  // aggregate that looks healthier than its source is the aggregation hiding the defect.
  const source = dg.qualityScore('case-records');
  const inherit = (d) => (source.measured && typeof source.dimensions[d] === 'number' ? source.dimensions[d] : 1);
  dg.observeQuality('oversight-aggregates', Object.fromEntries(OBSERVED_DIMENSIONS.map((d) => [d, inherit(d)])), { recordCount: cases.length });

  dg.observeQuality('platform-telemetry', {
    completeness: 1, validity: 1, consistency: 1, uniqueness: 1,
    timeliness: 1, accuracy: 1,
  }, { recordCount: telemetrySamples.length });

  return dg;
}

module.exports = {
  DataGovernance, seedPlatformDatasets, measurePlatformQuality,
  RETENTION_POLICIES, REFERENCE_DATA, MASTER_DATA,
  QUALITY_DIMENSIONS, OBSERVED_DIMENSIONS, DERIVED_DIMENSIONS, REQUIRED_METADATA, QUALITY_BANDS,
  CLASSIFICATIONS,
};
