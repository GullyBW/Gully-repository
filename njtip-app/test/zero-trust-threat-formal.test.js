'use strict';
// Phase 10, Parts 1, 2 & 3 — Zero Trust architecture, enterprise threat model, and formal
// policy verification.
const test = require('node:test');
const assert = require('node:assert');
const { makeZeroTrust, MAX_CREDENTIAL_TTL_MS, WORKLOAD_ID } = require('../src/iam/zero-trust-architecture');
const tm = require('../src/security/threat-model');
const fp = require('../src/iam/formal-policy');
const contextMap = require('../src/architecture/context-map');
const ownership = require('../src/governance/ownership');

const WL = 'spiffe://njtip/zone/independent/sa/intake-api';
function zt(nowRef) {
  const z = makeZeroTrust({ clock: () => nowRef.now });
  z.workloads.register(WL, { zone: 'independent', attestation: { kind: 'synthetic-node-attestation' } });
  z.devices.register('dev-1', { trusted: true });
  z.boundaries.allow('independent', 'executive', { actions: ['review-case'], rationale: 'case routing' });
  return z;
}
const baseRequest = (now) => ({
  subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: now, deviceId: 'dev-1', zone: 'independent' },
  action: 'review-case', resource: { zone: 'executive' }, env: { geoAllowed: true },
});

// --- Part 1: Zero Trust ------------------------------------------------------------------

test('zero trust: workload identity requires a SPIFFE-shaped id and an attestation', () => {
  const ref = { now: 1_000_000 };
  const z = makeZeroTrust({ clock: () => ref.now });
  assert.ok(WORKLOAD_ID.test(WL));
  assert.throws(() => z.workloads.register('intake-api', { zone: 'independent', attestation: {} }), /SPIFFE-shaped/);
  assert.throws(() => z.workloads.register(WL, { zone: 'independent' }), /requires an attestation/);
  assert.throws(() => z.workloads.register(WL, { zone: 'executive', attestation: {} }), /zone must match/);
  assert.ok(z.workloads.register(WL, { zone: 'independent', attestation: { kind: 'node' } }).id);
});

test('zero trust: credentials are short-lived, audience-bound, expiring and revocable', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  assert.throws(() => z.workloads.issueCredential(WL, { ttlMs: MAX_CREDENTIAL_TTL_MS + 1, audience: 'reports' }), /exceeds/);
  assert.throws(() => z.workloads.issueCredential(WL, { ttlMs: 1000 }), /audience/);
  const cred = z.workloads.issueCredential(WL, { ttlMs: 60_000, audience: 'reports' });
  assert.strictEqual(z.workloads.verifyCredential(cred.id, { audience: 'reports' }).valid, true);
  assert.strictEqual(z.workloads.verifyCredential(cred.id, { audience: 'other' }).valid, false);
  ref.now += 61_000;
  assert.strictEqual(z.workloads.verifyCredential(cred.id, { audience: 'reports' }).reason, 'credential expired');
  ref.now -= 61_000;
  const c2 = z.workloads.issueCredential(WL, { ttlMs: 60_000, audience: 'reports' });
  z.workloads.revoke(WL);
  assert.strictEqual(z.workloads.verifyCredential(c2.id, { audience: 'reports' }).valid, false);
});

test('zero trust: the PDP evaluates every request through the full pipeline', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const d = z.pdp.decide(baseRequest(ref.now));
  assert.strictEqual(d.decision, 'permit');
  for (const stage of ['continuous-authentication', 'workload-identity', 'trust-boundary', 'least-privilege', 'policy-decision', 'continuous-authorization']) {
    assert.ok(d.trace.includes(stage), stage);
  }
  assert.ok(d.trustScore > 0);
  assert.match(d.note, /Signed decision|never served from cache/);
});

test('zero trust: no implicit trust — unauthenticated, stale, out-of-boundary and over-ceiling deny', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const base = baseRequest(ref.now);
  assert.strictEqual(z.pdp.decide({ ...base, subject: {} }).stage, 'authentication');
  assert.strictEqual(z.pdp.decide({ ...base, subject: { ...base.subject, authenticatedAt: ref.now - 24 * 3600_000 } }).decision, 'deny');
  assert.strictEqual(z.pdp.decide({ ...base, resource: { zone: 'judiciary' } }).stage, 'trust-boundary');
  assert.strictEqual(z.pdp.decide({ ...base, subject: { ...base.subject, role: 'citizen' } }).decision, 'deny');
  assert.strictEqual(z.pdp.decide({ ...base, subject: { ...base.subject, kind: 'workload' } }).stage, 'workload-identity');
  // Device trust CONTRIBUTES to the score rather than gating on its own: for a sensitive
  // action an untrusted device drops the request below the floor and forces step-up.
  const sensitive = { ...base, action: 'read-evidence', resource: { zone: 'independent' } };
  assert.strictEqual(z.pdp.decide(sensitive).decision, 'permit', 'trusted device meets the sensitive floor');
  const untrusted = z.pdp.decide({ ...sensitive, subject: { ...sensitive.subject, deviceId: 'unknown-device' } });
  assert.strictEqual(untrusted.decision, 'step-up');
  assert.strictEqual(untrusted.stage, 'continuous-authorization');
});

