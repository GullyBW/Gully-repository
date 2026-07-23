'use strict';
// Break-glass / emergency privilege (blueprint phase3/06, design/07 §3).
// Emergency access is JIT, DUAL-CONTROLLED, time-boxed, reason-coded, and loudly
// audited. There is no un-approved path. Abuse (single approver, no reason, reuse
// after expiry) is rejected — enabling the "abuse of emergency privileges" sims.
class EmergencyAccess {
  constructor(audit, clock, { minApprovers = 2 } = {}) {
    this._audit = audit;
    this._clock = clock;
    this._minApprovers = minApprovers;
    this._grants = [];
  }

  request({ operation, principal, approvals = [], reason, ttlMs = 900_000 }) {
    const distinct = new Set(approvals);
    if (!reason) throw new Error('emergency access requires a reason code');
    if (distinct.size < this._minApprovers) {
      const e = new Error(`break-glass needs ${this._minApprovers} distinct approvers (got ${distinct.size})`);
      e.code = 'DUAL_CONTROL_REQUIRED';
      throw e;
    }
    if (!ttlMs || ttlMs <= 0) throw new Error('emergency grant must be time-boxed');
    const grant = { operation, principal, approvers: [...distinct], reason, expires: this._clock() + ttlMs };
    this._grants.push(grant);
    this._audit.append({ actor: principal, action: `break-glass:${operation}`, purpose: reason, zone: 'independent' });
    return grant;
  }

  isActive(operation, principal) {
    const now = this._clock();
    return this._grants.some((g) => g.operation === operation && g.principal === principal && g.expires > now);
  }

  activeGrants() {
    const now = this._clock();
    return this._grants.filter((g) => g.expires > now);
  }
}

module.exports = { EmergencyAccess };
