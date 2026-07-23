'use strict';
// Tests for the v0.2 assurance subsystems: adversarial suite, chaos, formal,
// traceability, compliance, drift, maturity, evidence signing/archive, governance.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../src/platform/orchestrator');
const adversarial = require('../adversarial');
const chaos = require('../chaos/chaos');
const formal = require('../formal');
const { buildMatrix, evidenceForRequirement } = require('../src/traceability/engine');
const { mapCompliance } = require('../src/compliance/engine');
const { detect } = require('../src/drift/detector');
const maturity = require('../src/maturity/model');
const { sign, verify } = require('../src/evidence/signing');
const { EvidenceArchive } = require('../src/evidence/archive');
const { GovernanceLedger } = require('../src/governance/portal');

test('all adversarial scenarios (full suite) are resisted', () => {
  for (const r of adversarial.runAll((o) => build(o))) assert.strictEqual(r.pass, true, `${r.id}: ${JSON.stringify(r.metrics)}`);
});

test('all chaos experiments degrade + recover', () => {
  for (const r of chaos.runAll((o) => build(o))) assert.strictEqual(r.pass, true, `${r.id} degraded=${r.degraded} recovered=${r.recovered}`);
});

test('all formal proofs hold with no counterexample', () => {
  for (const r of formal.runAll()) { assert.strictEqual(r.pass, true, `${r.id}: ${JSON.stringify(r.counterexample)}`); assert.strictEqual(r.counterexample, null); }
});

test('traceability coverage is 100% and enforced', () => {
  const twin = build();
  const v = require('./fitness').map((f) => f.check(twin));
  const sims = adversarial.runAll((o) => build(o));
  const m = buildMatrix({ fitness: v, sims, formal: formal.runAll() });
  assert.strictEqual(m.coverage.percentCovered, 100, JSON.stringify(m.coverage.uncovered));
  assert.strictEqual(m.coverage.percentEnforced, 100);
});

test('evidenceForRequirement answers "show evidence for X"', () => {
  const twin = build();
  const v = require('./fitness').map((f) => f.check(twin));
  const e = evidenceForRequirement('REQ-ANON-001', { fitness: v, sims: adversarial.runAll((o) => build(o)), formal: formal.runAll() });
  assert.ok(e.evidence.length > 0);
  assert.ok(e.evidence.every((x) => x.result === 'PASS'));
});

test('compliance mapping produces framework rollups', () => {
  const twin = build();
  const c = mapCompliance(require('./fitness').map((f) => f.check(twin)));
  assert.ok(c.frameworkSummary.find((f) => f.framework === 'NIST-800-53'));
  assert.ok(c.summary.evidenced > 0);
});

test('drift detector reports none for the approved twin', () => {
  assert.strictEqual(detect(build()).drift, false);
});

test('maturity is capped at 6 without human attestation, advances with it', () => {
  const base = maturity.assess({ referenceImplementation: true, fitnessPass: true, adversarialPass: true, evidenceGenerated: true, ciPassed: true });
  assert.strictEqual(base.achievedLevel, 6);
  const with7 = maturity.assess({ referenceImplementation: true, fitnessPass: true, adversarialPass: true, evidenceGenerated: true, ciPassed: true, humanAttestations: { 7: { attestedBy: 'validator' } } });
  assert.strictEqual(with7.achievedLevel, 7);
});

test('evidence signing is deterministic and verifiable', () => {
  const msg = 'digest-abc';
  const s1 = sign(msg), s2 = sign(msg);
  assert.strictEqual(s1, s2); // Ed25519 deterministic
  assert.strictEqual(verify(msg, s1), true);
  assert.strictEqual(verify('tampered', s1), false);
});

test('evidence archive is hash-chained and independently verifiable', () => {
  const f = path.join(os.tmpdir(), `njtip-arch-${process.pid}-${Date.now()}.json`);
  const a = new EvidenceArchive(f);
  a.append('digest-1'); a.append('digest-2');
  assert.strictEqual(a.verify().ok, true);
  require('node:fs').unlinkSync(f);
});

test('governance ledger records human decisions and rejects unaccountable ones', () => {
  const f = path.join(os.tmpdir(), `njtip-gov-${process.pid}-${Date.now()}.json`);
  const g = new GovernanceLedger(f);
  assert.throws(() => g.record({ decisionType: 'readiness', rationale: 'x' })); // no reviewer
  assert.throws(() => g.record({ reviewer: 'A', decisionType: 'readiness' })); // no rationale
  g.record({ reviewer: 'A', role: 'OB', decisionType: 'readiness', subject: 'MVP', verdict: 'defer', rationale: 'pending legal review' });
  assert.strictEqual(g.verify().ok, true);
  require('node:fs').unlinkSync(f);
});
