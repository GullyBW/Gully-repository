'use strict';
// Phase 14, Parts 1, 2 & 3 — the assumption dependency graph, multi-dimensional twin confidence and
// temporal mission impact.
const test = require('node:test');
const assert = require('node:assert');
const asm = require('../src/architecture/assumptions');
const twinMod = require('../src/twin2/operations-twin');
const bus = require('../src/observability/business');

const DAY = 24 * 3600_000;
const YEAR = 365 * DAY;
const CONTROLS = [{ id: 'APP-FIT-CONTEXT-MAP', pass: true }];
const BASE = {
  rationale: 'exercises the propagation rules', evidence: ['APP-FIT-CONTEXT-MAP'], contexts: ['assurance'],
  owner: 'ARB', reviewCadenceDays: 3650, expiresAt: 10 * YEAR, verificationMethod: 'executable-check', confidence: 'high',
};

// A four-node graph: ROOT carries NEC (necessary), SUP (supporting) and CTX (contextual); DEEP rests
// on NEC, so invalidity has somewhere to cascade to.
function probeGraph() {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  for (const id of ['ROOT', 'NEC', 'SUP', 'CTX', 'DEEP']) {
    r.register(id, { ...BASE, statement: `probe ${id}` });
    r.recordVerification(id, { holds: true, by: 'Assurance', at: 0 });
  }
  r.declareDependency('NEC', { on: 'ROOT', strength: 'necessary', type: 'logical', rationale: 'r' });
  r.declareDependency('SUP', { on: 'ROOT', strength: 'supporting', type: 'evidential', rationale: 'r' });
  r.declareDependency('CTX', { on: 'ROOT', strength: 'contextual', type: 'operational', rationale: 'r' });
  r.declareDependency('DEEP', { on: 'NEC', strength: 'necessary', type: 'logical', rationale: 'r' });
  return r;
}
const platform = () => asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
const levelOf = (rows, id) => (rows.find((x) => x.assumption === id) || {}).effective;

// --- Part 1: the dependency graph -----------------------------------------------------------------

test('every dependency strength declares what an upstream failure does to the dependent', () => {
  assert.deepStrictEqual(Object.keys(asm.DEPENDENCY_STRENGTHS).sort(), ['contextual', 'necessary', 'supporting']);
  for (const [id, s] of Object.entries(asm.DEPENDENCY_STRENGTHS)) {
    assert.ok(s.ifUpstreamFails, id);
    assert.strictEqual(typeof s.cascades, 'boolean', id);
  }
  // Only `necessary` cascades. If `supporting` did too, "weakened" and "does not hold" would be the
  // same state and one of them would be a lie.
  assert.strictEqual(asm.DEPENDENCY_STRENGTHS.necessary.cascades, true);
  assert.strictEqual(asm.DEPENDENCY_STRENGTHS.supporting.cascades, false);
  assert.strictEqual(asm.DEPENDENCY_STRENGTHS.contextual.propagation, 'none');
});

test('a dependency must name a registered upstream, a known strength and a known type', () => {
  const r = probeGraph();
  assert.throws(() => r.declareDependency('ROOT', { on: 'NOPE', strength: 'necessary', type: 'logical' }), /no such assumption/);
  assert.throws(() => r.declareDependency('ROOT', { on: 'SUP', strength: 'firm', type: 'logical' }), /unknown dependency strength/);
  assert.throws(() => r.declareDependency('ROOT', { on: 'SUP', strength: 'necessary', type: 'hunch' }), /unknown dependency type/);
  assert.throws(() => r.declareDependency('NEC', { on: 'ROOT', strength: 'necessary', type: 'logical' }), /already declares/);
});

test('a cycle is refused at declaration, fail-closed', () => {
  const r = probeGraph();
  assert.throws(() => r.declareDependency('ROOT', { on: 'DEEP', strength: 'necessary', type: 'logical' }), (e) => e.failClosed === true);
  assert.throws(() => r.declareDependency('ROOT', { on: 'ROOT', strength: 'necessary', type: 'logical' }), (e) => e.failClosed === true);
  assert.strictEqual(r.dependencyGraph().acyclic, true);
});

