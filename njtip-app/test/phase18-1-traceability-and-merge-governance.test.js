'use strict';

// Phase 18.1 — architectural governance, specification traceability and framework integrity.
//
// This phase exists because of something the platform could not do. Eighteen phases of
// specifications arrived as prose, were implemented, and left no artefact saying which requirement
// authorised which module. The gap was found the hard way: three requirements were merged into one
// guard with no ADR, and nothing in a 204-invariant assurance suite noticed — because nothing knew
// the three requirements existed.
//
// Two refusals shape the whole layer. The register is DECLARED and never inferred, because a
// traceability matrix full of guesses is worse than none. And a missing required element produces
// BLOCKED rather than a fraction, because "seven of nine" invites a reader to see 78% and move on
// when the requirement is simply unverified.

const test = require('node:test');
const assert = require('node:assert/strict');

const adr = require('../src/architecture/adr-governance');
const inst = require('../src/assurance/institutional');
const contextMap = require('../src/architecture/context-map');

const CONTROLS = [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

const BASE = {
  specification: 'Phase 18.1', section: 'Part 1',
  statement: 'Implement an executable requirements traceability matrix',
  artefactType: 'executable', declaredBy: 'Architecture Review Board',
};

const TRACED = {
  ...BASE,
  implementation: 'src/architecture/adr-governance.js',
  context: (contextMap.moduleOwnership().owner || {})['src/architecture/adr-governance.js'],
  owner: 'Architecture Review Board', capability: 'Architecture Governance', adr: 'ADR-0012',
  tests: ['phase18-1-traceability-and-merge-governance.test.js'],
  fitness: ['APP-FIT-REQUIREMENTS-TRACEABILITY'],
  mutation: ['the BLOCKED state was weakened to PARTIAL and the control caught it'],
  documentation: 'docs/architecture-governance.md', commits: ['0225cae'],
};

// ---------------------------------------------------------------------------------------------
// Part 1 — the requirement register. Declared, never inferred.
// ---------------------------------------------------------------------------------------------

test('phase18.1: six requirement states, exactly one verifying and exactly one blocking', () => {
  assert.equal(Object.keys(adr.REQUIREMENT_STATES).length, 6);
  const verifying = Object.entries(adr.REQUIREMENT_STATES).filter(([, s]) => s.verified).map(([id]) => id);
  assert.deepEqual(verifying, ['VERIFIED']);
  const blocking = Object.entries(adr.REQUIREMENT_STATES).filter(([, s]) => s.blocking).map(([id]) => id);
  assert.deepEqual(blocking, ['BLOCKED']);
  // If UNKNOWN blocked, nobody could declare a requirement before verifying it.
  assert.equal(adr.REQUIREMENT_STATES.UNKNOWN.blocking, false);
  assert.match(adr.REQUIREMENT_STATES.BLOCKED.means, /not a percentage/i);
});

test('phase18.1: mutation testing is required of code and is a category error for a governance decision', () => {
  assert.ok(adr.ARTEFACT_TYPES.executable.requires.includes('tests'));
  assert.ok(adr.ARTEFACT_TYPES.executable.requires.includes('fitness'));
  assert.ok(adr.ARTEFACT_TYPES.architectural.requires.includes('adr'));
  // You cannot mutate a board's approval to see whether a control notices.
  assert.ok(!adr.ARTEFACT_TYPES.governance.requires.includes('mutation'));
  assert.ok(!adr.ARTEFACT_TYPES.governance.requires.includes('fitness'));
  assert.match(adr.ARTEFACT_TYPES.governance.means, /category error/);
  for (const [id, t] of Object.entries(adr.ARTEFACT_TYPES)) {
    assert.deepEqual(t.requires.filter((e) => t.optional.includes(e)), [], `${id} lists an element as both required and optional`);
  }
});

test('phase18.1: a requirement that cannot be traced back to a specification is refused', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  for (const field of ['specification', 'section', 'statement', 'declaredBy', 'artefactType']) {
    assert.throws(() => reg.declare('R', { ...BASE, [field]: undefined }), (e) => e.failClosed === true, field);
  }
  assert.throws(() => reg.declare('R', { ...BASE, artefactType: 'invented' }), (e) => e.failClosed === true);
  // A rejection with no reason is indistinguishable from an oversight.
  assert.throws(() => reg.declare('R', { ...BASE, rejected: true }), (e) => e.failClosed === true);
  assert.ok(reg.declare('R', BASE));
});

test('phase18.1: a fully traced requirement is reachable — a state nothing can reach is not a state', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('P181-1', TRACED);
  const v = reg.verify('P181-1', { controls: CONTROLS, now: 0 });
  assert.notEqual(v.state, 'BLOCKED', v.reason);
  assert.ok(['VERIFIED', 'PARTIAL'].includes(v.state));
  assert.deepEqual(v.brokenMappings, []);
});

// ---------------------------------------------------------------------------------------------
// Part 3 — coverage verification. A missing required element is BLOCKED, not a fraction.
// ---------------------------------------------------------------------------------------------

