'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

const NOOP_METRICS = { inc() {} };

/**
 * Configuration governance (Phase 1). An auditable, policy-driven change
 * management layer IN FRONT OF the ConfigService control plane. It classifies
 * every key by operational risk and enforces an approval workflow scaled to
 * that risk, without changing ConfigService (which stays the low-level
 * primitive used by appliers, the kill switch, and scheduling).
 *
 *   critical (breakers, retry budgets, bulkheads, load shedding)
 *   high     (OTLP export, health thresholds)
 *   medium   (observability tuning, telemetry batching)
 *   low      (informational)
 *
 * Policy per tier: how many approvals, and whether an approver must be distinct
 * from the proposer. A change carrying enough approvals APPLIES automatically
 * (via config.set), producing a full, forensic change record: who/when/why,
 * previous & new value, rollback reference (the config revision), the approval
 * chain, and the services the key affects.
 *
 * Additive: `platform.config.set()` still works for programmatic/low-level use;
 * governance is the policy path the admin API routes through.
 */
const DEFAULT_POLICY = {
  critical: { approvals: 2, distinctApprover: true },
  high: { approvals: 1, distinctApprover: true },
  medium: { approvals: 0, distinctApprover: false },
  low: { approvals: 0, distinctApprover: false },
};
const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

class ConfigGovernance {
  constructor({ config, identity = null, clock, metrics = null, policy = {}, approverRole = 'platform_admin' } = {}) {
    this.config = config;
    this.identity = identity; // for RBAC (requireRole); null → routes already gate
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    this.policy = {};
    for (const tier of RISK_ORDER) this.policy[tier] = { ...DEFAULT_POLICY[tier], ...(policy[tier] || {}) };
    this.approverRole = approverRole;
    this.risk = new Map(); // key -> { risk, affects[] }
    this.changes = new Map(); // changeId -> change record
    this.log = []; // append-only governance log (ids in order)
  }

  /** Classify a key's operational risk and the services it affects. */
  classify(key, { risk = 'medium', affects = [] } = {}) {
    if (!RISK_ORDER.includes(risk)) throw err('INVALID_ARGUMENT', `risk must be one of ${RISK_ORDER.join('|')}`);
    this.risk.set(key, { risk, affects });
    return { key, risk, affects };
  }

  riskOf(key) {
    return (this.risk.get(key) || { risk: 'medium', affects: [] }).risk;
  }

  _rbac(actor, action) {
    if (!this.identity || !actor) return; // route-level auth already enforced
    // Any platform admin may propose/approve; a distinct-approver rule (below)
    // is what enforces separation of duties for high-risk changes.
    this.identity.requireRole(actor, this.approverRole, 'platform');
    void action;
  }

  /**
   * Request a configuration change. Low/medium (0 approvals) apply immediately;
   * high/critical create a PENDING change awaiting the approval chain.
   * @returns the change record.
   */
  request(key, value, { actor = 'system', justification = null, expireAt = null } = {}) {
    this.config._def(key); // NOT_FOUND if unknown
    if (!justification && this.riskOf(key) !== 'low') {
      throw err('INVALID_ARGUMENT', 'a justification is required for medium+ risk changes');
    }
    this._rbac(actor, 'propose');
    const meta = this.risk.get(key) || { risk: 'medium', affects: [] };
    const policy = this.policy[meta.risk];
    const change = {
      id: id('cchg'),
      key,
      from: this.config.get(key),
      to: value,
      risk: meta.risk,
      affects: meta.affects,
      actor,
      justification,
      status: 'pending',
      required_approvals: policy.approvals,
      distinct_approver: policy.distinctApprover,
      approvals: [],
      rollback_ref: null, // set to the config revision on apply
      expire_at: expireAt ? this.clock.nowIso() : null,
      created_at: this.clock.nowIso(),
      applied_at: null,
    };
    this.changes.set(change.id, change);
    this.log.push(change.id);
    this.metrics.inc('motse_config_governance_total', { risk: meta.risk, event: 'requested' });
    if (policy.approvals === 0) this._apply(change, actor, 'auto');
    return this._public(change);
  }

