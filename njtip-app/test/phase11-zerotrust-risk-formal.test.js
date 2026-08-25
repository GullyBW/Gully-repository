'use strict';
// Phase 11, Parts 1, 2 & 3 — production-grade Zero Trust optimization, enterprise risk
// intelligence, and the expanded formal verification engine.
const test = require('node:test');
const assert = require('node:assert');
const { makeZeroTrust, AuthorizationDecisionCache, RevocationRegistry, MAX_DECISION_TTL_MS } = require('../src/iam/zero-trust-architecture');
const tm = require('../src/security/threat-model');
const fp = require('../src/iam/formal-policy');

const CONTROL_IDS = [...new Set(tm.threats().flatMap((t) => t.controls))];
const GREEN = CONTROL_IDS.map((id) => ({ id, pass: true }));
const RED = GREEN.map((r) => (r.id === 'FIT-IDENTITY-MINIMIZATION' ? { ...r, pass: false } : r));

function zt(ref) {
  const z = makeZeroTrust({ clock: () => ref.now });
  z.devices.register('dev-1', { trusted: true });
  return z;
}
const req = (now, over = {}) => ({
  subject: { principal: 'inv-001', role: 'investigator', mfa: 'fido2', authenticatedAt: now, deviceId: 'dev-1', zone: 'independent', sessionId: 'S1', ...(over.subject || {}) },
  action: over.action || 'review-case', resource: over.resource || { zone: 'independent' }, env: { geoAllowed: true, ...(over.env || {}) },
});

// --- Part 1: Zero Trust optimization -------------------------------------------------------

test('zero trust cache: a permit issues a signed, short-lived decision that is reusable', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const first = z.pdp.decide(req(ref.now));
  assert.strictEqual(first.decision, 'permit');
  assert.ok(first.decisionToken.signature && first.decisionToken.digest);
  assert.ok(first.decisionToken.expiresAt - first.decisionToken.issuedAt <= MAX_DECISION_TTL_MS);
  const second = z.pdp.decide(req(ref.now));
  assert.strictEqual(second.stage, 'cached');
  assert.strictEqual(second.cached, true);
});

test('zero trust cache: a decision is bound to its security context, not just its principal', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  z.pdp.decide(req(ref.now));
  // Same principal and session, different role — must NOT reuse the cached permit.
  const escalated = z.pdp.decide(req(ref.now, { subject: { role: 'citizen' } }));
  assert.notStrictEqual(escalated.stage, 'cached');
  assert.strictEqual(escalated.decision, 'deny');
  // Same principal, weaker MFA on a sensitive action — also not reusable.
  const weaker = z.pdp.decide(req(ref.now, { action: 'read-evidence', subject: { mfa: 'otp' } }));
  assert.notStrictEqual(weaker.decision, 'permit');
});

test('zero trust cache: tampering, forgery and expiry all invalidate a decision', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const token = z.pdp.decide(req(ref.now)).decisionToken;
  assert.strictEqual(z.cache.verify({ ...token, principal: 'attacker' }, { policyVersion: z.pap.version() }).reason, 'tampered');
  assert.strictEqual(z.cache.verify({ ...token, signature: 'nope' }, { policyVersion: z.pap.version() }).reason, 'bad-signature');
  ref.now += MAX_DECISION_TTL_MS + 1;
  assert.strictEqual(z.cache.verify(token, { policyVersion: z.pap.version() }).reason, 'expired');
});

test('zero trust cache: revocation is immediate and beats any cached decision', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  z.pdp.decide(req(ref.now));
  assert.strictEqual(z.pdp.decide(req(ref.now)).stage, 'cached');
  z.revoke.session('S1', { by: 'Security Operations Centre', reason: 'suspected compromise' });
  const after = z.pdp.decide(req(ref.now));
  assert.strictEqual(after.decision, 'deny');
  assert.strictEqual(after.stage, 'revocation');
  // Subject revocation behaves identically.
  const z2 = zt(ref);
  z2.pdp.decide(req(ref.now));
  z2.revoke.subject('inv-001', { by: 'ISRB', reason: 'role withdrawn' });
  assert.strictEqual(z2.pdp.decide(req(ref.now)).stage, 'revocation');
  assert.throws(() => z2.revocations.revokeSession('X', { by: 'ops' }), /named actor and a reason/);
});

test('zero trust cache: a policy change invalidates every cached decision', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const token = z.pdp.decide(req(ref.now)).decisionToken;
  assert.ok(z.cache.size() >= 1);
  z.pap.publish([{ id: 'permit-all', effect: 'permit', actions: '*', conditions: [] }], { by: 'ISRB', rationale: 'containment' });
  assert.strictEqual(z.cache.size(), 0);
  assert.strictEqual(z.cache.verify(token, { policyVersion: z.pap.version() }).reason, 'stale-policy-version');
  assert.notStrictEqual(z.pdp.decide(req(ref.now)).stage, 'cached');
});

