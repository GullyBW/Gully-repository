'use strict';
// Stabilization Parts 7, 8, 9 & 10 — legislative impact analysis, recovery strategy
// evaluation, the National Data Exchange, and process governance mining.
const test = require('node:test');
const assert = require('node:assert');
const { LegislativeRegistry } = require('../src/legislation/registry');
const { LegislativeImpactAnalyzer } = require('../src/legislation/impact');
const { RecoveryStrategyEvaluator } = require('../src/twin2/recovery-strategies');
const { NationalDataExchange, PROHIBITED_PURPOSES, PERMITTED_PURPOSES } = require('../src/fabric/data-exchange');
const pg = require('../src/orchestration/process-governance');

function legislation() {
  const reg = new LegislativeRegistry({ clock: () => 0 });
  reg.register('dpa', { title: 'Data Protection Act', type: 'act', mapsToControls: ['FIT-IDENTITY-MINIMIZATION'], mapsToSystems: ['reporting'] });
  reg.register('reg-report', { title: 'Reporting Regulations', dependsOn: ['dpa'], mapsToControls: ['APP-FIT-ANONYMITY-BOUNDARY'], mapsToSystems: ['reporting', 'analytics'] });
  reg.register('reg-analytics', { title: 'Analytics Directive', dependsOn: ['reg-report'], mapsToControls: ['APP-FIT-ANALYTICS-PRIVACY'], mapsToSystems: ['analytics'] });
  return { reg, an: new LegislativeImpactAnalyzer(reg) };
}

// --- Part 7: legislative impact ---------------------------------------------------------

test('legislation: the regulatory dependency graph resolves transitively and is acyclic', () => {
  const { an } = legislation();
  assert.deepStrictEqual(an.descendants('dpa'), ['reg-analytics', 'reg-report']);
  assert.deepStrictEqual(an.ancestors('reg-analytics'), ['dpa', 'reg-report']);
  assert.deepStrictEqual(an.cycles(), []);
});

test('legislation: policy impact reaches transitive instruments, systems and controls', () => {
  const { an } = legislation();
  const impact = an.policyImpact('dpa');
  assert.ok(impact.affectedControls.includes('APP-FIT-ANALYTICS-PRIVACY'));
  assert.ok(impact.affectedSystems.includes('analytics'));
  assert.strictEqual(impact.advisoryOnly, true);
  assert.ok(impact.breadth >= 4);
});

test('legislation: service dependency map links systems to governing instruments', () => {
  const { an } = legislation();
  const map = an.serviceDependencyMap();
  assert.ok(map.reporting.some((r) => r.instrument === 'dpa'));
  assert.ok(map.analytics.length >= 2);
});

test('legislation: fitness impact separates unimplemented controls from failing ones', () => {
  const { an } = legislation();
  const fi = an.fitnessImpact('dpa', [{ id: 'FIT-IDENTITY-MINIMIZATION', pass: true }, { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: false }]);
  assert.deepStrictEqual(fi.failing, ['APP-FIT-ANONYMITY-BOUNDARY']);
  assert.deepStrictEqual(fi.unimplemented, ['APP-FIT-ANALYTICS-PRIVACY']);
});

test('legislation: version history is diffable and flags a weakening amendment', () => {
  const { reg, an } = legislation();
  reg.amend('dpa', { summary: 'narrow scope', mapsToControls: [] });
  const hist = an.versionHistory('dpa');
  assert.strictEqual(hist.versions.length, 2);
  assert.deepStrictEqual(hist.versions[1].diff.controlsRemoved, ['FIT-IDENTITY-MINIMIZATION']);
  assert.deepStrictEqual(hist.weakeningAmendments, [2]);
});

test('legislation: a change is simulatable, risk-banded, and never self-enacting', () => {
  const { reg, an } = legislation();
  const sim = an.simulateChange('reg-report', { proposedControls: [] });
  assert.strictEqual(sim.simulatable, true);
  assert.strictEqual(sim.enacts, false);
  assert.strictEqual(sim.risk.band, 'high');
  assert.ok(sim.risk.reasons.length >= 1);
  // A no-op change is low risk.
  assert.strictEqual(an.simulateChange('reg-analytics', {}).risk.band, 'low');
  // Enactment still requires a named human authority.
  assert.throws(() => reg.enact('dpa', {}), /named human authority/);
});

