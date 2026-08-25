'use strict';
// Phase 15, Parts 15–20: cross-government readiness, workload forecasting, institutional
// sustainability, executive decision support, and the phase's widened global invariant.
const test = require('node:test');
const assert = require('node:assert');
const ca = require('../src/governance/cross-agency');
const cm = require('../src/architecture/context-map');
const own = require('../src/governance/ownership');
const inst = require('../src/assurance/institutional');
const dp = require('../src/architecture/drift-prevention');
const ir = require('../src/governance/institutional-resilience');
const asm = require('../src/architecture/assumptions');
const doc = require('../src/architecture/documentation-assurance');
const { LegalAuthorityRegistry } = require('../src/legislation/legal-authority');

const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const NOW = 400 * DAY;
const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

const authorityFor = (registry, capability, { review = true, expiresAt = NOW + 10 * YEAR } = {}) => {
  registry.declare(capability, {
    kind: 'legislation', instrument: 'an instrument recorded by the institution',
    approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 3650, expiresAt,
    evidence: ['APP-FIT-LEGISLATIVE-IMPACT'], scope: 'the capability as declared',
    declaredBy: 'Legal Informatics Team', at: NOW - DAY,
  });
  if (review) registry.review(capability, { by: 'Attorney General Chambers', at: NOW });
  return registry;
};

// --- Part 17: cross-government readiness -------------------------------------------------------

test('institutions and their constitutional zones are derived, never listed', () => {
  const insts = ca.institutions();
  assert.strictEqual(insts.length, ca.agencies().length);
  for (const i of insts) {
    for (const z of i.zones) assert.ok(cm.ZONES.has(z), `${i.agency}: ${z}`);
    if (i.contexts.length) {
      // The strictest classification it holds, not the average of its portfolio.
      const order = [...cm.CLASSIFICATIONS];
      const held = i.contexts.map((c) => cm.zoneGovernance(c).classification);
      assert.strictEqual(i.strictestClassification, order.find((c) => held.includes(c)), i.agency);
    }
  }
  // An institution accountable across zones is itself a constitutional crossing point.
  const spanning = insts.filter((i) => i.spansZones);
  assert.ok(spanning.length, 'no institution spans constitutional zones');
  for (const i of spanning) assert.strictEqual(i.zone, 'spans-zones');
});

test('five readiness aspects, and only "ready" counts as ready', () => {
  assert.strictEqual(Object.keys(ca.GOVERNMENT_READINESS_ASPECTS).length, 5);
  for (const [id, a] of Object.entries(ca.GOVERNMENT_READINESS_ASPECTS)) {
    assert.ok(a.question.endsWith('?'), id);
    assert.ok(a.evidencedBy && a.failsAs, id);
  }
  assert.deepStrictEqual(Object.entries(ca.ASPECT_STATES).filter(([, s]) => s.ready).map(([id]) => id), ['ready']);
  // A recorded conflict ranks below an unexamined aspect, and neither is ready.
  assert.ok(ca.ASPECT_STATES.blocked.rank < ca.ASPECT_STATES.unknown.rank);
  assert.strictEqual(ca.ASPECT_STATES.unknown.ready, false);
  assert.strictEqual(ca.ASPECT_STATES.blocked.ready, false);
});

test('a relationship is only as ready as its weakest aspect, never the average', () => {
  const r = ca.crossGovernmentReadiness({});
  assert.ok(r.pairCount > 0);
  for (const p of r.pairs) {
    assert.strictEqual(p.aspects.length, 5);
    const worst = p.aspects.reduce((w, a) => (ca.ASPECT_STATES[a.state].rank < ca.ASPECT_STATES[w].rank ? a.state : w), 'ready');
    assert.strictEqual(p.readiness, worst, p.agencies.join(' ↔ '));
    assert.strictEqual(p.ready, p.aspects.every((a) => a.state === 'ready'));
  }
});

