'use strict';
// Phase 11, Parts 10, 11 & 12 — multi-region consistency governance, ADR governance evolution,
// and consumer impact analysis.
const test = require('node:test');
const assert = require('node:assert');
const mr = require('../src/twin2/multi-region');
const adr = require('../src/architecture/adr-governance');
const ctxMap = require('../src/architecture/context-map');
const { ConsumerContracts, CRITICALITY_WEIGHT } = require('../src/contracts/consumer-contracts');
const { ContractRegistry } = require('../src/contracts/integration-contracts');

// --- Part 10: consistency governance -------------------------------------------------------------

test('consistency: every declared stance is complete, coherent and owned by a real context', () => {
  const res = mr.validateConsistency({ contextIds: ctxMap.ids() });
  assert.deepStrictEqual(res.violations, []);
  assert.ok(res.contexts >= 15);
  for (const c of mr.contextConsistency()) {
    assert.ok(c.declared, c.context);
    assert.ok(c.rationale, `${c.context}: no rationale`);
    assert.ok(c.conflictDescription, `${c.context}: conflict resolution undescribed`);
    assert.ok(ctxMap.ids().includes(c.context), `${c.context} is not a bounded context`);
  }
});

test('consistency: constitutional contexts are strongly consistent and refuse stale reads', () => {
  for (const id of ['intake', 'custody', 'governance-oversight', 'identity-access', 'policy-governance']) {
    const c = mr.contextConsistency(id);
    assert.strictEqual(c.model, 'strong', id);
    assert.strictEqual(c.staleReadsAcceptable, false, id);
  }
  assert.strictEqual(mr.CONSISTENCY_MODELS.strong.maxStalenessMs, 0);
  assert.strictEqual(mr.CONSISTENCY_MODELS.strong.readsFromReplica, false);
  assert.ok(mr.CONSISTENCY_MODELS.causal.maxStalenessMs < mr.CONSISTENCY_MODELS.eventual.maxStalenessMs);
});

test('consistency: a read outside the declared model is refused, not served', () => {
  assert.strictEqual(mr.readAllowed({ context: 'intake', replicaLagMs: 500, hasQuorum: true }).allowed, false);
  assert.strictEqual(mr.readAllowed({ context: 'intake', replicaLagMs: 0, hasQuorum: false }).allowed, false);
  assert.strictEqual(mr.readAllowed({ context: 'intake', replicaLagMs: 0, hasQuorum: true }).allowed, true);
  assert.strictEqual(mr.readAllowed({ context: 'analytics', replicaLagMs: 30_000 }).allowed, true);
  assert.strictEqual(mr.readAllowed({ context: 'analytics', replicaLagMs: 90_000 }).allowed, false);
  assert.strictEqual(mr.readAllowed({ context: 'investigation', replicaLagMs: 30_000 }).allowed, false);
});

test('consistency: an undeclared context fails closed rather than defaulting to permissive', () => {
  const r = mr.readAllowed({ context: 'not-a-context' });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.failClosed, true);
  assert.match(r.reason, /no consistency stance declared/);
});

test('consistency: the posture names exactly which reads a lagging region may not serve', () => {
  const p = mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 97 }, healthy: ['bw-central', 'bw-south', 'bw-north'] });
  assert.strictEqual(p.writesAvailable, true);
  assert.ok(p.refusedReads.length > 0);
  assert.ok(p.refusedReads.some((r) => r.startsWith('custody@bw-north')));
  assert.ok(!p.matrix.some((r) => r.region === 'bw-central' && r.lag === 0 && !r.readAllowed));
  assert.strictEqual(p.failClosed, true);
  assert.strictEqual(p.authorizes, false);
  assert.deepStrictEqual(mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100 }, healthy: ['bw-central'] }), mr.consistencyPosture({ committedSequence: 100, replicas: { 'bw-central': 100 }, healthy: ['bw-central'] }));
});

test('consistency governance is part of multi-region validation', () => {
  assert.strictEqual(mr.validate().valid, true, mr.validate().violations.join('; '));
  assert.ok(mr.validate().consistencyContexts > 0);
});

// --- Part 11: ADR governance evolution ------------------------------------------------------------

