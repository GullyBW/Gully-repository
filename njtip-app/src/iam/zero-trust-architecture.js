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
const { hash, signing } = require('../twin');

// Workload identity in SPIFFE shape: spiffe://njtip/zone/<zone>/sa/<service>.
const WORKLOAD_ID = /^spiffe:\/\/njtip\/zone\/(independent|executive|judiciary)\/sa\/[a-z][a-z0-9-]{2,30}$/;
// Credentials are SHORT-LIVED by construction; a longer TTL is refused, not clamped.
const MAX_CREDENTIAL_TTL_MS = 15 * 60_000;
// Continuous authentication: an authentication older than this must be re-established.
const MAX_AUTH_AGE_MS = 30 * 60_000;
// Phase 11 Part 1: an authorization DECISION may be reused for at most this long, and only
// under the conditions in AuthorizationDecisionCache. Short by design — the point of caching
// is to survive load, not to avoid evaluating.
const MAX_DECISION_TTL_MS = 30_000;
// Actions that are NEVER served from cache, whatever the TTL says. These are the acts where
// re-evaluating costs microseconds and getting it wrong costs a case.
const NEVER_CACHED = new Set([...zeroTrust.SENSITIVE]);

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

// --- Revocation & authorization decision caching (Phase 11, Part 1) -------------------------

// Immediate revocation for sessions, credentials and subjects. Revocation is a SET MEMBERSHIP
// test on every use — there is no propagation delay to reason about, and a revoked identity
// cannot be resurrected by a cached decision.
class RevocationRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._sessions = new Map(); this._credentials = new Map(); this._subjects = new Map(); }
  revokeSession(id, { by, reason } = {}) { if (!by || !reason) throw new Error('revocation requires a named actor and a reason'); this._sessions.set(id, { at: this._clock(), by, reason }); return { kind: 'session', id, revoked: true }; }
  revokeCredential(id, { by, reason } = {}) { if (!by || !reason) throw new Error('revocation requires a named actor and a reason'); this._credentials.set(id, { at: this._clock(), by, reason }); return { kind: 'credential', id, revoked: true }; }
  revokeSubject(id, { by, reason } = {}) { if (!by || !reason) throw new Error('revocation requires a named actor and a reason'); this._subjects.set(id, { at: this._clock(), by, reason }); return { kind: 'subject', id, revoked: true }; }
  isRevoked({ sessionId = null, credentialId = null, principal = null } = {}) {
    if (sessionId && this._sessions.has(sessionId)) return { revoked: true, kind: 'session', ...this._sessions.get(sessionId) };
    if (credentialId && this._credentials.has(credentialId)) return { revoked: true, kind: 'credential', ...this._credentials.get(credentialId) };
    if (principal && this._subjects.has(principal)) return { revoked: true, kind: 'subject', ...this._subjects.get(principal) };
    return { revoked: false };
  }
  list() { return { sessions: [...this._sessions.keys()], credentials: [...this._credentials.keys()], subjects: [...this._subjects.keys()] }; }
}

// Cross-region policy synchronization. A region whose policy version lags the authoritative
// version MAY NOT serve authorization — it would be deciding against a policy that has been
// superseded, which is the failure mode caching exists to avoid.
class PolicySyncRegistry {
  constructor() { this._regions = new Map(); }
  register(region, { version = 0 } = {}) { this._regions.set(region, { region, version, syncedAt: null }); return this.state(region); }
  sync(region, version) { const r = this._regions.get(region); if (!r) throw new Error('unknown region: ' + region); r.version = version; r.syncedAt = version; return this.state(region); }
  state(region) { const r = this._regions.get(region); return r ? { ...r } : null; }
  // Which regions may serve authorization at the authoritative version?
  status(authoritativeVersion) {
    const rows = [...this._regions.values()].map((r) => ({ region: r.region, version: r.version, inSync: r.version === authoritativeVersion, mayServe: r.version === authoritativeVersion, lag: authoritativeVersion - r.version }));
    return { authoritativeVersion, regions: rows, allInSync: rows.every((r) => r.inSync), stale: rows.filter((r) => !r.inSync).map((r) => r.region) };
  }
}

