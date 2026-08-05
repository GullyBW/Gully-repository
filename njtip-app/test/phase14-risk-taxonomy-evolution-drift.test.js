'use strict';
// Phase 14, Parts 6, 7, 8 & 11 — institutional risk prioritisation, decision evolution, drift
// classification and the eleven-category dependency taxonomy.
const test = require('node:test');
const assert = require('node:assert');
const ir = require('../src/governance/institutional-resilience');
const dp = require('../src/architecture/drift-prevention');
const asm = require('../src/architecture/assumptions');
const { DecisionMemory, LINEAGE_STAGES } = require('../src/architecture/decision-memory');

const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

// --- Part 11: the dependency taxonomy ---------------------------------------------------------------

test('eleven dependency categories, and every kind belongs to exactly one', () => {
  assert.strictEqual(Object.keys(ir.DEPENDENCY_CATEGORIES).length, 11);
  for (const required of ['people', 'process', 'technology', 'data', 'knowledge', 'documentation', 'facilities', 'communications', 'suppliers', 'legal-authority', 'governance']) {
    assert.ok(ir.DEPENDENCY_CATEGORIES[required], required);
  }
  for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
    const owning = Object.entries(ir.DEPENDENCY_CATEGORIES).filter(([, c]) => c.kinds.includes(kind)).map(([id]) => id);
    assert.strictEqual(owning.length, 1, `${kind}: ${owning.join(', ')}`);
    assert.strictEqual(ir.categoryOfKind(kind), owning[0]);
  }
});

test('every dependency kind says whether anything would detect it breaking', () => {
  for (const [kind, spec] of Object.entries(ir.DEPENDENCY_KINDS)) {
    assert.notStrictEqual(spec.detectedBy, undefined, kind);
    assert.ok(spec.validatedBy, kind);
  }
  // At least one kind is honestly undetectable — a taxonomy where everything is detected is one
  // that has stopped looking.
  assert.ok(Object.values(ir.DEPENDENCY_KINDS).some((k) => k.detectedBy === null));
});

test('each capability is evaluated across all eleven categories, and an unassessed one is unvalidated', () => {
  const e = ir.evaluate({ controls: controlsAll() });
  for (const c of e.capabilities) {
    assert.strictEqual(c.categories.length, 11, c.capability);
    for (const cat of c.categories) {
      assert.strictEqual(cat.unassessed, false, `${c.capability}/${cat.category}`);
      assert.ok(cat.reason);
    }
  }
  assert.strictEqual(e.categoryCoverage.length, 11);
  // The taxonomy must be able to say both yes and no somewhere, or it is a constant.
  assert.ok(e.categoryCoverage.some((c) => c.validatedFor === c.of));
  assert.ok(e.categoryCoverage.some((c) => c.validatedFor < c.of));
});

test('data resilience distinguishes a reconstructible store from the only copy', () => {
  // A capability with a hash-chained ledger alongside its store can be rebuilt.
  assert.strictEqual(ir.dataResilience('evidence-custody').singleDependency, false);
  assert.match(ir.dataResilience('governance-decision-recording').reason, /reconstructible/);
});

test('the facilities assessment says out loud that it is a proxy', () => {
  const f = ir.facilityResilience('anonymous-reporting');
  assert.strictEqual(f.proxy, true);
  assert.match(f.reason, /never seen a building/);
  assert.strictEqual(ir.facilityResilience('anonymous-reporting', { regions: ['bw-central'] }).singleDependency, true);
});

test('an unknown legal authority is not a resilient one, and a constitutional mandate is', () => {
  assert.strictEqual(ir.legalAuthorityResilience('case-investigation').singleDependency, true);
  assert.match(ir.legalAuthorityResilience('case-investigation').reason, /UNKNOWN/);
  assert.strictEqual(ir.legalAuthorityResilience('anonymous-reporting').singleDependency, false);
  const two = ir.legalAuthorityResilience('case-investigation', {
    instruments: [{ id: 'a', contexts: ['investigation'] }, { id: 'b', contexts: ['investigation'] }],
  });
  assert.strictEqual(two.singleDependency, false);
});

test('knowledge needs both a validated person and a followable document', () => {
  const controls = controlsAll();
  const none = ir.knowledgeResilience('anonymous-reporting', { controls });
  assert.strictEqual(none.singleDependency, true);
  assert.strictEqual(none.documentValidated, true);
  assert.strictEqual(none.peopleValidated, false);
  assert.match(none.reason, /written down and nobody is currently validated/);
});