test('phase18.1: an executable requirement with no test or no control is BLOCKED, never partial', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('NOTESTS', { ...TRACED, tests: [] });
  const noTests = reg.verify('NOTESTS', { controls: CONTROLS, now: 0 });
  assert.equal(noTests.state, 'BLOCKED');
  assert.ok(noTests.missingRequired.includes('tests'));
  assert.match(noTests.reason, /BLOCKED, not partially verified/);

  reg.declare('NOFIT', { ...TRACED, fitness: [] });
  assert.equal(reg.verify('NOFIT', { controls: CONTROLS, now: 0 }).state, 'BLOCKED');

  // …and a missing OPTIONAL element is PARTIAL, so the distinction is real.
  reg.declare('NORUNBOOK', { ...TRACED, runbook: null, endpoint: null });
  assert.notEqual(reg.verify('NORUNBOOK', { controls: CONTROLS, now: 0 }).state, 'BLOCKED');
});

test('phase18.1: a declaration that points at nothing is a broken mapping, worse than an absence', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('BROKEN', {
    ...TRACED, implementation: 'src/module-that-does-not-exist.js',
    context: 'not-a-bounded-context', owner: 'Department of Nobody', adr: 'ADR-0099',
    tests: ['a-file-that-does-not-exist.test.js'], fitness: ['APP-FIT-NEVER-EXISTED'],
  });
  const broken = reg.verify('BROKEN', { controls: CONTROLS, now: 0 });
  assert.equal(broken.state, 'BLOCKED');
  for (const element of ['implementation', 'context', 'owner', 'adr', 'tests', 'fitness']) {
    assert.ok(broken.brokenMappings.some((b) => b.element === element), element);
  }
  assert.match(broken.reason, /reads as covered and is not/);
});

test('phase18.1: mutation evidence is recorded, never inferred from a fitness function existing', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('NOMUT', { ...TRACED, mutation: [] });
  const element = reg.verify('NOMUT', { controls: CONTROLS, now: 0 }).elements.find((e) => e.element === 'mutation');
  assert.equal(element.present, false);
  assert.equal(element.resolves, null, 'unrecorded is unknown, not failed');
  assert.match(element.detail, /deliberately not inferred/);
});

test('phase18.1: traceability runs both ways, and a rejected requirement is not an orphan', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('P181-1', TRACED);
  reg.declare('ORPHAN', { ...BASE, implementation: null });
  reg.declare('REJECTED', { ...BASE, rejected: true, rejectionRationale: 'superseded before implementation' });

  const matrix = reg.matrix({ controls: CONTROLS, modules: ['src/architecture/adr-governance.js', 'src/app.js'], now: 0 });
  // Requirement → implementation.
  assert.ok(matrix.orphanRequirements.includes('ORPHAN'));
  assert.ok(!matrix.orphanRequirements.includes('REJECTED'), 'considered and declined is not the same as forgotten');
  // Implementation → requirement: the direction nothing asked before.
  assert.ok(matrix.orphanImplementations.includes('src/app.js'));
  assert.ok(!matrix.orphanImplementations.includes('src/architecture/adr-governance.js'));
  assert.equal(matrix.implementationsExamined, 2, 'the orphan count is over what was examined, not absolute');
});

test('phase18.1: the matrix reports counts per state and no single compliance percentage', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('P181-1', TRACED);
  reg.declare('NOTESTS', { ...TRACED, tests: [] });
  const matrix = reg.matrix({ controls: CONTROLS, now: 0 });

  for (const state of Object.keys(adr.REQUIREMENT_STATES)) {
    assert.ok(Number.isFinite(matrix.counts[state]), state);
  }
  assert.equal(Object.values(matrix.counts).reduce((a, b) => a + b, 0), matrix.count,
    'a requirement is in no state or in two');
  // A single figure would let a high number conceal a blocked requirement.
  assert.ok(!Object.prototype.hasOwnProperty.call(matrix, 'compliancePercentage'));
  assert.equal(matrix.anyBlocked, matrix.counts.BLOCKED > 0);
  assert.equal(matrix.everyRequirementVerified, false);
});

test('phase18.1: an empty register distinguishes having no requirements from not writing them down', () => {
  const empty = new adr.RequirementRegister({ clock: () => 0 }).matrix({ now: 0 });
  assert.equal(empty.measurable, false);
  assert.equal(empty.everyRequirementVerified, false);
  assert.equal(empty.declarative, true);
  assert.match(empty.basis, /has not written them down/);
  assert.equal(empty.authorizes, false);
});

// ---------------------------------------------------------------------------------------------
// Part 9 — specification evolution governance.
//
// A specification arrives claiming to be new. Sometimes it is. More often it extends something that
// exists, and occasionally it redefines something somebody already owns — and the third case does
// the damage, because from inside a specification document it looks exactly like the first.
// ---------------------------------------------------------------------------------------------

const dp = require('../src/architecture/drift-prevention');
const own = require('../src/governance/ownership');

test('phase18.1: the ordinary case stays ordinary — a legitimate extension neither blocks nor needs review', () => {
  for (const ordinary of ['compatible-extension', 'clarification']) {
    assert.equal(dp.EVOLUTION_CLASSES[ordinary].blocking, false, ordinary);
    assert.equal(dp.EVOLUTION_CLASSES[ordinary].requiresHumanReview, false,
      'a classifier that flags every legitimate extension will be switched off within a week');
  }
  const report = dp.specificationEvolution({ proposals: [{ id: 'P-EXT', extendsModule: 'src/assurance/institutional.js' }], now: 0 });
  assert.equal(report.proposals[0].verdict, 'ACCEPTABLE');
  assert.equal(report.anyBlocked, false);
});