test('unknown is counted apart from blocked, at the pair level and the top level', () => {
  const r = ca.crossGovernmentReadiness({});
  for (const p of r.pairs) {
    for (const aspect of p.unknownAspects) assert.ok(!p.blockedAspects.includes(aspect));
    for (const aspect of p.readyAspects) {
      assert.ok(!p.unknownAspects.includes(aspect));
      assert.ok(!p.blockedAspects.includes(aspect));
    }
  }
  assert.ok(r.pairsWithUnknownAspects > 0);
  assert.ok(r.pairsWithBlockedAspects > 0);
  // With no registers at all, nothing is ready — and that is the true answer, not a discouraging one.
  assert.strictEqual(r.readinessRate, 0);
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.measurable.legalInteroperability, false);
  assert.strictEqual(r.measurable.operationalCoordination, false);
  assert.strictEqual(r.authorizes, false);
});

test('every aspect discriminates: none is ready for every pair', () => {
  const r = ca.crossGovernmentReadiness({});
  for (const a of r.byAspect) {
    assert.ok(Object.values(a.counts).some((n) => n > 0), a.aspect);
    assert.notStrictEqual(a.counts.ready, r.pairCount, `${a.aspect} is ready for every pair`);
  }
  assert.ok(r.limitingAspect);
});

test('communication is direct, relayed, or absent — and all three occur on the real estate', () => {
  // Institutions sharing a board reach each other directly.
  const direct = ca.communicationReadiness('National Identity Authority', 'National Cryptographic Authority');
  assert.strictEqual(direct.state, 'ready');
  assert.strictEqual(direct.hops, 1);
  // The ISRB cluster shares no forum with the rest of the governance graph.
  const isolated = ca.communicationReadiness('National Identity Authority', 'Attorney General Chambers');
  assert.strictEqual(isolated.state, 'blocked');
  assert.ok(isolated.findings.length);
  // And two institutions holding nothing cannot reach each other.
  assert.strictEqual(ca.communicationReadiness('Nobody At All', 'Also Nobody').state, 'blocked');
});

test('legal interoperability is unknown without a register and ready only once reviewed', () => {
  const withReliance = ca.crossGovernmentReadiness({}).pairs
    .find((p) => p.aspects.find((a) => a.aspect === 'legalInteroperability').reliances.length);
  assert.ok(withReliance, 'no pair delivers a critical capability by relying on the other');
  const [a, b] = withReliance.agencies;

  assert.strictEqual(ca.legalInteroperability(a, b, {}).state, 'unknown');

  const declared = new LegalAuthorityRegistry({ clock: () => NOW });
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES)) authorityFor(declared, capability, { review: false });
  // Recorded but unconfirmed is BLOCKED, not unknown: somebody looked and the answer is incomplete.
  assert.strictEqual(ca.legalInteroperability(a, b, { authorities: declared, now: NOW }).state, 'blocked');

  const reviewed = new LegalAuthorityRegistry({ clock: () => NOW });
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES)) authorityFor(reviewed, capability);
  const ok = ca.legalInteroperability(a, b, { authorities: reviewed, now: NOW });
  assert.strictEqual(ok.state, 'ready', ok.findings.join('; '));
});

test('governance interoperability finds real onward-disclosure and classification conflicts', () => {
  const aspects = ca.crossGovernmentReadiness({}).pairs.map((p) => p.aspects.find((a) => a.aspect === 'governanceInteroperability'));
  const blocked = aspects.filter((a) => a.state === 'blocked');
  assert.ok(blocked.length, 'no governance conflict across the declared cross-institutional flows');
  assert.ok(blocked.some((a) => a.findings.some((f) => /onward disclosure/.test(f))));
  assert.ok(blocked.some((a) => a.findings.some((f) => /classification downgrade/.test(f))));
  for (const a of blocked) assert.ok(a.findings.length);
  // An internal dependency on a 'no-sharing' context is architecture working as designed, not a
  // breach: the constraint governs what leaves, so only a LOOSER sink is a finding.
  for (const a of aspects) {
    for (const f of a.findings) assert.ok(!/depends on it across an institutional boundary/.test(f));
  }
  // Two institutions with no declared flow between them have nothing to reconcile.
  assert.strictEqual(ca.governanceInteroperability('Service Delivery Board', 'AI Governance Board').state, 'ready');
});

