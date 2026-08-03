'use strict';
// Phase 12, Parts 17 & 18 — the Digital Twin of Operations, and predictive mission impact analysis.
const test = require('node:test');
const assert = require('node:assert');
const { OperationsTwin, ENTITY_KINDS, SCENARIOS, buildModel } = require('../src/twin2/operations-twin');
const contextMap = require('../src/architecture/context-map');
const bus = require('../src/observability/business');

const twin = () => new OperationsTwin({ evidenceIds: ['APP-FIT-OPERATIONS-TWIN'] });

// --- Part 17: the Digital Twin of Operations ------------------------------------------------------

test('every entity kind says where it is read from', () => {
  for (const [kind, spec] of Object.entries(ENTITY_KINDS)) {
    assert.ok(spec.source, `${kind} has no source`);
    assert.ok(spec.describes, `${kind} does not say what it describes`);
  }
  const t = twin();
  for (const kind of Object.keys(ENTITY_KINDS)) {
    assert.ok(t.model().byKind[kind] > 0, `no '${kind}' entities are modelled`);
  }
});

test('the twin matches the architecture-of-record in both directions', () => {
  const t = twin();
  const v = t.validate();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  const modelled = t.entities('bounded-context').map((e) => e.id).sort();
  assert.deepStrictEqual(modelled, [...contextMap.ids()].sort());
});

test('the model is a function of the registries, not of history', () => {
  assert.strictEqual(twin().digest(), twin().digest());
  assert.strictEqual(buildModel({ evidenceIds: ['A'] }).digest, buildModel({ evidenceIds: ['A'] }).digest);
  // Different evidence produces a different model — the digest is not a constant.
  assert.notStrictEqual(buildModel({ evidenceIds: ['A'] }).digest, buildModel({ evidenceIds: ['A', 'B'] }).digest);
});

test('the baseline model is frozen and model() hands out a copy', () => {
  const t = twin();
  const snapshot = t.model();
  snapshot.entities.push({ kind: 'service', id: 'injected-by-a-caller' });
  snapshot.regions.push('mars-1');
  assert.strictEqual(t.model().entities.length, snapshot.entities.length - 1);
  assert.strictEqual(t.model().regions.includes('mars-1'), false);
  assert.strictEqual(t.verifyIsolation().frozen, true);
  assert.strictEqual(t.verifyIsolation().unchanged, true);
});

test('every scenario states what it perturbs and what question it answers', () => {
  const t = twin();
  for (const [id, spec] of Object.entries(SCENARIOS)) {
    assert.ok(spec.perturbs, id);
    assert.ok(spec.question && spec.question.endsWith('?'), id);
  }
  assert.strictEqual(t.scenarios().length, Object.keys(SCENARIOS).length);
  assert.throws(() => t.simulate({ scenario: 'improvise' }), /unknown scenario/);
});

test('a simulation never touches the baseline, and the property is verified after every run', () => {
  const t = twin();
  const before = t.digest();
  const runs = [
    t.simulate({ scenario: 'infrastructure-change', change: { zones: ['independent'] } }),
    t.simulate({ scenario: 'operational-failure', change: { failed: ['kms'] } }),
    t.simulate({ scenario: 'dr-exercise', change: { failedRegions: ['bw-south', 'bw-north'] } }),
  ];
  for (const r of runs) {
    assert.strictEqual(r.isolation.unchanged, true, r.scenario);
    assert.strictEqual(r.isolation.frozen, true, r.scenario);
    assert.strictEqual(r.isolation.baselineDigest, before);
    assert.strictEqual(r.authorizes, false);
  }
  assert.strictEqual(t.digest(), before);
  assert.strictEqual(t.model().entities.length, twin().model().entities.length);
});

