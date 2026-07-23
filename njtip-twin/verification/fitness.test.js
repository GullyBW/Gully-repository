'use strict';
// Tests: the compliant twin passes every fitness function, AND deliberately-broken
// twins FAIL the relevant check — proving "architecture violations are failing tests."
const { test } = require('node:test');
const assert = require('node:assert');
const { build, defaultTopology } = require('../src/platform/orchestrator');
const fitness = require('./fitness');
const { ZONES } = require('../src/zones');
const { ThresholdCustody } = require('../src/model/governance');

test('compliant twin passes ALL fitness functions', () => {
  const twin = build();
  for (const f of fitness) {
    const r = f.check(twin);
    assert.strictEqual(r.pass, true, `${r.id} should pass but had: ${r.violations.join('; ')}`);
  }
});

test('zone-isolation FAILS on a cross-zone DB misconfiguration', () => {
  const broken = defaultTopology();
  broken.find((s) => s.name === 'adjudication').dbZones.push(ZONES.EXECUTIVE);
  const twin = build({ topology: broken });
  const r = fitness.find((f) => f.id === 'FIT-ZONE-ISOLATION').check(twin);
  assert.strictEqual(r.pass, false);
  assert.ok(r.violations.length > 0);
});

test('governance FAILS when threshold M < 2 (single-party override possible)', () => {
  const twin = build();
  twin.threshold = new ThresholdCustody({ M: 1, custodians: ['c1'] });
  const r = fitness.find((f) => f.id === 'FIT-GOVERNANCE').check(twin);
  assert.strictEqual(r.pass, false);
});

test('policy-enforcement FAILS if an undeclared action is allowed', () => {
  const twin = build();
  twin.policy.addRule({ action: 'exfiltrate-everything', effect: 'allow' });
  const r = fitness.find((f) => f.id === 'FIT-POLICY-ENFORCEMENT').check(twin);
  assert.strictEqual(r.pass, false);
});
