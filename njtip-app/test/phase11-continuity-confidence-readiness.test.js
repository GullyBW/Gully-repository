'use strict';
// Phase 11, Parts 13, 14, 15 & 16 — governance continuity, the evidence confidence framework,
// the multi-dimensional readiness model, and engineering metrics intelligence.
const test = require('node:test');
const assert = require('node:assert');
const own = require('../src/governance/ownership');
const ec = require('../src/assurance/evidence-confidence');

// --- Part 13: governance continuity ---------------------------------------------------------------

test('continuity: every accountable role has a deputy that is not the primary', () => {
  for (const id of own.subsystems()) {
    const o = own.OWNERSHIP[id];
    const dep = own.deputies(id);
    for (const role of own.DEPUTY_ROLES) {
      assert.ok(dep[role], `${id}/${role}`);
      assert.notStrictEqual(dep[role], o[role], `${id}/${role}: deputy is the primary`);
    }
    assert.notStrictEqual(dep.responsibleAuthority, o.approvingAuthority, `${id}: substitution collapses SoD`);
    assert.notStrictEqual(dep.responsibleAuthority, dep.approvingAuthority, `${id}: deputies collapse SoD`);
  }
  assert.ok(own.DEPUTY_RULE);
});

test('continuity: succession terminates at a board, never at a person', () => {
  const boardNames = own.boards().map((b) => b.name);
  for (const id of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      const plan = own.successionPlan(id, role);
      assert.strictEqual(plan.chain.length, 3);
      assert.ok(boardNames.includes(plan.chain[2].holder), `${id}/${role} ends at ${plan.chain[2].holder}`);
      for (const step of plan.chain) assert.ok(step.basis);
    }
  }
});

test('continuity: an absence must be named, reasoned, human-recorded and time-bounded', () => {
  const reg = new own.AvailabilityRegister({ clock: () => 1_000 });
  assert.throws(() => reg.recordAbsence({}), /name a person/);
  assert.throws(() => reg.recordAbsence({ person: 'X' }), /named human/);
  assert.throws(() => reg.recordAbsence({ person: 'X', by: 'Y', reason: 'r' }), /time-bounded/);
  assert.throws(() => reg.recordAbsence({ person: 'X', by: 'Y', reason: 'r', from: 0, until: Infinity }), /time-bounded/);
  assert.throws(() => reg.recordAbsence({ person: 'X', by: 'Y', reason: 'r', from: 100, until: 50 }), /end after it starts/);
  const rec = reg.recordAbsence({ person: 'X', by: 'Y', reason: 'leave', from: 0, until: 5_000 });
  assert.match(rec.id, /^ABS-/);
});

test('continuity: the deputy holds it while the primary is away, and hands it back', () => {
  const reg = new own.AvailabilityRegister({ clock: () => 1_000 });
  const primary = own.OWNERSHIP['intake'].approvingAuthority;
  const deputy = own.deputyOf(primary);
  assert.strictEqual(reg.effectiveOwner('intake', 'approvingAuthority', 1_000).via, 'primary');
  reg.recordAbsence({ person: primary, from: 0, until: 5_000, reason: 'recess', by: 'OB Secretariat' });
  const held = reg.effectiveOwner('intake', 'approvingAuthority', 1_000);
  assert.strictEqual(held.via, 'deputy');
  assert.strictEqual(held.holder, deputy);
  assert.strictEqual(reg.effectiveOwner('intake', 'approvingAuthority', 6_000).via, 'primary');
});

test('continuity: with both away it is an ownership gap that escalates, not a silent default', () => {
  const reg = new own.AvailabilityRegister({ clock: () => 1_000 });
  const primary = own.OWNERSHIP['intake'].approvingAuthority;
  reg.recordAbsence({ person: primary, from: 0, until: 5_000, reason: 'recess', by: 'OB Secretariat' });
  reg.recordAbsence({ person: own.deputyOf(primary), from: 0, until: 5_000, reason: 'recess', by: 'OB Secretariat' });
  const gap = reg.effectiveOwner('intake', 'approvingAuthority', 1_000);
  assert.strictEqual(gap.covered, false);
  assert.strictEqual(gap.holder, null);
  assert.ok(gap.escalateTo);
  const cov = own.coverageScore({ availability: reg, now: 1_000 });
  assert.strictEqual(cov.complete, false);
  assert.ok(cov.uncovered > 0);
  const gaps = own.ownershipGaps({ availability: reg, now: 1_000, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, 1_000])) });
  assert.strictEqual(gaps.clean, false);
  assert.ok(gaps.gaps.some((g) => g.kind === 'availability' && g.subsystem === 'intake'));
});