test('zero trust: every request reaches the PDP; caching skips recomputation, never checks', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const before = z.pdp.decisionsEvaluated();
  const base = baseRequest(ref.now);
  z.pdp.decide(base); z.pdp.decide(base); z.pdp.decide(base);
  assert.strictEqual(z.pdp.decisionsEvaluated(), before + 3, 'no request may bypass the PDP');
  // An unseen security context is always fully evaluated; caching is disableable per call.
  const beforeFull = z.pdp.fullEvaluations();
  z.pdp.decide({ ...base, subject: { ...base.subject, sessionId: 'other' } });
  assert.strictEqual(z.pdp.fullEvaluations(), beforeFull + 1);
  const b2 = z.pdp.fullEvaluations();
  z.pdp.decide(base, { allowCache: false });
  assert.strictEqual(z.pdp.fullEvaluations(), b2 + 1);
});

test('zero trust: the PAP publishes policy with accountability and the PDP follows immediately', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  assert.throws(() => z.pap.publish([], {}), /named human and a rationale/);
  assert.strictEqual(z.pdp.decide(baseRequest(ref.now)).decision, 'permit');
  z.pap.publish([{ id: 'deny-all', effect: 'deny', actions: '*', conditions: [] }], { by: 'ISRB', rationale: 'incident containment' });
  assert.strictEqual(z.pdp.decide(baseRequest(ref.now)).decision, 'deny');
  assert.strictEqual(z.pap.version(), 2);
  assert.strictEqual(z.pap.history().length, 2);
});

test('zero trust: the PEP enforces and audits without deciding, and leaks no identity', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const ok = z.pep.enforce(baseRequest(ref.now));
  assert.strictEqual(ok.allowed, true);
  const denied = z.pep.enforce({ ...baseRequest(ref.now), resource: { zone: 'judiciary' } });
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.error.failClosed, true);
  const trail = z.pep.auditTrail();
  assert.strictEqual(trail.length, 2);
  assert.ok(trail.every((a) => a.decision && a.reason));
  assert.ok(!/@|omang/i.test(JSON.stringify(trail)));
});

test('zero trust: trust boundaries are declared, mutually authenticated and action-scoped', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  assert.throws(() => z.boundaries.allow('a', 'b', {}), /rationale/);
  assert.strictEqual(z.boundaries.permits('independent', 'executive', 'review-case').permitted, true);
  assert.strictEqual(z.boundaries.permits('independent', 'executive', 'admit-evidence').permitted, false);
  assert.strictEqual(z.boundaries.permits('independent', 'judiciary', 'review-case').permitted, false);
  assert.strictEqual(z.boundaries.permits('executive', 'executive', 'anything').permitted, true);
  z.boundaries.allow('executive', 'judiciary', { actions: [], mutualTls: false, rationale: 'test' });
  assert.match(z.boundaries.permits('executive', 'judiciary', 'x').reason, /mutual authentication/);
});

test('zero trust: the architecture names every NIST component and its invariants', () => {
  const ref = { now: 1_000_000 };
  const arch = zt(ref).architecture();
  for (const c of ['PAP', 'PDP', 'PEP', 'Workload identity', 'Trust boundaries', 'Device trust']) {
    assert.ok(arch.components.some((x) => x.component === c), c);
  }
  assert.strictEqual(arch.pipeline.length, 6);
  assert.ok(arch.invariants.some((i) => /No implicit trust/.test(i)));
});

// --- Part 2: threat model ------------------------------------------------------------------

test('threat model: covers every threat class beyond STRIDE and LINDDUN', () => {
  for (const cls of tm.CLASSES) assert.ok(tm.threats({ threatClass: cls }).length >= 1, cls);
  assert.ok(tm.ids().length >= 8);
});

test('threat model: attack trees decompose and abuse cases are recorded', () => {
  const paths = tm.attackPaths('TH-DEANON');
  assert.ok(paths.paths.length >= 3);
  assert.ok(paths.paths.some((p) => p.operator === 'AND'), 'AND nodes are represented');
  for (const t of tm.threats()) {
    assert.ok(t.abuseCases.length >= 1, `${t.id} abuse cases`);
    assert.ok(t.attck.length >= 1, `${t.id} ATT&CK`);
    assert.ok(t.capec.length >= 1, `${t.id} CAPEC`);
    assert.ok(tm.KILL_CHAIN.includes(t.killChain), `${t.id} kill chain`);
  }
});

