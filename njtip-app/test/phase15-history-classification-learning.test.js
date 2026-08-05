'use strict';
// Phase 15, Parts 4, 11 & 12 — capability declaration history, recommendation classification and the
// organizational learning lifecycle read from the decision end.
const test = require('node:test');
const assert = require('node:assert');
const cap = require('../src/capability/model');
const opt = require('../src/governance/optimization');
const inst = require('../src/assurance/institutional');
const { DecisionMemory } = require('../src/architecture/decision-memory');

const DAY = 24 * 3600_000;

// --- Part 4: capability declaration history ---------------------------------------------------------

test('a modification records both sides, and amending a declaration requires an ADR', () => {
  const h = new cap.CapabilityDeclarationHistory({ clock: () => 0 });
  for (const field of ['was', 'now']) assert.ok(cap.CHANGE_KINDS.modification.requires.includes(field), field);
  assert.throws(() => h.record('x', 'modification', { by: 'A', rationale: 'r', now: 'b', adr: 'ADR-0009' }), (e) => e.failClosed === true);
  assert.throws(() => h.record('x', 'modification', { by: 'A', rationale: 'r', was: 'a', adr: 'ADR-0009' }), (e) => e.failClosed === true);
  // An architecture that changed without a recorded decision.
  assert.throws(() => h.record('x', 'modification', { by: 'A', rationale: 'r', was: 'a', now: 'b' }), (e) => e.failClosed === true);
  // Creation may predate ADR governance.
  assert.ok(h.record('x', 'creation', { by: 'A', rationale: 'declared at baseline' }));
});

test('every change is attributed and complete', () => {
  const h = new cap.CapabilityDeclarationHistory({ clock: () => 0 });
  assert.throws(() => h.record('x', 'creation', { rationale: 'r' }), (e) => e.failClosed === true);
  assert.throws(() => h.record('x', 'creation', { by: 'A' }), (e) => e.failClosed === true);
  assert.throws(() => h.record('x', 'invented', { by: 'A', rationale: 'r' }), /unknown declaration change kind/);
  assert.throws(() => h.record('x', 'approval', { by: 'A' }), (e) => e.failClosed === true);
});

test('the seeded history records only the amendments this repository actually made', () => {
  const h = cap.seedDeclarationHistory(new cap.CapabilityDeclarationHistory({ clock: () => 0 }));
  const entries = h.entries();
  assert.ok(entries.length);
  const amended = [...new Set(entries.filter((e) => e.kind === 'modification').map((e) => e.capability))].sort();
  assert.deepStrictEqual(amended, ['case-investigation', 'service-recovery']);
  for (const e of entries) {
    assert.ok(e.adr, `${e.capability} cites no ADR`);
    assert.ok(e.rationale.length > 40, e.capability);
    assert.ok(e.was && e.now, e.capability);
  }
  // No approval nobody performed.
  assert.ok(!entries.some((e) => e.kind === 'approval'));
});

test('the report says how much is unrecorded rather than implying completeness', () => {
  const h = cap.seedDeclarationHistory(new cap.CapabilityDeclarationHistory({ clock: () => 0 }));
  const r = h.report();
  assert.ok(r.unrecorded.length);
  assert.notStrictEqual(r.coverage, 1);
  assert.match(r.coverageBasis, /not backfilled/);
  assert.ok(r.neverApproved.length);
  assert.ok(r.byAdr.length);
  assert.strictEqual(r.authorizes, false);
});

test('amended-since-approval is the finding, and approving clears it', () => {
  const h = cap.seedDeclarationHistory(new cap.CapabilityDeclarationHistory({ clock: () => 0 }));
  assert.strictEqual(h.evolution('case-investigation').amendedSinceApproval, true);
  h.record('case-investigation', 'approval', { by: 'ARB', approvedBy: 'Architecture Review Board', at: 100 });
  assert.strictEqual(h.evolution('case-investigation').amendedSinceApproval, false);
  assert.strictEqual(h.evolution('never-declared').unrecorded, true);
});

// --- Part 11: recommendation classification ---------------------------------------------------------

test('five classes, and exactly one of them removes', () => {
  assert.strictEqual(Object.keys(opt.RECOMMENDATION_CLASSES).length, 5);
  for (const required of ['strengthen', 'simplify', 'automate', 'clarify', 'monitor']) {
    assert.ok(opt.RECOMMENDATION_CLASSES[required], required);
  }
  const removing = Object.entries(opt.RECOMMENDATION_CLASSES).filter(([, c]) => c.removes).map(([id]) => id);
  assert.deepStrictEqual(removing, ['simplify']);
  assert.strictEqual(opt.RECOMMENDATION_CLASSES.simplify.scrutiny, 'high');
  for (const [id, c] of Object.entries(opt.RECOMMENDATION_CLASSES)) {
    assert.ok(c.means && c.watchFor, id);
  }
});