test('a consulted register that records nothing joint is blocked, not unknown', () => {
  const pair = ca.crossGovernmentReadiness({}).pairs[0].agencies;
  const empty = new own.ExerciseRegister({ clock: () => NOW });
  const looked = ca.operationalCoordination(pair[0], pair[1], { exercises: empty, now: NOW });
  assert.strictEqual(looked.state, 'blocked');
  assert.strictEqual(looked.coordination.unknown, false);
  // Nobody having looked at all is a different state.
  assert.strictEqual(ca.operationalCoordination(pair[0], pair[1], {}).state, 'unknown');
});

test('a recorded joint rehearsal makes coordination ready, or the bar is unreachable', () => {
  const exercises = new own.ExerciseRegister({ clock: () => NOW });
  const peopleFor = (agency) => own.subsystems()
    .filter((s) => [own.OWNERSHIP[s].responsibleAuthority, own.OWNERSHIP[s].approvingAuthority].includes(agency))
    .flatMap((s) => own.DEPUTY_ROLES.map((r) => own.OWNERSHIP[s][r]));
  const exercise = Object.keys(own.EXERCISE_KINDS)[0];
  const pair = ca.crossGovernmentReadiness({}).pairs[0].agencies;
  for (const agency of pair) {
    exercises.recordParticipation({ person: peopleFor(agency)[0], exercise, at: NOW - 10 * DAY, by: 'ORB', role: 'operationalOwner' });
  }
  const warm = ca.operationalCoordination(pair[0], pair[1], { exercises, now: NOW });
  assert.strictEqual(warm.state, 'ready', warm.detail);
  assert.strictEqual(ca.crossGovernmentReadiness({ exercises, now: NOW }).measurable.operationalCoordination, true);
});

test('a single declared flow between two institutions is reported as a single path', () => {
  const aspects = ca.crossGovernmentReadiness({}).pairs.map((p) => p.aspects.find((a) => a.aspect === 'dependencyResilience'));
  assert.ok(new Set(aspects.map((a) => a.state)).size > 1, 'the resilience check does not discriminate');
  assert.ok(aspects.some((a) => a.findings.some((f) => /exactly one declared flow/.test(f))));
});

test('a relationship crossing the constitutional separation is recorded as crossing one', () => {
  const r = ca.crossGovernmentReadiness({});
  assert.ok(r.crossZonePairCount > 0);
  for (const p of r.crossZonePairs) assert.notStrictEqual(p.zones[0], p.zones[1]);
  for (const p of r.pairs.filter((x) => !x.crossesConstitutionalSeparation)) assert.strictEqual(p.zones[0], p.zones[1]);
});

// --- Part 16: adaptive governance workload forecasting -----------------------------------------

test('twelve forecast dimensions, six of them asking how much work is coming', () => {
  assert.strictEqual(Object.keys(dp.FORECAST_DIMENSIONS).length, 12);
  for (const required of ['governanceWorkload', 'reviewBottlenecks', 'assumptionVerificationDemand', 'policyMaintenanceEffort', 'auditPreparationEffort', 'institutionalResilienceTrend']) {
    assert.ok(dp.FORECAST_DIMENSIONS[required], required);
    assert.ok(dp.FORECAST_DIMENSIONS[required].unit, required);
  }
});

test('a workload forecast stays null until the record that feeds it is supplied', () => {
  const blind = dp.adaptiveGovernanceAnalytics({ now: 0 });
  const byId = Object.fromEntries(blind.forecasts.map((f) => [f.forecast, f]));
  for (const id of ['governanceWorkload', 'reviewBottlenecks', 'assumptionVerificationDemand', 'auditPreparationEffort', 'institutionalResilienceTrend']) {
    assert.strictEqual(byId[id].point, null, id);
    assert.strictEqual(byId[id].interval, null, id);
    assert.strictEqual(byId[id].constrained, false, id);
  }
  // Policy maintenance reads the declared stances, which always exist.
  assert.notStrictEqual(byId.policyMaintenanceEffort.point, null);
});

