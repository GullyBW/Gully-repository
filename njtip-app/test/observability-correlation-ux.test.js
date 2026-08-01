'use strict';
// Stabilization Parts 5, 12, 13 & 15 — the end-to-end vertical slice, audience-specific
// observability, cross-domain correlation governance, and usability validation.
const test = require('node:test');
const assert = require('node:assert');
const dash = require('../src/observability/dashboards');
const { CorrelationGovernance } = require('../src/intelligence/correlation-governance');
const { UsabilityValidation, PERSONAS, seedRound } = require('../src/ux/usability-validation');
const contextMap = require('../src/architecture/context-map');
const ownership = require('../src/governance/ownership');
const { run } = require('../scripts/slice');

const BOARDS = ownership.boards().map((b) => b.id);
const SOURCES = {
  fitness: { held: 82, total: 82, failing: [] },
  architecture: { valid: true }, contracts: { covered: 16 },
  evolution: { openInvariantFailures: 0 }, maturity: { grade: 'A' },
  service: { total: 42, resolutionRate: 0.8, backlog: 7 },
};

// --- Part 5: production vertical slice --------------------------------------------------

test('vertical slice runs end to end through the composed application', () => {
  const out = run();
  assert.strictEqual(out.complete, true);
  assert.strictEqual(out.steps.length, 10);
  const names = out.steps.map((s) => s.name);
  assert.ok(names[0].includes('anonymous report'));
  assert.ok(names.some((n) => n.includes('governance decision')));
  assert.ok(names.some((n) => n.includes('twin')));
  // The constitutional guarantees hold along the whole path.
  assert.strictEqual(out.steps[0].identityStored, false);
  assert.notStrictEqual(out.steps[0].recipient, 'police');
  assert.strictEqual(out.steps[2].custodyChainIntact, true);
  assert.strictEqual(out.steps[5].automated, false);
  assert.strictEqual(out.steps[6].authorizesDeployment, false);
  assert.strictEqual(out.steps[7].invariantsHeld, true);
});

test('vertical slice transcript is deterministic', () => {
  assert.strictEqual(run().digest, run().digest, 'two runs must produce the same transcript digest');
});

// --- Part 12: observability domains -------------------------------------------------------

test('observability: six domains, each with a distinct audience, board and question', () => {
  assert.deepStrictEqual(dash.validate({ boards: BOARDS }).violations, []);
  const required = ['engineering-health', 'security-posture', 'operational-performance', 'governance-effectiveness', 'citizen-service-delivery', 'infrastructure-health'];
  assert.deepStrictEqual(dash.ids().sort(), required.slice().sort());
  const audiences = dash.audiences();
  assert.strictEqual(new Set(audiences.map((a) => a.audience)).size, 6);
  for (const a of audiences) { assert.ok(a.question.endsWith('?')); assert.ok(BOARDS.includes(a.board)); }
});

test('observability: dashboards are deterministic, informational and never authorize', () => {
  assert.deepStrictEqual(dash.all(SOURCES), dash.all(SOURCES));
  for (const id of dash.ids()) {
    const d = dash.dashboard(id, SOURCES);
    assert.strictEqual(d.informationalOnly, true);
    assert.strictEqual(d.authorizes, false);
    assert.ok(d.widgets.length >= 4);
  }
  assert.strictEqual(dash.dashboard('engineering-health', SOURCES).widgets.find((w) => w.id === 'invariants-held').value, 1);
});

test('observability: identity is refused and small cells are suppressed on dashboards', () => {
  const leak = dash.renderWidget({ id: 'x', title: 'x', source: 'leak', type: 'label' }, { leak: 'reporter@example.com' });
  assert.strictEqual(leak.status, 'refused');
  assert.strictEqual(leak.value, null);
  const small = dash.renderWidget({ id: 'c', title: 'c', source: 'n', type: 'count' }, { n: 2 });
  assert.strictEqual(small.suppressed, true);
  assert.strictEqual(small.value, null);
  const big = dash.renderWidget({ id: 'c', title: 'c', source: 'n', type: 'count' }, { n: 42 });
  assert.strictEqual(big.value, 42);
});

test('observability: a missing source degrades visibly instead of rendering a false zero', () => {
  const w = dash.renderWidget({ id: 'm', title: 'm', source: 'nowhere.at.all', type: 'count' }, {});
  assert.strictEqual(w.status, 'unavailable');
  assert.strictEqual(w.value, null);
});

// --- Part 13: correlation governance --------------------------------------------------------

test('correlation: the register is complete and internally consistent', () => {
  const cg = new CorrelationGovernance({ clock: () => 0 });
  assert.deepStrictEqual(cg.validate({ boards: BOARDS }).violations, []);
  for (const p of cg.register().permitted) {
    assert.ok(p.purpose && p.retentionDays > 0 && p.oversight && p.accountable, p.id);
    assert.ok(BOARDS.includes(p.oversight), `${p.id} oversight`);
  }
  for (const p of cg.register().prohibited) assert.ok(p.reason.length >= 30, `${p.id} needs a recorded reason`);
});

