'use strict';
// Phase 12, Parts 19 & 20 — automated compliance intelligence, and the enterprise knowledge graph.
const test = require('node:test');
const assert = require('node:assert');
const { ComplianceIntelligence, CHANGE_KINDS, KIND_READINESS, MAPPING_DIMENSIONS } = require('../src/legislation/compliance-intelligence');
const { EnterpriseGraph, NODE_KINDS, EDGE_KINDS } = require('../src/graph/enterprise-graph');
const { ContractRegistry } = require('../src/contracts/integration-contracts');
const { LegislativeRegistry } = require('../src/legislation/registry');
const contextMap = require('../src/architecture/context-map');
const ec = require('../src/assurance/evidence-confidence');

const ci = () => new ComplianceIntelligence({ clock: () => 1_000 });
const HOLDING = [{ id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }];

// --- Part 19: automated compliance intelligence ---------------------------------------------------

test('every change kind says who originates it and what a missed one costs', () => {
  const c = ci();
  assert.strictEqual(c.validate().valid, true, c.validate().violations.join('; '));
  for (const [kind, spec] of Object.entries(CHANGE_KINDS)) {
    assert.ok(spec.originator, kind);
    assert.ok(spec.missedMeans, kind);
    assert.ok((KIND_READINESS[kind] || []).length, `${kind} bears on no readiness dimension`);
    for (const d of KIND_READINESS[kind]) assert.ok(ec.READINESS_DIMENSIONS[d], `${kind} → ${d}`);
  }
  for (const [dim, spec] of Object.entries(MAPPING_DIMENSIONS)) assert.ok(spec.source, dim);
});

test('observing a change requires an observer, a summary and a known kind', () => {
  const c = ci();
  assert.throws(() => c.observe({ kind: 'legislative-change', summary: 'x' }), (e) => e.failClosed === true);
  assert.throws(() => c.observe({ kind: 'legislative-change', observedBy: 'y' }), /must be summarised/);
  assert.throws(() => c.observe({ kind: 'a-feeling', summary: 'x', observedBy: 'y' }), /unknown change kind/);
  assert.throws(() => c.observe({ kind: 'policy-update', summary: 'x', observedBy: 'y', severity: 'apocalyptic' }), /unknown severity/);
});

