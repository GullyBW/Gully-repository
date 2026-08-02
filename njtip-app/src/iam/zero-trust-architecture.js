'use strict';
// Zero Trust Architecture (Phase 10, Part 1). The existing pieces — trust scoring, device
// registry, break-glass, policy-as-data, RBAC/ABAC — are assembled here into the named
// NIST SP 800-207 components, so "zero trust" is a structure you can point at rather than an
// adjective: PAP (administration) → PDP (decision) → PEP (enforcement), with workload
// identity, short-lived credentials and explicit trust boundaries.
//
// The rule: EVERY access request is evaluated dynamically against live signals. There is no
// implicit trust — not from network position, not from a prior decision, not from a role
// alone. Deterministic; an injected clock keeps credential expiry testable.
const zeroTrust = require('./zero-trust');
const { PolicySet, DEFAULT_POLICIES } = require('./policy-engine');
const authz = require('../authz');

// Workload identity in SPIFFE shape: spiffe://njtip/zone/<zone>/sa/<service>.
const WORKLOAD_ID = /^spiffe:\/\/njtip\/zone\/(independent|executive|judiciary)\/sa\/[a-z][a-z0-9-]{2,30}$/;
// Credentials are SHORT-LIVED by construction; a longer TTL is refused, not clamped.
const MAX_CREDENTIAL_TTL_MS = 15 * 60_000;
// Continuous authentication: an authentication older than this must be re-established.
const MAX_AUTH_AGE_MS = 30 * 60_000;

// --- Workload / service identity ---------------------------------------------------------

class WorkloadIdentityRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._workloads = new Map(); this._credentials = new Map(); this._seq = 0; }

  // Register a workload. Attestation is what the platform checked before trusting it at all.
  register(id, { zone, attestation = null, allowedActions = [] } = {}) {
    if (!WORKLOAD_ID.test(id)) throw new Error(`workload identity must be a SPIFFE-shaped id: ${id}`);
    if (!zone || !id.includes(`/zone/${zone}/`)) throw new Error('workload zone must match its identity');
    if (!attestation) { const e = new Error('a workload identity requires an attestation (no implicit trust)'); e.failClosed = true; throw e; }
    this._workloads.set(id, { id, zone, attestation, allowedActions: [...allowedActions], revoked: false, registeredAt: this._clock() });
    return this.describe(id);
  }
  describe(id) { const w = this._workloads.get(id); return w ? { ...w, allowedActions: [...w.allowedActions] } : null; }
  list() { return [...this._workloads.keys()].sort(); }
  revoke(id) { const w = this._workloads.get(id); if (!w) return false; w.revoked = true; for (const c of this._credentials.values()) if (c.workload === id) c.revoked = true; return true; }

  // Issue a SHORT-LIVED credential. A TTL beyond the maximum is refused (fail-closed) rather
  // than silently reduced — a caller asking for a long-lived token has a design problem.
  issueCredential(workloadId, { ttlMs = 5 * 60_000, audience } = {}) {
    const w = this._workloads.get(workloadId);
    if (!w) { const e = new Error('unknown workload identity'); e.failClosed = true; throw e; }
    if (w.revoked) { const e = new Error('workload identity is revoked'); e.failClosed = true; throw e; }
    if (!audience) throw new Error('a credential must name its audience');
    if (ttlMs > MAX_CREDENTIAL_TTL_MS) { const e = new Error(`credential TTL ${ttlMs}ms exceeds the ${MAX_CREDENTIAL_TTL_MS}ms maximum (short-lived credentials only)`); e.failClosed = true; throw e; }
    const now = this._clock();
    const cred = { id: 'WLC-' + (++this._seq).toString().padStart(4, '0'), workload: workloadId, zone: w.zone, audience, issuedAt: now, expiresAt: now + ttlMs, revoked: false };
    this._credentials.set(cred.id, cred);
    return { ...cred };
  }
  // Verify a credential at the moment of use — never once at the door.
  verifyCredential(credentialId, { audience = null } = {}) {
    const c = this._credentials.get(credentialId);
    if (!c) return { valid: false, reason: 'unknown credential' };
    if (c.revoked) return { valid: false, reason: 'credential revoked' };
    if (this._clock() >= c.expiresAt) return { valid: false, reason: 'credential expired' };
    if (audience && c.audience !== audience) return { valid: false, reason: `credential audience '${c.audience}' does not match '${audience}'` };
    const w = this._workloads.get(c.workload);
    if (!w || w.revoked) return { valid: false, reason: 'issuing workload is revoked' };
    return { valid: true, workload: c.workload, zone: c.zone, expiresAt: c.expiresAt };
  }
  credentials() { return [...this._credentials.values()].map((c) => ({ ...c })); }
}

// --- Trust boundaries ----------------------------------------------------------------------

