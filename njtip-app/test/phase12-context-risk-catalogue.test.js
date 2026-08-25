'use strict';
// Phase 12, Parts 1, 2 & 3 — context-aware Zero Trust, quantitative risk intelligence, and the
// machine-readable formal verification catalogue.
const test = require('node:test');
const assert = require('node:assert');
const zt = require('../src/iam/zero-trust-architecture');
const tm = require('../src/security/threat-model');
const fp = require('../src/iam/formal-policy');

const NOW = 1_000_000;
function makeZt() {
  const z = zt.makeZeroTrust({ clock: () => NOW });
  z.devices.register('dev-1', { trusted: true });
  return z;
}
const req = (over = {}) => ({
  subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: NOW, deviceId: 'dev-1', devicePosture: 'healthy', zone: 'executive', sessionId: 'S1', clearance: 'secret', tenant: 'dcec', jurisdiction: 'BW', credentialVersion: 3, ...(over.subject || {}) },
  action: over.action || 'review-case',
  resource: { zone: 'executive', ...(over.resource || {}) },
  env: { network: 'gov-wan', hourOfDay: 10, ...(over.env || {}) },
  ...(over.nonce ? { nonce: over.nonce } : {}),
});

// --- Part 1: context-aware Zero Trust -------------------------------------------------------------

test('assurance level is derived from the authenticator, never asserted', () => {
  assert.strictEqual(zt.assuranceLevelOf({ mfa: 'fido2' }), 'AAL3');
  assert.strictEqual(zt.assuranceLevelOf({ mfa: 'totp' }), 'AAL2');
  assert.strictEqual(zt.assuranceLevelOf({ mfa: 'password' }), 'AAL1');
  assert.strictEqual(zt.assuranceLevelOf({}), 'AAL0');
  assert.notStrictEqual(zt.assuranceLevelOf({ assuranceLevel: 'AAL3' }), 'AAL3', 'a self-asserted level must not be believed');
  assert.ok(zt.assuranceRank('AAL3') > zt.assuranceRank('AAL2'));
  // The constitutional path stays open to a citizen with only a browser.
  assert.strictEqual(zt.ACTION_ASSURANCE_FLOOR['submit-report'], 'AAL0');
  assert.strictEqual(zt.ACTION_ASSURANCE_FLOOR['read-evidence'], 'AAL3');
});

test('each authorization context condition denies on its own and names itself', () => {
  const z = makeZt();
  assert.strictEqual(z.pdp.decide(req()).decision, 'permit');
  const cases = [
    ['assurance', req({ subject: { mfa: 'totp' }, action: 'read-evidence' }), /AAL3 required/],
    ['clearance', req({ subject: { clearance: 'internal' }, resource: { classification: 'secret' } }), /clearance/],
    ['tenant', req({ resource: { tenant: 'other-agency' } }), /tenant/],
    ['jurisdiction', req({ resource: { jurisdiction: 'ZA' } }), /jurisdiction/],
    ['credential version', req({ subject: { credentialVersion: 1 }, env: { minCredentialVersion: 3 } }), /credential/],
    ['device posture', req({ subject: { devicePosture: 'compromised' } }), /compromised/],
    ['network', req({ action: 'read-evidence', env: { network: 'public-internet' } }), /network/],
    ['geo', req({ env: { geoAllowed: false } }), /not permitted/],
  ];
  for (const [name, r, pattern] of cases) {
    const d = z.pdp.decide(r, { allowCache: false });
    assert.strictEqual(d.decision, 'deny', `${name} was permitted`);
    assert.match(d.reason, pattern, name);
  }
});

test('reading below clearance is permitted; reading above it is not', () => {
  const z = makeZt();
  assert.strictEqual(z.pdp.decide(req({ subject: { clearance: 'secret' }, resource: { classification: 'restricted' } })).decision, 'permit');
  assert.strictEqual(z.pdp.decide(req({ subject: { clearance: 'internal' }, resource: { classification: 'secret' } })).decision, 'deny');
});