test('ADR: the extended schema carries all eight Part 11 fields, each with a stated reason', () => {
  const fields = adr.schema().extended.map((s) => s.field);
  for (const f of ['rejectedAlternatives', 'architecturalTradeoffs', 'maintenanceImpact', 'implementationComplexity', 'operationalCost', 'lifecycleImplications', 'measurableSuccessCriteria', 'architecturalDebt']) {
    assert.ok(fields.includes(f), f);
  }
  for (const s of adr.schema().extended) assert.ok(s.why, s.field);
});

test('ADR: each ADR is held to the schema in force when it was written', () => {
  assert.strictEqual(adr.schemaNameFor(1), 'legacy');
  assert.strictEqual(adr.schemaNameFor(4), 'full');
  assert.strictEqual(adr.schemaNameFor(6), 'extended');
  assert.strictEqual(adr.schemaFor(3).length, adr.LEGACY_SCHEMA.length);
  assert.strictEqual(adr.schemaFor(6).length, adr.LEGACY_SCHEMA.length + adr.FULL_SCHEMA.length + adr.EXTENDED_SCHEMA.length);
  const res = adr.validateCatalogue();
  assert.strictEqual(res.valid, true, res.violations.join('; '));
  assert.strictEqual(res.bySchema.legacy, 3, 'legacy ADRs must not be retrofitted');
  assert.ok(res.bySchema.extended >= 1);
});

test('ADR: an unmeasurable success criterion fails validation', () => {
  // Validated in memory: writing a probe into the real catalogue would make this test a source of
  // non-determinism for every other process reading that directory.
  const filler = 'This section carries enough prose to clear the minimum-content threshold comfortably.';
  const craft = (criterion) => {
    let doc = '# ADR-0098: crafted probe\n\n- **Status:** Accepted\n\n';
    for (const s of adr.schemaFor(98)) {
      const isProbe = s.heading === 'Measurable success criteria';
      const other = adr.schema().measurableSections.includes(s.heading) ? `${filler} 108 invariants hold.` : filler;
      doc += `## ${s.heading}\n${isProbe ? criterion : other}\n\n`;
    }
    return doc;
  };
  const probe = (criterion) => adr.validateParsed(adr.parseText(craft(criterion), { file: '0098-probe.md', number: 98 }));
  const vague = probe('We will improve reliability and make everything better for everyone.');
  assert.strictEqual(vague.valid, false);
  assert.ok(vague.violations.some((x) => /no measurable value/.test(x)));
  const ok = probe('p95 latency under 500 ms across a 30-day window.');
  assert.strictEqual(ok.valid, true, ok.violations.join('; '));
  assert.strictEqual(ok.schema, 'extended');
});

test('ADR: lifecycle and architectural debt are queryable', () => {
  const lc = adr.lifecycle();
  assert.strictEqual(lc.total, adr.adrFiles().length);
  assert.ok(lc.active.length > 0);
  for (const s of lc.superseded) assert.notStrictEqual(s.by, null);
  const debt = adr.architecturalDebt();
  assert.ok(debt.entries.length > 0, 'no extended ADR records its architectural debt');
  assert.deepStrictEqual(debt.unassessed, []);
  for (const e of debt.entries) assert.ok(e.assessment.length >= 40);
});

test('ADR: the generated template covers every tier', () => {
  const tpl = adr.template({ number: '0099' });
  for (const s of [...adr.LEGACY_SCHEMA, ...adr.FULL_SCHEMA, ...adr.EXTENDED_SCHEMA]) {
    assert.ok(tpl.includes(`## ${s.heading}`), s.heading);
  }
});

// --- Part 12: consumer impact analysis -------------------------------------------------------------

const currentSpec = () => new ContractRegistry().current('api.reports.submit');

test('consumer impact: the score is weighted by whom the change breaks', () => {
  assert.ok(CRITICALITY_WEIGHT.constitutional > CRITICALITY_WEIGHT.critical);
  assert.ok(CRITICALITY_WEIGHT.critical > CRITICALITY_WEIGHT.important);
  const cc = new ConsumerContracts();
  const cur = currentSpec();
  const additive = cc.impactScore('api.reports.submit', { fields: { required: cur.fields.required, optional: [...cur.fields.optional, 'locale'] } });
  assert.strictEqual(additive.score, 0);
  assert.strictEqual(additive.band, 'none');
  const severe = cc.impactScore('api.reports.submit', { fields: { required: [], optional: [] } });
  assert.strictEqual(severe.safe, false);
  assert.strictEqual(severe.band, 'severe');
  assert.strictEqual(severe.constitutionalImpact, true);
  assert.match(severe.requiredAction, /major version/);
  const important = cc.impactScore('event.case.submitted', { fields: { required: [], optional: [] } });
  assert.ok(important.score < severe.score, 'breaking an important consumer must score below breaking the constitutional one');
});

