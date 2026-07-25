'use strict';
// NJTIP v1.1 MVP → production-shaped vertical slice:
//   Citizen → Anonymous Report → Policy Validation → Evidence Store → Audit Chain →
//   Investigator Review → Oversight Dashboard → Governance Decision → Evidence Generation.
// Composes the Twin's validated domain modules behind injected PORTS (status repo,
// notifications) so production adapters replace synthetic ones without changing logic.
// Deterministic given {clock, seed}; identity is impossible to store by construction.
const path = require('node:path');
const {
  ZONES, ReportStore, IdentityMinimizationError, EvidenceStore, AuditLog, IAM, ThresholdCustody, RecipientDirectory,
  PolicyEngine, GovernanceLedger, signing, hash, rng,
} = require('./twin');
const { MemoryStore } = require('./adapters/store');
const { NotificationService } = require('./adapters/notifications');
const caseLifecycle = require('./domain/case-lifecycle');
const evidenceLifecycle = require('./domain/evidence-lifecycle');
const investigation = require('./domain/investigation');
const analytics = require('./analytics');
const { SearchIndex } = require('./adapters/search');
const { CaseAggregate } = require('./eventsourcing/case-aggregate');
const { caseReadModel } = require('./eventsourcing/projections');

const SUBJECT_UNIT = { police: 'police', courts: 'courts', prosecution: 'prosecution', prison: 'prison', official: 'official', regulatory: 'regulatory', other: 'other' };
// Investigator roster (operational routing; distinct from IAM authorization). Each entry's
// unit is used for conflict-of-interest exclusion during assignment.
const DEFAULT_ROSTER = [
  { id: 'inv-001', unit: 'dcec' }, { id: 'inv-002', unit: 'ombudsman' },
  { id: 'inv-003', unit: 'judicial-oversight' }, { id: 'inv-004', unit: 'dcec' },
];

class Workflow {
  constructor({ clock, seed = 1, ledgerFile, statusRepo, notifications, metrics, workloadRepo, roster, events } = {}) {
    this.clock = clock || (() => Date.now());
    this._rand = rng.mulberry32(seed);
    this.report = new ReportStore(this.clock);
    this.evidence = new EvidenceStore(ZONES.EXECUTIVE, this.clock);
    this.audit = new AuditLog(this.clock);
    this.iam = new IAM(this.clock);
    this.threshold = new ThresholdCustody({ M: 3, custodians: ['c1', 'c2', 'c3', 'c4', 'c5'] });
    this.policy = new PolicyEngine();
    this.recipients = new RecipientDirectory();
    this.ledger = new GovernanceLedger(ledgerFile || path.join(__dirname, '..', 'data', 'governance-ledger.json'));
    // Injected ports (default: in-memory / synthetic reference).
    this._statusRepo = statusRepo || new MemoryStore(ZONES.INDEPENDENT);
    this.notifications = notifications || new NotificationService(new MemoryStore(ZONES.INDEPENDENT), this.clock);
    this._workload = workloadRepo || new MemoryStore(ZONES.EXECUTIVE);
    this._roster = roster || DEFAULT_ROSTER;
    this._events = events || null; // optional event store (Phase 11); additive, PII-free
    this._metrics = metrics || { inc() {}, observe() {} };

    this.policy.addRule({ action: 'submit-report', effect: 'allow' });
    this.policy.addRule({ action: 'get-status', effect: 'allow' });
    this.policy.addRule({ action: 'attach-evidence', effect: 'allow' });
    this.recipients.add('dcec', 'dcec', ['police']);
    this.recipients.add('ombudsman', 'ombudsman', ['courts', 'prosecution']);
    this.recipients.add('judicial-oversight', 'judicial-oversight', ['official']);
    this.recipients.sign();
    this.iam.addPrincipal('inv-001', { roles: ['investigate'], mfa: 'fido2', zone: ZONES.EXECUTIVE });
    this.audit.anchor();
  }

  _caseCode() { return 'NJ-' + Math.floor(this._rand() * 1e12).toString(36).toUpperCase().padStart(8, '0'); }