test('phase18.1: a proposal nothing could be said about is UNKNOWN, never acceptable', () => {
  const report = dp.specificationEvolution({ proposals: [{ id: 'P-BLANK' }], now: 0 });
  assert.equal(report.proposals[0].verdict, 'UNKNOWN');
  assert.ok(report.unknown.includes('P-BLANK'));
  assert.ok(!report.acceptable.includes('P-BLANK'),
    '"nobody could classify it" and "it is fine" are the two readings this verdict keeps apart');
});

test('phase18.1: a claim on something already owned blocks, and blocking means decided, not refused', () => {
  const cases = [
    [{ id: 'C1', introducesContext: 'a-brand-new-context' }, 'bounded-context-conflict'],
    [{ id: 'C2', movesModule: { module: 'src/x.js', from: 'assurance', to: 'observability' } }, 'bounded-context-conflict'],
    [{ id: 'C3', context: 'assurance', claimsResponsibility: 'evidence-grading', existingResponsibilities: { 'evidence-grading': 'observability' } }, 'responsibility-conflict'],
    [{ id: 'C4', context: own.subsystems()[0], assignsOwner: 'Department of Nobody' }, 'ownership-conflict'],
    [{ id: 'C5', changesApprovalAuthority: 'Somebody Else' }, 'governance-conflict'],
    [{ id: 'C6', redefinesEndpoint: '/api/governance/readiness' }, 'api-responsibility-conflict'],
  ];
  for (const [proposal, expected] of cases) {
    const row = dp.specificationEvolution({ proposals: [proposal], now: 0 }).proposals[0];
    assert.ok(row.classes.includes(expected), `${proposal.id} → ${row.classes.join(', ')}`);
    assert.equal(row.verdict, 'BLOCKED', proposal.id);
    assert.match(row.reason, /not refused, decided/);
  }
});

test('phase18.1: a duplication candidate needs review and does not block', () => {
  const report = dp.specificationEvolution({ proposals: [{ id: 'C7', resemblesEngine: 'architectureIntelligence' }], now: 0 });
  assert.equal(report.proposals[0].verdict, 'HUMAN-REVIEW-REQUIRED');
  assert.equal(report.anyBlocked, false, 'only confirmed duplication may block');
  assert.match(report.proposals[0].findings[0].evidence, /not a confirmed duplicate/);
});

test('phase18.1: a merge candidate is only detectable against a registered requirement', () => {
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  reg.declare('REQ-1', {
    specification: 'Phase 18.1', section: 'Part 9', statement: 'classify specification evolution',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
  });
  assert.ok(dp.specificationEvolution({ proposals: [{ id: 'C8', coversRequirement: 'REQ-1' }], requirements: reg, now: 0 })
    .proposals[0].classes.includes('merge-candidate'));

  // A claim to cover something the register has never heard of proves nothing either way.
  const phantom = dp.specificationEvolution({ proposals: [{ id: 'C9', coversRequirement: 'REQ-NEVER' }], requirements: reg, now: 0 });
  assert.ok(!phantom.proposals[0].classes.includes('merge-candidate'));
  assert.ok(phantom.proposals[0].classes.includes('UNKNOWN'));
});

test('phase18.1: an evolution analysis over no proposals is not a clean one', () => {
  const empty = dp.specificationEvolution({ proposals: [], now: 0 });
  assert.equal(empty.measurable, false);
  assert.equal(empty.anyBlocked, false);
  assert.match(empty.basis, /not the same as nothing conflicting/);
  assert.equal(empty.authorizes, false);
});

// ---------------------------------------------------------------------------------------------
// Part 4 — duplicate framework intelligence. Similarity is evidence, not a verdict.
// ---------------------------------------------------------------------------------------------

test('phase18.1: exactly one overlap state blocks, and it is the confirmed one', () => {
  assert.equal(Object.keys(dp.OVERLAP_STATES).length, 4);
  const blocking = Object.entries(dp.OVERLAP_STATES).filter(([, s]) => s.blocking).map(([id]) => id);
  assert.deepEqual(blocking, ['CONFIRMED_DUPLICATION']);
  assert.equal(dp.OVERLAP_STATES.POSSIBLE_OVERLAP.blocking, false);
  assert.equal(dp.OVERLAP_STATES.GOVERNANCE_REVIEW_REQUIRED.blocking, false);
  assert.match(dp.OVERLAP_STATES.POSSIBLE_OVERLAP.means, /not a verdict/);
});