test('withdrawing the independent zone names the constitutional services it takes with it', () => {
  const r = twin().simulate({ scenario: 'infrastructure-change', change: { zones: ['independent'] } });
  assert.strictEqual(r.safe, false);
  assert.ok(r.findings.some((f) => f.entity === 'intake-api' && /withdrawn zone/.test(f.finding)));
  assert.ok(r.blocking.some((f) => f.entity === 'intake-api'));
  assert.ok(r.removedEntities.includes('zone:independent'));
  const unknownZone = twin().simulate({ scenario: 'infrastructure-change', change: { zones: ['atlantis'] } });
  assert.ok(unknownZone.blocking.some((f) => /no such deployment zone/.test(f.finding)));
});

test('an operational failure propagates through declared dependencies and says it is a lower bound', () => {
  const r = twin().simulate({ scenario: 'operational-failure', change: { failed: ['kms'] } });
  assert.ok(r.blastRadius.impacted.includes('evidence-store'));
  assert.match(r.blastRadius.caveat, /lower bound/);
  assert.strictEqual(r.blastRadius.basis, 'declared dependencies in the architecture-of-record');
  const ghost = twin().simulate({ scenario: 'operational-failure', change: { failed: ['not-a-service'] } });
  assert.ok(ghost.findings.some((f) => /not modelled/.test(f.finding)));
});

test('weakening a consistency stance without an ADR is a blocking finding', () => {
  const r = twin().simulate({ scenario: 'policy-update', change: { policies: { investigation: 'eventual' } } });
  assert.strictEqual(r.safe, false);
  const weakening = r.findings.find((f) => f.weakening);
  assert.ok(weakening);
  assert.match(weakening.finding, /read-your-writes → eventual/);
  assert.match(weakening.finding, /WEAKENING/);
  assert.ok(r.blocking.some((f) => /cites no ADR/.test(f.finding)));
  // With an ADR cited, the weakening is still reported but no longer blocks on attribution.
  const withAdr = twin().simulate({ scenario: 'policy-update', change: { policies: { investigation: 'eventual' }, adr: 'ADR-0008' } });
  assert.ok(withAdr.findings.some((f) => f.weakening));
  assert.strictEqual(withAdr.blocking.length, 0);
  // An unknown model or context is named rather than silently applied.
  const nonsense = twin().simulate({ scenario: 'policy-update', change: { policies: { investigation: 'vibes', 'not-a-context': 'strong' }, adr: 'ADR-0008' } });
  assert.ok(nonsense.findings.some((f) => /is not a declared consistency model/.test(f.finding)));
  assert.ok(nonsense.findings.some((f) => /no consistency stance is declared/.test(f.finding)));
});

test('vacating an accountable authority leaves something unowned, and says which', () => {
  const r = twin().simulate({ scenario: 'governance-change', change: { vacated: ['identity-access'] } });
  assert.strictEqual(r.safe, false);
  assert.ok(r.blocking.some((f) => /no accountable authority/.test(f.finding)));
  assert.ok(r.removedEntities.includes('gov:identity-access'));
  const unreal = twin().simulate({ scenario: 'governance-change', change: { vacated: ['ministry-of-magic'] } });
  assert.ok(unreal.blocking.some((f) => /not a governed subsystem/.test(f.finding)));
});

test('a migration plan names what has to move with the thing being moved', () => {
  const r = twin().simulate({ scenario: 'migration-plan', change: { contexts: ['custody'] } });
  assert.ok(r.findings.some((f) => /moves from zone|unstated zone/.test(f.finding)));
  assert.strictEqual(r.safe, false);                       // no target zone stated
  const dependents = r.findings.filter((f) => /is not in the migration set/.test(f.finding));
  assert.ok(dependents.length > 0, 'nothing was reported as depending on the moving context');
  const unmodelled = twin().simulate({ scenario: 'migration-plan', change: { contexts: ['imaginary-context'], toZone: 'executive' } });
  assert.ok(unmodelled.blocking.some((f) => /not modelled/.test(f.finding)));
});