test('legislation: obsolete policy detection finds repealed-but-live instruments', () => {
  const { reg, an } = legislation();
  reg.repeal('reg-analytics', { by: 'Attorney General' });
  const obs = an.obsolete();
  assert.ok(obs.findings.some((f) => f.severity === 'high' && /repealed/.test(f.reason)));
  assert.strictEqual(obs.clean, false);
});

// --- Part 8: recovery strategies ----------------------------------------------------------

test('recovery: every strategy quantifies RTO, RPO, disruption, resources, integrity, continuity', () => {
  const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
  assert.ok(ev.catalogue().length >= 4);
  for (const s of ev.catalogue()) {
    for (const dim of ['rtoMinutes', 'rpoMinutes', 'operationalDisruption', 'resourceEfficiency', 'dataIntegrity', 'businessContinuity']) {
      assert.strictEqual(typeof s[dim], 'number', `${s.id}.${dim}`);
    }
    assert.ok(s.tradeoff.length > 20, `${s.id} trade-off`);
    assert.ok(s.prerequisites.length >= 1, `${s.id} prerequisites`);
  }
});

test('recovery: evaluation is deterministic, explainable and constraint-aware', () => {
  const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
  assert.deepStrictEqual(ev.evaluate({ incidentType: 'regional-outage' }), ev.evaluate({ incidentType: 'regional-outage' }));
  const constrained = ev.evaluate({ incidentType: 'regional-outage', constraints: { maxRtoMinutes: 60 } });
  assert.ok(constrained.strategies[0].meetsConstraints);
  const violating = constrained.strategies.filter((s) => !s.meetsConstraints);
  assert.ok(violating.length >= 1);
  assert.match(violating[0].violations[0], /RTO/);
  for (const s of constrained.strategies) assert.strictEqual(Object.keys(s.terms).length, 6);
});

test('recovery: comparison names the best strategy per dimension', () => {
  const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
  const cmp = ev.compare(['backup-restore', 'active-active', 'rebuild-from-events']);
  assert.strictEqual(cmp.bestBy.rto, 'active-active');
  assert.strictEqual(cmp.bestBy.rpo, 'active-active');
  assert.strictEqual(cmp.bestBy.dataIntegrity, 'rebuild-from-events');
});

test('recovery: a strategy is selected only after a named human authorizes it', () => {
  const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
  const rec = ev.recommend({ incidentType: 'cyber-incident' });
  assert.strictEqual(rec.advisoryOnly, true);
  assert.strictEqual(rec.requiresHumanAuthorization, true);
  assert.throws(() => ev.selected(rec.id), /human authorization required/);
  assert.throws(() => ev.authorize(rec.id, { by: 'ops' }), /named human authority and a rationale/);
  ev.authorize(rec.id, { by: 'National Disaster Management Office', rationale: 'containment before availability' });
  assert.strictEqual(ev.selected(rec.id).strategy, rec.recommended);
  assert.ok(ev.auditTrail().some((a) => a.event === 'authorized'));
});

test('recovery: an authority may authorize an alternative over the recommendation', () => {
  const ev = new RecoveryStrategyEvaluator({ clock: () => 0 });
  const rec = ev.recommend({ incidentType: 'regional-outage' });
  ev.authorize(rec.id, { by: 'Incident Commander', rationale: 'cost constraint', strategy: 'backup-restore' });
  assert.strictEqual(ev.selected(rec.id).strategy, 'backup-restore');
  assert.throws(() => ev.authorize(rec.id, { by: 'x', rationale: 'y', strategy: 'teleportation' }), /unknown recovery strategy/);
});

// --- Part 9: national data exchange -----------------------------------------------------------