test('phase18.1: structural overlap alone never confirms, however much of it there is', () => {
  const report = dp.duplicationAnalysis({
    candidates: [
      { pair: ['a.js', 'b.js'], dimensions: [] },
      { pair: ['c.js', 'd.js'], dimensions: ['registry'] },
      { pair: ['e.js', 'f.js'], dimensions: ['registry', 'calculation', 'api', 'validationLogic'] },
    ],
    now: 0,
  });
  assert.equal(report.blocks, false);
  assert.equal(report.anyConfirmedDuplication, false);
  assert.equal(report.pairs.find((p) => p.pair[0] === 'a.js').state, 'NO_OVERLAP');
  assert.equal(report.pairs.find((p) => p.pair[0] === 'c.js').state, 'POSSIBLE_OVERLAP');

  const heavy = report.pairs.find((p) => p.pair[0] === 'e.js');
  assert.equal(heavy.state, 'GOVERNANCE_REVIEW_REQUIRED', 'four shared dimensions still is not a verdict');
  assert.match(heavy.whyNotConfirmed, /can share a shape and do different jobs/);
});

test('phase18.1: a recorded human judgement confirms, and only then does it block', () => {
  const report = dp.duplicationAnalysis({
    candidates: [{ pair: ['g.js', 'h.js'], dimensions: ['registry', 'calculation'] }],
    confirmations: [{ pair: ['g.js', 'h.js'], confirmedBy: 'Architecture Review Board', rationale: 'the same capability under two names' }],
    now: 0,
  });
  assert.equal(report.blocks, true, 'a state nothing can reach is not a state');
  assert.equal(report.pairs[0].confirmedBy, 'Architecture Review Board');
  assert.ok(report.pairs[0].confirmationRationale);
  assert.equal(report.pairs[0].whyNotConfirmed, null);
});

test('phase18.1: a confirmation with no attributor or no rationale confirms nothing', () => {
  for (const confirmation of [
    { pair: ['g.js', 'h.js'], rationale: 'they look alike' },
    { pair: ['g.js', 'h.js'], confirmedBy: 'Architecture Review Board' },
  ]) {
    const report = dp.duplicationAnalysis({
      candidates: [{ pair: ['g.js', 'h.js'], dimensions: ['registry', 'calculation'] }],
      confirmations: [confirmation], now: 0,
    });
    assert.equal(report.blocks, false, 'a verdict with no reason is indistinguishable from a guess');
  }
});

test('phase18.1: a duplication analysis over no pairs is not a clean bill of health', () => {
  const empty = dp.duplicationAnalysis({ candidates: [], now: 0 });
  assert.equal(empty.measurable, false);
  assert.equal(empty.blocks, false);
  assert.match(empty.basis, /not the same as nothing being duplicated/);
  assert.equal(empty.authorizes, false);
});

// ---------------------------------------------------------------------------------------------
// Part 10 — capability-centric roadmap.
//
// A second capability axis, in the module that already had one. ADR-0013 records why that is not a
// duplicate: CAPABILITY_MAP describes what the justice system can do for a citizen; this describes
// what the platform delivers to an engineer planning against it. Disjoint sets, different audiences,
// one shared change history.
// ---------------------------------------------------------------------------------------------

const cap = require('../src/capability/model');
const migration = require('../src/migration/roadmap');

const COMPLETE_CAPABILITY = {
  name: 'Architecture Governance', description: 'Governs how the architecture is allowed to change',
  owner: 'Architecture Review Board', contexts: ['assurance'],
  modules: ['src/architecture/adr-governance.js'], requirements: ['REQ-A'],
  controls: ['APP-FIT-CAPABILITY-ROADMAP'], adr: 'ADR-0012',
  documentation: 'docs/architecture-governance.md', declaredBy: 'Architecture Review Board',
};

function withRequirement() {
  const r = new adr.RequirementRegister({ clock: () => 0 });
  r.declare('REQ-A', {
    specification: 'Phase 18.1', section: 'Part 10', statement: 'capability-centric roadmap',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
  });
  return r;
}

test('phase18.1: the two capability axes are disjoint, and neither replaces the other', () => {
  const business = new Set(Object.keys(cap.CAPABILITY_MAP));
  assert.ok(business.size > 0, 'Part 10 adds an axis and removes nothing');
  assert.deepEqual(cap.PLATFORM_CAPABILITIES.filter((c) => business.has(c)), [],
    'a name in both vocabularies would be one axis recorded twice');
  assert.ok(cap.PLATFORM_CAPABILITIES.length >= 10);
});

test('phase18.1: a capability cannot become OPERATIONAL by any machine path', () => {
  assert.equal(cap.CAPABILITY_LIFECYCLE.OPERATIONAL.machineReachable, false);
  assert.ok(cap.CAPABILITY_LIFECYCLE.OPERATIONAL.requires.includes('humanAuthorization'));

  const requirements = withRequirement();
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('architecture-governance', COMPLETE_CAPABILITY);
  const verified = reg.lifecycle('architecture-governance', { controls: CONTROLS, requirements, now: 0 });
  assert.equal(verified.state, 'VERIFIED', 'every verification dimension holds');
  assert.notEqual(verified.state, 'OPERATIONAL');
  assert.match(verified.reason, /no test can establish it/);

  // …and it is reachable when a human is recorded as saying so, or the state is decoration.
  const authorised = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  authorised.declare('architecture-governance', { ...COMPLETE_CAPABILITY, humanAuthorization: { by: 'Oversight Board', at: 0 } });
  assert.equal(authorised.lifecycle('architecture-governance', { controls: CONTROLS, requirements, now: 0 }).state, 'OPERATIONAL');
});