test('a DR exercise reports what refuses rather than what degrades quietly', () => {
  const healthy = twin().simulate({ scenario: 'dr-exercise', change: { failedRegions: [] } });
  assert.strictEqual(healthy.safe, true);
  const lost = twin().simulate({ scenario: 'dr-exercise', change: { failedRegions: ['bw-south', 'bw-north'] } });
  assert.strictEqual(lost.safe, false);
  assert.ok(lost.findings.some((f) => /unavailable/.test(f.finding)));
  assert.ok(lost.removedEntities.includes('region:bw-south'));
  assert.strictEqual(lost.isolation.unchanged, true);
});

test('the twin report runs a scenario set and still authorizes nothing', () => {
  const t = twin();
  const rep = t.report({ scenarios: [{ scenario: 'operational-failure', change: { failed: ['kms'] } }] });
  assert.strictEqual(rep.validation.valid, true);
  assert.strictEqual(rep.simulations.length, 1);
  assert.strictEqual(rep.isolation.unchanged, true);
  assert.strictEqual(rep.authorizes, false);
  assert.match(rep.note, /never maintained beside it/);
  assert.strictEqual(t.history().length, 1);
});

// --- Part 18: predictive mission impact analysis --------------------------------------------------

test('the mission impact chain has all six stages, joined end to end', () => {
  assert.deepStrictEqual(bus.MISSION_IMPACT_LAYERS, [
    'technical-event', 'business-process', 'justice-service', 'citizen-impact', 'mission-objective', 'strategic-goal',
  ]);
  const v = bus.validateMissionChain();
  assert.strictEqual(v.valid, true, v.violations.join('; '));
  for (const l of bus.missionImpactLinks()) {
    assert.ok(l.mechanism, `${l.from} → ${l.to}`);
    assert.ok(bus.MISSION_IMPACT_LAYERS.indexOf(l.toLayer) > bus.MISSION_IMPACT_LAYERS.indexOf(l.fromLayer));
  }
});

test('a citizen impact is stated in the citizen\'s words, with a declared severity', () => {
  for (const c of bus.citizenImpacts()) {
    assert.ok(c.experience, c.id);
    assert.doesNotMatch(c.experience, /api|endpoint|latency|store\b/i, c.id);
    assert.ok(bus.CITIZEN_IMPACT_SEVERITY.includes(c.severity), c.id);
    assert.strictEqual(typeof c.irreversible, 'boolean');
  }
  for (const s of bus.justiceServices()) {
    assert.ok(s.delivers, s.id);
    assert.ok(s.dependsOn.length, `${s.id} declares no technical dependency`);
  }
});

test('nothing is orphaned at either end of the chain', () => {
  for (const s of bus.justiceServices()) {
    assert.ok(bus.missionImpactLinks().some((l) => l.to === s.id), `${s.id} is reached by nothing`);
    assert.ok(bus.missionImpactLinks().some((l) => l.from === s.id), `${s.id} reaches nothing`);
  }
  for (const o of Object.keys(bus.MISSION_OUTCOMES)) {
    assert.ok(bus.missionImpactLinks().some((l) => l.from === o && l.toLayer === 'strategic-goal'), `${o} serves no strategic goal`);
  }
  for (const g of Object.keys(bus.STRATEGIC_GOALS)) {
    assert.ok(bus.missionImpactLinks().some((l) => l.to === g), `${g} is reached by nothing`);
  }
});

test('a technical event is forecast all the way to a strategic goal', () => {
  const f = bus.missionImpactForecast({ change: 'withdraw the intake store', failed: ['persistence-ind'] });
  assert.deepStrictEqual(f.undeliveredServices, ['anonymous-reporting']);
  assert.ok(f.citizenImpacts.some((c) => c.impact === 'cannot-report'));
  assert.ok(f.missionObjectives.some((o) => o.id === 'reports-can-be-filed'));
  assert.ok(f.strategicGoals.some((g) => g.id === 'rule-of-law'));
  assert.deepStrictEqual(f.constitutionalServicesLost, ['anonymous-reporting']);
  assert.strictEqual(f.safeToDeploy, false);
  assert.strictEqual(f.authorizes, false);
  assert.strictEqual(f.failClosed, true);
  // Every hop is traceable and states its mechanism, so a reader can disagree with any of them.
  assert.ok(f.paths.length > 0);
  for (const p of f.paths) assert.ok(p.mechanisms.length > 0, p.chain);
});

