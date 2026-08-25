'use strict';
// Tests: every adversarial scenario is resisted by the compliant twin.
const { test } = require('node:test');
const assert = require('node:assert');
const { build } = require('../src/platform/orchestrator');
const { runAll } = require('./scenarios');

test('all adversarial scenarios are resisted', () => {
  const results = runAll((opts) => build(opts));
  for (const r of results) {
    assert.strictEqual(r.pass, true, `${r.id} (${r.name}) should be resisted; metrics=${JSON.stringify(r.metrics)}`);
  }
});

test('determinism: two runs produce identical resilience metrics', () => {
  const a = runAll((opts) => build(opts));
  const b = runAll((opts) => build(opts));
  assert.deepStrictEqual(a.map((r) => r.metrics), b.map((r) => r.metrics));
});
