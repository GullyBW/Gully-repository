'use strict';
// Application authorization: a coarse ROUTE-level RBAC matrix + an ABAC layer, default-deny.
// This complements (does not replace) the Twin's fine-grained IAM, which enforces
// zero-standing-privilege JIT, matter-scoped, MFA-gated grants at the evidence-access level
// (blueprint: defence in depth). Here we answer "may this ROLE perform this ACTION, given
// these ATTRIBUTES?" — a fast, declarative gate the HTTP layer applies before the domain.
//
// Design rules: (1) default-deny — an action absent from the matrix is denied; (2) no
// implicit privilege — roles are explicit; (3) ABAC rules can only ADD denials (they never
// grant), so the RBAC matrix is the privilege ceiling.

// RBAC matrix: role → allowed actions. 'citizen' is the anonymous public role.
const RBAC = {
  citizen: ['submit-report', 'get-status', 'get-notifications', 'attach-evidence'],
  investigator: ['list-reports', 'review-case', 'transition-case', 'read-evidence', 'seal-evidence', 'admit-evidence'],
  'oversight-board': ['view-dashboard', 'record-governance-decision'],
  admin: ['admin-health', 'admin-metrics', 'admin-config'],
};

// Actions that require step-up MFA (FIDO2) regardless of role (sensitive operations).
const MFA_REQUIRED = new Set(['review-case', 'read-evidence', 'admit-evidence', 'record-governance-decision']);

// ABAC deny rules: each returns a truthy reason string to DENY, or falsy to allow.
const ABAC_RULES = [
  // Zone confinement: a principal may act only within their own zone when both are known.
  { action: '*', deny: (a) => (a.principalZone && a.resourceZone && a.principalZone !== a.resourceZone) ? 'zone-confinement: principal zone ≠ resource zone' : null },
  // Matter scoping: case-scoped actions require the case to match the granted matter.
  { action: 'review-case', deny: (a) => (a.matter && a.caseCode && a.matter !== a.caseCode) ? 'matter-scope: grant is for a different case' : null },
  { action: 'read-evidence', deny: (a) => (a.matter && a.caseCode && a.matter !== a.caseCode) ? 'matter-scope: grant is for a different case' : null },
  // Accountable-human rule: recording a governance decision requires a named human + rationale.
  { action: 'record-governance-decision', deny: (a) => (!a.reviewer || !a.rationale) ? 'accountability: named reviewer and rationale required' : null },
];

function can(role, action) { return !!(RBAC[role] && RBAC[role].includes(action)); }

// Full decision: RBAC ceiling, then MFA step-up, then ABAC denials. Default-deny.
function authorize({ role, action, attributes = {} }) {
  if (!can(role, action)) return { allow: false, reason: `rbac: role '${role}' may not '${action}'` };
  if (MFA_REQUIRED.has(action) && attributes.mfa !== 'fido2') return { allow: false, reason: `step-up: '${action}' requires FIDO2 MFA` };
  for (const rule of ABAC_RULES) {
    if (rule.action === '*' || rule.action === action) {
      const reason = rule.deny(attributes);
      if (reason) return { allow: false, reason: `abac: ${reason}` };
    }
  }
  return { allow: true, reason: 'permitted' };
}

// The set of actions a role holds (for introspection / admin UI). Never used to grant.
function actionsFor(role) { return [...(RBAC[role] || [])]; }

module.exports = { RBAC, MFA_REQUIRED, ABAC_RULES, can, authorize, actionsFor };