test('the graph reports roots, leaves, a topological order and what is load-bearing', () => {
  const g = probeGraph().dependencyGraph();
  assert.deepStrictEqual(g.roots, ['ROOT']);
  assert.deepStrictEqual(g.leaves.sort(), ['CTX', 'DEEP', 'SUP']);
  assert.strictEqual(g.order[0], 'ROOT');
  assert.ok(g.order.indexOf('NEC') < g.order.indexOf('DEEP'), 'an upstream must be ordered before its dependent');
  assert.strictEqual(g.loadBearing[0].assumption, 'ROOT');
  assert.strictEqual(g.loadBearing[0].carries, 4);
});

test('confidence flows downstream and only downward', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('WEAK', { ...BASE, statement: 'nothing can check this', verificationMethod: 'unverifiable', confidence: 'unknown' });
  r.register('STRONG', { ...BASE, statement: 'thoroughly evidenced' });
  r.recordVerification('STRONG', { holds: true, by: 'A', at: 0 });
  r.declareDependency('STRONG', { on: 'WEAK', strength: 'necessary', type: 'logical', rationale: 'r' });
  const rows = r.propagateConfidence({ now: 0, controls: CONTROLS }).assumptions;
  // The dependent inherits the ceiling; the upstream is NOT raised by its confident dependent.
  assert.strictEqual(levelOf(rows, 'STRONG'), 'unknown');
  assert.strictEqual(levelOf(rows, 'WEAK'), 'unknown');
  const strong = rows.find((x) => x.assumption === 'STRONG');
  assert.strictEqual(strong.intrinsic, 'high');
  assert.strictEqual(strong.inherited, true);
  assert.deepStrictEqual(strong.limitedBy, ['WEAK']);
});

test('a sound graph is high everywhere — the propagation has a success path', () => {
  const p = probeGraph().propagateConfidence({ now: 0, controls: CONTROLS });
  assert.deepStrictEqual(p.invalid, []);
  assert.deepStrictEqual(p.degraded, []);
  for (const row of p.assumptions) assert.strictEqual(row.effective, 'high', row.assumption);
});

test('invalidating one assumption cascades to everything necessarily resting on it', () => {
  const after = probeGraph().propagateConfidence({ now: 0, controls: CONTROLS, invalidated: ['ROOT'] });
  assert.deepStrictEqual(after.invalid.sort(), ['DEEP', 'NEC', 'ROOT']);
  // A cascade names its cause, transitively.
  assert.deepStrictEqual(after.cascaded, [
    { assumption: 'DEEP', from: 'NEC' },
    { assumption: 'NEC', from: 'ROOT' },
  ]);
  const rows = after.assumptions;
  assert.strictEqual(levelOf(rows, 'NEC'), 'unknown');
  assert.strictEqual(levelOf(rows, 'DEEP'), 'unknown');
});

test('a supporting dependent is weakened, not invalidated — and a contextual one is neither', () => {
  const after = probeGraph().propagateConfidence({ now: 0, controls: CONTROLS, invalidated: ['ROOT'] });
  assert.ok(!after.invalid.includes('SUP'));
  assert.strictEqual(levelOf(after.assumptions, 'SUP'), 'low');
  assert.strictEqual(levelOf(after.assumptions, 'CTX'), 'high');
  assert.ok(after.degraded.some((d) => d.assumption === 'SUP' && d.to === 'low'));
});