test('correlation: prohibited pairs are refused by name, with the reason', () => {
  const cg = new CorrelationGovernance({ clock: () => 0 });
  assert.throws(() => cg.authorize({ domains: ['privacy', 'service-delivery'], purpose: 'anything', requestedBy: 'analyst' }), /prohibited/);
  try { cg.authorize({ domains: ['governance', 'operations'], purpose: 'x', requestedBy: 'analyst' }); assert.fail('should refuse'); }
  catch (e) { assert.strictEqual(e.prohibited, 'staff-performance-profiling'); assert.match(e.message, /surveillance/); }
});

test('correlation: default-deny — an unregistered pair is refused', () => {
  const cg = new CorrelationGovernance({ clock: () => 0 });
  assert.throws(() => cg.authorize({ domains: ['engineering', 'legislation'], purpose: 'curiosity', requestedBy: 'analyst' }), /default-deny/);
  assert.throws(() => cg.authorize({ domains: ['engineering'], purpose: 'x', requestedBy: 'y' }), /at least two domains/);
  assert.throws(() => cg.authorize({ domains: ['engineering', 'operations'], requestedBy: 'y' }), /stated purpose/);
  assert.throws(() => cg.authorize({ domains: ['engineering', 'operations'], purpose: 'platform-reliability' }), /named requesting authority/);
});

test('correlation: purpose limitation and retention are enforced at use time', () => {
  const cg = new CorrelationGovernance({ clock: () => 0 });
  const auth = cg.authorize({ domains: ['engineering', 'operations'], purpose: 'platform-reliability', requestedBy: 'Office of the CTO' });
  assert.strictEqual(auth.oversight, 'ORB');
  assert.ok(auth.expiresAt > auth.grantedAt);
  assert.strictEqual(cg.guard(auth.id, { purpose: 'security-operations' }).permitted, false);
  assert.strictEqual(cg.guard(auth.id, { purpose: 'platform-reliability' }).permitted, true);
  assert.strictEqual(cg.guard(auth.id, { purpose: 'platform-reliability', now: auth.expiresAt + 1 }).permitted, false);
  assert.strictEqual(cg.retentionDue({ now: auth.expiresAt + 1 }).length, 1);
});

test('correlation: refusals are audited, and the register declares default-deny', () => {
  const cg = new CorrelationGovernance({ clock: () => 0 });
  try { cg.authorize({ domains: ['privacy', 'service-delivery'], purpose: 'x', requestedBy: 'analyst' }); } catch (_) { /* expected */ }
  const auth = cg.authorize({ domains: ['security', 'operations'], purpose: 'security-operations', requestedBy: 'CIRT' });
  cg.guard(auth.id, { purpose: 'security-operations' });
  const events = cg.auditTrail().map((a) => a.event);
  for (const required of ['refused', 'authorized', 'used']) assert.ok(events.includes(required), required);
  const report = cg.report();
  assert.strictEqual(report.defaultDeny, true);
  assert.strictEqual(report.authorizes, false);
});

// --- Part 15: usability validation --------------------------------------------------------

test('usability: every representative role is engaged and traced to a bounded context', () => {
  const uv = seedRound(new UsabilityValidation());
  const contexts = new Set(contextMap.ids());
  for (const p of uv.personas()) assert.ok(contexts.has(p.context), `${p.id} → ${p.context}`);
  for (const required of ['investigator', 'auditor', 'administrator', 'governance-official', 'oversight-board', 'operational-staff']) {
    assert.ok(PERSONAS[required], required);
  }
  assert.strictEqual(uv.coverage().complete, true);
  assert.deepStrictEqual(uv.coverage().uncovered, []);
});

test('usability: participant identity is refused — role codes only', () => {
  const uv = new UsabilityValidation();
  assert.throws(() => uv.recordSession({ participant: 'P-INV-01', taskId: 'triage-queue', completed: true, email: 'a@b.c' }), /refuse participant identity/);
  assert.throws(() => uv.recordSession({ participant: 'P-INV-01', taskId: 'triage-queue', completed: true, name: 'someone' }), /refuse participant identity/);
  assert.throws(() => uv.recordSession({ participant: 'a real person', taskId: 'triage-queue', completed: true }), /role-coded id/);
  const ok = uv.recordSession({ participant: 'P-INV-01', taskId: 'triage-queue', completed: true, secondsToComplete: 40 });
  assert.strictEqual(ok.persona, 'investigator');
});

test('usability: findings are derived from observation, ranked, and cite their evidence', () => {
  const uv = seedRound(new UsabilityValidation());
  const findings = uv.findings();
  assert.ok(findings.length >= 5);
  assert.strictEqual(findings[0].severity, 'blocker');
  assert.strictEqual(findings[0].task, 'trace-decision', 'the task nobody completed is the top finding');
  for (const f of findings) { assert.ok(f.evidence); assert.ok(f.context); }
  assert.deepStrictEqual(uv.findings(), uv.findings(), 'findings must be deterministic');
});

test('usability: the report carries outcomes, blockers and no identifying value', () => {
  const uv = seedRound(new UsabilityValidation());
  const report = uv.report();
  assert.strictEqual(report.sessions, 12);
  assert.ok(report.blockers.length >= 1);
  assert.strictEqual(report.outcomes['triage-queue'].completionRate, 1);
  assert.strictEqual(report.outcomes['trace-decision'].completionRate, 0);
  assert.ok(!/@|omang|nationalId/i.test(JSON.stringify(report)));
  assert.match(report.note, /do not authorize/i);
});
