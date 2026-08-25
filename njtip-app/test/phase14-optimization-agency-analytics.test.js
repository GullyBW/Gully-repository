'use strict';
// Phase 14, Parts 13, 14, 16 & 17 — governance optimization, capacity planning, cross-agency
// coordination and adaptive governance analytics.
const test = require('node:test');
const assert = require('node:assert');
const opt = require('../src/governance/optimization');
const ca = require('../src/governance/cross-agency');
const dp = require('../src/architecture/drift-prevention');
const ir = require('../src/governance/institutional-resilience');
const own = require('../src/governance/ownership');

const DAY = 24 * 3600_000;
const NOW = 400 * DAY;
const controlsAll = () => require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true }));

// --- Part 13: governance optimization ---------------------------------------------------------------

test('every optimization target names the wrong remedy as well as the right one', () => {
  for (const required of ['approval-bottleneck', 'review-workload', 'committee-utilisation', 'governance-delay', 'policy-conflict', 'duplicated-activity']) {
    assert.ok(opt.OPTIMIZATION_TARGETS[required], required);
  }
  for (const [id, t] of Object.entries(opt.OPTIMIZATION_TARGETS)) {
    assert.ok(t.signal, id);
    assert.ok(t.rightRemedy, id);
    // For every one of these the obvious fix removes a control, so the wrong remedy is written down.
    assert.ok(t.wrongRemedy.length > 40, id);
  }
});

test('a recommendation that damages governance integrity is refused, not warned about', () => {
  assert.strictEqual(opt.assertPreservesIntegrity({ recommendation: 'delegate approval', preserves: ['separationOfDuties'] }), true);
  const bad = [
    ['no action', { preserves: ['separationOfDuties'] }],
    ['no preserved property', { recommendation: 'streamline' }],
    ['unknown property', { recommendation: 'x', preserves: ['efficiency'] }],
    ['fewer authorities', { recommendation: 'x', preserves: ['separationOfDuties'], reducesDistinctAuthorities: true }],
    ['removes an approval', { recommendation: 'x', preserves: ['separationOfDuties'], removesApproval: true }],
    ['self-approval', { recommendation: 'x', preserves: ['separationOfDuties'], mergesResponsibleAndApprover: true }],
  ];
  for (const [what, rec] of bad) {
    assert.throws(() => opt.assertPreservesIntegrity(rec), (e) => e.failClosed === true, what);
  }
  // `recommend` runs the guard, so nothing can be emitted without passing it.
  assert.throws(() => opt.recommend({ recommendation: 'let owners approve their own releases', preserves: ['separationOfDuties'], mergesResponsibleAndApprover: true }), (e) => e.failClosed === true);
});

test('the optimizer finds real load, delay and duplication, and every recommendation says what it protects', () => {
  const r = opt.governanceOptimization({ now: 0 });
  assert.ok(r.findingCount > 0);
  assert.ok(r.recommendationCount > 0);
  assert.strictEqual(r.everyRecommendationPreservesIntegrity, true);
  for (const rec of r.recommendations) {
    assert.ok(rec.preserves.length, rec.target);
    // A recommendation with no stated limit is a promise.
    assert.ok(rec.wouldNotFix, rec.target);
    assert.strictEqual(rec.authorizes, false);
  }
  assert.ok(r.load.approvalLoad.length);
  assert.ok(r.load.boards.length);
  assert.ok(r.duplicatedActivities.length);
});

test('a policy conflict is reported in the direction that actually breaks', () => {
  const conflicts = opt.policyConflicts();
  for (const c of conflicts) {
    assert.notStrictEqual(c.from, c.to);
    assert.match(c.detail, /cannot be honoured/);
    // The conflict is always "a stronger guarantee depending on a weaker one", never the reverse.
    assert.ok(c.declares && c.dependsOnStance);
  }
});

// --- Part 14: capacity planning ---------------------------------------------------------------------

