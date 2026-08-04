'use strict';
// Phase 13, Parts 3, 4 & 5 — the institutional mission chain, the compliance state lifecycle, and
// the temporal enterprise knowledge graph.
const test = require('node:test');
const assert = require('node:assert');
const bus = require('../src/observability/business');
const ci = require('../src/legislation/compliance-intelligence');
const { LegislativeRegistry } = require('../src/legislation/registry');
const { EnterpriseGraph, EDGE_EVIDENCE, EDGE_KINDS } = require('../src/graph/enterprise-graph');
const { ContractRegistry } = require('../src/contracts/integration-contracts');

// --- Part 3: the chain reaches the institution and the government -------------------------------

test('the chain has eight stages and every edge moves forward', () => {
  assert.deepStrictEqual(bus.MISSION_IMPACT_LAYERS, [
    'technical-event', 'business-process', 'justice-service', 'citizen-impact',
    'institutional-impact', 'mission-objective', 'strategic-goal', 'government-mission-outcome',
  ]);
  const v = bus.validateMissionChain();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  assert.deepStrictEqual(bus.missionDependencyGraph().backwardEdges, []);
});

test('institutional impacts name an institution and a board they escalate to', () => {
  const impacts = bus.institutionalImpacts();
  assert.ok(impacts.length >= 4);
  for (const i of impacts) {
    assert.ok(i.title, i.id);
    assert.ok(i.institution, i.id);
    assert.ok(i.escalatesTo, i.id);
  }
});

test('the mission dependency graph draws exactly the links the forecast traverses', () => {
  const g = bus.missionDependencyGraph();
  assert.strictEqual(g.edgeCount, bus.missionImpactLinks().length);
  assert.deepStrictEqual(g.isolated, []);
  assert.deepStrictEqual(g.unresolvedEndpoints, []);
  // Layers are indexed in chain order, and every edge climbs.
  const index = Object.fromEntries(g.layers.map((l) => [l.layer, l.index]));
  for (const e of g.edges) assert.ok(index[e.toLayer] > index[e.fromLayer], `${e.from} → ${e.to}`);
  assert.strictEqual(g.authorizes, false);
});

test('a constitutional failure now reaches the institution and the government outcome', () => {
  const f = bus.missionImpactForecast({ change: 'withdraw the intake store', failed: ['persistence-ind'] });
  assert.ok(f.institutionalImpacts.some((i) => i.id === 'mandate-undeliverable'));
  assert.ok(f.institutionsAffected.includes('Directorate on Corruption and Economic Crime'));
  assert.ok(f.governmentMissionOutcomes.length > 0);
  // Every path runs the full chain and states a mechanism at each hop.
  assert.ok(f.paths.length > 0);
  for (const p of f.paths) assert.ok(p.mechanisms.length >= 3, p.chain);
});

test('the extended chain keeps unknown distinct from no impact', () => {
  const orphan = bus.missionImpactForecast({ change: 'broker withdrawal', failed: ['broker-exec'] });
  assert.deepStrictEqual(orphan.institutionalImpacts, []);
  assert.strictEqual(orphan.safeToDeploy, false);
  assert.match(orphan.boardSummary, /unknown, not nil/);
  const none = bus.missionImpactForecast({ change: 'docs only', failed: [] });
  assert.strictEqual(none.safeToDeploy, true);
  assert.deepStrictEqual(none.institutionalImpacts, []);
  assert.deepStrictEqual(none.governmentMissionOutcomes, []);
});

// --- Part 4: the compliance state lifecycle -------------------------------------------------------

function compliance() {
  const reg = new LegislativeRegistry({ clock: () => 0 });
  reg.register('act', { title: 'An Act', mapsToControls: ['APP-FIT-A', 'APP-FIT-B'] });
  return new ci.ComplianceIntelligence({ registry: reg, clock: () => 0 });
}
const HOLDING = [{ id: 'APP-FIT-A', pass: true }, { id: 'APP-FIT-B', pass: true }];
const MIXED = [{ id: 'APP-FIT-A', pass: true }, { id: 'APP-FIT-B', pass: false }];

test('no unknown state reads as compliant, and partial compliance is not compliance', () => {
  assert.strictEqual(ci.COMPLIANCE_STATES.unknown.compliant, false);
  assert.strictEqual(ci.COMPLIANCE_STATES['under-assessment'].compliant, false);
  assert.strictEqual(ci.COMPLIANCE_STATES['partially-compliant'].compliant, false);
  assert.strictEqual(ci.COMPLIANCE_STATES.remediating.compliant, false);
  assert.strictEqual(ci.COMPLIANCE_STATES.compliant.compliant, true);
  assert.strictEqual(ci.COMPLIANCE_STATES.verified.compliant, true);
  assert.strictEqual(compliance().validate().valid, true);
});