test('policy freshness: deciding against a superseded policy version is refused', () => {
  const z = makeZt();
  const current = z.pap.version();
  assert.strictEqual(z.pdp.decide(req({ env: { policyVersion: current } })).decision, 'permit');
  const stale = z.pdp.decide(req({ env: { policyVersion: current - 1 } }));
  assert.strictEqual(stale.decision, 'deny');
  assert.match(stale.reason, /policy version/);
  assert.strictEqual(z.pdp.decide(req({ env: { policyVersion: current + 5 } })).decision, 'deny');
});

test('replay detection: an authorization request nonce is single-use', () => {
  const z = makeZt();
  assert.strictEqual(z.pdp.decide(req({ nonce: 'N1' })).decision, 'permit');
  const replay = z.pdp.decide(req({ nonce: 'N1' }));
  assert.strictEqual(replay.decision, 'deny');
  assert.match(replay.reason, /replay/);
  assert.strictEqual(z.pdp.decide(req({ nonce: 'N2' })).decision, 'permit');
});

test('every context field participates in the digest — including the resource side', () => {
  const C = zt.AuthorizationDecisionCache;
  const base = C.subjectContextDigest(req());
  const perturbations = {
    assurance: req({ subject: { mfa: 'totp' } }),
    clearance: req({ subject: { clearance: 'internal' } }),
    'subject tenant': req({ subject: { tenant: 'other' } }),
    // The resource's own tenant matters as much as the subject's: without it a cached permit for
    // one agency's resource is replayable against another's.
    'resource tenant': req({ resource: { tenant: 'other-agency' } }),
    'resource jurisdiction': req({ resource: { jurisdiction: 'ZA' } }),
    'credential version': req({ subject: { credentialVersion: 9 } }),
    'device posture': req({ subject: { devicePosture: 'unknown' } }),
    classification: req({ resource: { classification: 'secret' } }),
    network: req({ env: { network: 'public-internet' } }),
    'time window': req({ env: { hourOfDay: 23 } }),
  };
  for (const [what, r] of Object.entries(perturbations)) {
    assert.notStrictEqual(C.subjectContextDigest(r), base, `${what} is not in the security boundary`);
  }
  // Something genuinely irrelevant must NOT change it, or nothing would ever cache.
  assert.strictEqual(C.subjectContextDigest(req({ subject: { displayHint: 'x' } })), base);
});

test('a context change invalidates a cached decision; publication invalidates the whole cache', () => {
  const z = makeZt();
  assert.strictEqual(z.pdp.decide(req()).decision, 'permit');
  assert.ok(z.pdp.decide(req()).cached, 'an identical repeat was not cached — caching is inert');
  assert.ok(!z.pdp.decide(req({ subject: { clearance: 'internal' } })).cached);
  z.pap.publish(z.pap.registry(), { by: 'ISRB Chair', rationale: 'periodic republication' });
  assert.ok(!z.pdp.decide(req()).cached, 'a decision survived a policy publication');
});

test('republishing the current policy set is a faithful round-trip', () => {
  const z = makeZt();
  // registry() used to return a display summary that dropped conditions; republishing it turned
  // every conditional deny into a blanket deny and took authorization down.
  z.pap.publish(z.pap.registry(), { by: 'ISRB Chair', rationale: 'republication' });
  assert.strictEqual(z.pdp.decide(req()).decision, 'permit', 'republishing the current policy denied a valid request');
  assert.ok(z.pap.registry().every((p) => Array.isArray(p.conditions)), 'registry() lost the policy conditions');
  assert.ok(z.pap.summary().length > 0, 'the display summary is still available');
});

test('policy synchronisation and revocation both propagate immediately', () => {
  const z = makeZt();
  const before = z.pap.version();
  z.pap.publish(z.pap.registry(), { by: 'ISRB Chair', rationale: 'republication' });
  z.policySync.register('bw-south', { version: before });
  const withRegion = { ...req(), env: { ...req().env, region: 'bw-south' } };
  assert.strictEqual(z.pdp.decide(withRegion).decision, 'deny', 'a lagging region served authorization');
  z.policySync.sync('bw-south', z.pap.version());
  assert.strictEqual(z.pdp.decide(withRegion).decision, 'permit');

  z.revocations.revokeSession('S1', { by: 'SOC Lead', reason: 'suspected compromise' });
  const revoked = z.pdp.decide(req());
  assert.strictEqual(revoked.decision, 'deny');
  assert.match(revoked.reason, /revoked/);
});