  // Append a PII-free domain event to the event store, if one is wired (Phase 11). Additive:
  // the read-model projection (statusRepo) is unaffected. Never carries identity/content.
  _emit(caseCode, type, data, actor = 'system') { if (this._events) try { this._events.append(caseCode, [{ type, data, meta: { actor } }]); } catch (_) { /* event store is additive; never blocks the workflow */ } }

  submitReport({ category, content, extra }) {
    if (this.policy.evaluate({ action: 'submit-report' }).effect !== 'allow') throw httpError(403, 'submit not permitted');
    if (!SUBJECT_UNIT[category]) throw httpError(400, 'invalid category');
    const case_code = this._caseCode();
    try {
      this.report.submit(Object.assign({ case_code, category, content }, extra || {}));
    } catch (e) {
      if (e instanceof IdentityMinimizationError) throw httpError(400, 'identity fields are not accepted (data minimization)');
      throw e;
    }
    const routed = this.recipients.route(SUBJECT_UNIT[category]);
    const createdAt = this.clock();
    const priority = investigation.scorePriority({ category, escalated: false, ageMs: 0 });
    this._statusRepo.put(case_code, { case_code, status: 'received', category, recipient: routed.recipientId, coi: routed.coiStatus, createdAt, stage: investigation.REVIEW_CHAIN[0], priority });
    this.audit.append({ actor: 'citizen(anon)', action: 'report-submitted', purpose: 'intake', zone: ZONES.INDEPENDENT });
    this.audit.append({ actor: 'system', action: 'report-routed', purpose: routed.recipientId, zone: ZONES.INDEPENDENT });
    this.notifications.notify(case_code, 'received', { status: 'received' });
    this._emit(case_code, 'CaseSubmitted', { category, recipient: routed.recipientId, stage: investigation.REVIEW_CHAIN[0] });
    this._metrics.inc('njtip_reports_total', { category });
    return { case_code, recipient: routed.recipientId, coi: routed.coiStatus };
  }

  status(case_code) { const s = this._statusRepo.get(case_code); return s ? { case_code, status: s.status } : null; }
  notificationsFor(case_code) { return this._statusRepo.get(case_code) ? this.notifications.forCase(case_code) : null; }

