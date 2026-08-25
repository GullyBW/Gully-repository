'use strict';
// v1.3 Phase 2 operational workflows: prioritisation, assignment + workload balancing,
// SLA targets, multi-stage review chain, appeals, and retention — pure helpers + their
// integration into the workflow.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const inv = require('../src/domain/investigation');
const { Workflow } = require('../src/workflow');

function freshWf() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-inv-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  let t = 1_700_000_000_000;
  return { wf: new Workflow({ clock: () => (t += 1000), seed: 4, ledgerFile }), ledgerFile, tick: (ms) => (t += ms) };
}

test('prioritisation: severity + escalation + ageing bands', () => {
  assert.strictEqual(inv.scorePriority({ category: 'police' }).band, 'P3'); // severity 5 → P3
  assert.strictEqual(inv.scorePriority({ category: 'police', escalated: true }).band, 'P1'); // +3 → P1
  assert.strictEqual(inv.scorePriority({ category: 'other' }).band, 'P4'); // severity 1
  const aged = inv.scorePriority({ category: 'regulatory', ageMs: 9 * 24 * 3600_000 });
  assert.ok(aged.score > inv.scorePriority({ category: 'regulatory' }).score); // ageing raises it
});

test('assignment: prefers the recipient agency, balances load, deterministic', () => {
  const roster = [{ id: 'a', unit: 'dcec' }, { id: 'b', unit: 'ombudsman' }, { id: 'c', unit: 'dcec' }];
  // Prefer the ombudsman agency → b.
  assert.strictEqual(inv.assign({ roster, preferUnit: 'ombudsman' }).id, 'b');
  // No preference → least loaded, tie-break by id (b has 0 load).
  assert.strictEqual(inv.assign({ roster, loads: { a: 2, c: 1 } }).id, 'b');
  // Within a tied unit, tie-break by id.
  assert.strictEqual(inv.assign({ roster: [{ id: 'a', unit: 'x' }, { id: 'c', unit: 'x' }], loads: { a: 1, c: 1 } }).id, 'a');
  // Excluding everyone → null.
  assert.strictEqual(inv.assign({ roster, exclude: ['a', 'b', 'c'] }), null);
});

test('SLA: due dates and breach detection', () => {
  const DAY = 24 * 3600_000;
  const s = inv.slaStatus({ band: 'P1', createdAt: 0, now: 2 * DAY }); // P1 first-review due in 1 day
  assert.strictEqual(s.firstReviewBreached, true);
  const ok = inv.slaStatus({ band: 'P1', createdAt: 0, firstReviewedAt: 12 * 3600_000, now: 12 * 3600_000 });
  assert.strictEqual(ok.firstReviewBreached, false);
});

test('workflow: assignment prefers the CoI-cleared recipient agency and balances load', () => {
  const { wf, ledgerFile } = freshWf();
  // police is CoI-routed to the ombudsman; assignment prefers an ombudsman investigator.
  const r = wf.submitReport({ category: 'police', content: 'x' });
  const rosterUnit = { 'inv-001': 'dcec', 'inv-002': 'ombudsman', 'inv-003': 'judicial-oversight', 'inv-004': 'dcec' };
  const a = wf.assignCase({ case_code: r.case_code });
  assert.strictEqual(rosterUnit[a.assignee], wf._statusRepo.get(r.case_code).recipient); // preferred agency
  // Second case → workload is tracked and durable.
  const r2 = wf.submitReport({ category: 'police', content: 'y' });
  wf.assignCase({ case_code: r2.case_code });
  assert.strictEqual(Object.values(wf.workloads()).reduce((x, y) => x + y, 0), 2);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});

test('workflow: SLA breach after ageing; review records first-review time', () => {
  const { wf, ledgerFile, tick } = freshWf();
  const r = wf.submitReport({ category: 'police', content: 'x' }); // P3, first-review due 7 days
  tick(8 * 24 * 3600_000); // 8 days later, no review yet
  assert.strictEqual(wf.slaStatus(r.case_code).firstReviewBreached, true);
  // A review records the first-review time (SLA clock stops).
  wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: 'reviewed' });
  assert.ok(wf._statusRepo.get(r.case_code).firstReviewedAt > 0);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});

test('workflow: review chain advances; appeals require resolved/closed + accountability', () => {
  const { wf, ledgerFile } = freshWf();
  const r = wf.submitReport({ category: 'courts', content: 'x' });
  assert.strictEqual(wf.advanceStage({ principal: 'inv-001', case_code: r.case_code }).stage, 'investigation');
  // Cannot appeal an open case.
  assert.throws(() => wf.fileAppeal({ case_code: r.case_code, by: 'appellant', reason: 'unfair' }), /resolved or closed/);
  // Resolve then appeal.
  wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: 'escalate' });
  wf.transitionCase({ principal: 'inv-001', case_code: r.case_code, event: 'resolve' });
  assert.throws(() => wf.fileAppeal({ case_code: r.case_code, by: '', reason: '' }), /accountable/);
  const ap = wf.fileAppeal({ case_code: r.case_code, by: 'appellant', reason: 'new evidence' });
  assert.strictEqual(ap.appeal.stage, 'appeal-review');
  // Retention plan is available and read-only.
  const ret = wf.retentionPlan(r.case_code);
  assert.ok(ret.disposeAt > 0 && ret.action === 'review-then-purge');
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});
