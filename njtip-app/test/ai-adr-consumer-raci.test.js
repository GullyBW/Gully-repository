'use strict';
// Phase 10, Parts 9, 11, 12 & 13 — AI governance, ADR governance, consumer-driven contract
// testing, and operational governance.
const test = require('node:test');
const assert = require('node:assert');
const { AiLifecycle, PROHIBITED_USES, RISK_CLASSES } = require('../src/ai/ai-lifecycle');
const adr = require('../src/architecture/adr-governance');
const { ConsumerContracts } = require('../src/contracts/consumer-contracts');
const raci = require('../src/governance/raci');
const ownership = require('../src/governance/ownership');
const contextMap = require('../src/architecture/context-map');

const FITNESS_IDS = [
  ...require('../../njtip-twin/verification/fitness').map((f) => f.id),
  ...require('../verification/app-fitness').map((f) => f.id),
  ...require('../verification/infra-fitness').map((f) => f.id),
];

function approvedAi() {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('model', 'priority-advisor', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
  ai.approve('model', 'priority-advisor', { by: 'AI Governance Board', rationale: 'explainable, advisory-only' });
  return ai;
}

// --- Part 9: AI governance -------------------------------------------------------------------

test('AI: there is no autonomous action surface at all', () => {
  const ai = new AiLifecycle();
  assert.strictEqual(typeof ai.apply, 'undefined');
  assert.strictEqual(typeof ai.execute, 'undefined');
  assert.strictEqual(typeof ai.act, 'undefined');
});

test('AI: prohibited uses are refused by name', () => {
  const ai = new AiLifecycle();
  for (const purpose of Object.keys(PROHIBITED_USES)) {
    assert.throws(() => ai.register('model', 'm', { owner: 'o', purpose }), /prohibited/, purpose);
  }
  assert.throws(() => ai.register('model', 'm', { owner: 'o', purpose: 'x', riskClass: 'prohibited' }), /prohibited-risk/);
});

test('AI: registries require approval above minimal risk, per version', () => {
  const ai = approvedAi();
  assert.strictEqual(ai.isApproved('model', 'priority-advisor').approved, true);
  ai.register('model', 'priority-advisor', { version: 2, owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
  assert.strictEqual(ai.isApproved('model', 'priority-advisor').approved, false, 'a new version resets approval');
  ai.register('model', 'spellcheck', { owner: 'o', purpose: 'title-tidying', riskClass: 'minimal' });
  assert.strictEqual(ai.isApproved('model', 'spellcheck').approved, true, 'minimal risk needs no approval');
  assert.strictEqual(RISK_CLASSES.high.biasMonitoring, true);
});

test('AI: inference is fail-closed on approval, explanation and identity', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('model', 'm', { owner: 'o', purpose: 'case-prioritisation', riskClass: 'high' });
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', requestedBy: 'inv' }), /not approved/);
  ai.approve('model', 'm', { by: 'AI Governance Board', rationale: 'r' });
  assert.throws(() => ai.infer({ model: 'm', output: 'x', requestedBy: 'inv' }), /requires an explanation/);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e' }), /requesting principal/);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', requestedBy: 'inv', inputSummary: { omang: '1' } }), /refuses identity/);
  // Phase 11, Part 9: a high-risk class carries a confidence floor; below it the output is withheld.
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', requestedBy: 'inv' }), /requires a confidence score/);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', confidence: 0.5, requestedBy: 'inv' }), /withheld/);
  const inf = ai.infer({ model: 'm', output: 'high', explanation: 'age + escalation', confidence: 0.9, requestedBy: 'inv-001', inputSummary: { category: 'police' } });
  assert.strictEqual(inf.advisoryOnly, true);
  assert.strictEqual(inf.authorizes, false);
  assert.strictEqual(inf.status, 'advisory');
});

test('AI: the only exit from an inference is a recorded human decision, and override always works', () => {
  const ai = approvedAi();
  const inf = ai.infer({ model: 'priority-advisor', output: 'high', explanation: 'e', confidence: 0.9, requestedBy: 'inv-001' });
  assert.ok(ai.pendingDecisions().some((p) => p.id === inf.id));
  assert.throws(() => ai.decide(inf.id, { decision: 'accepted' }), /named human/);
  assert.throws(() => ai.decide(inf.id, { by: 'x', decision: 'maybe', rationale: 'r' }), /accepted/);
  ai.decide(inf.id, { by: 'inv-001', decision: 'accepted', rationale: 'consistent with the file' });
  assert.strictEqual(ai.inference(inf.id).status, 'decided');
  ai.override(inf.id, { by: 'Oversight Board', rationale: 'reviewed on appeal' });
  assert.strictEqual(ai.inference(inf.id).overridden, true);
});

