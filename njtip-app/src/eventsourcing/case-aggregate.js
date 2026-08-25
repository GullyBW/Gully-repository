'use strict';
// CaseAggregate (Phase 11) — the case bounded context expressed as an event-sourced
// aggregate. It mirrors the EXISTING workflow's case state (no business-logic change); the
// workflow raises these events so the event log becomes the immutable source of truth while
// the read-model projection keeps serving queries (CQRS). Events carry NO identity/content.
//
// Domain events: CaseSubmitted, EvidenceAttached, CaseReviewed, CaseTransitioned,
// CaseAssigned, StageAdvanced, AppealFiled.
const { Aggregate } = require('./aggregate');

// Canonical event type constants (stable contract for consumers/projections).
const EVENTS = {
  CaseSubmitted: 'CaseSubmitted', EvidenceAttached: 'EvidenceAttached', CaseReviewed: 'CaseReviewed',
  CaseTransitioned: 'CaseTransitioned', CaseAssigned: 'CaseAssigned', StageAdvanced: 'StageAdvanced', AppealFiled: 'AppealFiled',
};

class CaseAggregate extends Aggregate {
  constructor(caseCode) { super(caseCode); this.status = null; this.category = null; this.recipient = null; this.stage = null; this.evidenceCount = 0; this.assignee = null; this.appealed = false; }

  onCaseSubmitted(d) { this.status = 'received'; this.category = d.category ?? null; this.recipient = d.recipient ?? null; this.stage = d.stage ?? null; }
  onEvidenceAttached() { this.evidenceCount += 1; }
  onCaseReviewed(d) { this.status = d.status; }
  onCaseTransitioned(d) { this.status = d.to; }
  onCaseAssigned(d) { this.assignee = d.assignee; }
  onStageAdvanced(d) { this.stage = d.stage; }
  onAppealFiled() { this.appealed = true; }

  // Non-identifying snapshot of the derived state.
  state() { return { caseCode: this.id, status: this.status, category: this.category, recipient: this.recipient, stage: this.stage, evidenceCount: this.evidenceCount, assignee: this.assignee, appealed: this.appealed, version: this.version }; }
}

module.exports = { CaseAggregate, EVENTS };