test('with its sources supplied each workload forecast produces a figure inside [0,1]', () => {
  const controls = controlsAll();
  const registry = new asm.AssumptionRegistry({ clock: () => 0 });
  asm.seedPlatformAssumptions(registry, { at: 0 });
  const loaded = dp.adaptiveGovernanceAnalytics({
    controls,
    optimization: require('../src/governance/optimization').governanceOptimization({ controls, now: 0 }),
    assumptionMaturity: registry.maturityReport({ now: 0, controls }),
    documentation: doc.report({ controls }),
    resilienceHistory: [0.2, 0.3, 0.4],
    now: 0,
  });
  const byId = Object.fromEntries(loaded.forecasts.map((f) => [f.forecast, f]));
  for (const id of ['governanceWorkload', 'reviewBottlenecks', 'assumptionVerificationDemand', 'auditPreparationEffort', 'institutionalResilienceTrend']) {
    assert.notStrictEqual(byId[id].point, null, id);
    assert.ok(byId[id].point >= 0 && byId[id].point <= 1, `${id}: ${byId[id].point}`);
    assert.ok(byId[id].basis, id);
  }
});

test('a trend needs at least two recorded periods; one observation is a reading', () => {
  const one = dp.adaptiveGovernanceAnalytics({ resilienceHistory: [0.4], now: 0 });
  const trend = one.forecasts.find((f) => f.forecast === 'institutionalResilienceTrend');
  assert.strictEqual(trend.point, null);
  assert.match(trend.basis, /a reading, not a trend/);
});

// --- Part 19: institutional sustainability -----------------------------------------------------

test('every sustainability dimension states its own horizon', () => {
  assert.strictEqual(Object.keys(inst.SUSTAINABILITY_DIMENSIONS).length, 7);
  for (const [id, d] of Object.entries(inst.SUSTAINABILITY_DIMENSIONS)) {
    assert.ok(d.horizon, id);
    assert.ok(d.asks.endsWith('?'), id);
    assert.ok(d.ifLost, id);
  }
});

test('an unmeasured sustainability dimension is never a sustainable one', () => {
  const blind = inst.institutionalSustainability({});
  assert.strictEqual(blind.sustainable, false);
  assert.strictEqual(blind.unmeasured.length, 7);
  // Unmeasured and unsustainable are different findings needing different work.
  assert.deepStrictEqual(blind.unsustainable, []);
  for (const d of blind.dimensions) {
    assert.strictEqual(d.sustainable, null, d.dimension);
    assert.strictEqual(d.derived, true, d.dimension);
  }
  assert.strictEqual(blind.authorizes, false);
});

const SUSTAINABLE = {
  optimization: { overCapacityAuthorities: [] },
  continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: [] },
  documentation: { sound: true, verification: { unresolvedCount: 0 } },
  assumptionMaturity: { belowMinimum: [], verificationBacklog: [] },
  resilience: { capabilities: [{ singleDependencies: [] }] },
  legalAuthority: { complete: true, blocking: [] },
};

test('a fully evidenced institution is sustainable, and every dimension can fail on its own', () => {
  const whole = inst.institutionalSustainability(SUSTAINABLE);
  assert.strictEqual(whole.sustainable, true, whole.unsustainable.concat(whole.unmeasured).join(', '));
  for (const [dimension, broken] of [
    ['governanceContinuity', { optimization: { overCapacityAuthorities: ['Oversight Board'] } }],
    ['organizationalResilience', { continuity: { sound: false, minimumBusFactor: 1, singlePersonDependencies: [] } }],
    ['documentationSustainability', { documentation: { sound: false, verification: { unresolvedCount: 4 } } }],
    ['assumptionHealth', { assumptionMaturity: { belowMinimum: ['ASM-0001'], verificationBacklog: [] } }],
    ['knowledgePreservation', { resilience: { capabilities: [{ singleDependencies: ['knowledge'] }] } }],
    ['successionReadiness', { continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: ['Registrar'] } }],
    ['legalContinuity', { legalAuthority: { complete: false, blocking: [{ capability: 'case-investigation' }] } }],
  ]) {
    const r = inst.institutionalSustainability({ ...SUSTAINABLE, ...broken });
    assert.ok(r.unsustainable.includes(dimension), dimension);
    assert.strictEqual(r.sustainable, false, dimension);
    assert.ok(r.shortestHorizon.some((h) => h.startsWith(dimension)), dimension);
  }
});