// Short-lived, cryptographically signed authorization decisions.
//
// This REPLACES the blanket "nothing is cached" rule with a stronger, checkable one: a decision
// may be reused only while it is signed, unexpired, bound to the same session, issued under the
// CURRENT policy version, un-revoked, and for an action that is cacheable at all. Every one of
// those is verified on every reuse — so a cache hit still passes through the checks that make
// the decision valid, it just skips recomputing the parts that provably cannot have changed.
class AuthorizationDecisionCache {
  constructor({ clock = () => Date.now(), revocations, ttlMs = 10_000 } = {}) {
    if (ttlMs > MAX_DECISION_TTL_MS) throw new Error(`decision TTL ${ttlMs}ms exceeds the ${MAX_DECISION_TTL_MS}ms maximum`);
    this._clock = clock; this._revocations = revocations; this._ttl = ttlMs;
    this._entries = new Map(); this._seenNonces = new Set();
    this._stats = { hits: 0, misses: 0, rejected: {} };
  }
  // A decision is bound to the full security context that produced it. Anything that would
  // change the outcome — role, MFA assurance, device, zone, subject kind — is in the key, so a
  // decision issued for one context can never be reused under another. (Learned the hard way:
  // keying on the principal alone turns the cache into a privilege-escalation vector.)
  static subjectContextDigest({ subject = {}, resource = {}, env = {} } = {}) {
    return hash.sha256({
      role: subject.role ?? null, mfa: subject.mfa ?? null, kind: subject.kind ?? null,
      zone: subject.zone ?? null, deviceId: subject.deviceId ?? null, suspended: subject.suspended ?? null,
      resourceZone: resource.zone ?? null, resourceId: resource.id ?? null,
      geoAllowed: env.geoAllowed !== false,
    }).slice(0, 16);
  }
  static key({ principal, action, sessionId, contextDigest }) { return `${principal}|${action}|${sessionId || ''}|${contextDigest}`; }

  // Issue a signed decision token for a permit. The signature covers every field that would
  // change the decision, so tampering with any of them invalidates it.
  issue({ principal, action, resource = {}, sessionId = null, credentialId = null, policyVersion, obligations = [], contextDigest }) {
    const now = this._clock();
    const body = {
      decisionId: 'AZD-' + hash.sha256({ principal, action, resource, sessionId, contextDigest, now }).slice(0, 12),
      principal, action, resourceZone: resource.zone || null, resourceId: resource.id || null,
      sessionId, credentialId, policyVersion, contextDigest, obligations: [...obligations],
      issuedAt: now, expiresAt: now + this._ttl,
    };
    const digest = hash.sha256(body);
    const token = { ...body, digest, signature: signing.sign(digest) };
    if (!NEVER_CACHED.has(action)) this._entries.set(AuthorizationDecisionCache.key({ principal, action, sessionId, contextDigest }), token);
    return token;
  }

  // Verify a decision token on its own terms — used both for cache lookup and for a token
  // presented by a caller (an identity-aware proxy in front of another service).
  verify(token, { policyVersion, nonce = null, contextDigest = null } = {}) {
    const reject = (reason) => { this._stats.rejected[reason] = (this._stats.rejected[reason] || 0) + 1; return { valid: false, reason }; };
    if (!token) return reject('no-decision');
    const { digest, signature, ...body } = token;
    if (hash.sha256(body) !== digest) return reject('tampered');
    if (!signing.verify(digest, signature)) return reject('bad-signature');
    if (this._clock() >= token.expiresAt) return reject('expired');
    if (token.policyVersion !== policyVersion) return reject('stale-policy-version');
    if (contextDigest !== null && token.contextDigest !== contextDigest) return reject('context-changed');
    if (NEVER_CACHED.has(token.action)) return reject('action-never-cached');
    const rev = this._revocations.isRevoked({ sessionId: token.sessionId, credentialId: token.credentialId, principal: token.principal });
    if (rev.revoked) return reject('revoked-' + rev.kind);
    // Replay protection: a presented nonce may be used exactly once.
    if (nonce !== null) {
      if (this._seenNonces.has(nonce)) return reject('replayed-nonce');
      this._seenNonces.add(nonce);
    }
    return { valid: true, decision: token };
  }

