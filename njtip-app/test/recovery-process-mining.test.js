'use strict';
// v1.7 Phase 54 (human-governed recovery) + Phase 56 (enterprise process mining).
const { test } = require('node:test');
const assert = require('node:assert');
const { RecoveryPlatform, seedPlaybooks } = require('../src/twin2/recovery');
const pm = require('../src/orchestration/process-mining');

test('recovery: recommends, requires human authorization, never auto-executes', () => {
  const rp = seedPlaybooks(new RecoveryPlatform({ clock: () => 1 }));
  assert.ok(rp.playbooks().length >= 3);
  const rec = rp.recommend({ incidentType: 'cyber-incident' });
  assert.strictEqual(rec.advisoryOnly, true);
  assert.strictEqual(rec.requiresHumanAuthorization, true);
  // Execution before authorization is refused (fail-closed).
  assert.throws(() => rp.execute(rec.id), /no human authorization/);
  // Authorization requires a named human + rationale.
  assert.throws(() => rp.authorize(rec.id, { by: 'x' }), /rationale/);
  rp.authorize(rec.id, { by: 'IR-lead', rationale: 'confirmed incident' });
  const ex = rp.execute(rec.id);
  assert.strictEqual(ex.executed, true);
  assert.ok(/no production change/.test(ex.note));
  // Unknown incident → no playbook, human triage.
  assert.strictEqual(rp.recommend({ incidentType: 'meteor' }).plan, null);
  // Audit trail records the lifecycle.
  assert.ok(rp.auditTrail().some((a) => a.event === 'authorized'));
});

test('recovery simulation validates projected resilience (advisory)', () => {
  const rp = seedPlaybooks(new RecoveryPlatform());
  const rec = rp.recommend({ incidentType: 'surge' });
  const sim = rp.simulate(rec.id);
  assert.strictEqual(typeof sim.projectedResilience, 'boolean');
  assert.ok(/human authorization/.test(sim.note));
});

test('process mining: discovery, conformance, bottlenecks, SLA deviations, performance', () => {
  const events = [
    { streamId: 'NJ-1', type: 'CaseSubmitted', meta: { at: 0, actor: 'system' } },
    { streamId: 'NJ-1', type: 'EvidenceAttached', meta: { at: 5, actor: 'citizen(anon)' } },
    { streamId: 'NJ-1', type: 'CaseReviewed', meta: { at: 100, actor: 'inv-001' } },
    { streamId: 'NJ-1', type: 'CaseTransitioned', meta: { at: 120, actor: 'inv-001' } },
    { streamId: 'NJ-2', type: 'CaseSubmitted', meta: { at: 0, actor: 'system' } },
    { streamId: 'NJ-2', type: 'CaseReviewed', meta: { at: 5, actor: 'inv-002' } },
  ];
  const d = pm.discover(events);
  assert.strictEqual(d.cases, 2);
  assert.strictEqual(d.edges['CaseSubmitted->EvidenceAttached'], 1);
  assert.strictEqual(d.edges['CaseSubmitted->CaseReviewed'], 1);
  // Bottleneck = the slowest transition (EvidenceAttached->CaseReviewed, 95ms).
  assert.strictEqual(pm.bottlenecks(events).slowest[0].edge, 'EvidenceAttached->CaseReviewed');
  // Conformance vs a reference event edge set.
  const conf = pm.conformance(events, { allowedEventEdges: ['CaseSubmitted->CaseReviewed', 'CaseReviewed->CaseTransitioned'] });
  assert.ok(conf.fitness < 1 && conf.nonConforming.length >= 1);
  // SLA deviations (cycle > 50ms → NJ-1).
  assert.strictEqual(pm.slaDeviations(events, { thresholdMs: 50 }).deviations, 1);
  // Performance + org flow.
  assert.strictEqual(pm.performance(events).completed, 1);
  assert.ok(pm.orgFlow(events).byActor['inv-001'] >= 1);
});
