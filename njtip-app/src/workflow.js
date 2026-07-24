'use strict';
// NJTIP v1.0 MVP — the complete vertical slice:
//   Citizen → Anonymous Report → Policy Validation → Evidence Store → Audit Chain →
//   Investigator Review → Oversight Dashboard → Governance Decision → Evidence Generation.
// It composes the Twin's validated domain modules and exercises EVERY major subsystem.
// Deterministic given {clock, seed}; identity is impossible to store by construction.
const path = require('node:path');
const {
  ZONES, ReportStore, IdentityMinimizationError, EvidenceStore, AuditLog, IAM, ThresholdCustody, RecipientDirectory,
  PolicyEngine, GovernanceLedger, signing, hash, rng,
} = require('./twin');

// Map report categories to the subject unit (for conflict-of-interest routing).
const SUBJECT_UNIT = { police: 'police', courts: 'courts', prosecution: 'prosecution', prison: 'prison', official: 'official', regulatory: 'regulatory', other: 'other' };

class Workflow {
  constructor({ clock, seed = 1, ledgerFile } = {}) {
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
    this._status = new Map(); // case_code -> lifecycle status (independent zone projection)

    // Policy: default-deny; explicitly allow the citizen-facing safe actions.
    this.policy.addRule({ action: 'submit-report', effect: 'allow' });
    this.policy.addRule({ action: 'get-status', effect: 'allow' });
    this.policy.addRule({ action: 'attach-evidence', effect: 'allow' });

    // Signed, conflict-of-interest-aware recipient directory.
    this.recipients.add('dcec', 'dcec', ['police']);
    this.recipients.add('ombudsman', 'ombudsman', ['courts', 'prosecution']);
    this.recipients.add('judicial-oversight', 'judicial-oversight', ['official']);
    this.recipients.sign();

    // A pre-registered investigator principal (phishing-resistant auth).
    this.iam.addPrincipal('inv-001', { roles: ['investigate'], mfa: 'fido2', zone: ZONES.EXECUTIVE });
    this.audit.anchor();
  }

  _caseCode() {
    return 'NJ-' + Math.floor(this._rand() * 1e12).toString(36).toUpperCase().padStart(8, '0');
  }

  // 1) Citizen submits an anonymous report. Policy-validated; identity is rejected by
  //    the store; conflict-of-interest routing selects an unconflicted recipient.
  submitReport({ category, content, extra }) {
    const decision = this.policy.evaluate({ action: 'submit-report' });
    if (decision.effect !== 'allow') throw httpError(403, 'submit not permitted');
    if (!SUBJECT_UNIT[category]) throw httpError(400, 'invalid category');
    const case_code = this._caseCode();
    // The store enforces no-identity; pass through any extra fields so an accidental
    // identity field is REJECTED (defense in depth), not silently dropped.
    try {
      this.report.submit(Object.assign({ case_code, category, content }, extra || {}));
    } catch (e) {
      if (e instanceof IdentityMinimizationError) throw httpError(400, 'identity fields are not accepted (data minimization)');
      throw e;
    }
    const routed = this.recipients.route(SUBJECT_UNIT[category]);
    this._status.set(case_code, { status: 'received', category, recipient: routed.recipientId, coi: routed.coiStatus });
    this.audit.append({ actor: 'citizen(anon)', action: 'report-submitted', purpose: 'intake', zone: ZONES.INDEPENDENT });
    this.audit.append({ actor: 'system', action: 'report-routed', purpose: routed.recipientId, zone: ZONES.INDEPENDENT });
    return { case_code, recipient: routed.recipientId, coi: routed.coiStatus };
  }

  // 2) Anonymous status retrieval (no identifier required beyond the case code).
  status(case_code) {
    const s = this._status.get(case_code);
    return s ? { case_code, status: s.status } : null;
  }

  // 3) Secure evidence submission → evidence store + chain of custody + audit.
  attachEvidence({ case_code, content }) {
    if (!this._status.get(case_code)) throw httpError(404, 'unknown case');
    const id = 'EV-' + case_code + '-' + this.evidence._custody.length;
    const res = this.evidence.ingest({ id, actor: 'citizen(anon)', role: 'submitter', content, matter: case_code });
    this.audit.append({ actor: 'citizen(anon)', action: 'evidence-ingested', purpose: res.contentHash, zone: ZONES.EXECUTIVE });
    return { evidenceId: id, contentHash: res.contentHash };
  }

  // 4) Investigator review — requires JIT, phishing-resistant, matter-scoped authorization.
  investigatorReview({ principal, case_code, note, disposition }) {
    if (!this._status.get(case_code)) throw httpError(404, 'unknown case');
    // Zero standing privilege: obtain a just-in-time, time-boxed grant, then decide.
    this.iam.grant({ principal, action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: case_code, ttlMs: 3600_000 });
    const decision = this.iam.decide({ principal, action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: case_code });
    if (!decision.allow) throw httpError(403, 'not authorized: ' + decision.reason);
    const s = this._status.get(case_code);
    s.status = disposition === 'escalate' ? 'escalated' : 'reviewed';
    s.disposition = disposition;
    this.audit.append({ actor: principal, action: 'investigator-review', purpose: disposition || 'note', zone: ZONES.EXECUTIVE });
    return { case_code, status: s.status };
  }

  // 5) Oversight dashboard — non-attributable AGGREGATES only (no case content, no identity).
  oversightDashboard() {
    const byStatus = {};
    for (const s of this._status.values()) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    return {
      totalReports: this._status.size,
      byStatus,
      auditIntegrity: this.audit.verifyIntegrity().ok,
      evidenceCustodyIntegrity: this.evidence.verifyCustodyChain().ok,
      note: 'Aggregate, non-attributable. No case content or identity is exposed.',
    };
  }

  // 6) Governance decision — a HUMAN decision is recorded. NEVER automated.
  governanceDecision({ reviewer, role, subject, verdict, rationale }) {
    const entry = this.ledger.record({ reviewer, role, decisionType: 'readiness', subject, verdict, rationale });
    this.audit.append({ actor: reviewer, action: 'governance-decision', purpose: verdict, zone: ZONES.INDEPENDENT });
    return { recorded: true, seq: entry.record.seq, decidedBy: reviewer };
  }

  // 7) Evidence generation for the workflow run (deterministic given seed+clock).
  generateEvidence() {
    const core = {
      totalReports: this._status.size,
      statuses: [...this._status.values()].map((s) => s.status).sort(),
      auditLength: this.audit.entries().length,
      auditIntegrity: this.audit.verifyIntegrity().ok,
      custodyIntegrity: this.evidence.verifyCustodyChain().ok,
      governanceDecisions: this.ledger.history().length,
    };
    const digest = hash.sha256(core);
    return { core, digest, signature: signing.sign(digest), note: 'Workflow evidence. Deterministic given identical seeded inputs. Evidence ≠ authorization.' };
  }
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { Workflow, httpError, SUBJECT_UNIT };