  // Look a decision up. A miss, or any failed check, means the PDP evaluates in full.
  lookup({ principal, action, sessionId, contextDigest }, { policyVersion }) {
    const key = AuthorizationDecisionCache.key({ principal, action, sessionId, contextDigest });
    const token = this._entries.get(key);
    const verdict = this.verify(token, { policyVersion, contextDigest });
    if (!verdict.valid) { this._stats.misses += 1; if (token && verdict.reason !== 'no-decision') this._entries.delete(key); return verdict; }
    this._stats.hits += 1;
    return verdict;
  }

  // Invalidation: by principal, by session, or wholesale on a policy change.
  invalidatePrincipal(principal) { let n = 0; for (const [k, t] of this._entries) if (t.principal === principal) { this._entries.delete(k); n++; } return n; }
  invalidateSession(sessionId) { let n = 0; for (const [k, t] of this._entries) if (t.sessionId === sessionId) { this._entries.delete(k); n++; } return n; }
  invalidateAll(reason = 'policy-change') { const n = this._entries.size; this._entries.clear(); return { invalidated: n, reason }; }
  size() { return this._entries.size; }
  stats() { return { ...this._stats, rejected: { ...this._stats.rejected }, size: this._entries.size, ttlMs: this._ttl }; }
}

// --- PAP · PDP · PEP -------------------------------------------------------------------------