test('zero trust cache: replay protection and session binding', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  const token = z.pdp.decide(req(ref.now)).decisionToken;
  assert.strictEqual(z.cache.verify(token, { policyVersion: z.pap.version(), nonce: 'n1' }).valid, true);
  assert.strictEqual(z.cache.verify(token, { policyVersion: z.pap.version(), nonce: 'n1' }).reason, 'replayed-nonce');
  assert.notStrictEqual(z.pdp.decide(req(ref.now, { subject: { sessionId: 'S2' } })).stage, 'cached');
});

test('zero trust cache: sensitive actions are never cached and triggers force re-evaluation', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  z.pdp.decide(req(ref.now, { action: 'read-evidence' }));
  const again = z.pdp.decide(req(ref.now, { action: 'read-evidence' }));
  assert.notStrictEqual(again.stage, 'cached');
  assert.ok(again.reevaluationTriggers.includes('sensitive-action'));
  for (const [env, trigger] of [[{ riskLevel: 'high' }, 'elevated-risk'], [{ devicePostureChanged: true }, 'device-posture-changed'], [{ forceReevaluation: true }, 'explicit-request']]) {
    assert.ok(z.pdp.reevaluationTriggers(req(ref.now, { env })).includes(trigger), trigger);
  }
});

test('zero trust: cross-region policy synchronization gates authorization', () => {
  const ref = { now: 1_000_000 };
  const z = zt(ref);
  z.policySync.register('bw-south', { version: 0 });
  assert.strictEqual(z.pdp.decide(req(ref.now, { env: { region: 'bw-south' } })).stage, 'policy-sync');
  z.policySync.sync('bw-south', z.pap.version());
  assert.strictEqual(z.pdp.decide(req(ref.now, { env: { region: 'bw-south' } })).decision, 'permit');
  const status = z.policySync.status(z.pap.version());
  assert.strictEqual(status.allInSync, true);
  assert.deepStrictEqual(status.stale, []);
});

test('zero trust cache: an over-long decision TTL is refused at construction', () => {
  assert.throws(() => new AuthorizationDecisionCache({ revocations: new RevocationRegistry(), ttlMs: MAX_DECISION_TTL_MS + 1 }), /exceeds/);
});

// --- Part 2: risk intelligence ----------------------------------------------------------------

test('risk: the lifecycle runs threat → residual → owner → review date', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  const rows = rr.lifecycle({ fitnessResults: GREEN });
  assert.strictEqual(rows.length, tm.ids().length);
  for (const row of rows) {
    assert.ok(row.owner && row.responsibleAuthority && row.governanceBoard, row.threat);
    assert.strictEqual(typeof row.residualRisk, 'number', row.threat);
    assert.strictEqual(typeof row.reviewDate, 'number', row.threat);
    assert.ok(row.evidence && row.verification, row.threat);
  }
});

test('risk: control effectiveness and residual risk react to the live gate', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.strictEqual(rr.controlEffectiveness('TH-DEANON', GREEN).score, 1);
  assert.strictEqual(rr.residual('TH-DEANON', { fitnessResults: GREEN }).residual, 0);
  const red = rr.residual('TH-DEANON', { fitnessResults: RED });
  assert.ok(red.residual > 0);
  assert.ok(rr.controlEffectiveness('TH-DEANON', RED).score < 1);
  assert.strictEqual(rr.controlEffectiveness('TH-DEANON', RED).failing, 1);
  assert.strictEqual(red.treatment, 'open — treat or accept');
});

test('risk: acceptance requires a named human, a rationale and an expiry — and it lapses', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.throws(() => rr.accept('TH-DEANON', { rationale: 'x' }), /named human authority/);
  assert.throws(() => rr.accept('TH-DEANON', { by: 'OB', rationale: 'x', days: 400 }), /expire within 365 days/);
  const acc = rr.accept('TH-DEANON', { by: 'Oversight Board', rationale: 'compensating control', days: 30, now: 0 });
  assert.strictEqual(rr.acceptanceFor('TH-DEANON', { now: 0 }).current, true);
  assert.strictEqual(rr.residual('TH-DEANON', { fitnessResults: RED, now: 0 }).treatment, 'accepted (time-boxed)');
  const later = 31 * 24 * 3600_000;
  assert.strictEqual(rr.acceptanceFor('TH-DEANON', { now: later }).current, false);
  assert.strictEqual(rr.expiredAcceptances({ now: later })[0].id, acc.id);
  assert.strictEqual(rr.validate({ fitnessResults: RED, now: later }).valid, false);
});