test('AI: inference evidence is preserved and tamper-evident', () => {
  const ai = approvedAi();
  const inf = ai.infer({ model: 'priority-advisor', output: 'high', explanation: 'e', confidence: 0.9, requestedBy: 'inv-001' });
  assert.strictEqual(ai.verifyEvidence(inf.id).valid, true);
  ai._inferences.find((i) => i.id === inf.id).output = 'tampered';
  assert.strictEqual(ai.verifyEvidence(inf.id).valid, false);
});

test('AI: bias monitoring suppresses small groups and reports disparity', () => {
  const ai = approvedAi();
  assert.throws(() => ai.observeBias('priority-advisor', { group: 'email', outcomeRate: 1, sampleSize: 50 }), /non-identifying/);
  ai.observeBias('priority-advisor', { group: 'region-a', outcomeRate: 0.8, sampleSize: 100 });
  ai.observeBias('priority-advisor', { group: 'region-b', outcomeRate: 0.4, sampleSize: 100 });
  ai.observeBias('priority-advisor', { group: 'region-c', outcomeRate: 0.99, sampleSize: 3 });
  const bias = ai.biasReport('priority-advisor', { threshold: 0.2 });
  assert.strictEqual(bias.measured, true);
  assert.strictEqual(bias.disparity, 0.4);
  assert.strictEqual(bias.withinThreshold, false);
  assert.strictEqual(bias.suppressed, 1);
  assert.strictEqual(bias.worstServed, 'region-b');
});

test('AI: hallucination safeguards withhold ungrounded or low-confidence output', () => {
  const ai = approvedAi();
  assert.strictEqual(ai.groundingCheck({ output: 'x', groundedIn: [] }).grounded, false);
  assert.strictEqual(ai.groundingCheck({ output: 'x', groundedIn: ['doc'], confidence: 0.2, minConfidence: 0.5 }).grounded, false);
  assert.strictEqual(ai.groundingCheck({ output: 'x', groundedIn: ['doc'], confidence: 0.9 }).grounded, true);
  const vocab = ai.groundingCheck({ output: 'the suspect confessed', groundedIn: ['doc'], allowedVocabulary: ['the', 'case', 'status'] });
  assert.strictEqual(vocab.grounded, false);
});

// --- Part 11: ADR governance ----------------------------------------------------------------------

test('ADR: the catalogue is valid, contiguous and published', () => {
  const res = adr.validateCatalogue();
  assert.deepStrictEqual(res.violations, []);
  assert.ok(res.count >= 4);
  assert.ok(res.adrs.every((a) => a.valid));
});

test('ADR: the expanded schema applies from 0004 and demands the full record', () => {
  assert.strictEqual(adr.FULL_SCHEMA_FROM, 4);
  const fields = adr.schema().full.map((s) => s.field);
  for (const f of ['businessJustification', 'riskAssessment', 'performanceImpact', 'securityImpact', 'operationalImpact', 'complianceImpact', 'rollbackStrategy', 'migrationStrategy', 'implementationCost', 'successMetrics', 'decisionOwner', 'approvalHistory']) {
    assert.ok(fields.includes(f), f);
  }
  const res = adr.validateCatalogue();
  // Phase 11 added a third tier from 0006 and Phase 12 a fourth from 0007; earlier ADRs stay on
  // the schema they were written to rather than being retrofitted.
  assert.ok(res.adrs.filter((a) => a.number >= 4 && a.number < adr.EXTENDED_SCHEMA_FROM).every((a) => a.schema === 'full'));
  assert.ok(res.adrs.filter((a) => a.number >= adr.EXTENDED_SCHEMA_FROM && a.number < adr.GOVERNANCE_SCHEMA_FROM).every((a) => a.schema === 'extended'));
  assert.ok(res.adrs.filter((a) => a.number >= adr.GOVERNANCE_SCHEMA_FROM).every((a) => a.schema === 'governance'));
  assert.ok(res.adrs.filter((a) => a.number < 4).every((a) => a.schema === 'legacy'));
});

test('ADR: validation can fail, and the template is generated from the schema', () => {
  const last = adr.validateCatalogue().adrs.slice(-1)[0];
  assert.strictEqual(adr.validateAdr(last.file, { minSectionChars: 1e9 }).valid, false, 'the content check must be able to fail');
  const tpl = adr.template({ number: '0099', title: 'test' });
  for (const s of adr.schema().full) assert.ok(tpl.includes(`## ${s.heading}`), s.heading);
  for (const s of adr.schema().legacy) assert.ok(tpl.includes(`## ${s.heading}`), s.heading);
});

// --- Part 12: consumer-driven contracts --------------------------------------------------------------

test('consumer contracts: every registered consumer is satisfied today', () => {
  const cc = new ConsumerContracts();
  assert.deepStrictEqual(cc.validate().violations, []);
  const all = cc.verifyAll();
  assert.strictEqual(all.allSatisfied, true, JSON.stringify(all.broken));
  assert.strictEqual(all.failClosed, true);
  assert.ok(all.consumers >= 4);
});