// Policy Administration Point: where policy is authored, versioned and published. Changing
// policy here changes decisions at the PDP with NO code change.
class PolicyAdministrationPoint {
  constructor({ policies = DEFAULT_POLICIES, onPublish = null } = {}) { this._version = 1; this._policies = [...policies]; this._set = new PolicySet(this._policies); this._history = [{ version: 1, count: this._policies.length }]; this._onPublish = onPublish; }
  publish(policies, { by, rationale } = {}) {
    if (!by || !rationale) throw new Error('publishing a policy set requires a named human and a rationale');
    this._set = new PolicySet(policies);      // validates, throws on a malformed policy
    this._policies = [...policies]; this._version += 1;
    this._history.push({ version: this._version, count: policies.length, by, rationale });
    // A policy change invalidates every cached decision immediately — a decision issued under
    // a superseded policy is not a decision, it is a memory.
    if (this._onPublish) this._onPublish(this._version);
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
  constructor({ pap, workloads, boundaries, devices, cache = null, revocations = null, policySync = null, clock = () => Date.now() } = {}) {
    this._pap = pap; this._workloads = workloads; this._boundaries = boundaries;
    this._devices = devices || new zeroTrust.DeviceRegistry(); this._clock = clock; this._decisions = 0; this._fullEvaluations = 0;
    this._cache = cache; this._revocations = revocations; this._policySync = policySync;
  }
  decisionsEvaluated() { return this._decisions; }
  fullEvaluations() { return this._fullEvaluations; }

  // Continuous re-evaluation triggers. Any of these forces a full evaluation regardless of a
  // valid cached decision — the cache is an optimisation over UNCHANGED conditions only.
  reevaluationTriggers(request = {}) {
    const { subject = {}, action, env = {} } = request;
    const triggers = [];
    if (NEVER_CACHED.has(action)) triggers.push('sensitive-action');
    if (env.riskLevel && env.riskLevel !== 'low') triggers.push('elevated-risk');
    if (env.devicePostureChanged) triggers.push('device-posture-changed');
    if (env.geoAllowed === false) triggers.push('geo-denied');
    if (subject.stepUpRequired) triggers.push('step-up-required');
    if (env.forceReevaluation) triggers.push('explicit-request');
    return triggers;
  }

  // Evaluate one access request. Every check runs; the first denial wins, and the trace shows
  // which checks ran so a denial is explainable to the person who hit it.
  decide(request = {}, { allowCache = true } = {}) {
    this._decisions += 1;
    const trace = [];
    const deny = (stage, reason) => ({ decision: 'deny', stage, reason, trace, evaluatedAt: this._clock() });
    const { subject = {}, action, resource = {}, env = {}, workloadCredential = null } = request;

    // 0. Revocation is checked FIRST, on every request, cached or not. A revoked identity is
    //    denied before anything else has a chance to permit it.
    trace.push('revocation-check');
    if (this._revocations) {
      const rev = this._revocations.isRevoked({ sessionId: subject.sessionId, credentialId: workloadCredential, principal: subject.principal });
      if (rev.revoked) return deny('revocation', `${rev.kind} revoked: ${rev.reason}`);
    }
    // 0b. A region whose policy version lags may not serve authorization at all.
    if (this._policySync && env.region) {
      const st = this._policySync.state(env.region);
      if (st && st.version !== this._pap.version()) return deny('policy-sync', `region '${env.region}' is at policy version ${st.version}, authoritative is ${this._pap.version()}`);
    }
    const triggers = this.reevaluationTriggers(request);
    const contextDigest = AuthorizationDecisionCache.subjectContextDigest(request);

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

    // 2b. Cached decision fast path. It sits AFTER revocation, authentication and credential
    //     validation — all of which are time-dependent and cheap — so caching only ever skips
    //     the policy evaluation and scoring, which depend solely on the (keyed) context.
    if (allowCache && this._cache && !triggers.length && subject.principal) {
      const hit = this._cache.lookup({ principal: subject.principal, action, sessionId: subject.sessionId, contextDigest }, { policyVersion: this._pap.version() });
      if (hit.valid) {
        return {
          decision: 'permit', stage: 'cached', reason: 'reused a signed, unexpired, policy-current decision for an unchanged security context',
          obligations: hit.decision.obligations, policyVersion: hit.decision.policyVersion,
          cached: true, decisionId: hit.decision.decisionId, expiresAt: hit.decision.expiresAt, contextDigest,
          trace: [...trace, 'decision-cache-hit'], evaluatedAt: this._clock(),
          note: 'Cache hit. Revocation, authentication freshness, credential validity, signature, expiry, policy version and security context were all re-checked; only the unchanged policy evaluation was skipped.',
        };
      }
      if (hit.reason && hit.reason !== 'no-decision') trace.push('decision-cache-rejected:' + hit.reason);
    } else if (triggers.length) trace.push('re-evaluation-triggered:' + triggers.join(','));
    this._fullEvaluations += 1;

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

    // Issue a signed, short-lived decision. Sensitive actions are never cached (the cache
    // refuses to store them), so this token is issued but not reusable for those.
    const token = this._cache
      ? this._cache.issue({ principal: subject.principal, action, resource, sessionId: subject.sessionId, credentialId: workloadCredential, policyVersion: this._pap.version(), obligations: policy.obligations, contextDigest })
      : null;
    return {
      decision: 'permit', stage: 'complete', reason: policy.reason,
      obligations: policy.obligations, trustScore: score.score, scoreBreakdown: score.breakdown,
      policyVersion: this._pap.version(), trace, evaluatedAt: this._clock(),
      cached: false, decisionToken: token, reevaluationTriggers: triggers,
      note: token && !NEVER_CACHED.has(action)
        ? 'Signed decision, reusable only while unexpired, policy-current, session-bound and un-revoked.'
        : 'Fully evaluated. This action is never served from cache.',
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

function makeZeroTrust({ clock = () => Date.now(), policies = DEFAULT_POLICIES, devices = null, decisionTtlMs = 10_000 } = {}) {
  const revocations = new RevocationRegistry({ clock });
  const cache = new AuthorizationDecisionCache({ clock, revocations, ttlMs: decisionTtlMs });
  const policySync = new PolicySyncRegistry();
  // A policy publication invalidates every cached decision, immediately and wholesale.
  const pap = new PolicyAdministrationPoint({ policies, onPublish: () => cache.invalidateAll('policy-change') });
  const workloads = new WorkloadIdentityRegistry({ clock });
  const boundaries = new TrustBoundaryRegistry();
  const deviceRegistry = devices || new zeroTrust.DeviceRegistry();
  const pdp = new PolicyDecisionPoint({ pap, workloads, boundaries, devices: deviceRegistry, cache, revocations, policySync, clock });
  const pep = new PolicyEnforcementPoint({ pdp, clock });
  // Revoking through this facade also drops any cached decision for the subject/session.
  const revoke = {
    session: (id, opts) => { const r = revocations.revokeSession(id, opts); cache.invalidateSession(id); return r; },
    credential: (id, opts) => revocations.revokeCredential(id, opts),
    subject: (id, opts) => { const r = revocations.revokeSubject(id, opts); cache.invalidatePrincipal(id); return r; },
  };
  return {
    pap, pdp, pep, workloads, boundaries, devices: deviceRegistry, cache, revocations, policySync, revoke,
    // The architecture as data, for documentation and the trust-boundary diagram.
    architecture: () => ({
      components: [
        { component: 'PAP', role: 'Policy Administration Point', responsibility: 'Author, version and publish policy. Publication requires a named human and a rationale.', implementation: 'PolicyAdministrationPoint' },
        { component: 'PDP', role: 'Policy Decision Point', responsibility: 'Evaluate every request against live signals; never cache a decision.', implementation: 'PolicyDecisionPoint' },
        { component: 'PEP', role: 'Policy Enforcement Point', responsibility: 'Enforce and audit the decision at the resource boundary. Never decides.', implementation: 'PolicyEnforcementPoint (identity-aware proxy)' },
        { component: 'Workload identity', role: 'Service/workload identity', responsibility: 'SPIFFE-shaped identities with attestation and short-lived credentials.', implementation: 'WorkloadIdentityRegistry' },
        { component: 'Trust boundaries', role: 'Microservice trust boundaries', responsibility: 'Declared, mutually authenticated, action-scoped flows. Undeclared crossings are denied.', implementation: 'TrustBoundaryRegistry' },
        { component: 'Device trust', role: 'Device posture', responsibility: 'Device trust contributes to the score; it never grants access on its own.', implementation: 'DeviceRegistry' },
        { component: 'Decision cache', role: 'Short-lived signed authorization decisions', responsibility: 'Reuse a decision only while signed, unexpired, policy-current, session-bound and un-revoked. Sensitive actions are never cached.', implementation: 'AuthorizationDecisionCache' },
        { component: 'Revocation', role: 'Immediate revocation', responsibility: 'Session, credential and subject revocation checked FIRST on every request and on every cache reuse.', implementation: 'RevocationRegistry' },
        { component: 'Policy sync', role: 'Cross-region policy synchronization', responsibility: 'A region behind the authoritative policy version may not serve authorization.', implementation: 'PolicySyncRegistry' },
      ],
      pipeline: ['continuous-authentication', 'workload-identity', 'trust-boundary', 'least-privilege', 'policy-decision', 'continuous-authorization'],
      invariants: [
        'No implicit trust: an unauthenticated or stale request is denied before any other check.',
        'Credentials are short-lived; a TTL beyond the maximum is refused, not clamped.',
        'Revocation is checked FIRST on every request and again on every cached reuse.',
        'A cached decision is signed, expires within 30s, is bound to its session and its policy version, and is dropped wholesale when policy changes.',
        'Sensitive actions are never served from cache, whatever the TTL says.',
        'The RBAC matrix is the privilege ceiling — policy can narrow it, never widen it.',
        'An undeclared trust-boundary crossing is denied by default.',
        'A region behind the authoritative policy version may not serve authorization.',
      ],
      maxCredentialTtlMs: MAX_CREDENTIAL_TTL_MS, maxAuthAgeMs: MAX_AUTH_AGE_MS, maxDecisionTtlMs: MAX_DECISION_TTL_MS,
      neverCachedActions: [...NEVER_CACHED].sort(),
    }),
  };
}

module.exports = {
  makeZeroTrust, WorkloadIdentityRegistry, TrustBoundaryRegistry,
  PolicyAdministrationPoint, PolicyDecisionPoint, PolicyEnforcementPoint,
  AuthorizationDecisionCache, RevocationRegistry, PolicySyncRegistry,
  WORKLOAD_ID, MAX_CREDENTIAL_TTL_MS, MAX_AUTH_AGE_MS, MAX_DECISION_TTL_MS, NEVER_CACHED,
};
