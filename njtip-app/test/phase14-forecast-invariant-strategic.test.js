'use strict';
// Phase 14, Parts 15, 19 & 20, and the phase's new global invariant.
const test = require('node:test');
const assert = require('node:assert');
const ci = require('../src/legislation/compliance-intelligence');
const { LegislativeRegistry } = require('../src/legislation/registry');
const ir = require('../src/governance/institutional-resilience');
const inst = require('../src/assurance/institutional');
const own = require('../src/governance/ownership');
const asm = require('../src/architecture/assumptions');
const { LegalAuthorityRegistry } = require('../src/legislation/legal-authority');
const ce = require('../src/assurance/control-effectiveness');

const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const NOW = 400 * DAY;
const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

// --- Part 15: regulatory change forecasting ---------------------------------------------------------

function forecaster() {
  const c = new ci.ComplianceIntelligence({ registry: new LegislativeRegistry(), clock: () => 0 });
  c.forecast({
    kind: 'legislative-change', summary: 'Whistleblower Protection Amendment',
    affects: { contexts: ['intake', 'custody'], controls: ['APP-FIT-ANONYMITY-BOUNDARY', 'APP-FIT-WHISTLEBLOWER-SHIELD'] },
    expectedAt: 200 * DAY, forecastBy: 'Attorney General Chambers', confidence: 'drafted',
  });
  return c;
}

test('a forecast must be attributed and carry a horizon', () => {
  const c = new ci.ComplianceIntelligence({ clock: () => 0 });
  assert.throws(() => c.forecast({ kind: 'legislative-change', summary: 's', expectedAt: 100 * DAY }), (e) => e.failClosed === true);
  assert.throws(() => c.forecast({ kind: 'legislative-change', summary: 's', forecastBy: 'AG' }), /must state when/);
  assert.throws(() => c.forecast({ kind: 'vibes', summary: 's', forecastBy: 'AG', expectedAt: 1 }), /unknown change kind/);
  assert.throws(() => c.forecast({ kind: 'legislative-change', summary: 's', forecastBy: 'AG', expectedAt: 1, confidence: 'certain' }), /unknown forecast confidence/);
});

test('forecasting never moves an obligation into a compliance state', () => {
  const c = forecaster();
  assert.deepStrictEqual(c.changes(), []);
  assert.strictEqual(c.state('data-protection-act').state, 'unknown');
  assert.strictEqual(c.transitionAudit({ now: 0 }).transitions, 0);
  assert.strictEqual(c.regulatoryReadiness({ now: 0 }).obligationsMoved, 0);
  for (const f of c.forecasts()) {
    assert.strictEqual(f.hypothetical, true);
    assert.strictEqual(f.observed, false);
  }
});

test('the impact is derived from what is missing, not typed in', () => {
  const impact = forecaster().forecastImpact('FCH-0001', { controls: controlsAll(), now: 0 });
  assert.deepStrictEqual(impact.affectedContexts, ['custody', 'intake']);
  assert.ok(impact.controls.toBuild.includes('APP-FIT-WHISTLEBLOWER-SHIELD'));
  assert.ok(impact.controls.existing.includes('APP-FIT-ANONYMITY-BOUNDARY'));
  assert.ok(impact.governanceImpact.boards.length);
  assert.ok(impact.operationalDisruption.dataFlows.length);
  assert.ok(ci.EFFORT_BANDS.includes(impact.effort));
  assert.match(impact.effortBasis, /derived from/);
  assert.strictEqual(impact.daysAway, 200);
  assert.match(impact.caveat, /has not happened/);
});