test('the state machine refuses an illegal jump and an unattributed change', () => {
  const c = compliance();
  assert.throws(() => c.transition('act', { to: 'verified', by: 'X', rationale: 'r' }), (e) => e.failClosed === true);
  assert.throws(() => c.transition('act', { to: 'verified', by: 'X', rationale: 'r' }), /not a legal transition/);
  assert.throws(() => c.transition('act', { to: 'under-assessment', by: 'X' }), (e) => e.failClosed === true);
  assert.throws(() => c.transition('act', { to: 'imaginary', by: 'X', rationale: 'r' }), /unknown compliance state/);
});

test('verified cannot be self-declared by the assessor', () => {
  const c = compliance();
  c.transition('act', { to: 'under-assessment', by: 'Officer', rationale: 'opened' });
  c.transition('act', { to: 'compliant', by: 'Officer', rationale: 'controls hold' });
  assert.throws(() => c.transition('act', { to: 'verified', by: 'Officer', rationale: 'confirmed', independent: true }), /cannot also be its independent verifier/);
  assert.throws(() => c.transition('act', { to: 'verified', by: 'Auditor General', rationale: 'confirmed' }), /requires independent confirmation/);
  const done = c.transition('act', { to: 'verified', by: 'Auditor General', rationale: 'confirmed', independent: true });
  assert.strictEqual(done.state, 'verified');
});

test('state is derived from evidence, not only declared', () => {
  const c = compliance();
  assert.strictEqual(c.deriveState('act', { controls: [] }).derived, 'governance-gap');
  assert.strictEqual(c.deriveState('act', { controls: HOLDING }).derived, 'compliant');
  assert.strictEqual(c.deriveState('act', { controls: MIXED }).derived, 'partially-compliant');
  assert.strictEqual(c.deriveState('act', { controls: [{ id: 'APP-FIT-A', pass: false }, { id: 'APP-FIT-B', pass: false }] }).derived, 'failing');
  assert.strictEqual(c.deriveState('act', { controls: ['APP-FIT-A', 'APP-FIT-B'] }).derived, 'under-assessment');
});

test('an obligation declared compliant whose controls fail is reported as overstated', () => {
  const c = compliance();
  c.transition('act', { to: 'under-assessment', by: 'Officer', rationale: 'opened' });
  c.transition('act', { to: 'compliant', by: 'Officer', rationale: 'declared' });
  const bad = c.stateReconciliation({ controls: MIXED });
  assert.deepStrictEqual(bad.overstated, ['act']);
  assert.strictEqual(bad.sound, false);
  const good = c.stateReconciliation({ controls: HOLDING });
  assert.deepStrictEqual(good.overstated, []);
  assert.strictEqual(good.sound, true);
  assert.strictEqual(good.noUnknownReportedCompliant, true);
});

test('a never-assessed obligation says so rather than reading as compliant', () => {
  const c = compliance();
  const tl = c.timeline('act');
  assert.strictEqual(tl.neverAssessed, true);
  assert.strictEqual(tl.current, 'unknown');
  assert.match(tl.note, /not a form of compliant/);
  assert.deepStrictEqual(c.evolution({ controls: HOLDING }).neverAssessed, ['act']);
});

test('the timeline records who moved the state, why, and whether it counted as compliant', () => {
  const c = compliance();
  c.transition('act', { to: 'under-assessment', by: 'Officer', rationale: 'opened', at: 10 });
  c.transition('act', { to: 'failing', by: 'Officer', rationale: 'a control does not hold', at: 20 });
  c.transition('act', { to: 'remediating', by: 'Officer', rationale: 'plan agreed', at: 30 });
  const tl = c.timeline('act');
  assert.strictEqual(tl.transitions, 3);
  assert.strictEqual(tl.current, 'remediating');
  for (const e of tl.entries) {
    assert.ok(e.by && e.rationale);
    assert.strictEqual(typeof e.compliantDuring, 'boolean');
  }
  assert.strictEqual(tl.entries[0].durationMs, 10);
  assert.strictEqual(tl.entries[2].durationMs, null);   // still current
});

test('evolution reports direction and never flatters an unassessed estate', () => {
  const c = compliance();
  c.transition('act', { to: 'under-assessment', by: 'Officer', rationale: 'opened', at: 1 });
  c.transition('act', { to: 'compliant', by: 'Officer', rationale: 'holds', at: 2 });
  const evo = c.evolution({ controls: HOLDING });
  assert.strictEqual(evo.complianceRate, 1);
  assert.strictEqual(evo.verificationRate, 0);          // compliant is not verified
  assert.strictEqual(evo.direction, 'improving');
  assert.deepStrictEqual(evo.neverAssessed, []);
  assert.strictEqual(evo.authorizes, false);

  const regressed = compliance();
  regressed.transition('act', { to: 'under-assessment', by: 'O', rationale: 'r', at: 1 });
  regressed.transition('act', { to: 'compliant', by: 'O', rationale: 'r', at: 2 });
  regressed.transition('act', { to: 'failing', by: 'O', rationale: 'a control broke', at: 3 });
  // Net movement is flat — it began non-compliant and ended non-compliant — but the latest move was
  // downward, and that is the fact a reader needs. Both are reported.
  const evo2 = regressed.evolution({ controls: MIXED });
  assert.strictEqual(evo2.direction, 'flat');
  assert.strictEqual(evo2.recentDirection, 'regressing');
  assert.strictEqual(evo2.latestTransition.to, 'failing');
});

