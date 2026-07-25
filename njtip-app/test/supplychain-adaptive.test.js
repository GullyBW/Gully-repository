'use strict';
// v1.8 Phase 65 (supply-chain governance) + Phase 66 (adaptive governance framework).
const { test } = require('node:test');
const assert = require('node:assert');
const { SupplyChainGovernance } = require('../src/supplychain/supply-chain');
const adaptive = require('../src/governance/adaptive');

test('supply-chain governance: suppliers, trusted components, integrity, risk, deployment gate', () => {
  const sc = new SupplyChainGovernance({ clock: () => 1 });
  // A component from an unregistered supplier is refused (fail-closed).
  assert.throws(() => sc.registerComponent('lib', { version: '1.0.0', supplier: 'rogue' }), /not registered/);
  sc.registerSupplier('trusted-vendor', { trustLevel: 'approved', risk: 'low' });
  const reg = sc.registerComponent('lib', { version: '1.0.0', supplier: 'trusted-vendor', risk: 'low' });
  // Integrity verification.
  assert.strictEqual(sc.verifyIntegrity('lib', '1.0.0', reg.integrity).ok, true);
  assert.strictEqual(sc.verifyIntegrity('lib', '1.0.0', 'deadbeef').ok, false);
  // Risk assessment folds supplier + component risk.
  assert.strictEqual(sc.riskAssessment('lib', '1.0.0').acceptable, true);
  // Provenance.
  assert.strictEqual(sc.provenance('lib', '1.0.0').supplier, 'trusted-vendor');
  // Deployment gate: empty SBOM passes; untrusted component fails; banned component fails.
  assert.strictEqual(sc.validateForDeployment([]).pass, true);
  assert.strictEqual(sc.validateForDeployment([{ name: 'lib', version: '1.0.0' }]).pass, true);
  assert.strictEqual(sc.validateForDeployment([{ name: 'evil', version: '9' }]).pass, false);
  sc.transition('lib', '1.0.0', 'banned');
  assert.strictEqual(sc.validateForDeployment([{ name: 'lib', version: '1.0.0' }]).pass, false);
  assert.ok(sc.auditTrail().some((a) => a.event === 'component-banned'));
});

test('supply-chain: high-risk supplier component is not acceptable', () => {
  const sc = new SupplyChainGovernance();
  sc.registerSupplier('risky', { trustLevel: 'unverified', risk: 'critical' });
  sc.registerComponent('c', { version: '1', supplier: 'risky', risk: 'low' });
  assert.strictEqual(sc.riskAssessment('c', '1').acceptable, false); // supplier risk dominates
  assert.strictEqual(sc.validateForDeployment([{ name: 'c', version: '1' }]).pass, false);
});

test('adaptive governance: effectiveness, review cycles, maturity trend, assessment, simulation', () => {
  // Effectiveness metric (human-governance density).
  const eff = adaptive.effectiveness({ decisionsRecorded: 20, automatedActions: 10 });
  assert.strictEqual(eff.humanGovernanceDensity, 2);
  // Review cycle due detection.
  assert.strictEqual(adaptive.reviewCycle({ kind: 'policy', lastReviewedAt: 0, cadenceMs: 100, now: 150 }).due, true);
  // Legislative review recommendation requires human approval.
  const lr = adaptive.legislativeReviewRecommendations([{ id: 'act', mapsToControls: ['C1', 'C2'] }], new Set(['C1']));
  assert.strictEqual(lr.requiresHumanApproval, true);
  assert.strictEqual(lr.recommendations[0].controls[0], 'C1');
  // Maturity evolution trend.
  assert.strictEqual(adaptive.maturityEvolution([{ score: 4 }, { score: 5 }, { score: 6 }]).direction, 'improving');
  // Continuous assessment is human-gated.
  const a = adaptive.assess({ effectivenessScore: 1, dueReviews: 2, openGovernanceGaps: 1 });
  assert.strictEqual(a.humanGate, true);
  assert.ok(a.score < 1);
  // Simulation is deterministic + advisory.
  assert.deepStrictEqual(adaptive.simulate({ proposedReviewCadenceMs: 1000, currentDueReviews: 3 }), adaptive.simulate({ proposedReviewCadenceMs: 1000, currentDueReviews: 3 }));
});
