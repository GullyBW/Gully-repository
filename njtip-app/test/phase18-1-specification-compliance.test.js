'use strict';

// Phase 18.1 Part 7 — specification compliance — and the two assurance principles Batch 5 found,
// generalised out of the one function that found them.
//
// The principle, stated once because everything below is a consequence of it:
//
//     absence of evidence is not evidence of compliance, and unknown is not pass.
//
// The reason Part 7 needs saying at all is that `matrix()` already answers "is this requirement
// verified" and answers it well. What it cannot answer is "is Phase 18.1 implemented", because a
// specification nobody wrote requirements for has a perfectly clean matrix. A register you never
// wrote to contains no failures. That is the shape of every false green this codebase has met.

const test = require('node:test');
const assert = require('node:assert/strict');

const adr = require('../src/architecture/adr-governance');
const ep = require('../src/assurance/epistemic');
const inst = require('../src/assurance/institutional');

const CONTROLS = [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id })),
];

const EXECUTABLE = {
  specification: 'SPEC-A', section: 'Part 1', statement: 'an executable requirement',
  artefactType: 'executable', declaredBy: 'Architecture Review Board',
  implementation: 'src/architecture/adr-governance.js', context: 'assurance',
  owner: 'Office of the Chief Architect',
  tests: ['phase18-1-traceability-and-merge-governance.test.js'],
  fitness: ['APP-FIT-REQUIREMENTS-TRACEABILITY'],
};
const register = (declarations) => {
  const r = new adr.RequirementRegister({ clock: () => 0 });
  for (const [id, spec] of declarations) r.declare(id, spec);
  return r;
};

// --- §4: the three epistemic states -----------------------------------------------------------

test('phase18.1 §4: absence of evidence is not evidence of compliance', () => {
  // The whole of Part 7 in one assertion. Nothing was declared about SPEC-GHOST; the dashboard is
  // told to expect it and reports that it knows nothing, rather than reporting nothing wrong.
  const d = register([['REQ-A', EXECUTABLE]])
    .specificationCompliance({ controls: CONTROLS, specifications: ['SPEC-A', 'SPEC-GHOST'], now: 0 });
  const ghost = d.bySpecification.find((s) => s.specification === 'SPEC-GHOST');
  assert.equal(ghost.state, 'UNKNOWN');
  assert.equal(ghost.compliant, false);
  assert.equal(ghost.measurable, false);
  assert.match(ghost.reason, /An empty register is not a clean one/);
  assert.notEqual(d.overall, 'COMPLIANT');
});

test('phase18.1 §4: unknown is not pass', () => {
  assert.equal(ep.EPISTEMIC_STATES.UNKNOWN.satisfied, false);
  assert.equal(ep.EPISTEMIC_STATES.UNKNOWN.examined, false);
  assert.equal(ep.EPISTEMIC_STATES.UNKNOWN.continuesChain, false);
  assert.equal(adr.COMPLIANCE_STATES.UNKNOWN.compliant, false);
  assert.equal(adr.COMPLIANCE_STATES.HUMAN_REVIEW_REQUIRED.compliant, false);
});

test('phase18.1 §4: broken and unknown are not collapsed, because they lead to different actions', () => {
  // One means somebody must fix something. The other means somebody must go and look.
  assert.notEqual(ep.EPISTEMIC_STATES.BROKEN.blocking, ep.EPISTEMIC_STATES.UNKNOWN.blocking);
  assert.equal(ep.EPISTEMIC_STATES.BROKEN.examined, true);
  assert.equal(ep.EPISTEMIC_STATES.UNKNOWN.examined, false);
  assert.notEqual(adr.COMPLIANCE_STATES.NON_COMPLIANT.epistemic, adr.COMPLIANCE_STATES.UNKNOWN.epistemic);
});