test('a change may not cite an instrument the registry does not hold', () => {
  const registry = new LegislativeRegistry({ clock: () => 0 });
  registry.register('data-protection-act', { title: 'Data Protection Act', type: 'act', mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'] });
  const c = new ComplianceIntelligence({ registry, clock: () => 1_000 });
  assert.throws(() => c.observe({ kind: 'legislative-change', summary: 'x', observedBy: 'y', instrument: 'imaginary-act' }), /unknown legal instrument/);
  const ok = c.observe({ kind: 'legislative-change', summary: 'amended', observedBy: 'Legal Counsel', instrument: 'data-protection-act', affects: { contexts: ['privacy'] } });
  // The instrument's own control mapping is picked up without being restated on the change.
  const m = c.mapChange(ok.id, { controls: HOLDING });
  assert.ok(m.controls.some((x) => x.control === 'APP-FIT-ANONYMITY-BOUNDARY'));
});

test('a change is mapped onto every dimension, resolved against a registry', () => {
  const c = ci();
  const change = c.observe({
    kind: 'legislative-change', summary: 'Data Protection Act amended', severity: 'critical', observedBy: 'Legal Counsel',
    affects: { contexts: ['privacy', 'ministry-of-typos'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'], datasets: ['case-records', 'a-spreadsheet'] },
  });
  const m = c.mapChange(change.id, { controls: HOLDING, datasets: ['case-records'] });
  assert.deepStrictEqual(m.boundedContexts, ['privacy']);
  assert.deepStrictEqual(m.unresolvedContexts, ['ministry-of-typos']);
  assert.ok(m.workflows.length > 0);
  assert.ok(m.policies.some((p) => p.policy === 'consistency:privacy'));
  assert.ok(m.adrs.length > 0);
  for (const a of m.adrs) assert.ok(a.via, `${a.adr} does not say why it was matched`);
  assert.ok(m.readinessDimensions.includes('legal'));
  assert.ok(m.readinessDimensions.includes('data'));    // an affected dataset implies it
  assert.ok(m.owners.every((o) => o.responsibleAuthority));
  assert.strictEqual(m.authorizes, false);
  for (const src of Object.values(m.mappedFrom)) assert.ok(src);
});

test('missing, failing, unverified and holding are four different control states', () => {
  const c = ci();
  const change = c.observe({
    kind: 'control-effectiveness', summary: 'review', observedBy: 'Assurance',
    affects: { controls: ['holds', 'fails', 'unverified', 'never-written'] },
  });
  const m = c.mapChange(change.id, { controls: [{ id: 'holds', pass: true }, { id: 'fails', pass: false }, 'unverified'] });
  const state = Object.fromEntries(m.controls.map((x) => [x.control, x.state]));
  assert.strictEqual(state.holds, 'holding');
  assert.strictEqual(state.fails, 'failing');
  assert.strictEqual(state.unverified, 'unverified');
  assert.strictEqual(state['never-written'], 'missing');
});

test('an unassessed change is a gap, not silence', () => {
  const c = ci();
  const change = c.observe({ kind: 'policy-update', summary: 'threshold changed', observedBy: 'ARB Chair', affects: { contexts: ['privacy'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'] } });
  let gaps = c.gapAnalysis({ controls: HOLDING });
  assert.strictEqual(gaps.clear, false);
  assert.deepStrictEqual(gaps.unassessed, [change.id]);
  assert.ok(gaps.gaps.some((g) => g.gap === 'unassessed'));
  assert.throws(() => c.assess(change.id, { by: 'ARB Chair' }), (e) => e.failClosed === true);
  assert.throws(() => c.assess('CHG-9999', { by: 'x', conclusion: 'y' }), /unknown change/);
  c.assess(change.id, { by: 'ARB Chair', conclusion: 'already implemented by the anonymity boundary' });
  gaps = c.gapAnalysis({ controls: HOLDING });
  assert.strictEqual(gaps.clear, true, JSON.stringify(gaps.gaps));
});

test('a control that exists but does not hold is not a control', () => {
  const c = ci();
  const change = c.observe({ kind: 'control-effectiveness', summary: 'regression', observedBy: 'Assurance', severity: 'critical', affects: { controls: ['APP-FIT-PROBE'] } });
  c.assess(change.id, { by: 'Assurance Lead', conclusion: 'under investigation' });
  const gaps = c.gapAnalysis({ controls: [{ id: 'APP-FIT-PROBE', pass: false }] });
  assert.strictEqual(gaps.clear, false);
  const failing = gaps.gaps.find((g) => g.gap === 'control-failing');
  assert.ok(failing);
  assert.strictEqual(failing.severity, 'critical');
  assert.match(failing.detail, /does not hold is not a control/);
});

test('a clear report says what it has not seen', () => {
  const c = ci();
  const change = c.observe({ kind: 'policy-update', summary: 'minor', observedBy: 'ARB Chair', severity: 'minor', affects: { contexts: ['privacy'], controls: ['APP-FIT-ANONYMITY-BOUNDARY'] } });
  c.assess(change.id, { by: 'ARB Chair', conclusion: 'implemented' });
  const gaps = c.gapAnalysis({ controls: HOLDING });
  assert.strictEqual(gaps.clear, true);
  assert.match(gaps.coverageCaveat, /not evidence that no unrecorded change exists/);
  assert.strictEqual(gaps.authorizes, false);
  assert.strictEqual(gaps.failClosed, true);
});

test('a change mapping to no control at all is itself a critical gap', () => {
  const c = ci();
  const change = c.observe({ kind: 'regulatory-amendment', summary: 'new supervisory expectation', observedBy: 'Compliance', affects: { contexts: ['privacy'] } });
  c.assess(change.id, { by: 'Compliance Lead', conclusion: 'noted' });
  const gaps = c.gapAnalysis({ controls: HOLDING });
  const gap = gaps.gaps.find((g) => g.gap === 'no-mapped-control');
  assert.ok(gap);
  assert.strictEqual(gap.severity, 'critical');
  assert.match(gap.detail, /nothing in the platform demonstrably responds to it/);
});

test('remediation recommends, ranks by severity, and never acts', () => {
  const c = ci();
  c.observe({
    kind: 'legislative-change', summary: 'amended', severity: 'critical', observedBy: 'Legal Counsel',
    affects: { contexts: ['privacy', 'nowhere'], controls: ['APP-FIT-NEVER-WRITTEN'], datasets: ['ungoverned'] },
  });
  const rem = c.remediation({ controls: HOLDING, datasets: ['case-records'] });
  assert.ok(rem.recommendations.length > 0);
  assert.strictEqual(rem.recommendationsOnly, true);
  assert.strictEqual(rem.authorizes, false);
  assert.match(rem.note, /Nothing here is applied/);
  const order = { critical: 0, major: 1, minor: 2 };
  const ranks = rem.recommendations.map((r) => order[r.severity]);
  assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const r of rem.recommendations) {
    assert.ok(r.recommendedAction);
    assert.ok(r.owners.length);
    assert.ok(r.derivedFrom);
  }
  // The module exposes no way to apply a recommendation.
  assert.strictEqual(typeof c.apply, 'undefined');
  assert.strictEqual(typeof c.remediate, 'undefined');
});

// --- Part 20: the enterprise knowledge graph ------------------------------------------------------

const FITNESS = [
  { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true },
  { id: 'APP-FIT-AUTHZ-DEFAULT-DENY', pass: true },
  { id: 'APP-FIT-CUSTODY-CHAIN', pass: true },
];
const graph = (opts = {}) => new EnterpriseGraph({
  fitnessResults: FITNESS, contracts: new ContractRegistry(),
  datasets: [{ id: 'case-records', domain: 'investigation' }],
  obligations: [{ id: 'data-protection-act', mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'] }],
  ...opts,
});

test('all thirteen node kinds are declared, sourced and populated', () => {
  const g = graph();
  const required = ['adr', 'bounded-context', 'service', 'api', 'risk', 'control', 'evidence', 'policy', 'dataset', 'metric', 'owner', 'readiness-dimension', 'compliance-obligation'];
  assert.deepStrictEqual(Object.keys(NODE_KINDS).sort(), [...required].sort());
  for (const kind of required) {
    assert.ok(NODE_KINDS[kind].source, kind);
    assert.ok(g.stats().byKind[kind] > 0, `no '${kind}' nodes`);
  }
});

test('every edge kind states what it means, and an unmeant edge is refused', () => {
  const g = graph();
  for (const [rel, meaning] of Object.entries(EDGE_KINDS)) assert.ok(meaning, rel);
  for (const e of g.edges()) assert.ok(e.meaning, `${e.from} → ${e.to}`);
  assert.throws(() => g._link('adr:ADR-0001', 'bounded-context:privacy', 'feels-related'), /no stated meaning/);
});

test('the graph matches the architecture-of-record and is deterministic', () => {
  const g = graph();
  const v = g.validate();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  for (const id of contextMap.ids()) assert.ok(g.node(`bounded-context:${id}`), id);
  assert.strictEqual(graph().digest(), g.digest());
  assert.notStrictEqual(graph({ fitnessResults: [] }).digest(), g.digest());
});

test('a control traces to its own evidence, and a failing check is not traceability', () => {
  const g = graph();
  const t = g.traceability();
  const row = t.nodes.find((n) => n.node === 'control:APP-FIT-ANONYMITY-BOUNDARY');
  assert.strictEqual(row.traceable, true);
  assert.strictEqual(row.evidence, 'evidence:APP-FIT-ANONYMITY-BOUNDARY');

  const failing = new EnterpriseGraph({ fitnessResults: [{ id: 'APP-FIT-PROBE', pass: false }] });
  const strict = failing.traceability({ requireHolding: true });
  assert.strictEqual(strict.nodes.find((n) => n.node === 'control:APP-FIT-PROBE').traceable, false);
  assert.match(strict.note, /demonstrated defect/);
  const lenient = failing.traceability({ requireHolding: false });
  assert.strictEqual(lenient.nodes.find((n) => n.node === 'control:APP-FIT-PROBE').traceable, true);
});

test('untraceable entities are named, and no evidence means no traceability', () => {
  const g = graph();
  const t = g.traceability();
  assert.strictEqual(t.untraceable.length, t.total - t.traceable);
  for (const key of t.untraceable) assert.ok(g.node(key), key);
  assert.strictEqual(t.complete, t.untraceable.length === 0);
  const blind = new EnterpriseGraph({ fitnessResults: [] });
  assert.strictEqual(blind.traceability().coverage, 0);
  assert.strictEqual(blind.traceability().complete, false);
});

test('traceability aggregates to the weakest kind, deterministically', () => {
  const g = graph();
  const t = g.traceability();
  const sorted = t.byKind.filter((b) => b.coverage !== null).sort((a, b) => a.coverage - b.coverage || a.kind.localeCompare(b.kind));
  assert.strictEqual(t.weakestKind.kind, sorted[0].kind);
  // Repeated builds pick the same weakest kind even when several tie at the same coverage.
  assert.strictEqual(graph().traceability().weakestKind.kind, t.weakestKind.kind);
  for (const b of t.byKind) assert.strictEqual(b.traceable + b.untraceable.length, b.total);
});

test('impact analysis answers both directions and states its limits', () => {
  const g = graph();
  const i = g.impactOf('bounded-context:identity-access');
  assert.strictEqual(i.known, true);
  assert.ok(i.dependents.length > 0);
  assert.ok(i.dependsOn.length > 0);
  assert.strictEqual(i.blastRadius, i.dependents.length);
  assert.match(i.caveat, /lower bound/);
  assert.strictEqual(i.authorizes, false);
  for (const d of i.dependents) assert.ok(d.depth > 0);
});

test('impact analysis respects its depth bound and refuses an unknown entity', () => {
  const g = graph();
  const deep = g.impactOf('bounded-context:identity-access', { maxDepth: 6 });
  const shallow = g.impactOf('bounded-context:identity-access', { maxDepth: 1 });
  assert.ok(shallow.dependents.every((d) => d.depth <= 1));
  assert.ok(shallow.dependents.length <= deep.dependents.length);
  const unknown = g.impactOf('bounded-context:atlantis');
  assert.strictEqual(unknown.known, false);
  assert.match(unknown.reason, /absence of a node is not absence of the thing/);
});

test('an obligation mapping to no control stays untraceable — the Part 19 gap, seen from the graph', () => {
  const g = new EnterpriseGraph({ fitnessResults: FITNESS, obligations: [{ id: 'unimplemented-act', mapsToControls: [] }] });
  const row = g.traceability().nodes.find((n) => n.node === 'compliance-obligation:unimplemented-act');
  assert.strictEqual(row.traceable, false);
  assert.ok(g.traceability().untraceable.includes('compliance-obligation:unimplemented-act'));
  // And an implemented one does trace, so the check can pass as well as fail.
  const ok = new EnterpriseGraph({ fitnessResults: FITNESS, obligations: [{ id: 'implemented-act', mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'] }] });
  assert.strictEqual(ok.traceability().nodes.find((n) => n.node === 'compliance-obligation:implemented-act').traceable, true);
});

test('the graph report carries stats, validation and traceability and authorizes nothing', () => {
  const rep = graph().report();
  assert.ok(rep.stats.nodes > 0 && rep.stats.edges > 0);
  assert.strictEqual(rep.validation.valid, true);
  assert.ok(rep.traceability.byKind.length);
  assert.strictEqual(rep.authorizes, false);
  assert.match(rep.note, /never maintained beside them/);
});