test('a simplification may never remove a mandatory control', () => {
  assert.strictEqual(opt.assertNoMandatoryRemoval({ class: 'strengthen' }), true);
  assert.strictEqual(opt.assertNoMandatoryRemoval({ class: 'simplify', touchesMandatory: [] }), true);
  for (const rec of [
    {},
    { class: 'streamline' },
    { class: 'strengthen', touchesMandatory: ['vibes'] },
    { class: 'simplify', touchesMandatory: ['separation-of-duties'] },
    { class: 'simplify', touchesMandatory: ['human-authorization'] },
  ]) {
    assert.throws(() => opt.assertNoMandatoryRemoval(rec), (e) => e.failClosed === true, JSON.stringify(rec));
  }
  // Nothing can be emitted without passing the guard.
  assert.throws(() => opt.recommend({ recommendation: 'drop the second approver', preserves: ['separationOfDuties'], class: 'simplify', touchesMandatory: ['separation-of-duties'] }), (e) => e.failClosed === true);
  assert.throws(() => opt.recommend({ recommendation: 'x', preserves: ['separationOfDuties'] }), (e) => e.failClosed === true);
});

test('every mandatory control names the failure it prevents', () => {
  for (const required of ['separation-of-duties', 'human-authorization', 'named-accountability', 'zone-isolation', 'attribution', 'independent-verification', 'fail-closed']) {
    assert.ok(opt.MANDATORY_CONTROLS[required], required);
  }
  for (const [id, c] of Object.entries(opt.MANDATORY_CONTROLS)) {
    assert.ok(c.prevents, id);
    assert.ok(c.basis, id);
  }
});

test('every real recommendation is classified, and none of them removes anything', () => {
  const r = opt.governanceOptimization({ now: 0 });
  assert.strictEqual(r.everyRecommendationClassified, true);
  for (const rec of r.recommendations) assert.ok(rec.classification.class, rec.target);
  assert.strictEqual(r.byClass.length, 5);
  assert.deepStrictEqual(r.simplifications, []);
  assert.ok(r.mandatoryControls.length);
});

// --- Part 12: the learning lifecycle from the decision end -------------------------------------------

function loopWithDecision() {
  const loop = new inst.ImprovementLoop({ clock: () => 0 });
  const i = loop.observe({ control: 'APP-FIT-X', detail: 'failed', observedBy: 'CI', at: 10 * DAY });
  loop.advance(i.id, 'root-caused', { by: 'Eng', detail: 'cause', at: 11 * DAY });
  loop.advance(i.id, 'action-agreed', { by: 'ARB', detail: 'plan', at: 12 * DAY });
  loop.advance(i.id, 'decided', { by: 'ARB', detail: 'agreed', adr: 'ADR-0005', at: 13 * DAY });
  return loop;
}

test('with nothing joining incidents to decisions, the lineage says exactly that', () => {
  const blind = new DecisionMemory({ clock: () => 0 }).learningLineage({ improvements: [] });
  assert.strictEqual(blind.learningRate, null);
  assert.strictEqual(blind.measurable, false);
  assert.match(blind.learningBasis, /nothing joins its incidents to its decisions/);
});

test('correction without learning stays a named list rather than a rate', () => {
  const mem = new DecisionMemory({ clock: () => 0 });
  const joined = mem.learningLineage({ improvements: loopWithDecision().items(), controls: [{ id: 'APP-FIT-X', pass: true }] });
  const adr5 = joined.decisions.find((d) => d.adr === 'ADR-0005');
  assert.strictEqual(adr5.reactive, true);
  assert.strictEqual(adr5.correctedWithoutLearning, true);
  assert.ok(joined.correctedWithoutLearning.some((x) => x.adr === 'ADR-0005'));
  assert.strictEqual(joined.learningRate, 0);
  // Decisions nobody took in response to anything are excluded, not counted as failures.
  assert.ok(joined.initiative.length);
  assert.match(joined.learningBasis, /excluded, because they were not corrections/);
});

test('a lesson and an evidenced outcome clear it, so the bar is reachable', () => {
  const mem = new DecisionMemory({ clock: () => 0 });
  mem.record('ADR-0005', 'implementation', { by: 'Eng', at: 14 * DAY, modules: ['src/authz.js'] });
  mem.record('ADR-0005', 'outcome', { by: 'Assurance', at: 15 * DAY, verdict: 'as-predicted', evidence: ['APP-FIT-X'] });
  mem.record('ADR-0005', 'lesson', { by: 'ARB', at: 16 * DAY, statement: 'measure before caching' });
  const learned = mem.learningLineage({ improvements: loopWithDecision().items(), controls: [{ id: 'APP-FIT-X', pass: true }] });
  assert.strictEqual(learned.learningRate, 1);
  assert.deepStrictEqual(learned.correctedWithoutLearning, []);
  assert.strictEqual(learned.authorizes, false);
});

test('the chain ends at a measurable readiness improvement, and learned is not improved', () => {
  assert.ok(inst.LEARNING_STAGES['readiness-improvement']);
  assert.strictEqual(Object.keys(inst.LEARNING_STAGES).length, 10);
});