// Microservice trust boundaries. A flow that is not declared does not exist: default-deny.
class TrustBoundaryRegistry {
  constructor() { this._flows = new Map(); }
  allow(from, to, { actions = [], mutualTls = true, rationale } = {}) {
    if (!rationale) throw new Error('a declared trust boundary flow requires a rationale');
    this._flows.set(`${from}->${to}`, { from, to, actions: [...actions], mutualTls, rationale });
    return this.describe(from, to);
  }
  describe(from, to) { const f = this._flows.get(`${from}->${to}`); return f ? { ...f, actions: [...f.actions] } : null; }
  flows() { return [...this._flows.values()].map((f) => ({ ...f, actions: [...f.actions] })); }
  // Is this crossing declared, mutually authenticated, and scoped to this action?
  permits(from, to, action) {
    if (from === to) return { permitted: true, reason: 'same trust boundary' };
    const f = this._flows.get(`${from}->${to}`);
    if (!f) return { permitted: false, reason: `undeclared trust boundary crossing ${from} → ${to} (default-deny)` };
    if (!f.mutualTls) return { permitted: false, reason: 'boundary crossing without mutual authentication' };
    if (f.actions.length && !f.actions.includes(action)) return { permitted: false, reason: `action '${action}' is not permitted across ${from} → ${to}` };
    return { permitted: true, reason: 'declared, mutually authenticated flow' };
  }
}

// --- PAP · PDP · PEP -------------------------------------------------------------------------

// Policy Administration Point: where policy is authored, versioned and published. Changing
// policy here changes decisions at the PDP with NO code change.
class PolicyAdministrationPoint {
  constructor({ policies = DEFAULT_POLICIES } = {}) { this._version = 1; this._policies = [...policies]; this._set = new PolicySet(this._policies); this._history = [{ version: 1, count: this._policies.length }]; }
  publish(policies, { by, rationale } = {}) {
    if (!by || !rationale) throw new Error('publishing a policy set requires a named human and a rationale');
    this._set = new PolicySet(policies);      // validates, throws on a malformed policy
    this._policies = [...policies]; this._version += 1;
    this._history.push({ version: this._version, count: policies.length, by, rationale });
    return { version: this._version, policies: policies.length };
  }
  policySet() { return this._set; }
  version() { return this._version; }
  registry() { return this._set.list(); }
  history() { return this._history.map((h) => ({ ...h })); }
}

// Policy Decision Point: evaluates a request against every signal and returns a decision with
// the reasoning trace. It NEVER caches a decision — a decision is valid for one request only.
class PolicyDecisionPoint {
  constructor({ pap, workloads, boundaries, devices, clock = () => Date.now() } = {}) {
    this._pap = pap; this._workloads = workloads; this._boundaries = boundaries;
    this._devices = devices || new zeroTrust.DeviceRegistry(); this._clock = clock; this._decisions = 0;
  }
  decisionsEvaluated() { return this._decisions; }

  // Evaluate one access request. Every check runs; the first denial wins, and the trace shows
  // which checks ran so a denial is explainable to the person who hit it.
  decide(request = {}) {
    this._decisions += 1;
    const trace = [];
    const deny = (stage, reason) => ({ decision: 'deny', stage, reason, trace, evaluatedAt: this._clock() });
    const { subject = {}, action, resource = {}, env = {}, workloadCredential = null } = request;

    // 1. Continuous authentication — a stale authentication is not an authentication.
    trace.push('continuous-authentication');
    if (!subject.principal) return deny('authentication', 'no authenticated principal (no implicit trust)');
    const authAge = typeof subject.authenticatedAt === 'number' ? this._clock() - subject.authenticatedAt : Infinity;
    if (!(authAge <= (subject.maxAuthAgeMs ?? MAX_AUTH_AGE_MS))) return deny('authentication', 'authentication is stale — re-authenticate');

    // 2. Workload identity — a service call must present a valid short-lived credential.
    trace.push('workload-identity');
    if (workloadCredential) {
      const v = this._workloads.verifyCredential(workloadCredential, { audience: resource.service || null });
      if (!v.valid) return deny('workload-identity', v.reason);
    } else if (subject.kind === 'workload') {
      return deny('workload-identity', 'workload requests must present a short-lived credential');
    }

    // 3. Trust boundary — an undeclared crossing does not exist.
    trace.push('trust-boundary');
    if (subject.zone && resource.zone) {
      const b = this._boundaries.permits(subject.zone, resource.zone, action);
      if (!b.permitted) return deny('trust-boundary', b.reason);
    }

    // 4. Least privilege — the RBAC matrix is the ceiling; nothing may exceed it.
    trace.push('least-privilege');
    const rbac = authz.authorize({ role: subject.role, action, attributes: { ...subject, ...resource, ...env } });
    if (!rbac.allow) return deny('least-privilege', rbac.reason);

    // 5. Context-aware policy (PAP-published, evaluated live).
    trace.push('policy-decision');
    const policy = this._pap.policySet().evaluate({ subject, action, resource, env });
    if (policy.decision !== 'permit') return deny('policy', policy.reason);

    // 6. Continuous authorization — a live trust score against the action's floor.
    trace.push('continuous-authorization');
    const deviceTrusted = subject.deviceId ? this._devices.isTrusted(subject.deviceId) : false;
    const score = zeroTrust.trustScore({ mfa: subject.mfa, deviceTrusted, geoAllowed: env.geoAllowed !== false, freshAuthMs: authAge, riskLevel: env.riskLevel || 'low' });
    const cont = zeroTrust.continuousAuthz({ action, score: score.score });
    if (cont.decision === 'deny') return deny('continuous-authorization', cont.reason);
    if (cont.decision === 'step-up') return { decision: 'step-up', stage: 'continuous-authorization', reason: cont.reason, required: cont.required, score: score.score, trace, evaluatedAt: this._clock() };

    return {
      decision: 'permit', stage: 'complete', reason: policy.reason,
      obligations: policy.obligations, trustScore: score.score, scoreBreakdown: score.breakdown,
      policyVersion: this._pap.version(), trace, evaluatedAt: this._clock(),
      note: 'Valid for THIS request only. No decision is cached; the next request is evaluated again.',
    };
  }
}