// --- Part 2: quantitative risk ----------------------------------------------------------------

const CONTROLS = [...new Set(tm.threats().flatMap((t) => t.controls))];
const GREEN = CONTROLS.map((id) => ({ id, pass: true }));
const RED = CONTROLS.map((id) => ({ id, pass: false }));
const THREAT = tm.ids()[0];

test('both risk scales are 1..5 ordinals with a stated meaning per point', () => {
  for (const scale of [tm.LIKELIHOOD_SCALE, tm.IMPACT_SCALE]) {
    assert.deepStrictEqual(Object.values(scale).map((s) => s.value).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    for (const s of Object.values(scale)) assert.ok(s.description);
  }
});

test('an unquantified risk reports unscored, never a plausible number', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  const q = rr.quantitative(THREAT, { fitnessResults: GREEN });
  assert.strictEqual(q.measured, false);
  assert.strictEqual(q.residualScore, null);
  assert.strictEqual(q.band, 'unscored');
});

test('risk = likelihood × impact, and residual is derived from control effectiveness', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.throws(() => rr.score(THREAT, { likelihood: 'possible', impact: 'severe' }), /named assessor/);
  assert.throws(() => rr.score(THREAT, { likelihood: 'quite-likely', impact: 'severe', by: 'CISO', rationale: 'r' }), /unknown likelihood/);
  rr.score(THREAT, { likelihood: 'possible', impact: 'severe', by: 'CISO', rationale: 'observed in comparable systems' });

  const uncontrolled = rr.quantitative(THREAT, { fitnessResults: RED });
  assert.strictEqual(uncontrolled.inherentScore, 15);
  assert.strictEqual(uncontrolled.residualScore, 15);
  assert.strictEqual(uncontrolled.band, 'critical');
  assert.strictEqual(uncontrolled.withinTolerance, false);
  const controlled = rr.quantitative(THREAT, { fitnessResults: GREEN });
  assert.strictEqual(controlled.residualScore, 0);
  assert.strictEqual(controlled.derivedFromQuantitative, true);
  assert.strictEqual(controlled.qualitative, controlled.band);
  assert.ok(controlled.formula);
});

test('a compensating control is credited only when a fitness function verifies it, and is capped', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  rr.score(THREAT, { likelihood: 'possible', impact: 'severe', by: 'CISO', rationale: 'r' });
  assert.throws(() => rr.registerCompensating(THREAT, { control: 'X' }), /rationale/);
  rr.registerCompensating(THREAT, { control: CONTROLS[0], rationale: 'independent detective control', by: 'SOC Lead' });
  assert.strictEqual(rr.quantitative(THREAT, { fitnessResults: RED }).compensating.credit, 0);
  const verified = rr.quantitative(THREAT, { fitnessResults: [{ id: CONTROLS[0], pass: true }, ...RED.slice(1)] });
  assert.ok(verified.compensating.credit > 0);
  assert.strictEqual(rr.compensatingCredit(THREAT, { fitnessResults: [], extra: ['NO-SUCH-CONTROL'] }).credit, 0);
  const stacked = rr.compensatingCredit(THREAT, { fitnessResults: GREEN, extra: CONTROLS.slice(0, 8) });
  assert.ok(stacked.credit <= tm.COMPENSATING_CREDIT_CAP);
});

test('a treatment plan needs a strategy, an owner, actions, a bounded date and evidence to close', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.throws(() => rr.planTreatment(THREAT, { strategy: 'ignore' }), /unknown treatment strategy/);
  assert.throws(() => rr.planTreatment(THREAT, { strategy: 'treat', owner: 'X', by: 'Y', rationale: 'r', actions: [] }), /not a plan/);
  assert.throws(() => rr.planTreatment(THREAT, { strategy: 'treat', owner: 'X', by: 'Y', rationale: 'r', actions: ['a'], dueInDays: 400 }), /within 365 days/);
  const plan = rr.planTreatment(THREAT, { strategy: 'treat', owner: 'SOC', by: 'CISO', rationale: 'above tolerance', dueInDays: 30, actions: ['implement the control'] });
  assert.strictEqual(plan.state, 'open');
  assert.throws(() => rr.closeTreatment(plan.id, { by: 'CISO' }), /evidence/);
  assert.strictEqual(rr.overdueTreatments({ now: 0 }).length, 0);
  assert.strictEqual(rr.overdueTreatments({ now: 60 * 24 * 3600_000 }).length, 1);
  assert.strictEqual(rr.closeTreatment(plan.id, { by: 'CISO', evidence: 'verified by the fitness gate' }).state, 'closed');
  for (const s of ['transfer', 'avoid', 'accept']) assert.strictEqual(tm.TREATMENT_STRATEGIES[s].requiresBoard, true);
});

