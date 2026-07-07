'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');
const { IdentityPlane } = require('./identity.plane');

/**
 * Policy Decision Kernel (DPI governed plane #2). A central, STATELESS,
 * DETERMINISTIC decision engine. Every authorization decision on the
 * platform flows through `decide()`; nothing else evaluates access.
 *
 *   decide({ assertion, tenant, resource, action, context, riskScore })
 *     → { decision: 'ALLOW' | 'DENY' | 'STEP_UP_AUTH', reason, obligations, ... }
 *
 * Guarantees:
 *   - deterministic: same inputs → same decision (rules are pure);
 *   - deny-by-default (Zero Trust): no matching ALLOW ⇒ DENY;
 *   - deny-overrides: any DENY short-circuits and wins;
 *   - fully auditable: every decision is appended to the audit chain and
 *     published as a `policy.decided` event (→ Event Store, Audit Graph).
 *
 * The kernel itself holds no mutable domain state — it reads only the
 * identity assertion and the resource descriptor handed to it (the Policy
 * Information Point is the caller's job), so it is trivially replicable per
 * cell and horizontally scalable.
 */
const DECISIONS = { ALLOW: 'ALLOW', DENY: 'DENY', STEP_UP_AUTH: 'STEP_UP_AUTH' };

// Actions that change state or move value — never permitted anonymously.
const MUTATING = /(\.|^)(write|create|update|delete|mutate|pay|transfer|capture|refund|revoke|grant)/i;
// Actions sensitive enough to demand step-up when risk is elevated.
const SENSITIVE = /(pay|transfer|capture|refund|payout|grant|revoke|cell\.|admin)/i;

class PolicyKernel {
  constructor({ clock, audit, bus, riskStepUpThreshold = 70 } = {}) {
    this.clock = clock;
    this.audit = audit;
    this.bus = bus;
    this.riskStepUpThreshold = riskStepUpThreshold;
    this.rules = []; // ordered; deny-producing rules first
    if (bus) bus.register('policy.decided', 1, ['policy_decision_id', 'decision']);
    this._registerDefaultRules();
  }

  /** Register a deterministic rule: (input, kernel) => Ruling | null (abstain). */
  register(name, fn) {
    this.rules.push({ name, fn });
    return this;
  }

  /**
   * The single decision entrypoint. Pure w.r.t. the decision; the only
   * side effects are the audit + event records of the decision itself.
   */
  decide({ assertion, tenant = 'motse', resource = null, action, context = {}, riskScore = 0 } = {}) {
    if (!action) throw err('INVALID_ARGUMENT', 'action is required');
    const input = {
      assertion: assertion || { subject: null, authenticated: false, level: 'L0', roles: [], tenant, suspended: false },
      tenant,
      resource: resource || null,
      action,
      context,
      riskScore,
    };

    const evaluated = [];
    let decision = DECISIONS.DENY; // deny-by-default
    let reason = 'default_deny';
    const obligations = [];

    for (const rule of this.rules) {
      const ruling = rule.fn(input, this);
      if (!ruling) continue; // abstain
      evaluated.push({ rule: rule.name, decision: ruling.decision, reason: ruling.reason });
      if (ruling.decision === DECISIONS.DENY) {
        decision = DECISIONS.DENY;
        reason = ruling.reason;
        break; // deny-overrides: short-circuit
      }
      if (ruling.decision === DECISIONS.STEP_UP_AUTH) {
        decision = DECISIONS.STEP_UP_AUTH;
        reason = ruling.reason;
        if (ruling.obligations) obligations.push(...ruling.obligations);
        continue; // a later DENY can still override; ALLOW cannot downgrade a step-up
      }
      if (ruling.decision === DECISIONS.ALLOW && decision !== DECISIONS.STEP_UP_AUTH) {
        decision = DECISIONS.ALLOW;
        reason = ruling.reason;
      }
    }

    const record = {
      policy_decision_id: id('pdk'),
      decision,
      reason,
      action,
      tenant,
      subject: input.assertion.subject || null,
      resource: resource ? (resource.id || resource.ref || String(resource)) : null,
      risk_score: riskScore,
      correlation_id: context.correlationId || null,
      causation_id: context.causationId || null,
      evaluated,
      obligations,
      at: this.clock.nowIso(),
    };

    if (this.audit) {
      this.audit.append(record.subject || 'anonymous', 'policy.decided', `policy:${record.policy_decision_id}`, null, {
        decision, action, reason, tenant,
      });
    }
    if (this.bus) {
      this.bus.publish('policy.decided', {
        policy_decision_id: record.policy_decision_id,
        decision, action, tenant, reason,
        subject: record.subject, resource: record.resource,
        correlation_id: record.correlation_id, causation_id: record.causation_id,
        plane: 'policy', stream_id: `policy:${record.policy_decision_id}`,
      });
    }
    return record;
  }

