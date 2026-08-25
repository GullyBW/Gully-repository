'use strict';
// Phase 9/10 assurance: the evidence package is deterministic + verifiable, and the
// readiness assessment is ALWAYS human-gated (no input can make it authorize deployment).
const { test } = require('node:test');
const assert = require('node:assert');
const { makePackage, verifyPackage, buildCore } = require('../scripts/evidence-package');
const { assess, REQUIRED_ATTESTATIONS } = require('../scripts/readiness');

test('evidence package is deterministic in its hashed core and verifies', () => {
  const a = makePackage();
  const b = makePackage();
  // Hashed core → identical digest + signature (metadata like generatedAt is excluded).
  assert.strictEqual(a.digest, b.digest);
  assert.strictEqual(a.signature, b.signature);
  assert.strictEqual(JSON.stringify(buildCore()), JSON.stringify(buildCore()));
  const res = verifyPackage(a);
  assert.strictEqual(res.ok, true, res.problems.join('; '));
  assert.strictEqual(a.core.fitness.allHold, true);
});

test('evidence package verification detects tampering', () => {
  const pkg = makePackage();
  pkg.core.version = 'tampered';
  const res = verifyPackage(pkg);
  assert.strictEqual(res.ok, false);
  assert.ok(res.problems.some((p) => /digest mismatch/.test(p)));
});

test('readiness is human-gated and NEVER authorizes — even fully attested', () => {
  const none = assess([]);
  assert.strictEqual(none.decision, 'NOT AUTHORIZED — HUMAN AUTHORIZATION REQUIRED');
  assert.strictEqual(none.humanGate.required, true);
  assert.ok(none.automatedReadinessLevel <= none.automatedReadinessCeiling);
  assert.ok(!('authorized' in none) || none.authorized !== true);
  // Even if every human attestation is provided, the script still does not authorize.
  const allAttested = REQUIRED_ATTESTATIONS.map((a) => ({ id: a.id, by: 'Named Human', rationale: 'reviewed' }));
  const full = assess(allAttested);
  const attDim = full.dimensions.find((d) => d.name === 'human-attestations');
  assert.strictEqual(attDim.pass, true); // attestations recorded
  assert.strictEqual(full.decision, 'NOT AUTHORIZED — HUMAN AUTHORIZATION REQUIRED'); // still gated
});

test('readiness reports the production-adapter gate (reference drivers are not go-live-ready)', () => {
  const r = assess([]);
  const adapters = r.dimensions.find((d) => d.name === 'production-adapters');
  assert.strictEqual(adapters.pass, false);
  assert.ok(/human-verified/.test(adapters.detail));
});