test('phase18.1: a module existing is implementation, not verification', () => {
  const requirements = withRequirement();
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('module-only', { ...COMPLETE_CAPABILITY, controls: [], requirements: [] });
  const lifecycle = reg.lifecycle('module-only', { controls: CONTROLS, requirements, now: 0 });
  assert.equal(lifecycle.state, 'IMPLEMENTING');
  assert.notEqual(lifecycle.state, 'VERIFIED');

  const maturity = reg.maturity('module-only', { controls: CONTROLS, requirements, now: 0 });
  assert.ok(maturity.blocked.includes('verificationCoverage'), 'nothing would fail if it stopped working');
  assert.ok(maturity.blocked.includes('specificationCoverage'), 'it exists because somebody built it');
  assert.equal(maturity.scored, false, 'nine dimensions with different evidence are never summed');
});

test('phase18.1: operational readiness stays UNKNOWN, whatever else is true', () => {
  const requirements = withRequirement();
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('architecture-governance', COMPLETE_CAPABILITY);
  const readiness = reg.maturity('architecture-governance', { controls: CONTROLS, requirements, now: 0 })
    .dimensions.find((d) => d.dimension === 'operationalReadiness');
  assert.equal(readiness.state, 'UNKNOWN');
  assert.match(readiness.detail, /passing test is not evidence/);
});

test('phase18.1: capability declarations are refused when they say nothing actionable', () => {
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  assert.throws(() => reg.declare('C', { name: 'X', declaredBy: 'ARB' }), (e) => e.failClosed === true);
  assert.throws(() => reg.declare('C', { name: 'X', description: 'd' }), (e) => e.failClosed === true);
  // This platform records a human statement and never makes one.
  assert.throws(
    () => reg.declare('C', { name: 'X', description: 'd', declaredBy: 'ARB', humanAuthorization: {} }),
    (e) => e.failClosed === true,
  );
});

test('phase18.1: dependencies are declared with a reason, an owner and a justification', () => {
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  for (const id of ['A', 'B']) reg.declare(id, { name: id, description: 'd', owner: 'Architecture Review Board', contexts: ['assurance'], declaredBy: 'ARB' });
  assert.throws(() => reg.dependOn('A', 'A', { rationale: 'r', owner: 'o', justification: 'j' }), (e) => e.failClosed === true);
  for (const field of ['rationale', 'owner', 'justification']) {
    const spec = { rationale: 'r', owner: 'o', justification: 'j', [field]: undefined };
    assert.throws(() => reg.dependOn('A', 'B', spec), (e) => e.failClosed === true, field);
  }
  assert.ok(reg.dependOn('A', 'B', { rationale: 'A reads B', owner: 'ARB', justification: 'ADR-0012' }));
});

test('phase18.1: a dependency cycle is a violation and blocks the capabilities in it', () => {
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  for (const id of ['A', 'B', 'C']) reg.declare(id, { name: id, description: 'd', owner: 'Architecture Review Board', contexts: ['assurance'], declaredBy: 'ARB' });
  reg.dependOn('A', 'B', { rationale: 'r', owner: 'ARB', justification: 'j' });
  reg.dependOn('B', 'C', { rationale: 'r', owner: 'ARB', justification: 'j' });
  reg.dependOn('C', 'A', { rationale: 'r', owner: 'ARB', justification: 'j' });
  reg.dependOn('A', 'GHOST', { rationale: 'r', owner: 'ARB', justification: 'j' });

  const analysis = reg.dependencyAnalysis();
  assert.equal(analysis.hasCycles, true);
  assert.ok(analysis.missingTargets.some((t) => t.target === 'GHOST'));
  assert.ok(analysis.violations.length >= 2);
  assert.equal(reg.lifecycle('A', { controls: CONTROLS, now: 0 }).state, 'BLOCKED');
  // Concentration is reported, not judged — a foundational capability with many dependents is normal.
  assert.match(analysis.concentrationNote, /Reported rather than judged/);
});

test('phase18.1: both roadmap views survive, and the phase history is untouched', () => {
  const requirements = withRequirement();
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('architecture-governance', COMPLETE_CAPABILITY);
  const roadmap = reg.roadmap({ controls: CONTROLS, requirements, now: 0 });

  assert.equal(roadmap.viewsSynchronized, true);
  assert.equal(roadmap.phaseView.items, migration.ids().length, 'Part 10 adds an axis and deletes no history');
  assert.equal(roadmap.phaseView.waves, Object.keys(migration.waves()).length);
  assert.equal(roadmap.capabilityView.count, reg.capabilities().length);
  assert.equal(roadmap.declarative, true);
  assert.equal(roadmap.authorizes, false);
});