// --- Part 6: risk prioritisation ---------------------------------------------------------------------

test('six risk factors, each declaring whether it is derived or a declared prior', () => {
  assert.strictEqual(Object.keys(ir.RISK_FACTORS).length, 6);
  for (const [id, f] of Object.entries(ir.RISK_FACTORS)) {
    assert.ok(['derived', 'declared'].includes(f.basis), id);
    assert.ok(f.question.endsWith('?'), id);
    assert.ok(f.derivation, id);
  }
  // Both kinds present: all-derived would be a claim to measure the unmeasurable, all-declared
  // would be no evidence at all.
  assert.ok(Object.values(ir.RISK_FACTORS).some((f) => f.basis === 'derived'));
  assert.ok(Object.values(ir.RISK_FACTORS).some((f) => f.basis === 'declared'));
});

test('every declared prior states its reasoning for every dependency kind', () => {
  for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
    assert.ok(ir.KIND_LIKELIHOOD[kind], `likelihood: ${kind}`);
    assert.ok(ir.KIND_LIKELIHOOD[kind].why.length > 20, kind);
    assert.ok(ir.KIND_RECOVERY[kind], `recovery: ${kind}`);
    assert.ok(ir.KIND_RECOVERY[kind].why.length > 20, kind);
  }
});

test('detectability is derived and moves in both directions', () => {
  const controls = controlsAll();
  assert.strictEqual(ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls }).levels.detectability, 'detected');
  assert.strictEqual(ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls: [] }).levels.detectability, 'undetected');
  assert.strictEqual(
    ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'service', controls: [{ id: 'APP-FIT-CHAOS-DETECT-RECOVER', pass: false }] }).levels.detectability,
    'partially-detected',
  );
  // A kind nothing detects is undetected however green the estate is.
  assert.strictEqual(ir.scoreDependency({ capability: 'anonymous-reporting', kind: 'communication-channel', controls }).levels.detectability, 'undetected');
});

test('a constitutional dependency always ranks above a non-constitutional one', () => {
  const controls = controlsAll();
  const ranked = ir.riskPrioritisation(ir.evaluate({ controls }), { controls });
  assert.ok(ranked.count > 0);
  let seenNonConstitutional = false;
  for (const r of ranked.ranked) {
    if (!r.constitutional) seenNonConstitutional = true;
    else assert.strictEqual(seenNonConstitutional, false, `${r.capability}/${r.kind} ranked below a non-constitutional dependency`);
  }
  assert.ok(seenNonConstitutional, 'the rule was never exercised — every open dependency is constitutional');
  assert.match(ranked.method, /always rank first/);
});

test('remediation priorities name the action, the effort and who decides', () => {
  const controls = controlsAll();
  const ranked = ir.riskPrioritisation(ir.evaluate({ controls }), { controls });
  assert.ok(ranked.remediationPriorities.length);
  for (const p of ranked.remediationPriorities) {
    assert.ok(p.action && p.action !== 'Review this dependency.', p.kind);
    assert.ok(p.effort && p.decidedBy && p.why, p.kind);
  }
  assert.strictEqual(ranked.authorizes, false);
  assert.strictEqual(ranked.recommendationsOnly, true);
});

test('the ranking is deterministic and discloses that some factors are priors', () => {
  const controls = controlsAll();
  const e = ir.evaluate({ controls });
  const a = ir.riskPrioritisation(e, { controls }).ranked.map((r) => `${r.capability}/${r.kind}`);
  const b = ir.riskPrioritisation(e, { controls }).ranked.map((r) => `${r.capability}/${r.kind}`);
  assert.deepStrictEqual(a, b);
  assert.ok(ir.riskPrioritisation(e, { controls }).declaredFactorShare > 0);
});

// --- Part 7: decision evolution ----------------------------------------------------------------------

test('four new lineage stages exist, and reversal is not supersession', () => {
  for (const required of ['intent', 'unintended', 'abandoned', 'reversal']) assert.ok(LINEAGE_STAGES[required], required);
  assert.notStrictEqual(LINEAGE_STAGES.reversal, LINEAGE_STAGES.supersession);
  for (const [id, s] of Object.entries(LINEAGE_STAGES)) assert.ok(s.requires.length, id);
});