test('a capacity dimension the evidence cannot support returns null, not a plausible number', () => {
  const plan = opt.capacityPlan({ now: 0 });
  for (const required of ['staffing', 'infrastructure', 'operationalWorkload', 'training', 'governanceWorkload', 'investigationCapacity']) {
    assert.ok(plan.dimensions.some((d) => d.dimension === required), required);
  }
  for (const dim of ['operationalWorkload', 'training', 'investigationCapacity']) {
    const d = plan.dimensions.find((x) => x.dimension === dim);
    assert.strictEqual(d.value, null, dim);
    assert.match(d.basis, /UNKNOWN/, dim);
  }
  // The three derived from registries are real.
  for (const dim of ['staffing', 'infrastructure', 'governanceWorkload']) {
    assert.ok(plan.dimensions.find((x) => x.dimension === dim).value > 0, dim);
  }
  assert.strictEqual(plan.complete, false);
  assert.strictEqual(plan.everyFigureDerived, true);
});

test('supplied measurements produce figures and a shortfall', () => {
  const training = new own.TrainingRegister({ clock: () => NOW });
  for (const s of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
        for (const c of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course: c, at: NOW - 30 * DAY, by: 'Registrar' });
      }
    }
  }
  const plan = opt.capacityPlan({
    now: NOW, training,
    caseload: { openCases: 40, periods: 3 },
    investigators: { available: 4, concurrentPerInvestigator: 5 },
  });
  assert.strictEqual(plan.dimensions.find((d) => d.dimension === 'training').value, 0);
  assert.strictEqual(plan.dimensions.find((d) => d.dimension === 'investigationCapacity').value, 20);
  assert.strictEqual(plan.complete, true);
  const shortfall = plan.shortfalls.find((s) => s.dimension === 'investigationCapacity');
  assert.strictEqual(shortfall.shortfall, 20);
  assert.match(shortfall.detail, /waiting on a person, not on a system/);
});

test('a shortfall is never computed against an unmeasured capacity', () => {
  const plan = opt.capacityPlan({ now: 0, caseload: { openCases: 40 } });
  assert.ok(!plan.shortfalls.some((s) => s.dimension === 'investigationCapacity'));
});

// --- Part 16: cross-agency coordination -------------------------------------------------------------

test('the institutions are derived from who is accountable, never listed', () => {
  const agencies = ca.agencies();
  const fromOwnership = new Set(own.subsystems().flatMap((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority]));
  assert.strictEqual(agencies.length, fromOwnership.size);
  for (const a of agencies) assert.ok(fromOwnership.has(a.agency), a.agency);
  assert.ok(agencies.length >= 10);
});

test('information sharing is read from the architecture and always crosses institutions', () => {
  const sharing = ca.informationSharing();
  assert.ok(sharing.length);
  for (const f of sharing) {
    assert.notStrictEqual(f.fromAgency, f.toAgency);
    assert.strictEqual(ca.agencyOf(f.fromContext), f.fromAgency);
    assert.strictEqual(ca.agencyOf(f.toContext), f.toAgency);
  }
});

test('only a demonstrated relationship counts as ready — a declared one never does', () => {
  const ready = Object.entries(ca.READINESS_BANDS).filter(([, b]) => b.ready).map(([id]) => id);
  assert.deepStrictEqual(ready, ['demonstrated']);
  assert.strictEqual(ca.READINESS_BANDS.declared.ready, false);
  assert.match(ca.READINESS_BANDS.declared.means, /never been exercised/);
});

test('with no register, no relationship is ready and coordination is unknown rather than absent', () => {
  const cold = ca.collaborationReadiness({});
  assert.strictEqual(cold.readinessRate, 0);
  assert.strictEqual(cold.measurable, false);
  assert.ok(cold.untestedPairs.length);
  for (const p of cold.pairs) {
    assert.strictEqual(p.ready, false, p.agencies.join('/'));
    assert.strictEqual(p.coordination.unknown, true);
  }
});

test('a recorded joint rehearsal makes a pair demonstrated — so the bar is reachable', () => {
  const cold = ca.collaborationReadiness({});
  const pair = cold.pairs[0];
  const exercises = new own.ExerciseRegister({ clock: () => NOW });
  const exercise = Object.keys(own.EXERCISE_KINDS)[0];
  const peopleFor = (agency) => own.subsystems()
    .filter((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority].includes(agency))
    .flatMap((s) => own.DEPUTY_ROLES.map((r) => own.OWNERSHIP[s][r]));
  for (const agency of pair.agencies) {
    exercises.recordParticipation({ person: peopleFor(agency)[0], exercise, at: NOW - 10 * DAY, by: 'ORB', role: 'operationalOwner' });
  }
  const warm = ca.pairReadiness(pair.agencies[0], pair.agencies[1], { exercises, now: NOW });
  assert.strictEqual(warm.readiness, 'demonstrated');
  assert.strictEqual(warm.ready, true);
  assert.ok(warm.coordination.evidence.length);
});