test('continuity: a never-reviewed record is overdue, not pending', () => {
  const never = own.reviewSchedule({ now: 0 });
  assert.ok(never.every((r) => r.overdue));
  const day = 24 * 3600_000;
  const fresh = own.reviewSchedule({ now: day, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, day])) });
  assert.ok(fresh.every((r) => !r.overdue));
  const old = own.reviewSchedule({ now: 400 * day, lastReviewed: Object.fromEntries(own.subsystems().map((s) => [s, 0])) });
  assert.ok(old.every((r) => r.overdue));
  assert.ok(own.REVIEW_CADENCE_DAYS.ISRB <= own.REVIEW_CADENCE_DAYS.ARB);
});

// --- Part 14: evidence confidence --------------------------------------------------------------

const NOW = 10_000_000;

test('confidence: it cannot be supplied by hand', () => {
  assert.throws(() => ec.assess({ id: 'x', source: 'executable-check', confidence: 1 }), /cannot be supplied/);
  assert.throws(() => ec.assess({ id: 'x', source: 'a-feeling' }), /unknown evidence source/);
  assert.throws(() => ec.assess({ id: 'x', source: 'executable-check', completeness: 2 }), /\[0, 1\]/);
});

test('confidence: source, completeness and freshness each move the number', () => {
  const fresh = ec.assess({ id: 'a', source: 'executable-check', completeness: 1, verifiedAt: NOW, now: NOW });
  assert.strictEqual(fresh.confidence, 1);
  assert.strictEqual(fresh.band, 'high');
  assert.strictEqual(fresh.manualEntry, false);
  assert.strictEqual(fresh.calculation, `${fresh.sourceWeight} × ${fresh.completeness} × ${fresh.freshness} = ${fresh.confidence}`);

  const half = ec.assess({ id: 'b', source: 'executable-check', completeness: 1, verifiedAt: NOW - 12 * 3600_000, now: NOW });
  assert.ok(half.confidence > 0.4 && half.confidence < 0.6);
  assert.strictEqual(ec.assess({ id: 'c', source: 'executable-check', completeness: 1, verifiedAt: NOW - 5 * 24 * 3600_000, now: NOW }).confidence, 0);
  assert.strictEqual(ec.assess({ id: 'd', source: 'executable-check', completeness: 1, verifiedAt: null, now: NOW }).confidence, 0);
  assert.strictEqual(ec.assess({ id: 'e', source: 'absent', completeness: 0, now: NOW }).band, 'unusable');
  assert.strictEqual(ec.assess({ id: 'f', source: 'executable-check', completeness: 0.5, verifiedAt: NOW, now: NOW }).confidence, 0.5);
  assert.ok(ec.SOURCE_KINDS['executable-check'].weight > ec.SOURCE_KINDS['human-attestation'].weight);
});

test('confidence: aggregation is weakest-link, so one unusable input cannot hide', () => {
  const reg = new ec.EvidenceRegister({ clock: () => NOW });
  for (let i = 0; i < 9; i++) reg.record({ id: `strong-${i}`, source: 'executable-check', completeness: 1, verifiedAt: NOW });
  reg.record({ id: 'weak', source: 'human-attestation', completeness: 0.2, verifiedAt: NOW - 170 * 24 * 3600_000 });
  const agg = reg.aggregate();
  assert.strictEqual(agg.weakest, 'weak');
  assert.strictEqual(agg.confidence, reg.get('weak').confidence);
  assert.ok(agg.mean > agg.confidence);
  assert.strictEqual(new ec.EvidenceRegister().aggregate().confidence, 0);
  assert.strictEqual(reg.digest(), reg.digest());
});

