'use strict';
// Governance-as-a-subsystem (blueprint DDR-10, D-01, threats E-1/I-1/T-4).
// - Threshold (M-of-N) custody: any de-anon-capable or safety-override operation
//   requires M distinct independent custodian approvals. No single operator can act.
// - Signed recipient directory + conflict-of-interest routing (T-4, P7).

class ThresholdCustody {
  constructor({ M, custodians }) {
    this.M = M;
    this.N = custodians.length;
    this._custodians = new Set(custodians);
    if (this.M > this.N) throw new Error('M cannot exceed N');
  }

  // Authorize a guarded operation. Throws unless >= M DISTINCT valid custodians approve.
  authorize(operation, approvals = []) {
    const distinct = new Set(approvals.filter((a) => this._custodians.has(a)));
    if (distinct.size < this.M) {
      const err = new Error(
        `threshold not met for "${operation}": ${distinct.size}/${this.M} distinct custodians`
      );
      err.code = 'THRESHOLD_NOT_MET';
      throw err;
    }
    return { operation, approvedBy: [...distinct], ok: true };
  }
}

class RecipientDirectory {
  constructor() {
    this._entries = new Map(); // recipientId -> { unit, conflicts: [caseSubjectUnit...] }
    this.signed = false;
  }

  add(recipientId, unit, conflicts = []) {
    this._entries.set(recipientId, { unit, conflicts });
  }

  sign() {
    this.signed = true; // in production this is a governance threshold signature
    return this;
  }

  // Conflict-of-interest-aware routing: never route a report to a recipient whose
  // unit is (or conflicts with) the subject unit. Returns an unconflicted recipient.
  route(subjectUnit) {
    if (!this.signed) throw new Error('recipient directory not signed (T-4 guard)');
    for (const [id, e] of this._entries) {
      const conflicted = e.unit === subjectUnit || e.conflicts.includes(subjectUnit);
      if (!conflicted) return { recipientId: id, coiStatus: 'clear' };
    }
    return { recipientId: null, coiStatus: 'no-unconflicted-recipient' };
  }
}

module.exports = { ThresholdCustody, RecipientDirectory };