// Policy Enforcement Point: the identity-aware proxy in front of a resource. It enforces the
// PDP's decision and records it. A PEP never decides — it only enforces and audits.
class PolicyEnforcementPoint {
  constructor({ pdp, name = 'identity-aware-proxy', clock = () => Date.now() } = {}) { this._pdp = pdp; this._name = name; this._clock = clock; this._audit = []; }
  enforce(request) {
    const decision = this._pdp.decide(request);
    this._audit.push({
      at: this._clock(), pep: this._name, action: request.action || null,
      principal: (request.subject || {}).principal || null,   // role-coded principal id, never a person
      decision: decision.decision, stage: decision.stage, reason: decision.reason,
    });
    if (decision.decision === 'permit') return { allowed: true, ...decision };
    const e = new Error(`access denied at ${this._name}: ${decision.reason}`);
    e.failClosed = true; e.decision = decision;
    return { allowed: false, error: e, ...decision };
  }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
}

// --- The assembled architecture -----------------------------------------------------------------

function makeZeroTrust({ clock = () => Date.now(), policies = DEFAULT_POLICIES, devices = null } = {}) {
  const pap = new PolicyAdministrationPoint({ policies });
  const workloads = new WorkloadIdentityRegistry({ clock });
  const boundaries = new TrustBoundaryRegistry();
  const deviceRegistry = devices || new zeroTrust.DeviceRegistry();
  const pdp = new PolicyDecisionPoint({ pap, workloads, boundaries, devices: deviceRegistry, clock });
  const pep = new PolicyEnforcementPoint({ pdp, clock });
  return {
    pap, pdp, pep, workloads, boundaries, devices: deviceRegistry,
    // The architecture as data, for documentation and the trust-boundary diagram.
    architecture: () => ({
      components: [
        { component: 'PAP', role: 'Policy Administration Point', responsibility: 'Author, version and publish policy. Publication requires a named human and a rationale.', implementation: 'PolicyAdministrationPoint' },
        { component: 'PDP', role: 'Policy Decision Point', responsibility: 'Evaluate every request against live signals; never cache a decision.', implementation: 'PolicyDecisionPoint' },
        { component: 'PEP', role: 'Policy Enforcement Point', responsibility: 'Enforce and audit the decision at the resource boundary. Never decides.', implementation: 'PolicyEnforcementPoint (identity-aware proxy)' },
        { component: 'Workload identity', role: 'Service/workload identity', responsibility: 'SPIFFE-shaped identities with attestation and short-lived credentials.', implementation: 'WorkloadIdentityRegistry' },
        { component: 'Trust boundaries', role: 'Microservice trust boundaries', responsibility: 'Declared, mutually authenticated, action-scoped flows. Undeclared crossings are denied.', implementation: 'TrustBoundaryRegistry' },
        { component: 'Device trust', role: 'Device posture', responsibility: 'Device trust contributes to the score; it never grants access on its own.', implementation: 'DeviceRegistry' },
      ],
      pipeline: ['continuous-authentication', 'workload-identity', 'trust-boundary', 'least-privilege', 'policy-decision', 'continuous-authorization'],
      invariants: [
        'No implicit trust: an unauthenticated or stale request is denied before any other check.',
        'Credentials are short-lived; a TTL beyond the maximum is refused, not clamped.',
        'A decision is valid for one request; nothing is cached.',
        'The RBAC matrix is the privilege ceiling — policy can narrow it, never widen it.',
        'An undeclared trust-boundary crossing is denied by default.',
      ],
      maxCredentialTtlMs: MAX_CREDENTIAL_TTL_MS, maxAuthAgeMs: MAX_AUTH_AGE_MS,
    }),
  };
}

module.exports = {
  makeZeroTrust, WorkloadIdentityRegistry, TrustBoundaryRegistry,
  PolicyAdministrationPoint, PolicyDecisionPoint, PolicyEnforcementPoint,
  WORKLOAD_ID, MAX_CREDENTIAL_TTL_MS, MAX_AUTH_AGE_MS,
};
