'use strict';
// Policy-as-DATA authorization engine (Phase 12: ABAC + PBAC). Policies are configuration
// (JSON), evaluated at runtime, so authorization changes WITHOUT code changes. This is
// additive to the static RBAC/ABAC in src/authz.js (defence in depth): the coarse matrix is
// the fast gate; this engine expresses fine-grained, agency-configurable rules.
//
// Semantics: DEFAULT-DENY, DENY-OVERRIDES. A request is permitted only if at least one
// policy permits it and NO policy denies it. Conditions are declarative attribute predicates
// (no code). Obligations (e.g. require-mfa, log) travel with a permit.
const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  nin: (a, b) => Array.isArray(b) && !b.includes(a),
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
  exists: (a) => a !== undefined && a !== null,
};

// A condition: { attr, op, value } evaluated against a flattened { subject.*, resource.*, env.* }.
function evalCondition(cond, ctx) {
  const fn = OPS[cond.op]; if (!fn) return false;
  return fn(get(ctx, cond.attr), cond.value);
}
function get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

// A policy: { id, effect: 'permit'|'deny', actions: [..]|'*', conditions: [..] (ALL must hold),
//             obligations: [..] }.
function matches(policy, action, ctx) {
  if (policy.actions !== '*' && !(policy.actions || []).includes(action)) return false;
  return (policy.conditions || []).every((c) => evalCondition(c, ctx));
}

class PolicySet {
  constructor(policies = []) { this._policies = []; this.load(policies); }
  // Load/replace policies at runtime (configurable without code changes).
  load(policies) { this._policies = validate(policies); return this; }
  add(policy) { this._policies.push(...validate([policy])); return this; }
  list() { return this._policies.map((p) => ({ id: p.id, effect: p.effect, actions: p.actions })); }

  // Evaluate: default-deny, deny-overrides. Returns permit/deny + obligations + matches.
  evaluate({ subject = {}, action, resource = {}, env = {} }) {
    const ctx = { subject, resource, env };
    const matched = this._policies.filter((p) => matches(p, action, ctx));
    const denies = matched.filter((p) => p.effect === 'deny');
    const permits = matched.filter((p) => p.effect === 'permit');
    if (denies.length) return { decision: 'deny', reason: `denied by ${denies[0].id}`, obligations: [], matched: matched.map((p) => p.id) };
    if (permits.length) return { decision: 'permit', reason: `permitted by ${permits[0].id}`, obligations: [...new Set(permits.flatMap((p) => p.obligations || []))], matched: matched.map((p) => p.id) };
    return { decision: 'deny', reason: 'default-deny (no matching permit)', obligations: [], matched: [] };
  }
}

function validate(policies) {
  return (policies || []).map((p) => {
    if (!p.id || !['permit', 'deny'].includes(p.effect)) throw new Error(`invalid policy: ${JSON.stringify(p)}`);
    return p;
  });
}

// A sensible default policy set (agencies override this via config, no code change).
// Zone confinement / matter scoping remain enforced by src/authz.js (defence in depth).
const DEFAULT_POLICIES = [
  { id: 'deny-suspended', effect: 'deny', actions: '*', conditions: [{ attr: 'subject.suspended', op: 'eq', value: true }], obligations: [] },
  { id: 'deny-untrusted-geo', effect: 'deny', actions: ['read-evidence', 'admit-evidence'], conditions: [{ attr: 'env.geoAllowed', op: 'eq', value: false }], obligations: [] },
  { id: 'permit-investigator-read', effect: 'permit', actions: ['read-evidence', 'review-case'], conditions: [{ attr: 'subject.role', op: 'eq', value: 'investigator' }, { attr: 'subject.mfa', op: 'eq', value: 'fido2' }], obligations: ['log', 'record-authz-audit'] },
  { id: 'permit-oversight-dashboard', effect: 'permit', actions: ['view-dashboard'], conditions: [{ attr: 'subject.role', op: 'eq', value: 'oversight-board' }], obligations: ['log'] },
];

module.exports = { PolicySet, DEFAULT_POLICIES, OPS };