test('consumer contracts: impact analysis names who breaks before the change ships', () => {
  const cc = new ConsumerContracts();
  const breaking = cc.impactOfChange('api.case.transition', { fields: { required: ['case_code'], optional: [] } });
  assert.strictEqual(breaking.safe, false);
  assert.ok(breaking.affectedConsumers.some((c) => c.consumer === 'investigator-console'));
  assert.match(breaking.verdict, /BREAKS/);
  const additive = cc.impactOfChange('api.reports.submit', { fields: { required: ['category'], optional: ['extra', 'locale'] } });
  assert.strictEqual(additive.safe, true);
  assert.match(additive.verdict, /backward compatible/);
});

test('consumer contracts: breaking the constitutional consumer is flagged as such', () => {
  const cc = new ConsumerContracts();
  const impact = cc.impactOfChange('api.reports.submit', { fields: { required: [], optional: [] } });
  assert.strictEqual(impact.safe, false);
  assert.strictEqual(impact.constitutionalImpact, true);
  assert.ok(impact.affectedConsumers.some((c) => c.criticality === 'constitutional'));
});

test('consumer contracts: dependency matrix, unconsumed contracts and deprecation tracking', () => {
  const cc = new ConsumerContracts();
  const matrix = cc.dependencyMatrix();
  assert.ok(matrix['api.reports.submit'].some((x) => x.consumer === 'citizen-web'));
  assert.ok(Array.isArray(cc.unconsumedContracts()));
  assert.ok(cc.versionLifecycle().every((x) => typeof x.version === 'number'));
  assert.ok(Array.isArray(cc.deprecationReport()));
});

test('consumer contracts: a consumer must handle errors and name its authentication', () => {
  const cc = new ConsumerContracts();
  assert.throws(() => cc.register('bad', { consumer: 'x', owner: 'intake', expectations: [] }), /at least one expectation/);
  cc.register('silent', { consumer: 'Silent client', owner: 'intake', expectations: [{ contract: 'api.reports.submit', sends: ['category'], reads: [], handlesErrors: [], authentication: 'anonymous' }] });
  assert.ok(cc.validate().violations.some((x) => /handles no errors/.test(x)));
});

// --- Part 13: operational governance -------------------------------------------------------------------

test('RACI: exactly one accountable role per activity, never the responsible one', () => {
  assert.deepStrictEqual(raci.validate().violations, []);
  for (const a of raci.activities()) {
    assert.ok(a.accountable, a.id);
    assert.notStrictEqual(a.accountable, a.responsible, a.id);
    assert.ok(a.evidence, a.id);
    assert.strictEqual(a.humanDecision, true, a.id);
  }
});

test('RACI: no subsystem approves itself, and every context has a full matrix', () => {
  const matrix = raci.matrix();
  assert.strictEqual(matrix.length, contextMap.ids().length);
  for (const m of matrix) {
    assert.strictEqual(m.rows.length, raci.activities().length, m.subsystem);
    for (const row of m.rows) assert.strictEqual(row.selfApproval, false, `${m.subsystem}/${row.activity}`);
  }
});

test('RACI: every control has an owning context and a governance board', () => {
  const control = raci.controlOwnership(FITNESS_IDS);
  assert.deepStrictEqual(control.unowned, []);
  assert.strictEqual(control.coverage, 1);
  for (const c of control.controls) { assert.ok(c.responsibleAuthority, c.control); assert.ok(c.governanceBoard, c.control); }
});

test('RACI: escalation workflows terminate at the governance board with named evidence', () => {
  const wf = raci.escalationWorkflow('custody', 'recovery-authorization');
  assert.strictEqual(wf.steps.length, 4);
  assert.strictEqual(wf.terminatesAt, ownership.describe('custody').governanceBoard);
  assert.ok(wf.evidenceRequired);
  assert.strictEqual(wf.humanDecision, true);
  assert.throws(() => raci.escalationWorkflow('custody', 'nonsense'), /unknown governance activity/);
});

test('RACI: the scorecard and maturity are computed and react to the live gate', () => {
  const green = FITNESS_IDS.map((id) => ({ id, pass: true }));
  const strong = raci.scorecard({ fitnessIds: FITNESS_IDS, fitnessResults: green });
  assert.strictEqual(strong.band, 'strong');
  assert.deepStrictEqual(strong.selfApprovals, []);
  const red = FITNESS_IDS.map((id, i) => ({ id, pass: i > 0 }));
  assert.ok(raci.scorecard({ fitnessIds: FITNESS_IDS, fitnessResults: red }).score < strong.score);
  assert.strictEqual(raci.maturity({ fitnessIds: FITNESS_IDS, fitnessResults: green }).level, 5);
  assert.ok(raci.maturity({ fitnessIds: FITNESS_IDS, fitnessResults: red }).level < 5);
});