// --- Part 18: executive decision support -------------------------------------------------------

const COMPLETE_PACKAGE = {
  recommendation: 'Record the legal basis for case investigation.',
  supportingEvidence: ['src/legislation/legal-authority.js'], confidence: 'high',
  assumptions: ['that an instrument exists'], affectedControls: ['APP-FIT-LEGAL-AUTHORITY'],
  legalDependencies: ['case-investigation: unknown'], institutionalImpacts: ['Attorney General Chambers'],
  risks: ['recording a plausible instrument that does not authorise it'], uncertainties: ['whether one exists'],
  // Phase 17 Parts 15 & 17 and Phase 18 Part 7 added nine fields to this one guard rather than
  // creating parallel decision frameworks.
  evidenceStrength: 'absence', forecastConfidence: 'not-applicable',
  governanceOwner: 'Attorney General Chambers',
  alternativesConsidered: ['suspend the capability until a basis is recorded'],
  predictedConsequences: ['the capability moves from an unknown legal basis to a declared one'],
  historicalOutcomes: ['no comparable recommendation has been recorded'],
  validationHistory: ['the premise has never been tested against a real instrument'],
  constitutionalImplications: ['none identified for this capability'],
  recommendedHumanActions: [inst.humanAction('Read and record the instrument.', 'Attorney General Chambers')],
};

test('a decision package requires seventeen kinds of evidence, each saying what its absence means', () => {
  assert.strictEqual(Object.keys(inst.DECISION_PACKAGE_FIELDS).length, 17);
  for (const [id, f] of Object.entries(inst.DECISION_PACKAGE_FIELDS)) assert.ok(f.absentMeans, id);
  assert.ok(inst.decisionPackage(COMPLETE_PACKAGE));
  for (const field of Object.keys(inst.DECISION_PACKAGE_FIELDS)) {
    assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, [field]: undefined }), (e) => e.failClosed === true, field);
    // An empty list is the same absence as a missing one.
    assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, [field]: Array.isArray(COMPLETE_PACKAGE[field]) ? [] : '' }), (e) => e.failClosed === true, field);
  }
});

test('a recommendation with no alternative is an instruction, and advice must be owned', () => {
  // A board asked to approve a recommendation with nothing to choose between is not deciding.
  assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, alternativesConsidered: [] }), (e) => e.failClosed === true);
  // The accountable body and every named actor must exist in the accountability record.
  assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, governanceOwner: 'Department of Nobody' }), (e) => e.failClosed === true);
  assert.throws(
    () => inst.decisionPackage({ ...COMPLETE_PACKAGE, recommendedHumanActions: [inst.humanAction('Do it.', 'Department of Nobody')] }),
    (e) => e.failClosed === true,
  );
  // This platform recommends actions and never records itself performing one.
  assert.throws(
    () => inst.decisionPackage({
      ...COMPLETE_PACKAGE,
      recommendedHumanActions: [{ ...inst.humanAction('Do it.', 'Oversight Board'), takenBy: 'NJTIP', takenAt: 0 }],
    }),
    (e) => e.failClosed === true,
  );
});

