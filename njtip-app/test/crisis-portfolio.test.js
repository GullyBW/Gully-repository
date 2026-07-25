'use strict';
// v1.8 Phase 63 (national mission & crisis management) + Phase 64 (service portfolio).
const { test } = require('node:test');
const assert = require('node:assert');
const { NationalCrisisPlatform } = require('../src/twin2/crisis');
const { ServicePortfolio } = require('../src/portfolio/service-portfolio');

test('crisis: incident registry, multi-agency coordination, deterministic sim, human-authorised ops', () => {
  const cp = new NationalCrisisPlatform({ clock: () => 1 });
  assert.throws(() => cp.declare({ type: 'alien-invasion' }), /unknown incident type/);
  const inc = cp.declare({ type: 'natural-disaster', severity: 'severe', affectedAgencies: ['dcec'] });
  // Multi-agency coordination + resource coordination.
  cp.assignAgency(inc.id, { agency: 'ombudsman', role: 'lead' });
  cp.allocateResource(inc.id, { resource: 'field-teams', quantity: 5 });
  assert.strictEqual(cp.describe(inc.id).affectedAgencies.includes('ombudsman'), true);
  // Stage advancement.
  assert.strictEqual(cp.advance(inc.id).stage, 'coordinating');
  // Deterministic simulation + continuity plan.
  assert.deepStrictEqual(cp.simulate(inc.id), cp.simulate(inc.id));
  assert.ok(cp.continuityPlan(inc.id).essentialFunctions.includes('evidence-custody'));
  // Operational execution requires named human authorization (fail-closed).
  assert.throws(() => cp.executeOperation(inc.id), /no human authorization/);
  assert.throws(() => cp.authorizeOperation(inc.id, { by: 'x' }), /rationale/);
  cp.authorizeOperation(inc.id, { by: 'national-coordinator', rationale: 'severe disaster' });
  assert.ok(/no production action/.test(cp.executeOperation(inc.id).note));
  assert.ok(cp.auditTrail().some((a) => a.event === 'operation-authorized'));
});

test('service portfolio: lifecycle, maturity, dependency, health, strategic assessment, recommendations', () => {
  const sp = new ServicePortfolio({ clock: () => 1 });
  sp.register('reporting', { owner: 'independent', fundingPerYear: 500000, maturity: 'defined', strategicValue: 'high' });
  sp.register('legacy', { owner: 'ops', fundingPerYear: 100000, maturity: 'initial', strategicValue: 'low', dependsOn: ['reporting'] });
  assert.throws(() => sp.register('bad', { owner: 'o', maturity: 'wizard' }), /invalid maturity/);
  sp.transition('reporting', 'live'); sp.transition('legacy', 'live');
  sp.recordMetrics('reporting', { usage: 100000, incidents: 0 });
  sp.recordMetrics('legacy', { usage: 500, incidents: 6 });
  // Dependency + impact.
  assert.deepStrictEqual(sp.impact('reporting'), ['legacy']);
  // Health: legacy (initial + incidents) is worse than reporting.
  assert.ok(sp.health('reporting').health > sp.health('legacy').health);
  // Strategic assessment (efficiency).
  assert.ok(sp.strategicAssessment('reporting').efficiency > sp.strategicAssessment('legacy').efficiency);
  // Recommendations are advisory; flags the low-value at-risk service for retirement.
  const recs = sp.recommendations();
  assert.strictEqual(recs.advisoryOnly, true);
  assert.ok(recs.recommendations.some((r) => r.service === 'legacy' && r.action === 'plan-retirement'));
});