  /** Approve a pending change. Applies it once the required approvals are met. */
  approve(changeId, approver, { note = null } = {}) {
    const change = this._change(changeId);
    if (change.status !== 'pending') throw err('STATE_CONFLICT', `change is ${change.status}`);
    this._rbac(approver, 'approve');
    if (change.distinct_approver && approver === change.actor) {
      throw err('PERMISSION_DENIED', 'separation of duties: the proposer cannot approve this change');
    }
    if (change.approvals.some((a) => a.by === approver)) {
      throw err('STATE_CONFLICT', 'this approver has already approved');
    }
    change.approvals.push({ by: approver, at: this.clock.nowIso(), note });
    this.metrics.inc('motse_config_governance_total', { risk: change.risk, event: 'approved' });
    if (change.approvals.length >= change.required_approvals) this._apply(change, approver, 'approved');
    return this._public(change);
  }

  reject(changeId, approver, { reason = null } = {}) {
    const change = this._change(changeId);
    if (change.status !== 'pending') throw err('STATE_CONFLICT', `change is ${change.status}`);
    this._rbac(approver, 'reject');
    change.status = 'rejected';
    change.rejected_by = approver;
    change.reject_reason = reason;
    change.resolved_at = this.clock.nowIso();
    this.metrics.inc('motse_config_governance_total', { risk: change.risk, event: 'rejected' });
    return this._public(change);
  }

  _apply(change, by, how) {
    this.config.set(change.key, change.to, {
      actor: change.actor,
      reason: `governed change ${change.id} (${how} by ${by}): ${change.justification || ''}`.trim(),
    });
    const revs = this.config.history(change.key);
    // set() always appends a revision, so revs is non-empty here.
    change.rollback_ref = revs[revs.length - 1].rev;
    change.status = 'applied';
    change.applied_at = this.clock.nowIso();
    change.applied_by = by;
    this.metrics.inc('motse_config_governance_total', { risk: change.risk, event: 'applied' });
  }

  /** Roll a governed change back to its recorded prior revision. */
  rollbackChange(changeId, actor) {
    const change = this._change(changeId);
    if (change.status !== 'applied' || change.rollback_ref == null) {
      throw err('STATE_CONFLICT', 'only an applied change with a rollback reference can be rolled back');
    }
    this._rbac(actor, 'rollback');
    this.config.rollback(change.key, change.rollback_ref, { actor });
    // The rollback restores the value AFTER this change; to revert THIS change
    // we set back to its `from`. Use the explicit prior value for correctness.
    this.config.set(change.key, change.from, { actor, reason: `revert governed change ${change.id}` });
    change.status = 'rolled_back';
    change.reverted_at = this.clock.nowIso();
    change.reverted_by = actor;
    this.metrics.inc('motse_config_governance_total', { risk: change.risk, event: 'rolled_back' });
    return this._public(change);
  }

  pending() {
    return [...this.changes.values()].filter((c) => c.status === 'pending').map((c) => this._public(c));
  }

  /** Full forensic history (most recent first). */
  history({ limit = 100 } = {}) {
    return this.log.slice(-limit).reverse().map((cid) => this._public(this.changes.get(cid)));
  }

  /** The governance policy + per-key risk classification (compliance view). */
  policyReport() {
    return {
      policy: this.policy,
      approver_role: this.approverRole,
      classified_keys: [...this.risk.entries()].map(([key, m]) => ({ key, ...m })),
    };
  }

  _change(id_) {
    const change = this.changes.get(id_);
    if (!change) throw err('NOT_FOUND', `no change ${id_}`);
    return change;
  }

  _public(c) { return { ...c }; }
}

module.exports = { ConfigGovernance, DEFAULT_POLICY, RISK_ORDER };