// --- Part 5: the temporal knowledge graph ---------------------------------------------------------

const EPOCH = 1_000;
const results = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];
const graph = (opts = {}) => new EnterpriseGraph({ fitnessResults: results(), contracts: new ContractRegistry(), epoch: EPOCH, ...opts });

test('every edge kind names the control that would fail if it were wrong', () => {
  const known = new Set(results().map((r) => r.id));
  for (const rel of Object.keys(EDGE_KINDS)) {
    assert.ok(EDGE_EVIDENCE[rel], `${rel} names no evidencing control`);
    assert.ok(known.has(EDGE_EVIDENCE[rel]), `${rel} cites '${EDGE_EVIDENCE[rel]}', which does not run`);
  }
});

test('every edge carries creation time, expiry, version, evidence and owner fields', () => {
  const g = graph();
  for (const e of g.edges()) {
    assert.ok(Number.isFinite(e.createdAt), `${e.from} → ${e.to}`);
    assert.ok(Object.prototype.hasOwnProperty.call(e, 'expiredAt'));
    assert.strictEqual(typeof e.version, 'number');
    assert.ok(e.evidence, `${e.from} → ${e.to} has no evidence`);
  }
  const integrity = g.temporalIntegrity();
  assert.strictEqual(integrity.coverage, 1);
  assert.deepStrictEqual(integrity.unevidenced, []);
  assert.strictEqual(integrity.sound, true);
});

test('an undated edge is excluded from history rather than assumed eternal', () => {
  const g = graph({ history: [{ from: 'adr:ADR-0001', to: 'bounded-context:assurance', rel: 'decides', createdAt: null, expiredAt: null, version: 1 }] });
  assert.ok(g.temporalIntegrity().coverage < 1);
  assert.strictEqual(g.temporalIntegrity().undated.length, 1);
  assert.ok(g.edgesAsOf(EPOCH + 10).every((e) => Number.isFinite(e.createdAt)));
  assert.strictEqual(g.asOf(EPOCH).undated.length, 1);
  assert.match(g.asOf(EPOCH).note, /cannot honestly be placed in the past/);
});

test('a temporal query answers what was in force at an instant', () => {
  const g = graph();
  assert.strictEqual(g.asOf(EPOCH - 1).totalEdgesInForce, 0);
  assert.ok(g.asOf(EPOCH).totalEdgesInForce > 0);
  assert.throws(() => g.asOf(undefined), /needs an instant/);
  assert.throws(() => g.edgesAsOf('yesterday'), /needs an instant/);
});

test('a superseded edge is in force before its expiry and not after', () => {
  const g = graph({
    history: [{ from: 'policy:consistency:retired-stance', to: 'bounded-context:investigation', rel: 'governs', createdAt: 100, expiredAt: 500, version: 1, evidence: 'evidence:APP-FIT-RACI-GOVERNANCE', owner: 'ARB' }],
  });
  assert.ok(g.edgesAsOf(300).some((e) => e.historical));
  assert.ok(!g.edgesAsOf(600).some((e) => e.historical));
  const then = g.asOf(300, { node: 'bounded-context:investigation' });
  assert.ok(then.policies.includes('policy:consistency:retired-stance'));
  // …and it is gone from the present.
  assert.ok(!g.asOf(EPOCH + 100, { node: 'bounded-context:investigation' }).policies.includes('policy:consistency:retired-stance'));
});

test('temporal impact reports what came into force, what ended, and what merely persisted', () => {
  const g = graph({
    history: [
      { from: 'policy:consistency:retired-stance', to: 'bounded-context:investigation', rel: 'governs', createdAt: 100, expiredAt: 500, version: 1, evidence: 'evidence:APP-FIT-RACI-GOVERNANCE', owner: 'ARB' },
      { from: 'policy:consistency:investigation', to: 'bounded-context:investigation', rel: 'governs', createdAt: 100, expiredAt: 500, version: 1, evidence: 'evidence:APP-FIT-RACI-GOVERNANCE', owner: 'ARB' },
    ],
  });
  const change = g.temporalImpact(300, EPOCH + 500);
  assert.ok(change.removed.some((r) => /retired-stance/.test(r.edge)));
  // A relationship re-established by the current graph is not a removal — it still holds.
  assert.ok(!change.removed.some((r) => /policy:consistency:investigation →/.test(r.edge)));
  assert.ok(change.added.length > 0);
  assert.throws(() => g.temporalImpact(600, 300), /must not precede/);
  assert.throws(() => g.temporalImpact(600), /needs two instants/);
  const quiet = g.temporalImpact(EPOCH + 100, EPOCH + 200);
  assert.deepStrictEqual(quiet.added, []);
  assert.deepStrictEqual(quiet.removed, []);
  assert.strictEqual(quiet.authorizes, false);
});