  attachEvidence({ case_code, content }) {
    const s = this._statusRepo.get(case_code);
    if (!s) throw httpError(404, 'unknown case');
    const id = 'EV-' + case_code + '-' + this.evidence._custody.length;
    const res = this.evidence.ingest({ id, actor: 'citizen(anon)', role: 'submitter', content, matter: case_code });
    // Track the item's evidentiary lifecycle state (durable, on the case projection).
    s.evidenceItems = s.evidenceItems || [];
    s.evidenceItems.push({ id, contentHash: res.contentHash, state: 'ingested' });
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: 'citizen(anon)', action: 'evidence-ingested', purpose: res.contentHash, zone: ZONES.EXECUTIVE });
    this.notifications.notify(case_code, 'evidence-received', { status: s.status });
    this._emit(case_code, 'EvidenceAttached', { contentHash: res.contentHash });
    this._metrics.inc('njtip_evidence_total');
    return { evidenceId: id, contentHash: res.contentHash, state: 'ingested' };
  }

  // Advance an evidence item through its handling lifecycle (seal/open/admit/exclude/purge),
  // rejecting illegal transitions by construction. Custody hashes remain the integrity proof.
  evidenceTransition({ case_code, evidenceId, event }) {
    const s = this._statusRepo.get(case_code);
    if (!s) throw httpError(404, 'unknown case');
    const item = (s.evidenceItems || []).find((e) => e.id === evidenceId);
    if (!item) throw httpError(404, 'unknown evidence');
    const r = evidenceLifecycle.apply(item.state, event);
    if (!r.ok) throw httpError(409, 'evidence lifecycle: ' + r.reason);
    item.state = r.to;
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: 'system', action: 'evidence-' + event, purpose: evidenceId, zone: ZONES.EXECUTIVE });
    this._metrics.inc('njtip_evidence_transitions_total', { event });
    return { evidenceId, state: item.state, allowed: evidenceLifecycle.allowedEvents(item.state) };
  }

  // Investigator queue (search/filter): non-identifying case metadata only.
  listReports({ category, status } = {}) {
    return this._statusRepo.values()
      .filter((s) => (!category || s.category === category) && (!status || s.status === status))
      .map((s) => ({ case_code: s.case_code, category: s.category, status: s.status, recipient: s.recipient }));
  }

  investigatorReview({ principal, case_code, note, disposition }) {
    const s = this._statusRepo.get(case_code);
    if (!s) throw httpError(404, 'unknown case');
    this.iam.grant({ principal, action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: case_code, ttlMs: 3600_000 });
    const decision = this.iam.decide({ principal, action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: case_code });
    if (!decision.allow) throw httpError(403, 'not authorized: ' + decision.reason);
    const target = disposition === 'escalate' ? 'escalated' : 'reviewed';
    // Guard the transition with the case state machine (idempotent re-review is a no-op).
    if (target !== s.status && !caseLifecycle.canTransition(s.status, target)) {
      throw httpError(409, `illegal case transition ${s.status} → ${target}`);
    }
    s.status = target;
    s.disposition = disposition;
    if (!s.firstReviewedAt) s.firstReviewedAt = this.clock(); // SLA: time-to-first-review
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: principal, action: 'investigator-review', purpose: disposition || 'note', zone: ZONES.EXECUTIVE });
    this.notifications.notify(case_code, 'reviewed', { status: s.status });
    this._emit(case_code, 'CaseReviewed', { status: s.status }, principal);
    this._metrics.inc('njtip_reviews_total', { disposition: disposition || 'note' });
    return { case_code, status: s.status };
  }

  // Case management: advance a case through its lifecycle (review/escalate/resolve/close),
  // rejecting illegal transitions. This is the general case-lifecycle capability behind the
  // investigator/oversight portals.
  transitionCase({ principal, case_code, event }) {
    const s = this._statusRepo.get(case_code);
    if (!s) throw httpError(404, 'unknown case');
    const r = caseLifecycle.apply(s.status, event);
    if (!r.ok) throw httpError(409, 'case lifecycle: ' + r.reason);
    s.status = r.to;
    if (r.to === 'resolved' && !s.resolvedAt) s.resolvedAt = this.clock(); // SLA: time-to-resolution
    if (r.to === 'escalated') s.priority = investigation.scorePriority({ category: s.category, escalated: true, ageMs: this.clock() - s.createdAt });
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: principal, action: 'case-' + event, purpose: r.to, zone: ZONES.EXECUTIVE });
    this.notifications.notify(case_code, r.to, { status: r.to });
    this._emit(case_code, 'CaseTransitioned', { event, to: r.to }, principal);
    this._metrics.inc('njtip_case_transitions_total', { event });
    return { case_code, status: s.status, allowed: caseLifecycle.allowedEvents(s.status) };
  }

  // --- Enterprise operational workflows (Phase 2) ---------------------------------

  // (Re)compute and persist the case priority (severity + escalation + ageing).
  prioritize(case_code) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    s.priority = investigation.scorePriority({ category: s.category, escalated: s.status === 'escalated', ageMs: this.clock() - s.createdAt });
    this._statusRepo.put(case_code, s);
    return { case_code, priority: s.priority };
  }

  // Assign a case to the least-loaded eligible investigator (conflict-of-interest excludes
  // the subject unit). Workload counts are durable so balancing is stable across restarts.
  assignCase({ case_code }) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    const loads = this._workload.get('loads') || {};
    const pick = investigation.assign({ roster: this._roster, loads, preferUnit: s.recipient });
    if (!pick) throw httpError(409, 'no eligible investigator (conflict-of-interest)');
    loads[pick.id] = (loads[pick.id] || 0) + 1;
    this._workload.put('loads', loads);
    s.assignee = pick.id;
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: 'system', action: 'case-assigned', purpose: pick.id, zone: ZONES.EXECUTIVE });
    this._emit(case_code, 'CaseAssigned', { assignee: pick.id });
    this._metrics.inc('njtip_assignments_total');
    return { case_code, assignee: pick.id, load: loads[pick.id] };
  }
  workloads() { return this._workload.get('loads') || {}; }

  // SLA status for a case (first-review + resolution due/breach), given the current clock.
  slaStatus(case_code) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    return investigation.slaStatus({ band: (s.priority || {}).band || 'P4', createdAt: s.createdAt, firstReviewedAt: s.firstReviewedAt, resolvedAt: s.resolvedAt, now: this.clock() });
  }

  // Multi-stage review chain: advance the case's review stage (intake→investigation→
  // oversight-review→decision). Independent of the lifecycle status; both are audited.
  advanceStage({ principal, case_code }) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    const next = investigation.nextStage(investigation.REVIEW_CHAIN, s.stage || investigation.REVIEW_CHAIN[0]);
    if (!next) throw httpError(409, 'already at the final review stage');
    s.stage = next;
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: principal, action: 'stage-advanced', purpose: next, zone: ZONES.EXECUTIVE });
    this._emit(case_code, 'StageAdvanced', { stage: next }, principal);
    return { case_code, stage: s.stage };
  }

  // File an appeal against a resolved/closed case. Appeals do NOT mutate the closed case
  // (immutable history); they create a linked appeal record entering the appeal chain.
  fileAppeal({ case_code, by, reason }) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    if (!['resolved', 'closed'].includes(s.status)) throw httpError(409, 'only resolved or closed cases may be appealed');
    if (!by || !reason) throw httpError(400, 'an accountable appellant and a reason are required');
    s.appeal = { by, stage: investigation.APPEAL_CHAIN[0], filedAt: this.clock() };
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: by, action: 'appeal-filed', purpose: investigation.APPEAL_CHAIN[0], zone: ZONES.INDEPENDENT });
    this._emit(case_code, 'AppealFiled', { stage: investigation.APPEAL_CHAIN[0] }, by);
    this._metrics.inc('njtip_appeals_total');
    return { case_code, appeal: s.appeal };
  }

  // Retention plan for a case (disposition date + action) based on outcome; legal hold at
  // the object store overrides purge. Read-only planning — never auto-purges.
  retentionPlan(case_code) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    const outcome = s.disposition === 'escalate' ? 'escalated' : (s.status === 'resolved' ? 'resolved' : s.status);
    return { case_code, ...investigation.retentionFor({ outcome, decidedAt: s.resolvedAt || s.createdAt }) };
  }

  // --- Search & analytics (Phase 3): privacy-preserving, non-attributable --------

  // Build a fresh search index from the durable projection (always consistent with the
  // store regardless of persistence backend). Indexes non-identifying fields only.
  _searchIndex() {
    const idx = new SearchIndex();
    for (const s of this._statusRepo.values()) {
      idx.index({ case_code: s.case_code, category: s.category, status: s.status, stage: s.stage, recipient: s.recipient, band: (s.priority || {}).band });
    }
    return idx;
  }
  searchCases(query, opts) { return this._searchIndex().search(query, opts); }
  // Semantic search (Phase 30): concept-expanded, intent-aware, explainable — over the same
  // privacy-preserving index (identity never participates).
  semanticSearch(query, opts) { const { SemanticSearch } = require('./search/semantic'); return new SemanticSearch(this._searchIndex()).search(query, opts); }

  // Enrich rows with derived, non-identifying analytics fields (SLA breach + band).
  _analyticsRows() {
    const now = this.clock();
    return this._statusRepo.values().map((s) => ({
      case_code: s.case_code, category: s.category, status: s.status, stage: s.stage, recipient: s.recipient,
      createdAt: s.createdAt, firstReviewedAt: s.firstReviewedAt, priority: s.priority,
      slaBreached: investigation.slaStatus({ band: (s.priority || {}).band || 'P4', createdAt: s.createdAt, firstReviewedAt: s.firstReviewedAt, resolvedAt: s.resolvedAt, now }).breached,
    }));
  }
  analytics({ by = 'category' } = {}) {
    const rows = this._analyticsRows();
    return {
      kpis: analytics.kpis(rows, this.clock()),
      aggregate: analytics.aggregate(rows, { by }),
      trends: analytics.trends(rows, { field: 'status' }),
      note: 'Aggregate, non-attributable. Small cells suppressed (k-anonymity). No identity or content.',
    };
  }
  caseTimeline(case_code) {
    const s = this._statusRepo.get(case_code); if (!s) throw httpError(404, 'unknown case');
    return analytics.timeline(s, this.audit.entries());
  }
  // Executive intelligence scorecard (Phase 21): governance-level, privacy-preserving.
  executiveScorecard() { return analytics.executiveScorecard(this._analyticsRows(), this.clock()); }
  exportCases({ format = 'json', filter = {} } = {}) {
    const rows = analytics.filter(this._analyticsRows(), filter);
    return analytics.exportRows(rows, { format });
  }

  // --- Event sourcing & CQRS (Phase 11): read-side/replay over the immutable log --------

  caseEvents(case_code) { return this._events ? this._events.readStream(case_code).map((e) => ({ type: e.type, version: e.version, at: e.meta.at, data: e.data })) : []; }
  // Replay a case from its events (event sourcing) → derived state, independent of the
  // read-model. Proves the read model and the event log agree.
  replayCase(case_code) {
    if (!this._events) return null;
    const agg = new CaseAggregate(case_code).loadFromHistory(this._events.readStream(case_code));
    return agg.state();
  }
  // Rebuild the entire case read model from events (CQRS projection rebuild / time-travel).
  rebuildReadModel({ untilAt } = {}) {
    if (!this._events) return [];
    const events = this._events.readAll(untilAt != null ? { untilAt } : {});
    return [...caseReadModel(events).values()];
  }
  // Event-log tamper-evidence (hash chain) — used by health + fitness.
  verifyEventIntegrity() { return this._events ? this._events.verifyChain() : { ok: true, length: 0, note: 'no event store wired' }; }

  // Process mining (Phase 56): discover the process model + performance from the event log.
  mineProcess() {
    const pm = require('./orchestration/process-mining');
    const events = this._events ? this._events.readAll() : [];
    return { discovery: pm.discover(events), bottlenecks: pm.bottlenecks(events), performance: pm.performance(events), recommendations: pm.recommendations(events) };
  }

  oversightDashboard({ category } = {}) {
    const rows = this._statusRepo.values().filter((s) => !category || s.category === category);
    const byStatus = {}; const byCategory = {};
    for (const s of rows) { byStatus[s.status] = (byStatus[s.status] || 0) + 1; byCategory[s.category] = (byCategory[s.category] || 0) + 1; }
    return {
      totalReports: rows.length, byStatus, byCategory,
      auditIntegrity: this.audit.verifyIntegrity().ok,
      evidenceCustodyIntegrity: this.evidence.verifyCustodyChain().ok,
      note: 'Aggregate, non-attributable. No case content or identity is exposed.',
    };
  }

  governanceDecision({ reviewer, role, subject, verdict, rationale }) {
    const entry = this.ledger.record({ reviewer, role, decisionType: 'readiness', subject, verdict, rationale });
    this.audit.append({ actor: reviewer, action: 'governance-decision', purpose: verdict, zone: ZONES.INDEPENDENT });
    this._metrics.inc('njtip_governance_decisions_total');
    return { recorded: true, seq: entry.record.seq, decidedBy: reviewer };
  }

  generateEvidence() {
    const core = {
      totalReports: this._statusRepo.size(),
      statuses: this._statusRepo.values().map((s) => s.status).sort(),
      auditLength: this.audit.entries().length,
      auditIntegrity: this.audit.verifyIntegrity().ok,
      custodyIntegrity: this.evidence.verifyCustodyChain().ok,
      governanceDecisions: this.ledger.history().length,
      notifications: this.notifications.count(),
    };
    const digest = hash.sha256(core);
    return { core, digest, signature: signing.sign(digest), note: 'Workflow evidence. Deterministic given identical seeded inputs. Evidence ≠ authorization.' };
  }
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { Workflow, httpError, SUBJECT_UNIT };