test('threat model: traces threat → control → evidence → verification → owner', () => {
  const ids = [...new Set(tm.threats().flatMap((t) => t.controls))];
  const rows = tm.traceability({ fitnessResults: ids.map((id) => ({ id, pass: true })) });
  for (const row of rows) {
    assert.ok(row.controls.length >= 1, `${row.threat} controls`);
    assert.ok(row.evidence, `${row.threat} evidence`);
    assert.match(row.verification, /verified/);
    assert.ok(contextMap.ids().includes(row.owner), `${row.threat} owner`);
    assert.ok(row.responsibleAuthority, `${row.threat} responsible authority`);
    assert.ok(ownership.boards().some((b) => b.id === row.governanceBoard), `${row.threat} board`);
  }
});

test('threat model: adversary playbooks name the control that breaks each step', () => {
  const pbs = tm.playbooks();
  assert.ok(pbs.length >= 3);
  for (const pb of pbs) {
    assert.ok(pb.adversary && pb.threats.length && pb.sequence.length >= 2, pb.id);
    for (const s of pb.sequence) { assert.ok(tm.KILL_CHAIN.includes(s.phase)); assert.ok(s.technique); assert.ok(s.breaksAt); }
  }
});

test('threat model: residual risk reacts to a failing control and weights by severity', () => {
  const ids = [...new Set(tm.threats().flatMap((t) => t.controls))];
  const allPass = ids.map((id) => ({ id, pass: true }));
  assert.strictEqual(tm.residualRisk({ fitnessResults: allPass }).clean, true);
  const failing = allPass.map((r) => (r.id === 'FIT-IDENTITY-MINIMIZATION' ? { ...r, pass: false } : r));
  const risk = tm.residualRisk({ fitnessResults: failing });
  assert.strictEqual(risk.clean, false);
  assert.ok(risk.totalExposure > 0);
  assert.strictEqual(risk.residual[0].threat, 'TH-DEANON');
});

// --- Part 3: formal policy verification -----------------------------------------------------

test('formal policy: every critical policy domain has a specification', () => {
  const kinds = new Set(fp.specifications().map((s) => s.kind));
  for (const required of ['authorization', 'separation-of-duties', 'approval-chain', 'escalation', 'evidence-custody', 'data-residency', 'legislative']) {
    assert.ok(kinds.has(required), required);
  }
  for (const s of fp.specifications()) { assert.ok(s.statement.length > 20, s.id); assert.ok(s.title, s.id); }
});

test('formal policy: all specifications are proven over their full bounded domain', () => {
  const report = fp.verifyAll({ mandates: [{ instrument: 'dpa', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }] });
  assert.strictEqual(report.allProven, true, JSON.stringify(report.failed));
  assert.ok(report.statesExplored > 1000, 'the state space must be real');
  for (const r of report.results) assert.strictEqual(r.statesExplored, r.statesInDomain, `${r.specification} explored its whole domain`);
  assert.strictEqual(report.authorizes, false);
});

test('formal policy: a violated property yields a deterministic counterexample', () => {
  const permitAll = [{ id: 'permit-all', effect: 'permit', actions: '*', conditions: [] }];
  const a = fp.check('SPEC-SUSPENDED-DENIED', { policies: permitAll });
  assert.strictEqual(a.proven, false);
  assert.ok(a.counterexample.state.suspended === true);
  assert.match(a.counterexample.reason, /suspended subject permitted/);
  const b = fp.check('SPEC-SUSPENDED-DENIED', { policies: permitAll });
  assert.deepStrictEqual(a.counterexample, b.counterexample, 'counterexamples must reproduce exactly');
});

test('formal policy: legislative compliance catches an unimplemented or failing mandate', () => {
  assert.strictEqual(fp.check('SPEC-LEGISLATIVE-COMPLIANCE', { mandates: [{ instrument: 'x', control: 'NONE', implemented: false }] }).proven, false);
  assert.strictEqual(fp.check('SPEC-LEGISLATIVE-COMPLIANCE', { mandates: [{ instrument: 'x', control: 'C', implemented: true, holding: false }] }).proven, false);
  assert.strictEqual(fp.check('SPEC-LEGISLATIVE-COMPLIANCE', { mandates: [{ instrument: 'x', control: 'C', implemented: true, holding: true }] }).proven, true);
});

test('formal policy: continuous validation is fail-closed and never authorizes', () => {
  const cv = fp.continuousValidation({ mandates: [] });
  assert.strictEqual(cv.failClosed, true);
  assert.strictEqual(cv.authorizes, false);
  assert.match(cv.verdict, /proven/);
  assert.match(cv.note, /does not authorize/i);
});