// --- Part 15: multi-dimensional readiness ---------------------------------------------------------

const HEALTHY = {
  fitness: { allHold: true, heldRatio: 1, failingCount: 0 },
  security: { policiesCertified: true, algorithmIndependence: true, credentialFindings: 0 },
  privacy: { identityMinimized: true, correlationDefaultDeny: true },
  operations: { readinessScore: 1 },
  reliability: { allSlosMet: true, sloHealthy: true },
  data: { tracedRatio: 1, qualityAcceptable: true, qualityReadiness: 1 },
  governance: { ownershipComplete: true, noSelfApproval: true },
  legislation: { unimplementedMandates: 0, mandatesImplementedRatio: 1 },
  supplyChain: { attestationsVerified: true, thirdPartyCount: 0 },
  continuity: { coverageComplete: true, noStructuralGaps: true },
};
const strongEvidence = () => {
  const reg = new ec.EvidenceRegister({ clock: () => 0 });
  for (const id of Object.keys(ec.READINESS_DIMENSIONS)) reg.record({ id: `readiness:${id}`, source: 'executable-check', completeness: 1, verifiedAt: 0 });
  return reg;
};

test('readiness: ten independent dimensions, each with declared signals and an owner', () => {
  assert.strictEqual(Object.keys(ec.READINESS_DIMENSIONS).length, 10);
  for (const [id, d] of Object.entries(ec.READINESS_DIMENSIONS)) {
    assert.ok(d.owner && d.question && d.evidence, id);
    assert.ok(Array.isArray(d.signals) && d.signals.length, `${id}: no declared signals`);
  }
  assert.strictEqual(ec.READINESS_DIMENSIONS.authorization, undefined, 'authorization must never be a dimension');
});

