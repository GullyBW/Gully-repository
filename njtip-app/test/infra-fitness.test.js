'use strict';
// v1.3 Phase 8: infrastructure/operational fitness (Twin extended to deployment/ops) and
// engineering-health analytics.
const { test } = require('node:test');
const assert = require('node:assert');
const infraFitness = require('../verification/infra-fitness');
const { currentHealth, trend } = require('../scripts/engineering-health');

test('every infrastructure fitness function passes against the committed manifests', () => {
  const results = infraFitness.map((f) => f.check());
  const failing = results.filter((r) => !r.pass);
  assert.strictEqual(failing.length, 0, 'failing infra fitness: ' + failing.map((f) => `${f.id}: ${f.violations.join(', ')}`).join(' | '));
  assert.ok(results.length >= 6);
  // The suite covers the expected operational invariants.
  const ids = results.map((r) => r.id);
  for (const id of ['INFRA-FIT-K8S-HARDENING', 'INFRA-FIT-NETWORK-DEFAULT-DENY', 'INFRA-FIT-DEPLOY-GATE', 'INFRA-FIT-DR-BACKUP-RESTORE', 'INFRA-FIT-DRIFT']) {
    assert.ok(ids.includes(id), 'missing ' + id);
  }
});

test('infra signature is stable (drift detection basis)', () => {
  const a = infraFitness.infraSignature();
  const b = infraFitness.infraSignature();
  assert.strictEqual(a.digest, b.digest); // deterministic
  assert.strictEqual(a.facts.runAsNonRoot, true);
  assert.strictEqual(a.facts.defaultDeny, true);
});

test('engineering-health aggregates all layers and computes a transparent trend', () => {
  const h = currentHealth();
  assert.strictEqual(h.score, 1); // all invariants hold in the committed state
  assert.ok(h.dims.twin.total >= 14 && h.dims.app.total >= 8 && h.dims.infra.total >= 6);
  // Trend is a transparent heuristic over recorded scores.
  const t = trend([{ score: 0.9 }, { score: 0.95 }], { score: 1 });
  assert.strictEqual(t.direction, 'improving');
});