test('phase18.1 §4: aggregation is to the weakest link, never the mean', () => {
  assert.equal(ep.weakest([]), 'UNKNOWN');
  assert.equal(ep.weakest(['RESOLVED', 'RESOLVED', 'RESOLVED']), 'RESOLVED');
  assert.equal(ep.weakest(['RESOLVED', 'RESOLVED', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(ep.weakest(['RESOLVED', 'UNKNOWN', 'BROKEN']), 'BROKEN');
  assert.equal(ep.weakest(['not-a-state']), 'UNKNOWN');
});

// --- §5: the first-break principle, in all seven shapes ----------------------------------------

const chainOf = (states) => ep.assuranceChain(
  states.map((s, i) => ({ step: `s${i + 1}`, state: s, detail: 'd', ifBroken: 'cost', resolvedFrom: 'src' })),
  { now: 0 },
);

test('phase18.1 §5 shape 1: a break at the first step leaves depth zero', () => {
  const c = chainOf(['BROKEN', 'RESOLVED', 'RESOLVED', 'RESOLVED', 'RESOLVED']);
  assert.equal(c.contiguousNavigableDepth, 0);
  assert.equal(c.resolvedCount, 4);
  assert.equal(c.stoppedAtPosition, 1);
  assert.equal(c.complete, false);
});

test('phase18.1 §5 shape 2: a break in the middle stops the chain there', () => {
  const c = chainOf(['RESOLVED', 'RESOLVED', 'BROKEN', 'RESOLVED', 'RESOLVED']);
  assert.equal(c.contiguousNavigableDepth, 2);
  assert.equal(c.stoppedAt, 's3');
  assert.equal(c.chainState, 'BROKEN');
});

test('phase18.1 §5 shape 3: a break at the final step is still a break', () => {
  const c = chainOf(['RESOLVED', 'RESOLVED', 'RESOLVED', 'RESOLVED', 'BROKEN']);
  assert.equal(c.contiguousNavigableDepth, 4);
  assert.equal(c.complete, false);
  assert.equal(c.stoppedAtPosition, 5);
});

test('phase18.1 §5 shape 4: an unknown step stops the chain and says it was unknown', () => {
  const c = chainOf(['RESOLVED', 'UNKNOWN', 'RESOLVED']);
  assert.equal(c.contiguousNavigableDepth, 1);
  assert.equal(c.chainState, 'UNKNOWN');
  assert.deepEqual(c.unknownSteps, ['s2']);
  assert.deepEqual(c.brokenSteps, []);
});

test('phase18.1 §5 shape 5: a broken step stops the chain and is reported apart from an unknown one', () => {
  const broken = chainOf(['RESOLVED', 'BROKEN', 'RESOLVED']);
  const unknown = chainOf(['RESOLVED', 'UNKNOWN', 'RESOLVED']);
  assert.equal(broken.contiguousNavigableDepth, unknown.contiguousNavigableDepth);
  assert.notEqual(broken.chainState, unknown.chainState);
  assert.deepEqual(broken.brokenSteps, ['s2']);
});

test('phase18.1 §5 shape 6: a complete chain is navigable end to end', () => {
  const c = chainOf(['RESOLVED', 'RESOLVED', 'RESOLVED']);
  assert.equal(c.complete, true);
  assert.equal(c.contiguousNavigableDepth, 3);
  assert.equal(c.stoppedAt, null);
  assert.match(c.summary, /navigable end to end/);
});

test('phase18.1 §5 shape 7: steps that resolve behind a gap are named, not counted as depth', () => {
  // The defect this shape exists for: reporting the tally as the depth produced "traceable through
  // 8/9" for a decision package with nothing at the top of it.
  const c = chainOf(['UNKNOWN', 'RESOLVED', 'RESOLVED', 'RESOLVED']);
  assert.equal(c.contiguousNavigableDepth, 0);
  assert.equal(c.resolvedCount, 3);
  assert.deepEqual(c.resolvedButUnreachable, ['s2', 's3', 's4']);
  assert.notEqual(c.contiguousNavigableDepth, c.resolvedCount);
});

test('phase18.1 §5: no chain summary is ever a percentage', () => {
  for (const c of [chainOf(['BROKEN', 'RESOLVED']), chainOf(['RESOLVED', 'UNKNOWN']), chainOf(['RESOLVED', 'RESOLVED'])]) {
    assert.doesNotMatch(c.summary, /%|percent/);
  }
  assert.match(chainOf(['RESOLVED', 'RESOLVED', 'UNKNOWN', 'RESOLVED']).summary, /^NAVIGABLE THROUGH 2\/4/);
});

test('phase18.1 §5: a step declaring no state is unknown rather than assumed good', () => {
  const c = ep.assuranceChain([{ step: 'a' }, { step: 'b', state: 'RESOLVED' }], { now: 0 });
  assert.equal(c.chainState, 'UNKNOWN');
  assert.equal(c.contiguousNavigableDepth, 0);
});

test('phase18.1 §5: the decision chain runs on the shared walker rather than a private copy', () => {
  assert.equal(inst.HOP_STATES, ep.EPISTEMIC_STATES);
  const walked = inst.explainDecision({}, { now: 0 });
  assert.equal(walked.chain.contiguousNavigableDepth, walked.contiguousNavigableDepth);
  assert.equal(walked.contiguousNavigableDepth, 0);
});

// --- Part 7: the five compliance outcomes, each reachable ---------------------------------------

test('phase18.1 part 7: a fully evidenced executable requirement is compliant', () => {
  const d = register([['REQ-A', EXECUTABLE]]).specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.equal(d.overall, 'COMPLIANT');
  assert.deepEqual(d.specificationsCompliant, ['SPEC-A']);
  assert.equal(d.authorizes, false);
});

test('phase18.1 part 7: a requirement missing what its artefact type requires is observed non-compliance', () => {
  const d = register([['REQ-BARE', {
    specification: 'SPEC-B', section: 'Part 1', statement: 'declared and not built',
    artefactType: 'executable', declaredBy: 'ARB', context: 'assurance', owner: 'Office of the Chief Architect',
  }]]).specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.equal(d.overall, 'NON_COMPLIANT');
  assert.equal(adr.COMPLIANCE_STATES.NON_COMPLIANT.blocking, true);
});

test('phase18.1 part 7: a declaration pointing at nothing is unresolved evidence, not absence', () => {
  // Worse than declaring nothing, because it reads as covered.
  const d = register([['REQ-GHOST', { ...EXECUTABLE, specification: 'SPEC-C', implementation: 'src/does-not-exist.js' }]])
    .specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.equal(d.overall, 'EVIDENCE_UNRESOLVED');
  assert.equal(d.unresolvedEvidence.length, 1);
  assert.equal(d.unresolvedEvidence[0].element, 'implementation');
});

test('phase18.1 part 7: substantive adequacy of a governance requirement is a human matter', () => {
  const reg = register([['REQ-GOV', {
    specification: 'SPEC-D', section: 'Part 1', statement: 'a governance decision',
    artefactType: 'governance', declaredBy: 'ARB', context: 'assurance',
    owner: 'Office of the Chief Architect', documentation: 'docs/architecture-governance.md',
  }]]);
  const awaiting = reg.specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.equal(awaiting.overall, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(awaiting.requirementsNeedingHumanReview.length, 1);

  // A recorded human finding clears it, or the state is a dead end nothing can leave.
  const reviewed = reg.specificationCompliance({
    controls: CONTROLS, now: 0,
    reviews: [{ requirement: 'REQ-GOV', reviewedBy: 'Architecture Review Board', finding: 'adequate for the decision it records' }],
  });
  assert.equal(reviewed.overall, 'COMPLIANT');

  // An unsigned review is an assertion that somebody agreed.
  const unsigned = reg.specificationCompliance({ controls: CONTROLS, now: 0, reviews: [{ requirement: 'REQ-GOV' }] });
  assert.equal(unsigned.rejectedReviews.length, 1);
  assert.equal(unsigned.overall, 'HUMAN_REVIEW_REQUIRED');
});

test('phase18.1 part 7: one unverified requirement makes the specification unverified', () => {
  const decls = [];
  for (let i = 0; i < 9; i += 1) decls.push([`REQ-OK-${i}`, { ...EXECUTABLE, specification: 'SPEC-E' }]);
  decls.push(['REQ-BAD', {
    specification: 'SPEC-E', section: 'Part 2', statement: 'not built', artefactType: 'executable',
    declaredBy: 'ARB', context: 'assurance', owner: 'Office of the Chief Architect',
  }]);
  const d = register(decls).specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.equal(d.overall, 'NON_COMPLIANT');
  assert.equal(d.bySpecification[0].weakestRequirement, 'REQ-BAD');
  // Nine of ten is not ninety per cent of a specification.
  assert.doesNotMatch(d.basis, /%|percent/);
  assert.ok(!('complianceRate' in d));
});

test('phase18.1 part 7: the dashboard states which findings it observed and which need a human', () => {
  const d = register([['REQ-A', EXECUTABLE]]).specificationCompliance({ controls: CONTROLS, now: 0 });
  assert.match(d.machineDetectable, /no declared requirements at all/);
  assert.match(d.humanJudgementRequired, /substantively adequate/);
  assert.equal(d.producesInstitutionalVerdict, false);
  assert.equal(d.authorizes, false);
});

test('phase18.1 part 7: compliance is a view over the requirement register, not a second register', () => {
  assert.equal(typeof adr.RequirementRegister.prototype.specificationCompliance, 'function');
  // Every compliance state maps onto an epistemic state, so a compliance finding can enter any
  // other assurance chain without a translation layer inventing a fourth meaning on the way.
  for (const c of Object.values(adr.COMPLIANCE_STATES)) assert.ok(ep.EPISTEMIC_STATES[c.epistemic]);
});

test('phase18.1 part 7: the dashboard is deterministic', () => {
  const reg = register([['REQ-A', EXECUTABLE]]);
  const a = reg.specificationCompliance({ controls: CONTROLS, specifications: ['SPEC-A', 'SPEC-Z'], now: 0 });
  const b = reg.specificationCompliance({ controls: CONTROLS, specifications: ['SPEC-A', 'SPEC-Z'], now: 0 });
  assert.deepEqual(a, b);
});

// --- Batch 7: the global invariant applied to the governance machinery --------------------------
//
// The invariant has been evaluated against the five constitutional capabilities since ADR-0009. What
// nothing asked was whether the machinery that evaluates it is itself resilient. Phase 18.1 built a
// requirement register, a merge register, a compliance dashboard and a decision assurance chain —
// four new things an institution would come to depend on — and the invariant's own question applies:
// no critical capability may depend on a single person, process, document or system.
//
// The answer, recorded rather than smoothed: every one of the five governance capabilities rests on
// a single accountable body. That is a real finding about this platform and it is left visible.

const ir = require('../src/governance/institutional-resilience');

const RUNNING = [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

test('phase18.1 batch 7: the invariant names four kinds and evaluates all four', () => {
  assert.deepEqual(Object.keys(ir.SINGLE_POINT_KINDS), ['person', 'process', 'document', 'system']);
  for (const k of Object.values(ir.SINGLE_POINT_KINDS)) {
    assert.ok(k.asks.endsWith('?'));
    assert.ok(k.ifSingle, 'a kind that does not say what one instance costs is decoration');
  }
});

test('phase18.1 batch 7: a resilience finding about the platform goes to a board, not to the build', () => {
  // Escalating this to BLOCKED would be a silent change to governance semantics. ADR-0009 says a
  // violation against a CONSTITUTIONAL capability blocks readiness, and says nothing about this.
  assert.equal(ir.GOVERNANCE_RESILIENCE_STATES.SINGLE_POINT_OBSERVED.blocking, false);
  assert.equal(ir.GOVERNANCE_RESILIENCE_STATES.SINGLE_POINT_OBSERVED.requiresGovernanceReview, true);
  assert.equal(ir.GOVERNANCE_RESILIENCE_STATES.BLOCKED.blocking, true);
  assert.equal(ir.GOVERNANCE_RESILIENCE_STATES.UNKNOWN.blocking, false);
});

test('phase18.1 batch 7: BLOCKED is reachable, but only where governance already required resilience', () => {
  const mandated = ir.governanceCapabilityResilience({
    controls: RUNNING, now: 0,
    capabilities: {
      mandated: {
        title: 'a capability the governance model requires to be resilient',
        controls: ['APP-FIT-DECISION-QUALITY'], documents: ['docs/architecture-governance.md'],
        modules: ['src/assurance/epistemic.js'], governanceModelRequiresResilience: true,
      },
    },
  });
  assert.equal(mandated.capabilities[0].state, 'BLOCKED');
  assert.equal(mandated.blocksInstitutionalReadiness, true);

  // The identical shape, without the governance requirement, does not block.
  const same = ir.governanceCapabilityResilience({
    controls: RUNNING, now: 0,
    capabilities: {
      same: {
        title: 'the same shape with no governance requirement',
        controls: ['APP-FIT-DECISION-QUALITY'], documents: ['docs/architecture-governance.md'],
        modules: ['src/assurance/epistemic.js'],
      },
    },
  });
  assert.equal(same.capabilities[0].state, 'SINGLE_POINT_OBSERVED');
  assert.equal(same.blocksInstitutionalReadiness, false);
});

test('phase18.1 batch 7: RESILIENT is reachable, so the control is not one nothing can pass', () => {
  const spread = ir.governanceCapabilityResilience({
    controls: RUNNING, now: 0,
    capabilities: {
      spread: {
        title: 'two of every kind',
        controls: ['APP-FIT-DECISION-QUALITY', 'APP-FIT-LIFECYCLE-DEFAULT-DENY'],
        documents: ['docs/architecture-governance.md', 'docs/adaptive-governance.md'],
        modules: ['src/assurance/institutional.js', 'src/assurance/epistemic.js'],
      },
    },
  });
  assert.equal(spread.capabilities[0].state, 'RESILIENT');
  assert.equal(spread.holds, true);
});

test('phase18.1 batch 7: nothing supplied means unexamined, never resilient', () => {
  const blind = ir.governanceCapabilityResilience({ controls: [], now: 0 });
  assert.equal(blind.holds, false);
  for (const c of blind.capabilities) {
    assert.notEqual(c.state, 'RESILIENT');
    assert.ok(c.unexaminedKinds.includes('process'), 'a capability no control watched reported its watching processes as examined');
  }
});

test('phase18.1 batch 7: a declared reference that does not exist neither counts nor hides', () => {
  const phantom = ir.governanceCapabilityResilience({
    controls: RUNNING, now: 0,
    capabilities: {
      phantom: {
        title: 'one real document and one never written',
        controls: ['APP-FIT-DECISION-QUALITY', 'APP-FIT-LIFECYCLE-DEFAULT-DENY'],
        documents: ['docs/architecture-governance.md', 'docs/never-written.md'],
        modules: ['src/assurance/epistemic.js', 'src/assurance/nowhere.js'],
      },
    },
  });
  const c = phantom.capabilities[0];
  assert.equal(c.counts.document, 1, 'a reference to nothing inflated the count and hid a single point');
  assert.equal(c.counts.system, 1);
  assert.ok(c.singlePointKinds.includes('document'));
  assert.deepEqual(c.documentsMissing, ['docs/never-written.md']);
});

test('phase18.1 batch 7: the honest finding — every governance capability rests on one board', () => {
  const report = ir.governanceCapabilityResilience({ controls: RUNNING, now: 0 });
  assert.equal(report.count, 5);
  assert.equal(report.holds, false, 'this is recorded rather than smoothed');
  for (const c of report.capabilities) {
    assert.equal(c.counts.person, 1);
    assert.ok(c.singlePointKinds.includes('person'));
  }
  // …and it is a matter for a board rather than a build failure.
  assert.equal(report.blocksInstitutionalReadiness, false);
  assert.equal(report.governanceReviewRequired.length, 5);
  assert.ok(report.singlePointDependencies.length >= 5);
  // Every declared reference resolves, or the report itself would be the anti-pattern it detects.
  for (const c of report.capabilities) {
    assert.deepEqual(c.documentsMissing, [], `'${c.capability}' declares a document that does not exist`);
    assert.deepEqual(c.modulesMissing, [], `'${c.capability}' declares a module that does not exist`);
    assert.deepEqual(c.controlsDeclaredNotRunning, [], `'${c.capability}' declares a control that did not run`);
  }
});

test('phase18.1 batch 7: the six-clause constitutional invariant is untouched and still blocks', () => {
  assert.equal(Object.keys(ir.INVARIANT_CLAUSES).length, 6);
  const global = ir.evaluateGlobalInvariant({ controls: RUNNING, now: 400 * 24 * 3600_000 });
  assert.equal(global.blocksInstitutionalReadiness, true);
  assert.equal(global.authorizes, false);
});

test('phase18.1 batch 7: the resilience report is deterministic, fails closed and authorises nothing', () => {
  const a = ir.governanceCapabilityResilience({ controls: RUNNING, now: 0 });
  const b = ir.governanceCapabilityResilience({ controls: RUNNING, now: 0 });
  assert.deepEqual(a, b);
  assert.equal(a.failClosed, true);
  assert.equal(a.authorizes, false);
  assert.equal(a.producesInstitutionalVerdict, false);
  assert.doesNotMatch(a.basis, /%|percent/);
  for (const s of Object.values(ir.GOVERNANCE_RESILIENCE_STATES)) assert.ok(ep.EPISTEMIC_STATES[s.epistemic]);
});
