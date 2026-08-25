'use strict';
// v1.4 Phase 13 (advisory-only AI + human approval) and Phase 20 (configurable workflow
// orchestration: rule guards, approval chains, SLA/escalation, versioning).
const { test } = require('node:test');
const assert = require('node:assert');
const advisor = require('../src/ai/advisor');
const { RecommendationQueue } = require('../src/ai/approval');
const { WorkflowEngine, DEFAULT_WORKFLOW } = require('../src/orchestration/workflow-engine');

test('AI advisor: deterministic, explainable, confidence-scored, advisory-only', () => {
  const rec = advisor.recommendPriority({ category: 'police', status: 'escalated', createdAt: 0, now: 0 });
  assert.strictEqual(rec.advisoryOnly, true);
  assert.strictEqual(rec.autonomous, false);
  assert.ok(rec.explanation.length >= 1 && typeof rec.confidence === 'number');
  assert.strictEqual(JSON.stringify(rec), JSON.stringify(advisor.recommendPriority({ category: 'police', status: 'escalated', createdAt: 0, now: 0 })));
  // Duplicate detection over non-identifying features.
  const dup = advisor.detectDuplicates({ case_code: 'A', category: 'police', recipient: 'ombudsman' }, [{ case_code: 'B', category: 'police', recipient: 'ombudsman' }], { threshold: 0.5 });
  assert.ok(dup.recommendation.length >= 1);
  // Risk + fraud + summary carry explanations.
  assert.ok(advisor.riskScore({ category: 'police', status: 'escalated' }).explanation.length >= 1);
  assert.ok(Array.isArray(advisor.fraudPatterns([]).recommendation));
});

test('AI approval queue: human-gated; never auto-applies; audited', () => {
  const q = new RecommendationQueue({ clock: () => 1 });
  const rec = advisor.riskScore({ category: 'courts' });
  const { id } = q.submit(rec, { caseCode: 'NJ-1' });
  assert.strictEqual(q.pending().length, 1);
  // A decision requires a named human and never applies automatically.
  assert.throws(() => q.decide(id, { decision: 'approved' }), /accountable human/);
  const d = q.decide(id, { by: 'reviewer', decision: 'approved' });
  assert.strictEqual(d.appliesAutomatically, false);
  assert.throws(() => q.decide(id, { by: 'reviewer', decision: 'approved' }), /already decided/);
  // Non-advisory recommendations are refused.
  assert.throws(() => q.submit({ advisoryOnly: false, autonomous: true }), /advisory/);
  assert.strictEqual(q.audit()[0].status, 'approved');
});

test('workflow orchestration: data-driven routing, guards, approval chains, versioning', () => {
  let now = 0;
  const eng = new WorkflowEngine({ clock: () => now });
  eng.register(DEFAULT_WORKFLOW);
  const inst = eng.start('investigation', { context: { region: 'south' } });
  assert.strictEqual(inst.state, 'intake');
  assert.strictEqual(eng.fire(inst.id, 'assess').state, 'assessment');
  assert.strictEqual(eng.fire(inst.id, 'investigate').state, 'investigation');
  assert.strictEqual(eng.fire(inst.id, 'review').state, 'oversight');
  // Approval chain: cannot leave 'oversight' without the oversight-board approval.
  assert.throws(() => eng.fire(inst.id, 'decide'), /pending approvals/);
  eng.approve(inst.id, { role: 'oversight-board', by: 'OB Chair' });
  assert.strictEqual(eng.fire(inst.id, 'decide').state, 'decision');
  assert.strictEqual(eng.fire(inst.id, 'close').state, 'closed');
  assert.strictEqual(eng.isTerminal(inst.id), true);
  // Illegal event is rejected.
  assert.throws(() => eng.fire(inst.id, 'reopen'), /illegal event/);
});

test('workflow orchestration: rule guard + SLA escalation + versioning', () => {
  let now = 0;
  const eng = new WorkflowEngine({ clock: () => now });
  eng.register({ id: 'wf', version: 1, start: 's1', terminal: ['done'], states: {
    s1: { on: { go: 's2' }, guard: [{ attr: 'approvedBudget', op: 'eq', value: true }], slaMs: 100, escalateTo: 'escalated' },
    s2: { on: {} }, escalated: { on: {} }, done: { on: {} },
  } });
  const i = eng.start('wf', { context: { approvedBudget: false } });
  // Guard blocks the transition until the context satisfies it.
  assert.throws(() => eng.fire(i.id, 'go'), /guard failed/);
  // SLA breach → escalate.
  now += 200;
  assert.strictEqual(eng.slaStatus(i.id).breached, true);
  assert.strictEqual(eng.escalate(i.id).state, 'escalated');
  // Versioning: a new definition version does not disturb the running (pinned) instance.
  eng.register({ id: 'wf', version: 2, start: 's1', terminal: [], states: { s1: { on: {} } } });
  assert.strictEqual(eng.instance(i.id).version, 1);
});