test('expiry and a failed verification cascade without anybody declaring anything invalid', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('OLD', { ...BASE, statement: 'expires', expiresAt: 10 * DAY });
  r.register('ON-OLD', { ...BASE, statement: 'rests on it' });
  r.recordVerification('OLD', { holds: true, by: 'A', at: 0 });
  r.recordVerification('ON-OLD', { holds: true, by: 'A', at: 0 });
  r.declareDependency('ON-OLD', { on: 'OLD', strength: 'necessary', type: 'logical', rationale: 'r' });

  assert.deepStrictEqual(r.propagateConfidence({ now: 0, controls: CONTROLS }).invalid, []);
  const expired = r.propagateConfidence({ now: 100 * DAY, controls: CONTROLS });
  assert.deepStrictEqual(expired.invalid.sort(), ['OLD', 'ON-OLD']);

  r.recordVerification('OLD', { holds: false, by: 'Assurance', at: 1 });
  assert.ok(r.propagateConfidence({ now: 0, controls: CONTROLS }).invalid.includes('ON-OLD'));
});

test('impact analysis names what would stop holding, what weakens, and what a human must judge', () => {
  const impact = probeGraph().assumptionImpact('ROOT', { now: 0, controls: CONTROLS });
  assert.strictEqual(impact.affectedCount, 4);
  assert.deepStrictEqual(impact.wouldNotHold.sort(), ['DEEP', 'NEC']);
  assert.deepStrictEqual(impact.wouldBeWeakened, ['SUP']);
  assert.deepStrictEqual(impact.toJudge, ['CTX']);
  assert.deepStrictEqual(impact.affected.find((a) => a.assumption === 'DEEP').path, ['ROOT', 'NEC', 'DEEP']);
  assert.strictEqual(impact.affected.find((a) => a.assumption === 'DEEP').distance, 2);
  assert.strictEqual(impact.authorizes, false);
});

test('an assumption nothing rests on says so, rather than reporting safety', () => {
  const impact = probeGraph().assumptionImpact('DEEP');
  assert.strictEqual(impact.affectedCount, 0);
  assert.match(impact.note, /not proof nothing does/);
});

test('the platform\'s own assumptions form an acyclic graph with a named load-bearing root', () => {
  const r = platform();
  const g = r.dependencyGraph();
  assert.strictEqual(g.acyclic, true);
  assert.ok(g.edgeCount >= 7);
  for (const e of g.edges) assert.ok(e.rationale, `${e.from} → ${e.to}`);
  // ASM-0006 — "a fitness identifier names exactly one control" — turns out to carry most of the
  // registry, because three assumptions cite fitness identifiers as their evidence.
  assert.strictEqual(g.loadBearing[0].assumption, 'ASM-0006');
  const impact = r.assumptionImpact('ASM-0006', { now: 0, controls: CONTROLS });
  assert.ok(impact.wouldNotHold.includes('ASM-0001'));
  assert.ok(impact.wouldNotHold.includes('ASM-0005'), 'invalidity must reach ASM-0005 through ASM-0001');
  assert.strictEqual(r.validate({ now: 0 }).valid, true);
});

test('health reads the propagated level and names the upstream that capped it', () => {
  const r = new asm.AssumptionRegistry({ clock: () => 0 });
  r.register('U', { ...BASE, statement: 'unverifiable', verificationMethod: 'unverifiable', confidence: 'unknown' });
  r.register('D', { ...BASE, statement: 'well evidenced' });
  r.recordVerification('D', { holds: true, by: 'A', at: 0 });
  r.declareDependency('D', { on: 'U', strength: 'necessary', type: 'logical', rationale: 'r' });
  const h = r.health(['D'], { now: 0, controls: CONTROLS });
  assert.strictEqual(h.confidence, 'unknown');
  assert.deepStrictEqual(h.inheritedWeakness, [{ assumption: 'D', from: 'high', to: 'unknown', limitedBy: ['U'] }]);
  // Turning propagation off shows the mechanism is doing the work rather than the assessment.
  assert.strictEqual(r.health(['D'], { now: 0, controls: CONTROLS, propagate: false }).confidence, 'high');
});

// --- Part 2: multi-dimensional twin confidence -----------------------------------------------------

function buildTwin(opts = {}) {
  return new twinMod.OperationsTwin({ evidenceIds: ['APP-FIT-CONTEXT-MAP'], clock: () => 0, ...opts });
}

