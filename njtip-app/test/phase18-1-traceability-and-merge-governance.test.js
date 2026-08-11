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
