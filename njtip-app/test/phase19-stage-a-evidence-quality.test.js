'use strict';

// Capability-model evolution, Stage A (evidence quality) with Stage B (reverse index) and Stage C
// (cross-axis mapping).
//
// Stage A exists because the `evidenceQuality` maturity dimension was a stub that read
// "grading them against evidence quality is not yet wired to this registry" and counted controls.
// Counting is the specific failure the dimension prevents: five weak controls are not better
// evidence than one authoritative one, and ten stale references are not twice as good as five.
//
// Held throughout: BUSINESS CAPABILITY != PLATFORM CAPABILITY, VERIFIED != OPERATIONAL, and
// EVIDENCE != HUMAN JUDGEMENT.

const test = require('node:test');
const assert = require('node:assert/strict');

const cap = require('../src/capability/model');
const ep = require('../src/assurance/epistemic');

const CONTROLS = [
  ...require('../verification/app-fitness').map((f) => ({ id: f.id })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id })),
];
const REQS = { requirements: () => [{ id: 'REQ-A' }] };
const FULL = {
  id: 'probe', name: 'Probe', owner: 'Office of the Chief Architect',
  declaredBy: 'Architecture Review Board', at: 0, contexts: ['assurance'],
  modules: ['src/assurance/epistemic.js'], controls: ['APP-FIT-EPISTEMIC-INTEGRITY'],
  requirements: ['REQ-A'],
};
const grade = (c, opts = {}) => cap.capabilityEvidenceQuality(c, { controls: CONTROLS, requirements: REQS, now: 0, ...opts });

// --- §7 Stage A: the five grades ----------------------------------------------------------------

test('stage A: evidence absent grades as no evidence, not as failure', () => {
  const q = cap.capabilityEvidenceQuality({}, { now: 0 });
  assert.equal(q.overall, 'NO_EVIDENCE');
  assert.equal(q.epistemic, 'UNKNOWN');
  assert.equal(cap.EVIDENCE_GRADES.NO_EVIDENCE.establishes, false);
});

test('stage A: authoritative evidence is reachable', () => {
  const q = grade(FULL);
  assert.equal(q.overall, 'AUTHORITATIVE', 'a grade nothing can reach is not a grade');
  assert.equal(q.epistemic, 'RESOLVED');
  assert.equal(q.dimensions.length, 10);
});

test('stage A: evidence contradicting the record is BROKEN, not partial', () => {
  const ghost = grade({ ...FULL, owner: 'Committee That Does Not Exist' });
  assert.equal(ghost.overall, 'CONFLICTING');
  assert.equal(ghost.epistemic, 'BROKEN');
  const gone = grade({ ...FULL, modules: ['src/deleted-in-a-refactor.js'] });
  assert.equal(gone.overall, 'CONFLICTING');
});

test('stage A: stale evidence is weak, and weak is not absent', () => {
  const stale = grade(FULL, { now: 400 * 24 * 3600_000 });
  assert.equal(stale.overall, 'WEAK');
  // Somebody looked and found something old. That is a different fact from nobody looking.
  assert.notEqual(cap.EVIDENCE_GRADES.WEAK.humanJudgementNeeded, cap.EVIDENCE_GRADES.NO_EVIDENCE.humanJudgementNeeded);
});

test('stage A: evidence covering part of the claim is incomplete', () => {
  const partial = grade({ ...FULL, requirements: [] });
  const completeness = partial.dimensions.find((d) => d.dimension === 'completeness');
  assert.equal(completeness.grade, 'INCOMPLETE');
});

test('stage A: unverifiable evidence is unknown rather than failing', () => {
  // No control results supplied at all: whether the evidence reproduces is unestablished.
  const q = cap.capabilityEvidenceQuality(FULL, { requirements: REQS, now: 0 });
  assert.equal(q.dimensions.find((d) => d.dimension === 'reproducibility').grade, 'NO_EVIDENCE');
  // An empty list is a claim that nothing ran, which contradicts the declaration.
  const empty = cap.capabilityEvidenceQuality(FULL, { controls: [], requirements: REQS, now: 0 });
  assert.equal(empty.dimensions.find((d) => d.dimension === 'reproducibility').grade, 'CONFLICTING');
});

test('stage A: ten dimensions are never summed and one bad one is not outvoted', () => {
  const q = grade({ ...FULL, owner: 'Nobody At All' });
  assert.ok(q.authoritative.length >= 5, 'the fixture must leave most dimensions strong for this to prove anything');
  assert.equal(q.overall, 'CONFLICTING');
  assert.ok(!('score' in q) && !('evidenceScore' in q));
  assert.doesNotMatch(q.basis, /%|percent/);
});

