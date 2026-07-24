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

const SUBJECT_UNIT = { police: 'police', courts: 'courts', prosecution: 'prosecution', prison: 'prison', official: 'official', regulatory: 'regulatory', other: 'other' };

class Workflow {
  constructor({ clock, seed = 1, ledgerFile, statusRepo, notifications, metrics } = {}) {
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
    this._statusRepo.put(case_code, { case_code, status: 'received', category, recipient: routed.recipientId, coi: routed.coiStatus });
    this.audit.append({ actor: 'citizen(anon)', action: 'report-submitted', purpose: 'intake', zone: ZONES.INDEPENDENT });
    this.audit.append({ actor: 'system', action: 'report-routed', purpose: routed.recipientId, zone: ZONES.INDEPENDENT });
    this.notifications.notify(case_code, 'received', { status: 'received' });
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
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: principal, action: 'investigator-review', purpose: disposition || 'note', zone: ZONES.EXECUTIVE });
    this.notifications.notify(case_code, 'reviewed', { status: s.status });
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
    this._statusRepo.put(case_code, s);
    this.audit.append({ actor: principal, action: 'case-' + event, purpose: r.to, zone: ZONES.EXECUTIVE });
    this.notifications.notify(case_code, r.to, { status: r.to });
    this._metrics.inc('njtip_case_transitions_total', { event });
    return { case_code, status: s.status, allowed: caseLifecycle.allowedEvents(s.status) };
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
