'use strict';
// v1.3 Phase 3: privacy-preserving full-text search and analytics/intelligence.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { SearchIndex } = require('../src/adapters/search');
const analytics = require('../src/analytics');
const { Workflow } = require('../src/workflow');

function freshWf() {
  const ledgerFile = path.join(os.tmpdir(), `njtip-sa-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  let t = 1_700_000_000_000;
  return { wf: new Workflow({ clock: () => (t += 1000), seed: 8, ledgerFile }), ledgerFile };
}

test('search index: field-scoped + free-text, ranked; REFUSES sensitive fields', () => {
  const idx = new SearchIndex();
  idx.index({ case_code: 'NJ-1', category: 'police', status: 'received', recipient: 'ombudsman' });
  idx.index({ case_code: 'NJ-2', category: 'courts', status: 'received', recipient: 'ombudsman' });
  assert.strictEqual(idx.search('category:police').length, 1);
  assert.strictEqual(idx.search('received').length, 2);          // free-text across fields
  assert.strictEqual(idx.search('ombudsman received')[0].case_code, 'NJ-1'); // AND + rank/tiebreak
  // Identity/content fields are refused (fail-closed).
  assert.throws(() => idx.index({ case_code: 'NJ-3', email: 'a@b.c' }), /sensitive field/);
  assert.throws(() => idx.index({ case_code: 'NJ-4', content: 'secret' }), /sensitive field/);
  // Non-allowlisted fields are silently ignored (never indexed).
  idx.index({ case_code: 'NJ-5', category: 'prison', note: 'ignored-field-value' });
  assert.strictEqual(idx.search('ignored-field-value').length, 0);
});

test('analytics: small-cell suppression (k-anonymity) protects individuals', () => {
  const rows = [
    ...Array(6).fill({ category: 'police', status: 'received' }),
    { category: 'courts', status: 'received' }, // a lone cell → suppressed
  ];
  const agg = analytics.aggregate(rows, { by: 'category', k: 5 });
  assert.strictEqual(agg.groups.police.count, 6);          // above threshold → shown
  assert.strictEqual(agg.groups.courts.count, null);        // below threshold → suppressed
  assert.strictEqual(agg.groups.courts.suppressed, true);
});

test('analytics: KPIs and deterministic trends', () => {
  const DAY = 24 * 3600_000;
  const rows = [
    { category: 'police', status: 'resolved', createdAt: 0, firstReviewedAt: DAY, slaBreached: false },
    { category: 'police', status: 'received', createdAt: 2 * DAY, slaBreached: true },
  ];
  const k = analytics.kpis(rows, 3 * DAY);
  assert.strictEqual(k.total, 2);
  assert.strictEqual(k.resolved, 1);
  assert.strictEqual(k.slaBreachRate, 0.5);
  const tr = analytics.trends(rows, { field: 'status' });
  assert.deepStrictEqual(tr.buckets.map((b) => b.day), [0, 2]);
});

test('analytics export: only non-identifying columns, JSON + CSV', () => {
  const rows = [{ case_code: 'NJ-1', category: 'police', status: 'received', stage: 'intake-review', recipient: 'ombudsman', priority: { band: 'P3' }, createdAt: 10, email: 'should-not-appear' }];
  const json = analytics.exportRows(rows, { format: 'json' });
  assert.deepStrictEqual(Object.keys(json[0]).sort(), ['band', 'case_code', 'category', 'createdAt', 'recipient', 'stage', 'status']);
  const csv = analytics.exportRows(rows, { format: 'csv' });
  assert.ok(csv.startsWith('case_code,category,status,stage,recipient,band,createdAt'));
  assert.ok(!csv.includes('should-not-appear')); // identity never exported
});

test('workflow: search + analytics over the live projection are consistent', () => {
  const { wf, ledgerFile } = freshWf();
  const a = wf.submitReport({ category: 'police', content: 'x' });
  wf.submitReport({ category: 'courts', content: 'y' });
  assert.strictEqual(wf.searchCases('category:police').length, 1);
  assert.strictEqual(wf.searchCases('category:police')[0].case_code, a.case_code);
  const an = wf.analytics({ by: 'category' });
  assert.strictEqual(an.kpis.total, 2);
  assert.ok(an.note.includes('non-attributable'));
  // Timeline is available for a known case.
  assert.strictEqual(wf.caseTimeline(a.case_code).case_code, a.case_code);
  try { fs.unlinkSync(ledgerFile); } catch (_) {}
});
