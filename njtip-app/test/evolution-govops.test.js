'use strict';
// v1.6 Phase 49 (platform evolution intelligence) + Phase 50 (governance operations center).
const { test } = require('node:test');
const assert = require('node:assert');
const evolution = require('../src/evolution/evolution');
const { GovernanceOpsCenter } = require('../src/govops/center');
const { createApp } = require('../src/app');

test('evolution intelligence: ADR log, dependency health, tech debt, refactoring impact', () => {
  const adr = new evolution.ArchitectureDecisionLog({ clock: () => 1 });
  adr.record({ id: 'ADR-001', title: 'Freeze architecture', rationale: 'stability' });
  assert.throws(() => adr.record({ id: 'x' }), /rationale/);
  assert.strictEqual(adr.history().length, 1);
  // Dependency health surfaces coupling from the capability map.
  const dh = evolution.dependencyHealth();
  assert.ok('fanIn' in dh && 'fanOut' in dh);
  // Technical debt from failing invariants.
  const debt = evolution.technicalDebt([{ id: 'A', pass: true }, { id: 'B', pass: false }]);
  assert.strictEqual(debt.openInvariantFailures, 1);
  assert.strictEqual(debt.debtRatio, 0.5);
  // Refactoring impact = transitive dependents (blast radius).
  const impact = evolution.refactoringImpact('Identity & Access');
  assert.ok(impact.impactedCapabilities.includes('Multi-Agency Federation'));
  // Evolution forecast is a transparent trend.
  assert.strictEqual(evolution.evolutionForecast([{ score: 0.8 }, { score: 0.9 }, { score: 1 }]).direction, 'improving');
  // Capability lifecycle tracking.
  const lc = new evolution.CapabilityLifecycle();
  assert.throws(() => lc.set('Case Management', 'bogus'), /invalid lifecycle/);
  assert.strictEqual(lc.set('Case Management', 'deprecated').state, 'deprecated');
});

test('governance ops center: aggregates posture; ALWAYS advisory + human-gated', () => {
  const center = new GovernanceOpsCenter({
    fitness: () => ({ invariants: 57, held: 57, healthy: true }),
    slo: () => ({ healthy: true }),
    resilience: () => ({ pass: true }),
    compliance: () => ({ overallCoverage: 1 }),
    ai: () => ({ models: 1, allApproved: true }),
  });
  const snap = center.snapshot();
  assert.strictEqual(snap.advisoryPosture, 'green');
  assert.strictEqual(snap.humanGate.required, true);
  assert.ok(!('authorized' in snap));
  // A failing domain flips the posture to 'attention'.
  const bad = new GovernanceOpsCenter({ fitness: () => ({ healthy: false }), resilience: () => ({ pass: true }) });
  assert.strictEqual(bad.snapshot().advisoryPosture, 'attention');
  // Strategic readiness is explicitly human-gated (never authorizes).
  assert.ok(/NOT AUTHORIZED/.test(center.strategicReadiness().decision));
});

test('governance ops center integrates with the live composition (advisory, green)', () => {
  const app = createApp();
  const snap = app.govOps.snapshot();
  assert.strictEqual(snap.domains.engineering.healthy, true);
  assert.strictEqual(snap.humanGate.required, true);
  assert.ok(app.evolution.report().technicalDebt.openInvariantFailures === 0);
});