test('the board summary speaks in the citizen\'s language, not the platform\'s', () => {
  const f = bus.missionImpactForecast({ change: 'withdraw the intake store', failed: ['persistence-ind'] });
  const summary = f.boardSummary.replace(/^[^:]*:/, '');
  assert.match(summary, /A person who decided today to report corruption cannot/);
  assert.doesNotMatch(summary, /persistence-|intake-api|kms/i);
  assert.match(summary, /irreversible/);
});

test('impact aggregates to the worst harm, not the average of several', () => {
  const f = bus.missionImpactForecast({ change: 'total loss', failed: ['persistence-ind', 'kms', 'persistence-exec', 'persistence-jud'] });
  assert.strictEqual(f.worstCitizenImpact.severity, 'severe');
  assert.ok(f.citizenImpacts.length > 1);
  // The list is ordered by severity, worst first.
  const ranks = f.citizenImpacts.map((c) => bus.CITIZEN_IMPACT_SEVERITY.indexOf(c.severity));
  assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(f.irreversibleImpacts.length > 0);
});

test('a service is not delivered when any component it needs is down', () => {
  const kms = bus.missionImpactForecast({ change: 'kms outage', failed: ['kms'] });
  assert.ok(kms.undeliveredServices.includes('evidence-custody'));
  const custody = kms.justiceServices.find((s) => s.service === 'evidence-custody');
  assert.strictEqual(custody.state, 'not-delivered');
  assert.ok(custody.missingComponents.includes('kms'));
  assert.ok(kms.citizenImpacts.some((c) => c.impact === 'evidence-unusable'));
});

test('an unmapped affected component reports unknown, never no-impact', () => {
  const orphan = bus.missionImpactForecast({ change: 'withdraw the executive broker', failed: ['broker-exec'] });
  assert.deepStrictEqual(orphan.citizenImpacts, []);
  assert.ok(orphan.unmappedComponents.includes('broker-exec'));
  assert.strictEqual(orphan.coverage.complete, false);
  assert.strictEqual(orphan.safeToDeploy, false);
  assert.match(orphan.boardSummary, /unknown, not nil/);
  assert.match(orphan.coverage.caveat, /UNKNOWN rather than absent/);
});

test('a component the topology has never heard of is reported as unmodelled', () => {
  const ghost = bus.missionImpactForecast({ change: 'ship something new', failed: ['new-search-index'] });
  assert.deepStrictEqual(ghost.unmodelledComponents, ['new-search-index']);
  assert.ok(ghost.unmappedComponents.includes('new-search-index'));
  assert.strictEqual(ghost.safeToDeploy, false);
});

test('a change affecting nothing is reported safe, so the gate can pass as well as block', () => {
  const none = bus.missionImpactForecast({ change: 'documentation only', failed: [] });
  assert.strictEqual(none.safeToDeploy, true);
  assert.deepStrictEqual(none.citizenImpacts, []);
  assert.deepStrictEqual(none.unmappedComponents, []);
  assert.strictEqual(none.worstCitizenImpact, null);
  assert.match(none.boardSummary, /no declared justice service is affected/);
  // Even a safe forecast authorizes nothing.
  assert.strictEqual(none.authorizes, false);
});

test('traceToStrategic walks the whole chain from a justice service', () => {
  const paths = bus.traceToStrategic('anonymous-reporting');
  assert.ok(paths.length > 0);
  for (const p of paths) {
    assert.strictEqual(p[p.length - 1].toLayer, 'strategic-goal');
    for (const l of p) assert.ok(l.mechanism);
  }
  assert.deepStrictEqual(bus.traceToStrategic('rule-of-law'), []);   // a terminal node goes nowhere
});