test('six confidence dimensions are declared, each with a question and a consequence', () => {
  assert.deepStrictEqual(Object.keys(twinMod.CONFIDENCE_DIMENSIONS), ['model', 'evidence', 'data', 'simulation', 'forecast', 'calibration']);
  for (const [id, d] of Object.entries(twinMod.CONFIDENCE_DIMENSIONS)) {
    assert.ok(d.question.endsWith('?'), id);
    assert.ok(d.derivedFrom, id);
    assert.ok(d.absentMeans.length > 30, id);
  }
});

test('a simulation missing a confidence dimension refuses to run', () => {
  const full = Object.keys(twinMod.CONFIDENCE_DIMENSIONS).map((id) => ({ dimension: id, level: 'high', why: 'crafted' }));
  assert.strictEqual(twinMod.assertCompleteConfidence('probe', full), true);
  assert.throws(() => twinMod.assertCompleteConfidence('probe', full.slice(1)), (e) => e.failClosed === true);
  assert.throws(() => twinMod.assertCompleteConfidence('probe', null), /no confidence dimensions at all/);
  assert.throws(() => twinMod.assertCompleteConfidence('probe', [...full, { dimension: 'vibes', level: 'high', why: 'x' }]), /undeclared confidence dimension/);
  assert.throws(() => twinMod.assertCompleteConfidence('probe', full.map((d, i) => (i ? d : { ...d, why: null }))), /states no reason/);
});

test('overall confidence is the weakest dimension and is never entered by hand', () => {
  const twin = buildTwin({ assumptions: platform() });
  const c = twin.confidence('operational-failure', { now: 0, controls: CONTROLS });
  assert.strictEqual(c.dimensions.length, 6);
  assert.strictEqual(c.derived, true);
  assert.strictEqual(c.manualEntry, false);
  const order = ['high', 'moderate', 'low', 'unknown'];
  const weakest = c.dimensions.reduce((w, d) => (order.indexOf(d.level) >= order.indexOf(w) ? d.level : w), 'high');
  assert.strictEqual(c.confidence, weakest);
  assert.match(c.method, /never their average/);
});

test('data confidence is unknown when the scenario perturbs something the model does not contain', () => {
  const twin = buildTwin({ assumptions: platform(), regions: [] });
  const d = twin.confidenceDimensions('dr-exercise', { now: 0, controls: CONTROLS }).find((x) => x.dimension === 'data');
  assert.strictEqual(d.level, 'unknown');
  assert.match(d.why, /perturbs something that is not there/);
  // …and it is 'high' when the regions are there, so the dimension can move in both directions.
  const populated = buildTwin({ assumptions: platform() });
  assert.strictEqual(populated.confidenceDimensions('dr-exercise', { now: 0, controls: CONTROLS }).find((x) => x.dimension === 'data').level, 'high');
});

test('forecast confidence catches a model that was right and is drifting', () => {
  const twin = buildTwin({ assumptions: platform() });
  for (let i = 0; i < 6; i++) twin.recordValidation('migration-plan', { predicted: true, observed: i < 3, by: 'ARB', at: i });
  const f = twin.confidenceDimensions('migration-plan', { now: 0, controls: CONTROLS }).find((x) => x.dimension === 'forecast');
  assert.strictEqual(f.level, 'unknown');
  assert.match(f.why, /drifting/);
});

test('the confidence report names the dimension limiting the estate most often', () => {
  const twin = buildTwin({ assumptions: platform() });
  const r = twin.confidenceReport({ now: 0, controls: CONTROLS });
  assert.strictEqual(r.byDimension.length, 6);
  assert.ok(r.mostLimitingDimension.dimension);
  assert.strictEqual(r.authorizes, false);
});