test('phase18.1: requirement and capability are traceable in both directions', () => {
  const requirements = withRequirement();
  requirements.declare('REQ-ORPHAN', {
    specification: 'Phase 18.1', section: 'Part 10', statement: 'a requirement no capability claims',
    artefactType: 'executable', declaredBy: 'Architecture Review Board',
  });
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('architecture-governance', COMPLETE_CAPABILITY);
  assert.ok(reg.roadmap({ controls: CONTROLS, requirements, now: 0 }).requirementsWithoutCapability.includes('REQ-ORPHAN'));

  const bare = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  bare.declare('bare', { name: 'Bare', description: 'd', declaredBy: 'ARB' });
  const bareRoadmap = bare.roadmap({ controls: CONTROLS, now: 0 });
  for (const finding of ['capabilitiesWithoutOwner', 'capabilitiesWithoutRequirement', 'capabilitiesWithoutImplementation']) {
    assert.ok(bareRoadmap[finding].includes('bare'), finding);
  }

  // One requirement claimed by two capabilities cannot have one implementation responsibility.
  const contested = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  for (const id of ['X', 'Y']) {
    contested.declare(id, { name: id, description: 'd', owner: 'Architecture Review Board', contexts: ['assurance'], requirements: ['REQ-A'], declaredBy: 'ARB' });
  }
  assert.equal(contested.roadmap({ controls: CONTROLS, requirements, now: 0 }).conflictingCapabilityClaims.length, 1);
});

test('phase18.1: an empty capability register distinguishes no capabilities from undeclared ones', () => {
  const empty = new cap.PlatformCapabilityRegistry({ clock: () => 0 }).roadmap({ controls: CONTROLS, now: 0 });
  assert.equal(empty.measurable, false);
  assert.match(empty.basis, /has not declared them/);
});

test('phase18.1: the merge ADR tier is conditional on recording a merge, not on a number', () => {
  // The first version applied it by number and immediately demanded four merge sections of
  // ADR-0013, which records no merge. The platform's own ADR control caught that.
  const catalogue = adr.validateCatalogue();
  const twelve = catalogue.adrs.find((a) => a.number === 12);
  const thirteen = catalogue.adrs.find((a) => a.number === 13);
  assert.equal(twelve.schema, 'merge');
  assert.equal(twelve.recordsMerge, 'MERGE-0001');
  assert.equal(thirteen.schema, 'governance', 'ADR-0013 records no merge and is not held to the merge schema');
  assert.equal(thirteen.recordsMerge, null);
  assert.ok(catalogue.adrs.every((a) => a.valid), catalogue.adrs.filter((a) => !a.valid).map((a) => a.file).join(', '));
});

// --- Part 5: executive decision quality -----------------------------------------------------------
//
// The question this part answers is narrow and worth stating plainly: given a decision package, can
// a machine tell whether the alternatives on it are a real choice? Partly. It can see that two
// entries are the same string, that one shares most of its words with the recommendation it is meant
// to compete with, that another gives no reason anybody could weigh. It cannot see whether two
// differently worded options are materially different, and the tests below fix that boundary in
// place so a later change cannot quietly move it.

const BODIES = [...inst.accountableBodies()];

const REAL_CHOICE = [
  'Enable the archive now and record the legal basis afterwards, rejected because it would create records the institution cannot lawfully hold.',
  'Leave the archive disabled indefinitely, however that leaves case history unrecoverable for the courts that need it.',
];

const COMPLETE_PACKAGE = {
  subject: 'test-subject',
  recommendation: 'Record the legal basis for evidence retention before enabling the archive.',
  supportingEvidence: ['src/legislation/legal-authority.js: retention is UNDECLARED'],
  evidenceStrength: 'absence',
  assumptions: ['That a legal basis exists and is simply unrecorded.'],
  confidence: 'high — this is an absence of records, which is directly observable rather than estimated',
  alternativesConsidered: REAL_CHOICE,
  historicalOutcomes: ['The retention register was enabled in the twin and the archive tier held every record written to it.'],
  validationHistory: ['Reviewed at the February validation workshop against the recorded instrument.'],
  legalDependencies: ['Evidence Act: retention of case material'],
  governanceOwner: BODIES[0],
  affectedControls: ['APP-FIT-LEGAL-AUTHORITY'],
  predictedConsequences: ['the legal authority register stops reporting an undeclared capability'],
};

test('phase18.1 part 5: a complete decision package with two distinct reasoned options is supported', () => {
  const q = inst.alternativeQuality(COMPLETE_PACKAGE);
  assert.equal(q.verdict, 'SUPPORTED');
  assert.equal(q.blocking, false);
  assert.deepEqual(q.supported, [0, 1]);
  assert.equal(q.authorizes, false);
});

test('phase18.1 part 5: a package offering no alternative is structurally empty and blocks', () => {
  const q = inst.alternativeQuality({ recommendation: 'Do the thing.' });
  assert.equal(q.verdict, 'STRUCTURALLY_EMPTY');
  assert.equal(q.blocking, true);
  assert.match(q.reason, /no alternative was stated/);
});

test('phase18.1 part 5: one option written twice is one option, and that is observable enough to block', () => {
  const q = inst.alternativeQuality({
    recommendation: 'Enable it.',
    alternativesConsidered: ['Do nothing, rejected because it leaves the gap open.', 'Do nothing; rejected because it leaves the gap open!'],
  });
  assert.equal(q.verdict, 'STRUCTURALLY_EMPTY');
  assert.equal(q.blocking, true);
  assert.deepEqual(q.structurallyEmpty, [0, 1]);
});