test('exchange: the governance model states what it is and is not', () => {
  const x = new NationalDataExchange({ clock: () => 0 });
  const model = x.governanceModel();
  assert.strictEqual(model.capability, 'National Data Exchange');
  assert.match(model.formerly, /Marketplace/);
  assert.ok(model.isNot.includes('a commercial marketplace'));
  assert.ok(Object.keys(PERMITTED_PURPOSES).includes('inter-agency-exchange'));
  assert.ok(PROHIBITED_PURPOSES['commercial-exchange']);
});

test('exchange: purpose limitation is declared, enforced at request and at use', () => {
  const x = new NationalDataExchange({ clock: () => 0 });
  assert.throws(() => x.registerDataset('bad', { owner: 'a', permittedPurposes: ['commercial-exchange'] }), /prohibited/);
  assert.throws(() => x.registerDataset('none', { owner: 'a', permittedPurposes: [] }), /at least one permitted purpose/);
  assert.throws(() => x.registerDataset('pii', { owner: 'a', schemaFields: ['email'], permittedPurposes: ['analytics'] }), /identity fields/);
  x.registerDataset('ds', { owner: 'dcec', schemaFields: ['category', 'status'], permittedPurposes: ['analytics'], retentionDays: 30 });
  assert.throws(() => x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics', approver: 'a', justification: 'b' }), /not approved/);
  x.approveDataset('ds', { by: 'Data Steward', rationale: 'aggregate only' });
  assert.throws(() => x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'open-government-data' }), /does not permit the purpose/);
  assert.throws(() => x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics' }), /named human approver/);
  const ag = x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics', approver: 'DGB Chair', justification: 'national statistics' });
  assert.strictEqual(ag.purposeLimited, true);
  assert.strictEqual(x.checkUse({ agreementId: ag.id, purpose: 'inter-agency-exchange' }).permitted, false);
  assert.strictEqual(x.checkUse({ agreementId: ag.id, purpose: 'analytics' }).permitted, true);
});

test('exchange: retention bounds the agreement and revocation is a human act', () => {
  const x = new NationalDataExchange({ clock: () => 0 });
  x.registerDataset('ds', { owner: 'dcec', schemaFields: ['category'], permittedPurposes: ['analytics'], retentionDays: 1 });
  x.approveDataset('ds', { by: 'Steward', rationale: 'ok' });
  const ag = x.requestExchange({ datasetId: 'ds', consumer: 'stats', purpose: 'analytics', approver: 'DGB', justification: 'j' });
  const after = ag.expiresAt + 1;
  assert.strictEqual(x.checkUse({ agreementId: ag.id, purpose: 'analytics', now: after }).permitted, false);
  assert.strictEqual(x.retentionDue({ now: after }).length, 1);
  assert.throws(() => x.revoke(ag.id, { by: 'x' }), /named human and a reason/);
  x.revoke(ag.id, { by: 'Data Steward', reason: 'purpose fulfilled' });
  assert.strictEqual(x.checkUse({ agreementId: ag.id, purpose: 'analytics' }).permitted, false);
});

test('exchange: discovery is purpose-aware and the audit trail is unified', () => {
  const x = new NationalDataExchange({ clock: () => 0 });
  x.registerDataset('open', { owner: 'stats', classification: 'public', schemaFields: ['category'], permittedPurposes: ['open-government-data'], tags: ['transparency'] });
  x.registerDataset('internal', { owner: 'dcec', classification: 'internal', schemaFields: ['status'], permittedPurposes: ['analytics'] });
  x.approveDataset('open', { by: 'Steward', rationale: 'public' });
  x.approveDataset('internal', { by: 'Steward', rationale: 'internal' });
  assert.deepStrictEqual(x.discover({ purpose: 'open-government-data' }).map((d) => d.id), ['open']);
  assert.deepStrictEqual(x.discover({ purpose: 'analytics' }).map((d) => d.id), ['internal']);
  const events = x.auditTrail().map((e) => e.event);
  for (const required of ['dataset-registered', 'dataset-approved']) assert.ok(events.includes(required), required);
});

