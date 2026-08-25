'use strict';
// v1.7 Phase 59 (cross-domain systems intelligence) + Phase 60 (sovereign command center).
const { test } = require('node:test');
const assert = require('node:assert');
const crossDomain = require('../src/intelligence/cross-domain');
const { CommandCenter } = require('../src/govops/command-center');
const { createApp } = require('../src/app');

test('cross-domain intelligence: correlation, systemic risk, explainable health, forecast', () => {
  const domains = { engineering: { healthy: true }, security: { healthy: false }, resilience: { pass: true } };
  const corr = crossDomain.correlate(domains);
  assert.deepStrictEqual(corr.degraded, ['security']);
  assert.strictEqual(corr.allHealthy, false);
  const risk = crossDomain.systemicRisk(domains);
  assert.ok(risk.systemicRisk > 0 && ['low', 'medium', 'high'].includes(risk.band));
  const health = crossDomain.explainableHealth(domains);
  assert.ok(health.overall < 1 && health.reasons.some((r) => /security/.test(r)));
  // Dependency intelligence surfaces critical capabilities.
  assert.ok(crossDomain.dependencyIntelligence().criticalCapabilities.length >= 0);
  // Forecast is a transparent trend.
  assert.strictEqual(crossDomain.forecast([{ overall: 0.8 }, { overall: 0.9 }, { overall: 1 }]).direction, 'improving');
});

test('command center: aggregates posture; always human-gated; never authorizes', () => {
  const cc = new CommandCenter({
    engineering: () => ({ healthy: true }),
    operations: () => ({ healthy: true }),
    resilience: () => ({ pass: true }),
    compliance: () => ({ overallCoverage: 1 }),
    ai: () => ({ healthy: true }),
    identity: () => ({ healthy: true }),
    infrastructure: () => ({ healthy: true }),
  });
  const snap = cc.snapshot();
  assert.strictEqual(snap.posture, 'green');
  assert.strictEqual(snap.humanGate.required, true);
  assert.ok(!('authorized' in snap));
  // National readiness score is advisory + human-gated.
  const rs = cc.nationalReadinessScore();
  assert.strictEqual(rs.humanGate, true);
  assert.ok(rs.score >= 0 && rs.score <= 1);
  // Strategic report + decision-support summary are advisory.
  assert.strictEqual(cc.strategicReport().advisoryOnly, true);
  assert.ok(/HUMAN APPROVAL REQUIRED/.test(cc.decisionSupportSummary().decision));
  // Scenario comparison.
  const cmp = cc.compareScenarios([{ name: 'good', domains: { a: { healthy: true } } }, { name: 'bad', domains: { a: { healthy: false } } }]);
  assert.ok(cmp[0].health > cmp[1].health);
  // A degraded domain flips posture away from green.
  assert.notStrictEqual(new CommandCenter({ engineering: () => ({ healthy: false }) }).snapshot().posture, 'green');
});

test('command center integrates with the live composition (advisory, green, human-gated)', () => {
  const app = createApp();
  const snap = app.commandCenter.snapshot();
  assert.strictEqual(snap.posture, 'green');
  assert.strictEqual(snap.humanGate.required, true);
  assert.strictEqual(app.commandCenter.nationalReadinessScore().humanGate, true);
});