test('risk forecasting is deterministic and reacts to a worsening exposure trend', () => {
  const empty = new tm.RiskRegister({ clock: () => 0 });
  assert.strictEqual(empty.forecast().direction, 'insufficient-data');
  const rr = new tm.RiskRegister({ clock: () => 0 });
  for (let i = 0; i < 5; i++) rr.snapshot({ fitnessResults: CONTROLS.map((id, idx) => ({ id, pass: idx >= i })), now: i });
  const f = rr.forecast();
  assert.strictEqual(f.direction, 'worsening');
  assert.strictEqual(f.breachExpected, true);
  assert.strictEqual(f.authorizes, false);
  assert.deepStrictEqual(rr.forecast(), f);
});

// --- Part 3: formal verification catalogue -------------------------------------------------------

const MANDATES = [{ instrument: 'data-protection-act', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }];

test('the catalogue covers every area Part 3 requires and every property is proven', () => {
  const cat = fp.catalogue({ mandates: MANDATES });
  const kinds = new Set(cat.properties.map((p) => p.kind));
  for (const kind of ['authorization', 'privilege-escalation', 'separation-of-duties', 'evidence-integrity',
    'workflow-consistency', 'event-ordering', 'legislative', 'data-residency', 'deadlock-freedom']) {
    assert.ok(kinds.has(kind), `no property covers ${kind}`);
  }
  assert.strictEqual(cat.allProven, true, cat.refuted.join(', '));
  assert.strictEqual(cat.machineReadable, true);
  assert.strictEqual(cat.total, Object.keys(fp.SPECIFICATIONS).length);
});

test('every catalogue row carries context, method, coverage, ADR and an accountable owner', () => {
  const cat = fp.catalogue({ mandates: MANDATES });
  for (const p of cat.properties) {
    for (const field of ['id', 'description', 'statement', 'kind', 'boundedContext', 'verificationMethod',
      'proofStatus', 'proofCoverage', 'owningAdr', 'responsibleOwner', 'governanceBoard', 'guarantee']) {
      assert.ok(p[field] !== null && p[field] !== undefined, `${p.id}: missing ${field}`);
    }
    assert.strictEqual(p.proofStatus, 'proven');
    assert.strictEqual(p.proofCoverage, 1);
    assert.strictEqual(p.counterexample, null);
  }
});

test('catalogue validation bites: an ungoverned specification fails', () => {
  assert.strictEqual(fp.validateCatalogue({ mandates: MANDATES }).valid, true);
  const original = fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'];
  try {
    delete fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'];
    const bad = fp.validateCatalogue({ mandates: MANDATES });
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.violations.some((x) => /no governance record|no bounded context/.test(x)));
  } finally { fp.SPEC_GOVERNANCE['SPEC-AUTHZ-DEFAULT-DENY'] = original; }
  try {
    fp.SPEC_GOVERNANCE['SPEC-IMAGINARY'] = { context: 'assurance', adr: 'ADR-0001' };
    assert.strictEqual(fp.validateCatalogue({ mandates: MANDATES }).valid, false);
  } finally { delete fp.SPEC_GOVERNANCE['SPEC-IMAGINARY']; }
});

test('the proof report is deterministic, grouped and claims no authority', () => {
  const r = fp.proofReport({ mandates: MANDATES });
  assert.strictEqual(r.validation.valid, true);
  assert.strictEqual(r.authorizes, false);
  assert.ok(Object.keys(r.byContext).length > 1);
  assert.ok(Object.keys(r.byMethod).length > 1, '"proven" must not mean the same thing for every property');
  assert.ok(!r.byContext.unowned);
  assert.deepStrictEqual(fp.proofReport({ mandates: MANDATES }), r);
});