test('an intent recorded after the outcome is refused', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  m.record('ADR-0005', 'intent', { by: 'ARB', at: 1, predictions: [{ subject: 'latency', expectation: 'falls' }] });
  m.record('ADR-0005', 'outcome', { by: 'Assurance', at: 2, verdict: 'as-predicted', evidence: ['APP-FIT-AUTHZ-CACHE-SAFETY'] });
  assert.throws(
    () => m.record('ADR-0005', 'intent', { by: 'ARB', at: 3, predictions: [{ subject: 'x', expectation: 'we meant that' }] }),
    (e) => e.failClosed === true && /not a prediction/.test(e.message),
  );
});

test('a consequence that was predicted at decision time is reclassified, not filed as unforeseen', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  m.record('ADR-0005', 'intent', { by: 'ARB', at: 1, predictions: [{ subject: 'latency', expectation: 'falls below 5ms' }] });
  m.record('ADR-0005', 'unintended', { by: 'SRE', at: 2, subject: 'cache-replay', consequence: 'replay across tenants', discoveredBy: 'CI' });
  m.record('ADR-0005', 'unintended', { by: 'Optimist', at: 3, subject: 'latency', consequence: 'latency changed', discoveredBy: 'observation' });

  const l = m.lineage('ADR-0005');
  assert.deepStrictEqual(l.genuinelyUnintended, ['replay across tenants']);
  assert.strictEqual(l.misfiledAsUnintended.length, 1);
  assert.strictEqual(l.misfiledAsUnintended[0].wasPredictedBy, 'ARB');
  assert.ok(l.gaps.some((g) => /was predicted at decision time/.test(g)));
});

test('a reversal and a supersession produce different histories', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  m.record('ADR-0005', 'reversal', { by: 'ARB', at: 1, reversedBy: 'ADR-0007', reason: 'withdrawn' });
  m.record('ADR-0004', 'supersession', { by: 'ARB', at: 1, adr: 'ADR-0007' });
  assert.deepStrictEqual(m.evolution('ADR-0005').branches.reversed, ['ADR-0007']);
  assert.deepStrictEqual(m.evolution('ADR-0005').branches.superseded, []);
  assert.deepStrictEqual(m.evolution('ADR-0004').branches.superseded, ['ADR-0007']);
  assert.deepStrictEqual(m.evolution('ADR-0004').branches.reversed, []);
  assert.match(m.evolution('ADR-0005').note, /REVERSED, not superseded/);
  // A reversal must cite a decision somebody actually took.
  assert.throws(() => m.record('ADR-0004', 'reversal', { by: 'ARB', at: 2, reversedBy: 'ADR-9999', reason: 'r' }), /does not exist/);
});

test('a decision that was reversed with no lesson recorded is flagged', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  m.record('ADR-0005', 'reversal', { by: 'ARB', at: 1, reversedBy: 'ADR-0007', reason: 'withdrawn' });
  assert.strictEqual(m.evolution('ADR-0005').costWithoutLearning, true);
  m.record('ADR-0005', 'lesson', { by: 'ARB', at: 2, statement: 'a cache keyed without the tenant is a channel' });
  assert.strictEqual(m.evolution('ADR-0005').costWithoutLearning, false);
});

test('an abandoned approach is kept, with why it was dropped', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  assert.throws(() => m.record('ADR-0004', 'abandoned', { by: 'ARB', at: 1, approach: 'a shared cache' }), /requires 'whyNot'/);
  m.record('ADR-0004', 'abandoned', { by: 'ARB', at: 1, approach: 'a shared cache', whyNot: 'no way to bound cross-tenant visibility' });
  assert.deepStrictEqual(m.evolution('ADR-0004').branches.abandoned, ['a shared cache']);
});

test('the evolution timeline is chronological and every event is attributed', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  m.record('ADR-0005', 'intent', { by: 'ARB', at: 1, predictions: [{ subject: 'latency', expectation: 'falls' }] });
  m.record('ADR-0005', 'implementation', { by: 'Eng', at: 2, modules: ['src/authz.js'] });
  m.record('ADR-0005', 'outcome', { by: 'Assurance', at: 3, verdict: 'mixed', evidence: ['APP-FIT-AUTHZ-CACHE-SAFETY'] });
  m.record('ADR-0005', 'lesson', { by: 'ARB', at: 4, statement: 'measure before caching' });
  const evo = m.evolution('ADR-0005', { controls: [{ id: 'APP-FIT-AUTHZ-CACHE-SAFETY', pass: true }] });
  assert.strictEqual(evo.events.length, 4);
  for (let i = 1; i < evo.events.length; i++) assert.ok(evo.events[i].at >= evo.events[i - 1].at);
  for (const e of evo.events) assert.ok(e.by && e.what);
  assert.strictEqual(evo.predictionAccuracy, 'mixed');
  assert.strictEqual(evo.authorizes, false);
});