test('stage A: evidence never promotes a capability', () => {
  const q = grade(FULL);
  assert.equal(q.promotes, false);
  assert.equal(q.authorizes, false);
  for (const g of Object.values(cap.EVIDENCE_GRADES)) assert.ok(ep.EPISTEMIC_STATES[g.epistemic]);
});

test('stage A: the maturity dimension follows the grade rather than the control count', () => {
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('wired', { name: 'W', description: 'd', declaredBy: 'ARB', owner: 'Office of the Chief Architect', contexts: ['assurance'], modules: ['src/assurance/epistemic.js'], controls: ['APP-FIT-EPISTEMIC-INTEGRITY'], requirements: ['REQ-A'] });
  const eq = reg.maturity('wired', { controls: CONTROLS, requirements: REQS, now: 0 }).dimensions.find((d) => d.dimension === 'evidenceQuality');
  assert.doesNotMatch(String(eq.detail), /not yet wired/);
  assert.equal(eq.state, 'VERIFIED');

  const bad = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  bad.declare('ghost', { name: 'G', description: 'd', declaredBy: 'ARB', owner: 'Nobody At All', contexts: ['assurance'], modules: ['src/assurance/epistemic.js'], controls: ['APP-FIT-EPISTEMIC-INTEGRITY'], requirements: ['REQ-A'] });
  const badEq = bad.maturity('ghost', { controls: CONTROLS, requirements: REQS, now: 0 }).dimensions.find((d) => d.dimension === 'evidenceQuality');
  assert.equal(badEq.state, 'BLOCKED', 'the state must follow the grade, or evidence is being counted with extra steps');
});

// --- §8: the lifecycle boundary -----------------------------------------------------------------

test('stage A: VERIFIED is not OPERATIONAL and no evidence changes that', () => {
  assert.equal(cap.CAPABILITY_LIFECYCLE.OPERATIONAL.machineReachable, false);
  assert.ok(cap.CAPABILITY_LIFECYCLE.OPERATIONAL.requires.includes('humanAuthorization'));
  const reg = new cap.PlatformCapabilityRegistry({ clock: () => 0 });
  reg.declare('complete', { name: 'C', description: 'd', declaredBy: 'ARB', owner: 'Office of the Chief Architect', contexts: ['assurance'], modules: ['src/assurance/epistemic.js'], controls: ['APP-FIT-EPISTEMIC-INTEGRITY'], requirements: ['REQ-A'], adr: 'ADR-0014', documentation: 'docs/architecture-governance.md' });
  const life = reg.lifecycle('complete', { controls: CONTROLS, requirements: REQS, now: 0 });
  assert.notEqual(life.state, 'OPERATIONAL');
  assert.equal(life.operationalRequiresHuman, true);
});

// --- §9 Stage B: the reverse index --------------------------------------------------------------

const index = (caps, watched = []) => cap.capabilityModuleIndex({ capabilities: caps, watchedPaths: watched, now: 0 });

test('stage B: a capability claiming a module that is gone is broken', () => {
  const r = index([{ id: 'a', modules: ['src/renamed-away.js'] }]);
  assert.equal(r.byKind.MISSING_MODULE, 1);
  assert.equal(cap.REVERSE_INDEX_FINDINGS.MISSING_MODULE.epistemic, 'BROKEN');
});

test('stage B: a module nobody claims is unknown and needs a human', () => {
  const r = index([{ id: 'a', modules: ['src/assurance/epistemic.js'] }], ['src/assurance']);
  assert.ok(r.byKind.ORPHAN_MODULE > 0);
  assert.equal(cap.REVERSE_INDEX_FINDINGS.ORPHAN_MODULE.epistemic, 'UNKNOWN');
  assert.equal(cap.REVERSE_INDEX_FINDINGS.ORPHAN_MODULE.requiresHuman, true);
});

test('stage B: the reverse direction resolves module to capabilities', () => {
  const r = index([{ id: 'a', modules: ['src/assurance/epistemic.js'] }, { id: 'b', modules: ['src/assurance/epistemic.js'] }]);
  const row = r.reverse.find((x) => x.module === 'src/assurance/epistemic.js');
  assert.deepEqual(row.capabilities, ['a', 'b']);
  assert.equal(r.byKind.SHARED_MODULE, 1);
  assert.equal(cap.REVERSE_INDEX_FINDINGS.SHARED_MODULE.requiresHuman, true);
});

test('stage B: a capability with no module, and a module declared twice, are both found', () => {
  assert.equal(index([{ id: 'a', modules: [] }]).byKind.UNIMPLEMENTED_CAPABILITY, 1);
  assert.equal(index([{ id: 'a', modules: ['src/assurance/epistemic.js', 'src/assurance/epistemic.js'] }]).byKind.DUPLICATE_MAPPING, 1);
  // …and implementationRequired:false makes the first legitimate rather than a finding.
  assert.equal(index([{ id: 'a', modules: [], implementationRequired: false }]).byKind.UNIMPLEMENTED_CAPABILITY, 0);
});