// --- Part 10: process governance ----------------------------------------------------------------

const ev = (streamId, type, at, actor) => ({ streamId, type, meta: { at, actor } });
const EVENTS = [
  ev('C1', 'CaseSubmitted', 0, 'sys'), ev('C1', 'CaseReviewed', 1000, 'inv-1'), ev('C1', 'GovernanceDecided', 2000, 'inv-1'),
  ev('C2', 'CaseSubmitted', 0, 'sys'), ev('C2', 'CaseReviewed', 600_000, 'inv-2'), ev('C2', 'CaseTransitioned', 1_200_000, 'inv-3'),
  ev('C3', 'GovernanceDecided', 0, 'gov-1'),
];

test('process governance: detects deviation, policy violation and SoD breach', () => {
  const dev = pg.governanceDeviations(EVENTS, { requiredSequence: ['CaseSubmitted', 'CaseReviewed'] });
  assert.ok(dev.findings.some((f) => f.caseId === 'C3' && /missing/.test(f.reason)));
  const pol = pg.policyViolations(EVENTS, { rules: [{ id: 'review-first', requires: { activity: 'GovernanceDecided', precededBy: 'CaseReviewed' } }] });
  assert.ok(pol.findings.some((f) => f.caseId === 'C3'));
  const sod = pg.segregationOfDutiesBreaches(EVENTS);
  assert.ok(sod.findings.some((f) => f.caseId === 'C1' && f.actor === 'inv-1'));
});

test('process governance: detects approval anomalies and composite fraud indicators', () => {
  const app = pg.approvalAnomalies(EVENTS, { minDwellMs: 60_000 });
  assert.ok(app.findings.some((f) => /faster than/.test(f.reason)));
  assert.ok(app.findings.some((f) => /first recorded activity/.test(f.reason)));
  const fraud = pg.fraudIndicators(EVENTS, { minDwellMs: 60_000 });
  const c1 = fraud.findings.find((f) => f.caseId === 'C1');
  assert.ok(c1 && c1.signalCount >= 2 && c1.severity === 'high');
  assert.strictEqual(fraud.advisoryOnly, true);
});

test('process governance: correlates findings with the fitness functions meant to prevent them', () => {
  const report = pg.report(EVENTS, {
    requiredSequence: ['CaseSubmitted', 'CaseReviewed'],
    fitnessResults: [{ id: 'APP-FIT-AUTHZ-DEFAULT-DENY', pass: true }, { id: 'FIT-GOVERNANCE', pass: false }],
  });
  const green = report.correlation.correlations.find((c) => c.control === 'APP-FIT-AUTHZ-DEFAULT-DENY');
  assert.match(green.interpretation, /does not cover this path/);
  const failing = report.correlation.correlations.find((c) => c.control === 'FIT-GOVERNANCE');
  assert.match(failing.interpretation, /already failing/);
  const unknown = report.correlation.correlations.find((c) => c.controlKnown === false);
  assert.match(unknown.interpretation, /control gap/);
});

test('process governance: deterministic, advisory, and never identifies a person', () => {
  const a = pg.report(EVENTS, { requiredSequence: ['CaseSubmitted'] });
  const b = pg.report(EVENTS, { requiredSequence: ['CaseSubmitted'] });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.advisoryOnly, true);
  assert.strictEqual(a.authorizes, false);
  assert.ok(!/@|omang|nationalId/i.test(JSON.stringify(a)));
  assert.ok(a.bottlenecks.slowest.length >= 1, 'bottleneck analysis is retained');
});

test('process governance: unusual and compliance detection surface the right cases', () => {
  const unusual = pg.unusualPatterns(EVENTS, { rareThreshold: 0.3 });
  assert.ok(unusual.findings.length >= 1);
  const comp = pg.complianceFailures(EVENTS, { slaMs: 1000 });
  assert.ok(comp.findings.some((f) => /SLA breached/.test(f.reason)));
  assert.ok(comp.findings.some((f) => /never reached a terminal/.test(f.reason)));
});