test('phase18.1 part 5: an alternative that restates the recommendation is raised, not ruled on', () => {
  const q = inst.alternativeQuality({
    recommendation: 'Record the legal basis for evidence retention before enabling the archive.',
    alternativesConsidered: ['Record the legal basis for the evidence retention archive before enabling it.'],
  });
  assert.equal(q.alternatives[0].state, 'POSSIBLE_DUPLICATION');
  assert.ok(q.alternatives[0].similarityToRecommendation >= 0.6);
  // Evidence, not a verdict. It stops the package being called supported and it does not block.
  assert.equal(q.verdict, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(q.blocking, false);
  assert.equal(q.humanJudgementNeeded, true);
});

test('phase18.1 part 5: an option with no stated reason is unarguable rather than wrong', () => {
  const q = inst.alternativeQuality({
    recommendation: 'Something quite different from the option below.',
    alternativesConsidered: ['Buy a larger server for the archive tier'],
  });
  assert.equal(q.alternatives[0].state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(q.alternatives[0].givesReason, false);
  assert.equal(q.blocking, false);
  assert.match(q.alternatives[0].detail, /nothing to weigh/);
});

test('phase18.1 part 5: a label shorter than the minimum is not an option somebody weighed', () => {
  const q = inst.alternativeQuality({
    recommendation: 'Something quite different from the option below.',
    alternativesConsidered: ['Rejected because cost'],
  });
  assert.equal(q.alternatives[0].state, 'INSUFFICIENT_EVIDENCE');
  assert.ok(q.alternatives[0].length < inst.ALTERNATIVE_MIN_CHARS);
});

test('phase18.1 part 5: only structural emptiness blocks, and the boundary is stated in the output', () => {
  const blocking = Object.entries(inst.ALTERNATIVE_QUALITY).filter(([, s]) => s.blocking).map(([id]) => id);
  assert.deepEqual(blocking, ['STRUCTURALLY_EMPTY']);
  const q = inst.alternativeQuality(COMPLETE_PACKAGE);
  assert.match(q.machineDetectable, /identical text after normalisation/);
  assert.match(q.humanJudgementRequired, /No structural check can settle that/);
});

test('phase18.1 part 5: every package the platform actually assembles offers a real choice', () => {
  const loaded = inst.decisionSupport({
    legalAuthority: { blocking: [{ capability: 'anonymous-reporting', state: 'unknown', reason: 'nothing is recorded', constitutional: true }] },
    assumptionMaturity: { verificationBacklog: [{ assumption: 'ASM-0001', criticality: 'foundational' }], belowMinimum: [], organizationalMaturity: 'A2' },
    controlEffectiveness: { measurable: false, unknown: ['APP-FIT-KNOWLEDGE-CONTINUITY'] },
  });
  assert.ok(loaded.packages.length > 0);
  for (const p of loaded.packages) {
    assert.equal(inst.alternativeQuality(p).blocking, false, `package '${p.subject}' does not offer a choice`);
  }
});

// --- Part 8: decision explainability --------------------------------------------------------------
//
// Not a second explainability engine — the same hop discipline `explain()` established, pointed at a
// recommendation instead of a dashboard figure. One thing had to be added: a third hop outcome. The
// first version of this chain counted records, so a package whose precedent field honestly read "no
// comparable recommendation has been recorded" resolved the precedent hop and the whole chain
// reported "explainable end to end across all 9 hops". A stated absence had been read as a presence.

test('phase18.1 part 8: a fully evidenced recommendation is explainable end to end', () => {
  const r = inst.explainDecision(COMPLETE_PACKAGE, { now: 0 });
  assert.equal(r.complete, true);
  assert.equal(r.brokenAt, null);
  assert.equal(r.hops.length, 9);
  assert.equal(r.authorizes, false);
});

test('phase18.1 part 8: each hop is load-bearing and names the exact place traceability stops', () => {
  const cases = [
    ['recommendation', 1, { recommendation: null }],
    ['evidence', 2, { supportingEvidence: [] }],
    ['assumptions', 3, { assumptions: [] }],
    ['confidence', 4, { confidence: '' }],
    ['alternatives', 5, { alternativesConsidered: [] }],
    ['historicalPrecedent', 6, { historicalOutcomes: [] }],
    ['legalAuthority', 7, { legalDependencies: [] }],
    ['governanceOwner', 8, { governanceOwner: null }],
    ['implementation', 9, { affectedControls: [] }],
  ];
  for (const [hop, position, mutation] of cases) {
    const r = inst.explainDecision({ ...COMPLETE_PACKAGE, ...mutation }, { now: 0 });
    assert.equal(r.complete, false, `the '${hop}' hop is decoration`);
    assert.equal(r.brokenAt, hop);
    assert.equal(r.brokenAtPosition, position);
    assert.ok(r.consequence, `a chain broken at '${hop}' does not say what that costs`);
  }
});

test('phase18.1 part 8: an incomplete chain is never rendered as a percentage', () => {
  const r = inst.explainDecision({ ...COMPLETE_PACKAGE, governanceOwner: null }, { now: 0 });
  assert.equal(r.navigableDepth, 7, "seven hops walk cleanly before the eighth stops the chain");
  assert.doesNotMatch(r.explanation, /%|percent/);
  assert.match(r.explanation, /BROKEN AT GOVERNANCEOWNER/);
  // Eight of nine is not eight-ninths of an explanation. It is a recommendation nobody owns.
  assert.match(r.consequence, /owned by nobody/);
});

test('phase18.1 part 8: an honest statement that nothing comparable has happened is UNKNOWN, not precedent', () => {
  const r = inst.explainDecision({
    ...COMPLETE_PACKAGE,
    historicalOutcomes: ['No comparable recommendation has been recorded, so nothing is known about how this has gone before.'],
    validationHistory: ['The premise has never been tested against a real instrument.'],
  }, { now: 0 });
  assert.equal(r.complete, false);
  assert.equal(r.brokenAt, 'historicalPrecedent');
  assert.equal(r.brokenState, 'UNKNOWN');
  assert.deepEqual(r.unknownHops, ['historicalPrecedent']);
  assert.match(r.hops[5].detail, /an absence of history is not a history of success/);
});

test('phase18.1 part 8: unknown, broken and resolved are three states and only one continues a chain', () => {
  assert.equal(Object.keys(inst.HOP_STATES).length, 3);
  assert.equal(inst.HOP_STATES.RESOLVED.continuesChain, true);
  assert.equal(inst.HOP_STATES.BROKEN.continuesChain, false);
  assert.equal(inst.HOP_STATES.UNKNOWN.continuesChain, false);
});

test('phase18.1 part 8: evidence of an unrecognised grade is worth an unknown amount, not a lot', () => {
  const r = inst.explainDecision({ ...COMPLETE_PACKAGE, evidenceStrength: 'strong' }, { now: 0 });
  assert.equal(r.brokenAt, 'evidence');
  assert.equal(r.brokenState, 'UNKNOWN');
  assert.match(r.hops[1].detail, /not a recognised grade/);
});

test('phase18.1 part 8: a confident conclusion drawn from an absence is inconsistent, not firm', () => {
  const r = inst.explainDecision({ ...COMPLETE_PACKAGE, confidence: 'high confidence in the projected outcome' }, { now: 0 });
  assert.equal(r.brokenAt, 'confidence');
  assert.equal(r.brokenState, 'BROKEN');
  assert.match(r.hops[3].detail, /says nothing about why the thing is missing/);
});

test('phase18.1 part 8: an actor who holds nothing in the accountability record is not an owner', () => {
  const r = inst.explainDecision({ ...COMPLETE_PACKAGE, governanceOwner: 'Committee For Doing The Thing' }, { now: 0 });
  assert.equal(r.brokenAt, 'governanceOwner');
  assert.equal(r.brokenState, 'BROKEN', 'a contradicted owner is checked and wrong, which is not the same as unestablished');
  assert.match(r.hops[7].detail, /holds nothing in the accountability record/);
});

test('phase18.1 part 8: cosmetic alternatives stop the chain without blocking the package', () => {
  const r = inst.explainDecision({
    ...COMPLETE_PACKAGE,
    alternativesConsidered: ['Record the legal basis for evidence retention before enabling the archive.'],
  }, { now: 0 });
  assert.equal(r.brokenAt, 'alternatives');
  assert.equal(r.brokenState, 'UNKNOWN');
  assert.equal(r.alternativeQuality.blocking, false);
});

test('phase18.1 part 8: an incomplete implementation trace leaves nobody able to check afterwards', () => {
  const r = inst.explainDecision({ ...COMPLETE_PACKAGE, predictedConsequences: [] }, { now: 0 });
  assert.equal(r.brokenAt, 'implementation');
  assert.match(r.hops[8].detail, /nobody can come back and check/);
});

test('phase18.1 part 8: the chain is deterministic and reuses the nine-hop discipline rather than a second engine', () => {
  const a = inst.explainDecision(COMPLETE_PACKAGE, { now: 0 });
  const b = inst.explainDecision(COMPLETE_PACKAGE, { now: 0 });
  assert.deepEqual(a, b);
  assert.equal(inst.DECISION_EXPLANATION_ORDER.length, inst.EXPLANATION_ORDER.length);
  for (const h of Object.values(inst.DECISION_EXPLANATION_HOPS)) {
    assert.ok(h.answers.endsWith('?'));
    assert.ok(h.ifBroken, 'a hop that does not say what its absence costs is decoration');
  }
});

test('phase18.1 part 8: the platform reports its own decision packages honestly, including where they stop', () => {
  const loaded = inst.decisionSupport({
    legalAuthority: { blocking: [{ capability: 'anonymous-reporting', state: 'unknown', reason: 'nothing is recorded', constitutional: true }] },
  });
  for (const p of loaded.packages) {
    const chain = inst.explainDecision(p, { now: 0 });
    assert.equal(chain.authorizes, false);
    if (!chain.complete) assert.ok(chain.brokenAt, `package '${p.subject}' is incomplete and does not name where`);
  }
  // The honest finding, recorded rather than smoothed: the platform's own legal-authority package
  // stops at the precedent hop, because nothing comparable has ever been recorded.
  const legal = loaded.packages.find((p) => p.subject === 'legal-authority');
  const chain = inst.explainDecision(legal, { now: 0 });
  assert.equal(chain.complete, false);
  assert.equal(chain.brokenAt, 'historicalPrecedent');
  assert.equal(chain.brokenState, 'UNKNOWN');
});