test('every simulation carries its six dimensions, not just the word', () => {
  const twin = buildTwin({ assumptions: platform() });
  const run = twin.simulate({ scenario: 'operational-failure', change: { failed: ['kms'] }, now: 0, controls: CONTROLS });
  assert.strictEqual(Object.keys(run.confidenceDimensions).length, 6);
  assert.strictEqual(run.confidence, run.confidenceDetail.confidence);
  assert.strictEqual(run.authorizes, false);
});

// --- Part 3: temporal mission impact ---------------------------------------------------------------

test('five horizons are declared in order, each saying what changes there', () => {
  assert.deepStrictEqual(bus.IMPACT_HORIZON_ORDER, ['immediate', 'short-term', 'medium-term', 'long-term', 'strategic-institutional']);
  for (const [id, h] of Object.entries(bus.IMPACT_HORIZONS)) {
    assert.ok(h.within, id);
    assert.ok(h.whatChangesHere.length > 30, id);
    assert.ok(h.ifUnknown.length > 30, id);
  }
});

test('every mission-chain layer lands in exactly one horizon', () => {
  for (const layer of bus.MISSION_IMPACT_LAYERS) {
    const owning = bus.IMPACT_HORIZON_ORDER.filter((h) => bus.IMPACT_HORIZONS[h].layers.includes(layer));
    assert.strictEqual(owning.length, 1, `${layer}: ${owning.join(', ')}`);
  }
  assert.strictEqual(bus.validateMissionChain().valid, true);
});

test('a constitutional outage reaches every horizon, ending at public confidence', () => {
  const t = bus.temporalMissionImpact({ change: 'intake withdrawn', failed: ['intake-api'] });
  assert.strictEqual(t.furthestImpact, 'strategic-institutional');
  assert.strictEqual(t.reachesStrategic, true);
  assert.strictEqual(t.complete, true);
  for (const h of t.horizons) {
    assert.strictEqual(h.state, 'impact', h.horizon);
    assert.ok(h.reached.length, h.horizon);
  }
  assert.strictEqual(t.timeline.length, 5);
  assert.strictEqual(t.authorizes, false);
});

test('an unmapped component makes every horizon UNKNOWN rather than clear', () => {
  const t = bus.temporalMissionImpact({ change: 'search index lost', failed: ['search-index'] });
  assert.strictEqual(t.unknownHorizons.length, 5);
  assert.strictEqual(t.complete, false);
  assert.ok(!t.horizons.some((h) => h.state === 'no-declared-impact'));
  // The booleans must not read as an answer either.
  for (const h of t.horizons) {
    assert.strictEqual(h.impacted, false);
    assert.strictEqual(h.assessable, false);
  }
  assert.match(t.boardSummary, /UNKNOWN/);
});

test('a component nobody modelled is unknown at every horizon too', () => {
  const t = bus.temporalMissionImpact({ change: 'unmodelled thing', failed: ['quantum-widget'] });
  assert.strictEqual(t.unknownHorizons.length, 5);
});

test('a change affecting nothing reports no declared impact, stated as a limit of what is declared', () => {
  const t = bus.temporalMissionImpact({ change: 'nothing at all', failed: [] });
  assert.deepStrictEqual(t.impactedHorizons, []);
  assert.deepStrictEqual(t.unknownHorizons, []);
  assert.strictEqual(t.complete, true);
  for (const h of t.horizons) assert.strictEqual(h.state, 'no-declared-impact', h.horizon);
  assert.match(t.boardSummary, /not a guarantee/);
});

test('the timeline says when each consequence arrives and what to expect', () => {
  const t = bus.temporalMissionImpact({ change: 'custody lost', failed: ['evidence-store'] });
  assert.strictEqual(t.timeline.length, 5);
  for (const row of t.timeline) {
    assert.ok(row.when && row.expect && row.detail, row.horizon);
  }
  // An unknown row must say so in the text a reader actually sees, not only in a flag.
  for (const row of t.timeline) {
    const h = t.horizons.find((x) => x.horizon === row.horizon);
    if (h.state === 'unknown') assert.match(row.expect, /UNKNOWN/);
  }
});
