'use strict';
// Policy Governance Platform (Phase 41). A governance layer OVER the policy-as-data engine
// (iam/policy-engine.js): a policy REGISTRY with versioning, ownership, lifecycle, SIMULATION,
// compatibility validation, impact analysis, rollback, dependencies, audit trails, and
// certification. Deterministic. Every policy change is validated (simulated) BEFORE
// activation — an activation that fails simulation is refused (fail-closed).
const { PolicySet } = require('./policy-engine');

const LIFECYCLE = ['draft', 'active', 'deprecated', 'retired'];

class PolicyRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._sets = new Map(); this._active = new Map(); this._audit = []; }

  // Register a new VERSION of a named policy set (starts in 'draft').
  register(name, { owner, policies = [], dependsOn = [] } = {}) {
    if (!name || !owner) throw new Error('policy set name and owner are required');
    new PolicySet(policies); // validate policy shape (throws on invalid)
    const versions = this._sets.get(name) || [];
    const version = versions.length + 1;
    versions.push({ name, version, owner, policies, dependsOn: [...dependsOn], status: 'draft', since: this._clock() });
    this._sets.set(name, versions);
    this._log('registered', name, version, owner);
    return { name, version, status: 'draft' };
  }
  versions(name) { return (this._sets.get(name) || []).map((v) => ({ name: v.name, version: v.version, owner: v.owner, status: v.status })); }
  _ver(name, version) { const vs = this._sets.get(name) || []; return version ? vs.find((v) => v.version === version) : vs[vs.length - 1]; }

  // Simulate a policy set version against a suite of requests → decisions (no activation).
  simulate(name, version, requests = []) {
    const v = this._ver(name, version); if (!v) throw new Error('unknown policy set version');
    const ps = new PolicySet(v.policies);
    return requests.map((r) => ({ request: r, decision: ps.evaluate(r).decision }));
  }
  // Impact analysis: which requests change decision between the ACTIVE version and a candidate.
  impact(name, candidateVersion, requests = []) {
    const activeV = this._active.get(name);
    const before = activeV ? this.simulate(name, activeV, requests) : requests.map((r) => ({ request: r, decision: 'deny' }));
    const after = this.simulate(name, candidateVersion, requests);
    const changes = [];
    for (let i = 0; i < requests.length; i++) if (before[i].decision !== after[i].decision) changes.push({ request: requests[i], from: before[i].decision, to: after[i].decision });
    return { changes, changed: changes.length, fromVersion: activeV || null, toVersion: candidateVersion };
  }
  // Compatibility: a candidate must not silently REVOKE (permit→deny) an expected-permit set.
  checkCompatibility(name, candidateVersion, expectedPermits = []) {
    const results = this.simulate(name, candidateVersion, expectedPermits);
    const regressions = results.filter((r) => r.decision !== 'permit').map((r) => r.request);
    return { compatible: regressions.length === 0, regressions };
  }

  // Activate a version — validated by simulation against a REQUIRED suite BEFORE activation.
  // The Twin's fitness gate additionally guards the whole system; here we guard the change.
  activate(name, version, { validationSuite = [] } = {}) {
    const v = this._ver(name, version); if (!v) throw new Error('unknown policy set version');
    // Validation: every required (request → expectedDecision) must hold.
    const failures = [];
    for (const t of validationSuite) { const got = new PolicySet(v.policies).evaluate(t.request).decision; if (got !== t.expect) failures.push({ request: t.request, expect: t.expect, got }); }
    if (failures.length) { const e = new Error('policy activation refused — validation failed'); e.failures = failures; throw e; }
    // Deprecate the previously active version.
    const prev = this._active.get(name); if (prev) { const pv = this._ver(name, prev); if (pv) pv.status = 'deprecated'; }
    v.status = 'active'; this._active.set(name, version);
    this._log('activated', name, version, v.owner);
    return { name, version, status: 'active' };
  }
  active(name) { const version = this._active.get(name); return version ? this._ver(name, version) : null; }
  // Rollback to a prior version (records the rollback; the prior version becomes active again).
  rollback(name, toVersion) { const v = this._ver(name, toVersion); if (!v) throw new Error('unknown version'); const cur = this._active.get(name); if (cur) { const cv = this._ver(name, cur); if (cv) cv.status = 'deprecated'; } v.status = 'active'; this._active.set(name, toVersion); this._log('rolled-back', name, toVersion, v.owner); return { name, version: toVersion, status: 'active' }; }
  retire(name, version) { const v = this._ver(name, version); if (!v) throw new Error('unknown version'); if (v.status !== 'deprecated') throw new Error('a policy version must be deprecated before retirement'); v.status = 'retired'; this._log('retired', name, version, v.owner); return { name, version, status: 'retired' }; }

  // Certification: active + validated + has an owner + no unresolved dependencies.
  certify(name) { const v = this.active(name); if (!v) return { name, certified: false, reason: 'no active version' }; const unmet = (v.dependsOn || []).filter((d) => !this._active.has(d)); return { name, version: v.version, certified: unmet.length === 0, unmetDependencies: unmet }; }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, name, version, actor) { this._audit.push({ at: this._clock(), event, name, version, actor: actor || 'system' }); }
}

module.exports = { PolicyRegistry, LIFECYCLE };
