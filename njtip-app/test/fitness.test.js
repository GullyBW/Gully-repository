'use strict';
// The application-level fitness gate must pass, and the combined validate result must
// report both the Twin and the app breakdown. A failing app-fitness check == a failing build.
const { test } = require('node:test');
const assert = require('node:assert');
const appFitness = require('../verification/app-fitness');
const { twinValidate, runApp } = require('../src/twin-validate');

test('every application fitness function passes', () => {
  const results = runApp();
  const failing = results.filter((r) => !r.pass);
  assert.strictEqual(failing.length, 0, 'failing app fitness: ' + failing.map((f) => `${f.id}: ${f.violations.join(', ')}`).join(' | '));
  assert.strictEqual(results.length, appFitness.length);
});

test('combined validate reports twin + app invariants and holds', () => {
  const v = twinValidate();
  assert.strictEqual(v.invariantsHeld, true, 'failing: ' + v.failing.join(', '));
  assert.strictEqual(v.passed, v.total);
  assert.ok(v.twin.total >= 14 && v.app.total >= 8);
  assert.strictEqual(v.total, v.twin.total + v.app.total);
});
