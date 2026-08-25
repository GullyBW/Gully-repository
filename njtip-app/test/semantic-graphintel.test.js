'use strict';
// v1.5 Phase 30 (semantic search) + Phase 31 (knowledge graph intelligence, advisory).
const { test } = require('node:test');
const assert = require('node:assert');
const { SemanticSearch, expandQuery, parseIntent, qualityMetrics } = require('../src/search/semantic');
const { KnowledgeGraph } = require('../src/graph/graph');
const gi = require('../src/graph/intelligence');

test('semantic: concept expansion + intent parsing (identity-free)', () => {
  const exp = expandQuery('corruption');
  assert.ok(exp.expanded.includes('bribery') && exp.explanation.length >= 1);
  // No identity terms ever enter the concept space.
  assert.ok(!exp.expanded.some((t) => ['name', 'email', 'omang', 'phone'].includes(t)));
  assert.deepStrictEqual(parseIntent('show escalated police cases'), { status: 'escalated', category: 'police' });
});

test('semantic search: hybrid keyword+semantic, explainable, intent-filtered', () => {
  const ss = new SemanticSearch();
  ss.index({ case_code: 'NJ-1', category: 'police', status: 'escalated', recipient: 'ombudsman' });
  ss.index({ case_code: 'NJ-2', category: 'courts', status: 'received', recipient: 'ombudsman' });
  // Identity fields are refused by the underlying index.
  assert.throws(() => ss.index({ case_code: 'NJ-3', email: 'a@b.c' }), /sensitive field/);
  // Keyword hit with explanation.
  const r = ss.search('police');
  assert.strictEqual(r.results[0].case_code, 'NJ-1');
  assert.ok(r.results[0].matchedOn.some((m) => m.includes('police')));
  // Intent narrows results.
  const r2 = ss.search('escalated police');
  assert.ok(r2.results.every((x) => x.case_code === 'NJ-1'));
  // Quality metrics.
  const q = qualityMetrics(['NJ-1', 'NJ-2'], ['NJ-1']);
  assert.strictEqual(q.precision, 0.5);
  assert.strictEqual(q.recall, 1);
});

test('graph intelligence: similarity, link prediction, clustering, patterns — all advisory', () => {
  const g = new KnowledgeGraph();
  g.addNode('org', 'Organization'); g.addNode('a1', 'Asset'); g.addNode('a2', 'Asset');
  g.addNode('p1', 'Person'); g.addNode('p2', 'Person');
  g.addEdge('p1', 'org', 'director'); g.addEdge('p2', 'org', 'director');
  g.addEdge('p1', 'a1', 'owns'); g.addEdge('p2', 'a1', 'owns');
  // Similarity of two directors sharing neighbours.
  const sim = gi.similarity(g, 'p1', 'p2');
  assert.ok(sim.result.score > 0 && sim.advisoryOnly === true);
  // Link prediction is advisory + explainable + human-gated.
  const pred = gi.predictLinks(g, 'org');
  assert.strictEqual(pred.requiresHumanApproval, true);
  assert.strictEqual(pred.autonomous, false);
  assert.ok(pred.explanation.length >= 1);
  // Clustering returns candidate components (advisory).
  assert.strictEqual(gi.clusters(g).advisoryOnly, true);
  // Suspicious patterns are flags, never determinations.
  const susp = gi.suspiciousPatterns(g, { minDegree: 2 });
  assert.ok(/NOT a determination/i.test(susp.explanation.join(' ')));
  // Explainable path.
  const path = gi.explainPath(g, 'a1', 'org');
  assert.ok(path.result.path.includes('org'));
});