test('evidence strength is graded, not described, and a forecast confidence needs a forecast', () => {
  // "high — derived from the records" and "high — a projection" are not the same claim.
  assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, evidenceStrength: 'high — from the records' }), (e) => e.failClosed === true);
  assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, evidenceStrength: 'projected' }), (e) => e.failClosed === true);
  assert.throws(() => inst.decisionPackage({ ...COMPLETE_PACKAGE, forecastConfidence: 'well calibrated' }), (e) => e.failClosed === true);
  assert.ok(inst.decisionPackage({ ...COMPLETE_PACKAGE, evidenceStrength: 'projected', forecastConfidence: 'the forecast has been scored 8 times, 62% within interval' }));
  assert.ok(inst.EVIDENCE_STRENGTH.projected.rank < inst.EVIDENCE_STRENGTH.absence.rank,
    'a projection does not outrank a directly observable absence');
});

test('the advisory conclusion is a constant string and no input can change it', () => {
  assert.strictEqual(inst.HUMAN_AUTHORIZATION_REQUIRED, 'Human authorization required.');
  const overridden = inst.decisionPackage({
    ...COMPLETE_PACKAGE, conclusion: 'Approved.', authorizes: true, advisory: false, decidedBy: 'Oversight Board',
  });
  assert.strictEqual(overridden.conclusion, inst.HUMAN_AUTHORIZATION_REQUIRED);
  assert.strictEqual(overridden.authorizes, false);
  assert.strictEqual(overridden.advisory, true);
  assert.strictEqual(overridden.decidedBy, null);
  // The guard rejects a hand-built package that concludes anything else, or claims authority.
  assert.throws(() => inst.assertAdvisory({ ...COMPLETE_PACKAGE, conclusion: 'Proceed.', authorizes: false }), (e) => e.failClosed === true);
  assert.throws(() => inst.assertAdvisory({ ...COMPLETE_PACKAGE, conclusion: inst.HUMAN_AUTHORIZATION_REQUIRED, authorizes: true }), (e) => e.failClosed === true);
});

test('no evidence produces no advice, and real findings produce advisory packages', () => {
  const silent = inst.decisionSupport({});
  assert.strictEqual(silent.count, 0);
  assert.match(silent.basis, /says nothing rather than inventing advice/);

  const sources = {
    legalAuthority: { blocking: [{ capability: 'anonymous-reporting', state: 'unknown', reason: 'nothing is recorded', constitutional: true }] },
    assumptionMaturity: { verificationBacklog: [{ assumption: 'ASM-0001', criticality: 'foundational' }], belowMinimum: [], organizationalMaturity: 'A2' },
    controlEffectiveness: { measurable: false, unknown: ['APP-FIT-KNOWLEDGE-CONTINUITY'] },
  };
  const loaded = inst.decisionSupport(sources);
  assert.strictEqual(loaded.count, 3);
  assert.strictEqual(loaded.everyPackageAdvisory, true);
  assert.strictEqual(loaded.conclusion, inst.HUMAN_AUTHORIZATION_REQUIRED);
  assert.strictEqual(loaded.authorizes, false);
  for (const p of loaded.packages) {
    inst.assertAdvisory(p);
    assert.ok(p.risks.length && p.uncertainties.length && p.assumptions.length, p.subject);
  }
  assert.ok(loaded.packages.some((p) => p.priority === 'constitutional'));
  // Deterministic: the same input twice produces the same ordering.
  assert.deepStrictEqual(loaded.ordered, inst.decisionSupport(sources).ordered);
});

// --- Part 20: the widened global invariant ------------------------------------------------------

test('the invariant does not hold on the recorded estate, and names which clauses fail', () => {
  const report = ir.globalInvariantReport({ controls: controlsAll(), now: NOW });
  assert.strictEqual(report.holds, false);
  assert.strictEqual(report.blocksInstitutionalReadiness, true);
  assert.strictEqual(report.authorizes, false);
  const failing = report.clauses.filter((c) => c.failingCapabilities.length).map((c) => c.clause);
  for (const clause of ['undocumented-legal-authority', 'ineffective-detecting-control']) {
    assert.ok(failing.includes(clause), clause);
  }
});