test('effort moves with the work, and an unresolvable context is reported', () => {
  const c = forecaster();
  const controls = controlsAll();
  c.forecast({ kind: 'policy-update', summary: 'already covered', affects: { contexts: ['intake'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'] }, expectedAt: 300 * DAY, forecastBy: 'ARB' });
  assert.strictEqual(c.forecastImpact('FCH-0002', { controls, now: 0 }).effort, 'absorbed');
  c.forecast({ kind: 'policy-update', summary: 'names nothing real', affects: { contexts: ['ministry-of-magic'] }, expectedAt: 300 * DAY, forecastBy: 'ARB' });
  assert.deepStrictEqual(c.forecastImpact('FCH-0003', { controls, now: 0 }).unresolvedContexts, ['ministry-of-magic']);
});

test('an empty forecast register means nobody has looked, not that nothing is coming', () => {
  const empty = new ci.ComplianceIntelligence({ clock: () => 0 }).regulatoryReadiness({ now: 0 });
  assert.strictEqual(empty.ready, false);
  assert.match(empty.readinessBasis, /nobody has looked/);
  assert.strictEqual(empty.authorizes, false);
});

// --- The new global invariant ------------------------------------------------------------------------

function evidencedEstate() {
  const availability = new own.AvailabilityRegister({ clock: () => NOW });
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const training = new own.TrainingRegister({ clock: () => NOW });
  const exercises = new own.ExerciseRegister({ clock: () => NOW });
  for (const s of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      for (const person of [own.OWNERSHIP[s][role], own.deputyOf(own.OWNERSHIP[s][role])]) {
        activity.recordAct({ person, act: 'review', subsystem: s, at: NOW - 10 * DAY });
        for (const course of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person, course, at: NOW - 30 * DAY, by: 'Registrar' });
        for (const [id, k] of Object.entries(own.EXERCISE_KINDS)) if (k.relevantTo.includes(role)) exercises.recordParticipation({ person, exercise: id, at: NOW - 60 * DAY, by: 'ORB', role });
      }
    }
  }
  const continuity = own.knowledgeContinuity({ availability, activity, training, exercises, now: NOW });
  const assumptions = new asm.AssumptionRegistry({ clock: () => NOW });
  assumptions.register('CUSTODY-SOUND', {
    statement: 'a verified assumption for the success path', rationale: 'exercises the passing branch',
    evidence: ['APP-FIT-CUSTODY-SIGNED-CHAIN'], contexts: ['custody'], owner: 'Directorate of Forensic Services',
    reviewCadenceDays: 3650, expiresAt: NOW + 10 * YEAR, verificationMethod: 'executable-check', confidence: 'high',
  });
  assumptions.recordVerification('CUSTODY-SOUND', { holds: true, by: 'Assurance', at: NOW });

  // Phase 15 widened the invariant to six clauses. The two new ones need their own evidence: a
  // declared and reviewed legal basis, and observations of the detecting controls actually working.
  const authorities = new LegalAuthorityRegistry({ clock: () => NOW });
  for (const capability of Object.keys(ir.CRITICAL_CAPABILITIES)) {
    authorities.declare(capability, {
      kind: 'legislation', instrument: 'an instrument recorded by the institution',
      approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 3650, expiresAt: NOW + 10 * YEAR,
      evidence: ['APP-FIT-LEGISLATIVE-IMPACT'], scope: 'the capability as declared',
      declaredBy: 'Legal Informatics Team', at: NOW - DAY,
    });
    authorities.review(capability, { by: 'Attorney General Chambers', at: NOW });
  }
  const observations = new ce.ControlObservationRegister({ clock: () => NOW });
  for (const control of [...new Set(Object.values(ir.DEPENDENCY_KINDS).map((k) => k.detectedBy).filter(Boolean))]) {
    for (let i = 0; i < 20; i += 1) {
      const occurredAt = NOW - (100 - i) * DAY;
      observations.record(control, {
        outcome: 'true-positive', occurredAt, detectedAt: occurredAt + 60_000,
        acknowledgedAt: occurredAt + 120_000, acknowledgedBy: 'Duty Officer',
        remediatedAt: occurredAt + 3600_000, observedBy: 'Operations Review Board',
      });
    }
  }
  return { continuity, assumptions, authorities, observations };
}

test('the invariant has six clauses, each saying where it is evaluated from', () => {
  assert.strictEqual(Object.keys(ir.INVARIANT_CLAUSES).length, 6);
  for (const required of ['unvalidated-assumption', 'unverified-dependency', 'undocumented-governance-relationship', 'single-point-of-organizational-failure',
    'undocumented-legal-authority', 'ineffective-detecting-control']) {
    assert.ok(ir.INVARIANT_CLAUSES[required], required);
  }
  for (const [id, c] of Object.entries(ir.INVARIANT_CLAUSES)) {
    assert.ok(c.statement && c.evaluatedFrom && c.ifUnknown, id);
  }
});

test('with no registers, the clauses that need one report unknown and the invariant does not hold', () => {
  const blind = ir.evaluateGlobalInvariant({ controls: [], now: NOW });
  assert.strictEqual(blind.holds, false);
  assert.strictEqual(blind.blocksInstitutionalReadiness, true);
  for (const cap of blind.capabilities) {
    const a = cap.clauses.find((c) => c.clause === 'unvalidated-assumption');
    assert.strictEqual(a.holds, false, cap.capability);
    assert.strictEqual(a.unknown, true, cap.capability);
  }
  assert.strictEqual(blind.authorizes, false);
});

test('each clause can fail on its own', () => {
  const controls = controlsAll();
  // An expired assumption bearing on the capability's context.
  const stale = new asm.AssumptionRegistry({ clock: () => NOW });
  stale.register('STALE', {
    statement: 's', rationale: 'r', evidence: ['APP-FIT-CUSTODY-SIGNED-CHAIN'], contexts: ['custody'],
    owner: 'DFS', reviewCadenceDays: 90, expiresAt: 10 * DAY, verificationMethod: 'executable-check', confidence: 'high',
  });
  assert.strictEqual(ir.assumptionClause('evidence-custody', { assumptions: stale, controls, now: NOW }).holds, false);
  // A detecting control that ran and failed, and one that never ran.
  const [kind, spec] = Object.entries(ir.DEPENDENCY_KINDS).find(([, k]) => k.detectedBy);
  const failing = ir.verificationClause('evidence-custody', { controls: controls.map((c) => (c.id === spec.detectedBy ? { ...c, pass: false } : c)) });
  assert.strictEqual(failing.holds, false);
  assert.ok(failing.unverified.includes(kind));
  assert.strictEqual(ir.verificationClause('evidence-custody', { controls: controls.filter((c) => c.id !== spec.detectedBy) }).holds, false);
});

test('a fully evidenced constitutional capability satisfies all six clauses', () => {
  const { continuity, assumptions, authorities, observations } = evidencedEstate();
  const g = ir.evaluateGlobalInvariant({ assumptions, continuity, authorities, observations, controls: controlsAll(), now: NOW });
  const custody = g.capabilities.find((c) => c.capability === 'evidence-custody');
  assert.strictEqual(custody.holds, true, custody.clauses.filter((c) => !c.holds).map((c) => `${c.clause}: ${c.reason}`).join('; '));
  // …and the estate as a whole still does not, because other capabilities genuinely fail.
  assert.strictEqual(g.holds, false);
  assert.strictEqual(g.clauses.length, 6);
});

test('the two Phase 15 clauses report unknown before they report failure', () => {
  const blind = ir.evaluateGlobalInvariant({ controls: [], now: NOW });
  for (const cap of blind.capabilities) {
    const legal = cap.clauses.find((c) => c.clause === 'undocumented-legal-authority');
    assert.strictEqual(legal.holds, false, cap.capability);
    assert.strictEqual(legal.unknown, true, cap.capability);
    const effective = cap.clauses.find((c) => c.clause === 'ineffective-detecting-control');
    assert.strictEqual(effective.holds, false, cap.capability);
    assert.strictEqual(effective.unknown, true, cap.capability);
    assert.ok(effective.controls.length, cap.capability);
  }
});

test('a declared but unreviewed legal authority does not satisfy the legal clause', () => {
  const authorities = new LegalAuthorityRegistry({ clock: () => NOW });
  authorities.declare('evidence-custody', {
    kind: 'legislation', instrument: 'an instrument recorded by the institution',
    approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 3650, expiresAt: NOW + 10 * YEAR,
    evidence: ['APP-FIT-LEGISLATIVE-IMPACT'], scope: 'the capability as declared',
    declaredBy: 'Legal Informatics Team', at: NOW - DAY,
  });
  const declared = ir.legalAuthorityClause('evidence-custody', { authorities, controls: controlsAll(), now: NOW });
  assert.strictEqual(declared.holds, false);
  assert.strictEqual(declared.state, 'declared');
  // Recorded-but-unconfirmed is not the same finding as nobody having looked.
  assert.strictEqual(declared.unknown, false);
  authorities.review('evidence-custody', { by: 'Attorney General Chambers', at: NOW });
  assert.strictEqual(ir.legalAuthorityClause('evidence-custody', { authorities, controls: controlsAll(), now: NOW }).holds, true);
});

test('controls observed missing real conditions fail the effectiveness clause while the build stays green', () => {
  const observations = new ce.ControlObservationRegister({ clock: () => NOW });
  for (const control of [...new Set(Object.values(ir.DEPENDENCY_KINDS).map((k) => k.detectedBy).filter(Boolean))]) {
    for (let i = 0; i < 20; i += 1) {
      const occurredAt = NOW - (100 - i) * DAY;
      if (i < 6) { observations.record(control, { outcome: 'false-negative', occurredAt, observedBy: 'ORB' }); continue; }
      observations.record(control, {
        outcome: 'true-positive', occurredAt, detectedAt: occurredAt + 60_000,
        acknowledgedAt: occurredAt + 120_000, acknowledgedBy: 'Duty Officer',
        remediatedAt: occurredAt + 3600_000, observedBy: 'ORB',
      });
    }
  }
  const clause = ir.controlEffectivenessClause('evidence-custody', { observations, controls: controlsAll() });
  assert.strictEqual(clause.holds, false);
  assert.strictEqual(clause.unknown, false);
  assert.ok(clause.ineffective.length);
});

test('a failing clause is accepted only by a named authority, with a rationale and an expiry', () => {
  const acceptances = new ir.ResilienceAcceptance({ clock: () => NOW });
  const base = { capability: 'anonymous-reporting', clause: 'unvalidated-assumption' };
  assert.throws(() => acceptances.acceptClause({ ...base, rationale: 'r', expiresAt: NOW + DAY }), (e) => e.failClosed === true);
  assert.throws(() => acceptances.acceptClause({ ...base, by: 'Oversight Board', expiresAt: NOW + DAY }), (e) => e.failClosed === true);
  assert.throws(() => acceptances.acceptClause({ ...base, by: 'Oversight Board', rationale: 'r' }), /must expire/);
  assert.throws(() => acceptances.acceptClause({ capability: 'anonymous-reporting', clause: 'inconvenience', by: 'Oversight Board', rationale: 'r', expiresAt: NOW + DAY }), /unknown invariant clause/);
  // Constitutional capabilities are the Oversight Board's alone.
  assert.throws(() => acceptances.acceptClause({ ...base, by: 'Platform Engineering', rationale: 'known', expiresAt: NOW + DAY }), (e) => e.failClosed === true);
  assert.ok(acceptances.acceptClause({ ...base, by: 'Oversight Board', rationale: 'verification is scheduled', expiresAt: NOW + 30 * DAY }));
});

test('an accepted clause stops blocking, and an expired acceptance stops covering it', () => {
  const { continuity, assumptions } = evidencedEstate();
  const controls = controlsAll();
  const acceptances = new ir.ResilienceAcceptance({ clock: () => NOW });
  acceptances.acceptClause({ capability: 'anonymous-reporting', clause: 'unvalidated-assumption', by: 'Oversight Board', rationale: 'verification is scheduled', expiresAt: NOW + 30 * DAY });

  const now = ir.globalInvariantReport({ assumptions, continuity, controls, acceptances, now: NOW });
  assert.ok(!now.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.clause === 'unvalidated-assumption'));
  for (const u of now.unaccepted) assert.ok(u.ifUnknown, u.clause);

  const later = ir.globalInvariantReport({ assumptions, continuity, controls, acceptances, now: NOW + 60 * DAY });
  assert.ok(later.unaccepted.some((u) => u.capability === 'anonymous-reporting' && u.clause === 'unvalidated-assumption'));
  assert.strictEqual(later.expiredAcceptances.length, 1);
  assert.strictEqual(later.blocksInstitutionalReadiness, true);
});

// --- Parts 19 & 20: strategic intelligence and adaptive assurance -------------------------------------

const GREEN_PANELS = {
  resilience: { holds: true, violationCount: 0, capabilities: [{ categoriesValidated: true }] },
  governanceMaturity: { level: 5, name: 'Continuously assured' },
  readiness: { readyCount: 10, dimensionCount: 10, allDimensionsReady: true },
  mission: { safeToDeploy: true, boardSummary: 'no declared justice service is affected' },
  documentation: { sound: true, verification: { claims: 132, unresolvedCount: 0 } },
  continuity: { sound: true, minimumBusFactor: 2, singlePersonDependencies: [] },
  compliance: { complianceRate: 1, direction: 'improving', recentDirection: 'improving', reconciliation: { sound: true } },
  training: { sound: true, readinessContribution: 1, expiredQualifications: [] },
  simulation: { confidence: 'high', uncalibrated: [] },
  assumptions: { count: 9, sound: true, stale: [], overclaims: [] },
  regulatory: { count: 2, ready: true, readinessBasis: '2 forecast change(s) modelled' },
  adaptive: { constrained: ['auditReadiness'], unconstrained: [], forecasts: [1, 2, 3, 4, 5, 6] },
  capacity: { measured: ['staffing'], complete: true, shortfallCount: 0, unmeasurable: [] },
  decisions: { evaluationRate: 1, contradicted: [], unevaluated: [] },
  publicTrust: { composite: 'warranted', basis: 'every measured condition holds' },
  // Phase 15, Part 15 added seven institutional-health panels.
  optimization: { findingCount: 0, bottleneckAuthorities: [], overCapacityAuthorities: [] },
  legalAuthority: { count: 5, complete: true, completenessBasis: '5 of 5 capabilities have a reviewed legal authority' },
  assumptionMaturity: { organizationalMaturity: 'A4', belowMinimum: [], maturityBasis: 'every assumption is at or above its required maturity' },
  controlEffectiveness: { effectivenessRate: 1, measurable: true, ineffective: [], effectivenessBasis: 'every observed control is effective' },
  dependencyIntelligence: { count: 5, open: 0, weakestType: { type: 'organizational' } },
  learning: { learningRate: 1, measurable: true, correctedNotLearned: [] },
};

test('twenty-two executive panels, all derived, none enterable by hand', () => {
  assert.strictEqual(Object.keys(inst.EXECUTIVE_PANELS).length, 22);
  for (const required of ['strategicReadiness', 'organizationalMaturity', 'operationalSustainability', 'decisionQuality', 'publicTrust',
    'governanceHealth', 'legalAuthorityCompleteness', 'assumptionMaturity', 'controlEffectiveness', 'dependencyResilience', 'organizationalLearning', 'documentationIntegrity']) {
    assert.ok(inst.EXECUTIVE_PANELS[required], required);
  }
  const injected = inst.executiveGovernanceIntelligence({ publicTrust: 1, decisionQuality: 0.99 });
  assert.strictEqual(injected.panels.find((p) => p.panel === 'decisionQuality').measured, false);
  assert.strictEqual(injected.everyMetricDerived, true);
});

test('a fully evidenced strategic dashboard is sound and still prints NOT AUTHORIZED', () => {
  const d = inst.executiveGovernanceIntelligence(GREEN_PANELS);
  assert.strictEqual(d.sound, true, d.unsound.concat(d.unmeasured).join(', '));
  assert.strictEqual(d.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(d.authorizes, false);
});

test('a failing strategic source turns its own panel red rather than being averaged away', () => {
  const d = inst.executiveGovernanceIntelligence({ ...GREEN_PANELS, publicTrust: { composite: 'not-warranted', basis: 'a citizen cannot report' } });
  assert.ok(d.unsound.includes('publicTrust'));
  assert.strictEqual(d.sound, false);
});

test('twenty-one assurance domains, each saying what unverified would mean', () => {
  assert.strictEqual(Object.keys(inst.ASSURANCE_DOMAINS).length, 21);
  for (const required of ['dependencyResilience', 'strategicReadiness', 'learningMaturity', 'governanceAdaptability', 'publicTrustIndicators',
    'legalAuthority', 'controlEffectiveness', 'institutionalSustainability']) {
    assert.ok(inst.ASSURANCE_DOMAINS[required], required);
  }
  for (const [id, d] of Object.entries(inst.ASSURANCE_DOMAINS)) assert.ok(d.unverifiedMeans.length > 30, id);
  assert.strictEqual(inst.institutionalAssurance({}).unmeasured.length, 21);
});

test('an institution that corrects without learning fails learning maturity', () => {
  const a = inst.institutionalAssurance({ learning: { learningRate: 0, correctedNotLearned: ['IMP-0001'] } });
  assert.ok(a.failing.includes('learningMaturity'));
  assert.ok(!a.unmeasured.includes('learningMaturity'));
});

test('twenty-one verified domains are institutionally ready and still NOT AUTHORIZED', () => {
  const a = inst.institutionalAssurance({
    drift: { clean: true }, security: true, privacy: true,
    governanceMaturity: { level: 5 }, documentation: { sound: true },
    readiness: { allDimensionsReady: true }, continuity: { sound: true, minimumBusFactor: 2 },
    resilience: { holds: true, capabilities: [{ categoriesValidated: true }] }, training: { sound: true },
    compliance: { reconciliation: { sound: true } }, mission: { safeToDeploy: true },
    evidenceQuality: { sound: true }, regulatory: { ready: true },
    learning: { learningRate: 1, correctedNotLearned: [] },
    optimization: { bottleneckAuthorities: [], overCapacityAuthorities: [] },
    publicTrust: { composite: 'warranted' },
    // Phase 15: legal authority, control effectiveness and sustainability.
    legalAuthority: { complete: true }, controlEffectiveness: { measurable: true, ineffective: [] },
    sustainability: { sustainable: true },
  });
  assert.strictEqual(a.institutionallyReady, true, a.blockers.join('; '));
  assert.strictEqual(a.verified, 21);
  // The invariant that has survived every phase.
  assert.strictEqual(a.authorizationStatus, 'NOT AUTHORIZED');
  assert.strictEqual(a.authorizes, false);
  assert.strictEqual(a.derivedFromReadiness, false);
  assert.match(a.note, /does not replace human authority/);
});