  /** True iff a decision permits the action to proceed. */
  static permits(decision) {
    return decision.decision === DECISIONS.ALLOW;
  }

  // ── Default DPI policy set (deterministic, ordered) ─────────────────

  _registerDefaultRules() {
    const R = DECISIONS;

    // 1. Suspended subjects are denied everything (deny-overrides, first).
    this.register('suspended_subject', ({ assertion }) =>
      assertion.suspended ? { decision: R.DENY, reason: 'subject_suspended' } : null);

    // 2. Tenant isolation — no implicit cross-tenant access (multi-tenant).
    this.register('tenant_isolation', ({ assertion, tenant, resource }) => {
      if (resource && resource.tenant && resource.tenant !== tenant) {
        return { decision: R.DENY, reason: 'cross_tenant_resource' };
      }
      // An authenticated subject bound to another tenant cannot act here,
      // unless they are a platform operator (cross-tenant by grant).
      if (assertion.authenticated && assertion.tenant && assertion.tenant !== tenant &&
          !IdentityPlane.hasRole(assertion, 'platform_admin', 'platform')) {
        return { decision: R.DENY, reason: 'cross_tenant_subject' };
      }
      return null;
    });

    // 3. Mutations require authentication.
    this.register('authenticated_mutation', ({ assertion, action }) =>
      (MUTATING.test(action) && !assertion.authenticated)
        ? { decision: R.DENY, reason: 'unauthenticated_mutation' } : null);

    // 4. Restricted-content gate (heritage restriction / classification).
    //    Fail-closed: restricted resources require an authenticated subject
    //    that satisfies the resource's role/level/membership requirement.
    this.register('restricted_classification', ({ assertion, resource }) => {
      if (!resource || resource.classification !== 'restricted') return null;
      if (!assertion.authenticated) return { decision: R.DENY, reason: 'restricted_requires_auth' };
      if (this._satisfiesRequirements(assertion, resource)) return null; // defer to grant rules
      return { decision: R.DENY, reason: 'restricted_not_authorized' };
    });

    // 5. Explicit resource requirements (role / level / morafe membership).
    this.register('resource_requirements', ({ assertion, resource }) => {
      if (!resource) return null;
      if (resource.required_role && !IdentityPlane.hasRole(assertion, resource.required_role, resource.required_scope)) {
        return { decision: R.DENY, reason: 'missing_required_role' };
      }
      if (resource.required_level && !IdentityPlane.atLeast(assertion, resource.required_level)) {
        return { decision: R.DENY, reason: 'below_required_level' };
      }
      if (resource.required_morafe && !(assertion.morafe_refs || []).includes(resource.required_morafe)) {
        return { decision: R.DENY, reason: 'not_a_member' };
      }
      return null;
    });

    // 6. Risk-based step-up for sensitive actions (Zero Trust continuous auth).
    this.register('risk_step_up', ({ action, riskScore }) =>
      (SENSITIVE.test(action) && riskScore >= this.riskStepUpThreshold)
        ? { decision: R.STEP_UP_AUTH, reason: 'elevated_risk', obligations: ['reauthenticate'] } : null);

    // 7. Grants (ALLOW) — evaluated after all deny rules.
    //    a) public reads are open;
    this.register('public_read', ({ action, resource }) =>
      (/read/i.test(action) && (!resource || (resource.classification || 'public') === 'public'))
        ? { decision: R.ALLOW, reason: 'public_read' } : null);
    //    b) an authenticated subject that reached here (no denial) may proceed.
    this.register('authenticated_grant', ({ assertion }) =>
      assertion.authenticated ? { decision: R.ALLOW, reason: 'authenticated' } : null);
  }

  _satisfiesRequirements(assertion, resource) {
    if (resource.required_role && !IdentityPlane.hasRole(assertion, resource.required_role, resource.required_scope)) return false;
    if (resource.required_level && !IdentityPlane.atLeast(assertion, resource.required_level)) return false;
    if (resource.required_morafe && !(assertion.morafe_refs || []).includes(resource.required_morafe)) return false;
    // A restricted resource with no explicit requirement needs at least L2.
    if (!resource.required_role && !resource.required_level && !resource.required_morafe) {
      return IdentityPlane.atLeast(assertion, 'L2');
    }
    return true;
  }
}

module.exports = { PolicyKernel, DECISIONS };