test('a decision with no recorded intent is named, not assumed to have had one', () => {
  const m = new DecisionMemory({ clock: () => 0 });
  const r = m.report({ controls: [] });
  assert.ok(r.unpredicted.length > 0);
  assert.ok(m.lineage('ADR-0001').gaps.some((g) => /no intended outcome recorded/.test(g)));
});

// --- Part 8: drift classification --------------------------------------------------------------------

test('eight drift classifications, each with its own routing and consequence', () => {
  assert.strictEqual(Object.keys(dp.DRIFT_CLASSES).length, 8);
  for (const required of ['architectural', 'documentation', 'ownership', 'governance', 'dependency', 'runtime', 'security', 'policy']) {
    assert.ok(dp.DRIFT_CLASSES[required], required);
  }
  for (const [id, c] of Object.entries(dp.DRIFT_CLASSES)) {
    assert.ok(c.respondsBy, id);
    assert.strictEqual(typeof c.blocksBuild, 'boolean', id);
    assert.ok(c.within && c.response && c.ifIgnored, id);
  }
});

test('no two classifications produce the same governance response', () => {
  assert.strictEqual(dp.assertDistinctResponses().distinct, true);
  // …and the check can fail, so it is not a tautology.
  const collided = dp.assertDistinctResponses({
    a: { respondsBy: 'ARB', blocksBuild: true, within: 'now', response: 'fix it' },
    b: { respondsBy: 'ARB', blocksBuild: true, within: 'now', response: 'fix it' },
  });
  assert.strictEqual(collided.distinct, false);
  assert.strictEqual(collided.collisions.length, 1);
});

test('classification actually routes: several authorities, and blocking is not uniform', () => {
  const authorities = new Set(Object.values(dp.DRIFT_CLASSES).map((c) => c.respondsBy));
  assert.ok(authorities.size >= 4, [...authorities].join(', '));
  const blocking = Object.values(dp.DRIFT_CLASSES).filter((c) => c.blocksBuild).length;
  assert.ok(blocking > 0 && blocking < Object.keys(dp.DRIFT_CLASSES).length);
});

test('every finding carries a classification and the response it triggers', () => {
  const registry = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  const drift = dp.detect({ controls: controlsAll(), assumptions: registry });
  assert.deepStrictEqual(drift.unclassified, []);
  for (const f of drift.findings) {
    assert.ok(f.classification, `${f.kind}/${f.subject}`);
    assert.ok(f.respondsBy, `${f.kind}/${f.subject}`);
    assert.strictEqual(typeof f.blocksBuild, 'boolean');
  }
  assert.strictEqual(drift.byClass.length, 8);
  assert.strictEqual(drift.clean, true);
});

test('a threat whose treating control failed produces security drift, routed to the ISRB', () => {
  const threatModel = require('../src/security/threat-model');
  const one = threatModel.traceability()[0].controls[0].control;
  const drift = dp.detect({
    controls: controlsAll().map((c) => (c.id === one ? { ...c, pass: false } : c)),
    checkDocumentation: false,
  });
  const security = drift.findings.filter((f) => f.kind === 'security');
  assert.ok(security.length, 'no security drift was reported for a failing treatment');
  assert.ok(security.some((f) => f.subject.includes(one)));
  for (const f of security) assert.strictEqual(f.respondsBy, 'Information Security Review Board');
  assert.strictEqual(dp.DRIFT_CLASSES.security.blocksBuild, true);
});

test('a treatment naming a control the suite does not contain is unrealised security drift', () => {
  const threatModel = require('../src/security/threat-model');
  const one = threatModel.traceability()[0].controls[0].control;
  const drift = dp.detect({ controls: controlsAll().filter((c) => c.id !== one), checkDocumentation: false });
  assert.ok(drift.findings.some((f) => f.kind === 'security' && f.direction === 'unrealised'));
});