test('inter-agency risks name the institutions and where the relationship would fail', () => {
  const cold = ca.collaborationReadiness({});
  assert.ok(cold.risks.length);
  for (const r of cold.risks) {
    assert.ok(r.detail && r.wouldFailAt, r.risk);
    assert.ok(r.agencies.length, r.risk);
  }
  assert.ok(cold.risks.some((r) => r.risk === 'untested-sharing'));
  assert.ok(cold.risks.some((r) => r.risk === 'cross-agency-approval-bottleneck'));
  assert.strictEqual(cold.authorizes, false);
});

test('a communication path is real or it is not', () => {
  const cold = ca.collaborationReadiness({});
  assert.ok(cold.pairs.some((p) => p.communicationPath.reachable));
  assert.strictEqual(ca.communicationPath('Nobody At All', 'Also Nobody').reachable, false);
});

// --- Part 17: adaptive governance analytics ----------------------------------------------------------

test('with no observations the interval is [0,1] and constrains nothing', () => {
  const zero = dp.forecastInterval(0.9, 0);
  assert.deepStrictEqual(zero.interval, [0, 1]);
  assert.strictEqual(zero.constrained, false);
  assert.match(zero.method, /does not constrain this figure at all/);
});

test('the interval narrows as observations accumulate, and never escapes [0,1]', () => {
  const four = dp.forecastInterval(0.5, 4);
  const hundred = dp.forecastInterval(0.5, 100);
  assert.ok(hundred.interval[1] - hundred.interval[0] < four.interval[1] - four.interval[0]);
  assert.strictEqual(four.constrained, false);
  assert.strictEqual(hundred.constrained, true);
  for (const [p, n] of [[0.02, 4], [0.98, 4], [0, 1], [1, 1]]) {
    const i = dp.forecastInterval(p, n);
    assert.ok(i.interval[0] >= 0 && i.interval[1] <= 1, JSON.stringify(i.interval));
  }
  assert.match(dp.forecastInterval(0.5, 9).method, /NOT a statistical confidence interval/);
});

test('no interval is offered around a null point estimate', () => {
  const none = dp.forecastInterval(null, 50);
  assert.strictEqual(none.interval, null);
  assert.strictEqual(none.constrained, false);
});

test('twelve forecasts, and with nothing supplied most are unforecastable rather than optimistic', () => {
  const blind = dp.adaptiveGovernanceAnalytics({ now: 0 });
  assert.strictEqual(blind.forecasts.length, 12);
  assert.ok(blind.unforecastable.length);
  assert.strictEqual(blind.everyForecastDerived, true);
  for (const f of blind.forecasts) {
    assert.ok(f.basis, f.forecast);
    if (f.point === null) assert.strictEqual(f.interval, null, f.forecast);
  }
});

test('supplied evidence produces forecasts, and a five-observation one is still unconstrained', () => {
  const controls = controlsAll();
  const full = dp.adaptiveGovernanceAnalytics({
    controls, governanceMaturity: { level: 4, name: 'Evidenced' },
    resilience: ir.evaluate({ controls }),
    stabilityHistory: [0.95, 0.97, 0.96, 0.98, 0.97, 0.99, 0.98, 0.97, 0.96, 0.98],
    now: 0,
  });
  const byId = Object.fromEntries(full.forecasts.map((f) => [f.forecast, f]));
  assert.ok(byId.auditReadiness.point !== null);
  assert.strictEqual(byId.auditReadiness.constrained, true);
  assert.ok(byId.institutionalResilience.point !== null);
  // Five capabilities give ±0.45, which spans most of the scale.
  assert.strictEqual(byId.institutionalResilience.constrained, false);
  // No learning register: unknown, not zero.
  assert.strictEqual(byId.organizationalLearning.point, null);
  assert.ok(full.unconstrained.length);
  assert.match(full.note, /rest on too few observations/);
  assert.strictEqual(full.authorizes, false);
});

test('the adaptive forecasts are carried by the governance analytics report', () => {
  const analytics = dp.governanceAnalytics({ controls: controlsAll(), now: 0 });
  assert.strictEqual(analytics.adaptive.forecasts.length, 12);
});