test('stage B: a complete index reports clean and establishes no verification', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const dir = 'src/assurance';
  const every = fs.readdirSync(path.join(__dirname, '..', dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
  const clean = index([{ id: 'all', modules: every }], [dir]);
  assert.equal(clean.count, 0);
  assert.equal(clean.state, 'RESOLVED');
  assert.equal(clean.establishesVerification, false, 'a module existing says nothing about whether a capability works');
  assert.equal(clean.promotes, false);
});

// --- §10 Stage C: cross-axis mapping ------------------------------------------------------------

const B = Object.keys(cap.CAPABILITY_MAP);
const P = cap.PLATFORM_CAPABILITIES;
const mapping = (mappings, extra = {}) => cap.crossAxisMapping({ mappings, now: 0, ...extra });

test('stage C: ADR-0013 holds — the axes stay disjoint and are never merged', () => {
  const m = mapping([]);
  assert.equal(m.axesDisjoint, true);
  assert.equal(m.mergesAxes, false);
  assert.equal(m.businessAxis.length, B.length);
  assert.equal(m.platformAxis.length, P.length);
});

test('stage C: one business capability may map to many platform capabilities', () => {
  const m = mapping([
    { business: B[0], platform: P[0], relation: 'supports', declaredBy: 'ARB' },
    { business: B[0], platform: P[1], relation: 'enables', declaredBy: 'ARB' },
  ]);
  assert.ok(m.oneToMany.includes(B[0]));
  assert.equal(m.rows.find((r) => r.business === B[0]).count, 2);
});

test('stage C: many business capabilities may map to one platform capability', () => {
  const m = mapping([
    { business: B[0], platform: P[0], relation: 'supports', declaredBy: 'ARB' },
    { business: B[1], platform: P[0], relation: 'supports', declaredBy: 'ARB' },
  ]);
  assert.ok(m.manyToOne.includes(P[0]));
  assert.deepEqual(m.byPlatform.find((x) => x.platform === P[0]).businessCapabilities, [B[0], B[1]]);
});

test('stage C: an unmapped capability is unknown, and a deliberate one is resolved', () => {
  const bare = mapping([]);
  const anyUnmapped = bare.rows.find((r) => r.state === 'UNMAPPED' || r.state === 'AMBIGUOUS');
  assert.ok(anyUnmapped, 'no capability is unmapped, so the state is untested');
  assert.equal(cap.MAPPING_STATES.UNMAPPED.epistemic, 'UNKNOWN');
  assert.equal(cap.MAPPING_STATES.INTENTIONALLY_UNMAPPED.epistemic, 'RESOLVED');
  // Lack of a mapping is only a failure where something requires one.
  const required = mapping([], { requiredMappings: [B[0]] });
  assert.equal(required.rows.find((r) => r.business === B[0]).state, 'MAPPING_REQUIRED');
  assert.equal(cap.MAPPING_STATES.MAPPING_REQUIRED.epistemic, 'BROKEN');
});

test('stage C: similarity raises ambiguity for a human and never becomes a mapping', () => {
  const bare = mapping([]);
  const ambiguous = bare.rows.filter((r) => r.state === 'AMBIGUOUS');
  assert.ok(ambiguous.length > 0);
  for (const row of ambiguous) {
    assert.ok(row.ambiguityReason);
    assert.match(row.ambiguityReason, /similarity is evidence that somebody should look, never a mapping/);
    assert.equal(row.mappings.length, 0);
  }
  assert.equal(cap.MAPPING_STATES.AMBIGUOUS.requiresHuman, true);
});

test('stage C: a mapping that is an inference is refused', () => {
  const m = mapping([
    { business: B[0], platform: P[0], relation: 'supports' },
    { business: B[0], platform: P[0], relation: 'sort-of-like', declaredBy: 'ARB' },
    { business: 'Not Real', platform: P[0], relation: 'supports', declaredBy: 'ARB' },
    { business: B[0], platform: 'Not Real Either', relation: 'supports', declaredBy: 'ARB' },
  ]);
  assert.equal(m.invalid.length, 4);
  assert.ok(m.invalid.some((x) => /must name who declared it/.test(x.reason)));
});

test('stage A/B/C are deterministic', () => {
  assert.deepEqual(grade(FULL), grade(FULL));
  assert.deepEqual(index([{ id: 'a', modules: ['src/assurance/epistemic.js'] }]), index([{ id: 'a', modules: ['src/assurance/epistemic.js'] }]));
  assert.deepEqual(mapping([]), mapping([]));
});