test('readiness: ten green dimensions still print NOT AUTHORIZED', () => {
  const green = ec.readinessModel({ sources: HEALTHY, evidence: strongEvidence() });
  assert.strictEqual(green.allDimensionsReady, true, JSON.stringify(green.notReady));
  assert.strictEqual(green.readyCount, 10);
  assert.strictEqual(green.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(green.derivedFromReadiness, false);
  assert.strictEqual(green.authorizes, false);
  // No input changes it.
  for (const sources of [{}, HEALTHY, { ...HEALTHY, authorization: { granted: true } }]) {
    assert.strictEqual(ec.readinessModel({ sources, evidence: strongEvidence() }).authorizationStatus, 'NOT AUTHORIZED');
  }
});

test('readiness: dimensions are independent, and a count of zero reads as good', () => {
  const evidence = strongEvidence();
  const broken = ec.readinessModel({ sources: { ...HEALTHY, privacy: { identityMinimized: false, correlationDefaultDeny: true } }, evidence });
  assert.strictEqual(broken.readyCount, 9);
  assert.ok(broken.notReady.some((d) => d.dimension === 'privacy' && d.owner));
  assert.strictEqual(broken.authorizationStatus, 'NOT AUTHORIZED');

  assert.strictEqual(ec.scoreDimension('security', { sources: HEALTHY, evidence }).ready, true);
  const findings = ec.scoreDimension('security', { sources: { security: { policiesCertified: true, algorithmIndependence: true, credentialFindings: 3 } }, evidence });
  assert.strictEqual(findings.ready, false);
});

test('readiness: no evidence, and weak evidence, are both not ready', () => {
  const blind = ec.readinessModel({ sources: {}, evidence: null });
  assert.strictEqual(blind.allDimensionsReady, false);
  assert.ok(blind.dimensions.every((d) => d.status === 'no-evidence'));
  assert.strictEqual(blind.authorizationStatus, 'NOT AUTHORIZED');

  const weak = new ec.EvidenceRegister({ clock: () => 0 });
  for (const id of Object.keys(ec.READINESS_DIMENSIONS)) weak.record({ id: `readiness:${id}`, source: 'human-attestation', completeness: 0.2, verifiedAt: -170 * 24 * 3600_000 });
  const weakly = ec.readinessModel({ sources: HEALTHY, evidence: weak });
  assert.strictEqual(weakly.allDimensionsReady, false);
  assert.ok(weakly.lowConfidence.length > 0);
});

// --- Part 16: engineering metrics intelligence ------------------------------------------------------

test('engineering: an unmeasured metric is null, never zero', () => {
  const empty = ec.engineeringMetrics({});
  assert.strictEqual(empty.coverage, null);
  assert.strictEqual(empty.mutationScore, null);
  assert.strictEqual(empty.dora.deploymentFrequency.perDay, null);
  assert.strictEqual(empty.dora.deploymentFrequency.band, 'unknown');
  assert.ok(empty.unmeasured.length >= 5);
});

test('engineering: DORA bands are correct at the boundaries', () => {
  assert.strictEqual(ec.bandFor('deploymentFrequency', 2).band, 'elite');
  assert.strictEqual(ec.bandFor('deploymentFrequency', 1 / 60).band, 'low');
  assert.strictEqual(ec.bandFor('leadTimeHours', 2).band, 'elite');
  assert.strictEqual(ec.bandFor('changeFailureRate', 0.5).band, 'low');
  assert.strictEqual(ec.bandFor('mttrHours', 0.5).band, 'elite');
  assert.strictEqual(ec.bandFor('mttrHours', null).band, 'unknown');
});

test('engineering: counts and rates are derived, and trend polarity is stated', () => {
  const m = ec.engineeringMetrics({
    tests: { unit: 300, integration: 80, contract: 38 }, invariants: { twin: 14, app: 92, infra: 9 },
    coverage: 0.86, mutationScore: 0.74, deployments: 30, windowDays: 30, failedDeployments: 1,
    leadTimeHours: 100, mttdHours: 0.5, mttrHours: 5,
    debtTrend: [10, 8, 6, 4], riskTrend: [5, 4, 3, 2], assuranceTrend: [0.8, 0.9, 0.95, 1],
  });
  assert.strictEqual(m.tests.total, 418);
  assert.strictEqual(m.invariants.total, 115);
  assert.strictEqual(m.dora.deploymentFrequency.perDay, 1);
  assert.strictEqual(m.dora.changeFailureRate.value, 0.0333);
  assert.deepStrictEqual(m.unmeasured, []);
  assert.strictEqual(m.trends.technicalDebt.direction, 'falling');
  assert.strictEqual(m.trends.technicalDebt.better, 'falling');
  assert.strictEqual(m.trends.assurance.better, 'rising');
  assert.deepStrictEqual(ec.engineeringMetrics({ tests: { unit: 1 } }), ec.engineeringMetrics({ tests: { unit: 1 } }));
});

test('engineering: maturity cannot inflate on unmeasured metrics', () => {
  assert.strictEqual(ec.maturity(ec.engineeringMetrics({})).level, 0);
  const counted = ec.engineeringMetrics({ tests: { unit: 10 }, invariants: { app: 5 } });
  assert.strictEqual(ec.maturity(counted).level, 2);
  assert.ok(ec.maturity(counted).blockedBy.length > 0);
  const automated = ec.engineeringMetrics({ tests: { unit: 10 }, invariants: { app: 5 }, deployments: 10, windowDays: 30, failedDeployments: 0 });
  assert.strictEqual(ec.maturity(automated).level, 3);
  const elite = ec.engineeringMetrics({
    tests: { unit: 400 }, invariants: { app: 100 }, coverage: 0.95, mutationScore: 0.9,
    deployments: 60, windowDays: 30, failedDeployments: 1, leadTimeHours: 2, mttrHours: 0.5,
    debtTrend: [10, 5, 2], riskTrend: [9, 5, 1], assuranceTrend: [0.9, 0.95, 1],
  });
  assert.strictEqual(ec.maturity(elite).level, 5);
  const rotting = ec.engineeringMetrics({
    tests: { unit: 400 }, invariants: { app: 100 }, coverage: 0.95, mutationScore: 0.9,
    deployments: 60, windowDays: 30, failedDeployments: 1, leadTimeHours: 2, mttrHours: 0.5,
    debtTrend: [2, 5, 10], riskTrend: [1, 5, 9],
  });
  assert.notStrictEqual(ec.maturity(rotting).level, 5);
  assert.strictEqual(ec.maturity(elite).authorizes, false);
});