test('risk: reviews come due by severity and a reassessment resets the clock', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.strictEqual(rr.reviewReminders({ now: 0 }).length, tm.ids().length);
  assert.strictEqual(rr.reviewDue('TH-DEANON', { now: 0 }).neverAssessed, true);
  rr.reassess('TH-DEANON', { by: 'CISO', findings: 'controls verified', now: 0 });
  assert.strictEqual(rr.reviewDue('TH-DEANON', { now: 0 }).overdue, false);
  assert.strictEqual(rr.reviewDue('TH-DEANON', { now: 400 * 24 * 3600_000 }).overdue, true);
  assert.ok(tm.REVIEW_CADENCE_DAYS.critical < tm.REVIEW_CADENCE_DAYS.low);
});

test('risk: threat intelligence raises attention only and refuses identity', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.throws(() => rr.ingestIntelligence({ source: 'a@b.c', threat: 'TH-DEANON', indicator: 'x' }), /refuses identity/);
  assert.throws(() => rr.ingestIntelligence({ source: 's', threat: 'TH-UNKNOWN', indicator: 'x' }), /unknown threat/);
  const rec = rr.ingestIntelligence({ source: 'national-cirt', threat: 'TH-DEANON', indicator: 'campaign-x' });
  assert.strictEqual(rec.effect, 'raises-attention-only');
  assert.strictEqual(rr.intelligence('TH-DEANON').length, 1);
});

test('risk: heat map and trend are computed and react to repair', () => {
  const rr = new tm.RiskRegister({ clock: () => 0 });
  assert.strictEqual(rr.heatMap({ fitnessResults: GREEN }).clean, true);
  const hot = rr.heatMap({ fitnessResults: RED });
  assert.strictEqual(hot.clean, false);
  assert.strictEqual(hot.worst.threat, 'TH-DEANON');
  rr.snapshot({ fitnessResults: RED, now: 0 });
  rr.snapshot({ fitnessResults: GREEN, now: 1 });
  assert.strictEqual(rr.trend().direction, 'improving');
  assert.strictEqual(rr.report({ fitnessResults: GREEN }).authorizes, false);
});

// --- Part 3: formal verification expansion --------------------------------------------------------

test('formal: all sixteen properties are proven exhaustively', () => {
  const report = fp.verifyAll({ mandates: [{ instrument: 'dpa', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }] });
  assert.strictEqual(report.allProven, true, JSON.stringify(report.failed));
  assert.ok(report.specifications >= 16);
  assert.ok(report.statesExplored > 10_000);
  assert.strictEqual(fp.stateCoverage({}).fullyExhaustive, true);
});

test('formal: the catalogue publishes a guarantee for every property', () => {
  const cat = fp.catalogue();
  assert.ok(cat.properties.length >= 16);
  for (const p of cat.properties) assert.ok(p.guarantee, p.id);
  for (const required of ['authorization', 'separation-of-duties', 'evidence-integrity', 'non-interference', 'privilege-escalation', 'workflow-consistency', 'event-ordering', 'deadlock-freedom', 'data-residency', 'legislative']) {
    assert.ok(cat.kinds.includes(required), required);
  }
});

test('formal: every new property can detect its own violation', () => {
  const cases = [
    ['SPEC-NON-INTERFERENCE', { from: 'independent', to: 'executive', carriesIdentity: true, mechanism: 'domain-event' }],
    ['SPEC-NO-PRIVILEGE-ESCALATION', { from: 'citizen', to: 'admin', granted: false, fromRank: 0, toRank: 3 }],
    ['SPEC-EVIDENCE-INTEGRITY', { entries: [{ digest: 'a', previous: null, signed: true }, { digest: 'b', previous: 'WRONG', signed: true }] }],
    ['SPEC-EVIDENCE-INTEGRITY', { entries: [{ digest: 'a', previous: null, signed: false }] }],
    ['SPEC-WORKFLOW-CONSISTENCY', { steps: ['assigned', 'reviewed'], terminal: null }],
    ['SPEC-WORKFLOW-CONSISTENCY', { steps: ['received', 'reviewed', 'reviewed'], terminal: null }],
    ['SPEC-EVENT-ORDERING', { stream: 'X', sequences: [1, 3] }],
    ['SPEC-DEADLOCK-FREEDOM', { states: { a: ['b'], b: ['a'] }, terminal: ['done'] }],
  ];
  for (const [spec, bad] of cases) {
    assert.ok(fp.SPECIFICATIONS[spec].holds(bad, { policySet: null, mandates: [] }), `${spec} must reject ${JSON.stringify(bad)}`);
  }
});

test('formal: the proof summary carries method, guarantees and no authority claim', () => {
  const summary = fp.proofSummary({ mandates: [] });
  assert.strictEqual(summary.failed, 0);
  assert.ok(summary.method.includes('bounded') || summary.method.includes('Bounded'));
  assert.strictEqual(summary.authorizes, false);
  assert.ok(summary.guarantees.every((g) => g.guarantee));
  assert.deepStrictEqual(summary.counterexamples, []);
});