test('consumer impact: the dependency visualization is consistent and deterministic', () => {
  const cc = new ConsumerContracts();
  const viz = cc.dependencyVisualization();
  assert.ok(viz.nodes.length > 0 && viz.edges.length > 0);
  for (const e of viz.edges) {
    assert.ok(viz.nodes.some((n) => n.id === e.from), e.from);
    assert.ok(viz.nodes.some((n) => n.id === e.to), e.to);
  }
  assert.match(viz.text, /citizen-web/);
  assert.deepStrictEqual(cc.dependencyVisualization(), viz);
});

test('consumer impact: compatibility is forecast cumulatively and names the first breaking step', () => {
  const cc = new ConsumerContracts();
  const cur = currentSpec();
  const safe = cc.compatibilityForecast({
    contract: 'api.reports.submit',
    steps: [
      { name: 'add locale', spec: { fields: { required: cur.fields.required, optional: [...cur.fields.optional, 'locale'] } } },
      { name: 'add channel', spec: { fields: { required: cur.fields.required, optional: [...cur.fields.optional, 'locale', 'channel'] } } },
    ],
  });
  assert.strictEqual(safe.cumulativeSafe, true);
  assert.strictEqual(safe.firstBreakingStep, null);

  const breaking = cc.compatibilityForecast({
    contract: 'api.reports.submit',
    steps: [
      { name: 'add locale', spec: { fields: { required: cur.fields.required, optional: [...cur.fields.optional, 'locale'] } } },
      { name: 'drop category', spec: { fields: { required: [], optional: ['locale'] } } },
    ],
  });
  assert.strictEqual(breaking.firstBreakingStep, 1);
  assert.strictEqual(breaking.safeThrough, 1);
  assert.match(breaking.recommendation, /major version/);
  assert.ok(breaking.steps[1].affected.length > 0);
});

test('consumer impact: adoption is observed, never assumed', () => {
  const cc = new ConsumerContracts();
  const cur = currentSpec();
  const before = cc.adoption('api.reports.submit');
  assert.strictEqual(before.coverage, 0);
  assert.strictEqual(before.fullyAdopted, false);
  assert.ok(before.unreported.includes('citizen-web'));
  cc.recordAdoption('citizen-web', 'api.reports.submit', { version: cur.version });
  const after = cc.adoption('api.reports.submit');
  assert.strictEqual(after.coverage, 1);
  assert.strictEqual(after.fullyAdopted, true);
  assert.throws(() => cc.recordAdoption('citizen-web', 'api.reports.submit', { version: 0 }), /integer contract version/);
  assert.throws(() => cc.recordAdoption('nobody', 'api.reports.submit', { version: 1 }), /unknown consumer/);
});

test('consumer impact: a deprecated contract past its sunset with live consumers is overdue', () => {
  const registry = new ContractRegistry();
  registry.deprecate('api.reports.submit', { sunsetAt: 1_000 });
  const cc = new ConsumerContracts({ registry });
  const a = cc.deprecationAnalytics({ now: 10_000_000 });
  assert.ok(a.deprecated.length > 0);
  assert.ok(a.overdue.includes('api.reports.submit'));
  assert.strictEqual(a.clean, false);
  assert.ok(a.totalBurden > 0);
});

test('consumer impact: migration readiness fails closed on an unreported consumer', () => {
  const cc = new ConsumerContracts();
  const spec = { fields: { required: [], optional: [] } };
  const notReady = cc.migrationReadiness({ contract: 'api.reports.submit', spec });
  assert.strictEqual(notReady.ready, false);
  assert.ok(notReady.blockedBy.includes('citizen-web'));
  assert.strictEqual(notReady.constitutionalBlocked, true);
  assert.strictEqual(notReady.failClosed, true);
  assert.strictEqual(notReady.authorizes, false);

  cc.recordAdoption('citizen-web', 'api.reports.submit', { version: currentSpec().version });
  const ready = cc.migrationReadiness({ contract: 'api.reports.submit', spec });
  assert.strictEqual(ready.ready, true);
  assert.strictEqual(ready.adoptionCoverage, 1);
});
