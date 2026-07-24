'use strict';
// Knowledge Graph Intelligence (Phase 31). Reasoning over the privacy-preserving graph:
// similarity scoring, relationship PREDICTION, clustering, suspicious-pattern discovery, and
// EXPLAINABLE traversal. Deterministic. Every inferred relationship is ADVISORY — human
// approval is mandatory before it is treated as real (nothing here creates edges or acts).
function advisory(kind, result, confidence, explanation) {
  return { kind, result, confidence: +Math.max(0, Math.min(1, confidence)).toFixed(2), explanation, advisoryOnly: true, requiresHumanApproval: true, autonomous: false };
}

// Similarity = Jaccard of two nodes' neighbour sets (structural similarity).
function similarity(graph, a, b) {
  const na = new Set(graph.neighbors(a)); const nb = new Set(graph.neighbors(b));
  const inter = [...na].filter((x) => nb.has(x)).length; const uni = new Set([...na, ...nb]).size;
  const score = uni ? inter / uni : 0;
  return advisory('similarity', { a, b, score: +score.toFixed(2), commonNeighbors: [...na].filter((x) => nb.has(x)).sort() }, score, [`Jaccard of neighbour sets: ${inter}/${uni}`]);
}

// Link prediction via common neighbours (a transparent heuristic). Suggests likely, NOT
// actual, relationships — each with a confidence and an explanation. Advisory only.
function predictLinks(graph, node, { top = 5 } = {}) {
  const direct = new Set(graph.neighbors(node)); direct.add(node);
  const candidates = new Map();
  for (const nb of graph.neighbors(node)) for (const two of graph.neighbors(nb)) {
    if (direct.has(two)) continue;
    candidates.set(two, (candidates.get(two) || new Set()).add(nb));
  }
  const ranked = [...candidates.entries()]
    .map(([candidate, via]) => ({ candidate, commonNeighbors: [...via].sort(), score: +(via.size / (graph.neighbors(node).length || 1)).toFixed(2) }))
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
    .slice(0, top);
  return advisory('link-prediction', ranked, ranked.length ? ranked[0].score : 0, [`predicted via shared neighbours of '${node}'`, 'human approval required before any inferred link is acted upon']);
}

// Investigation clustering: connected components (each component = a candidate cluster).
function clusters(graph) {
  const seen = new Set(); const out = [];
  for (const id of graph.nodesOfType ? allNodeIds(graph) : []) {
    if (seen.has(id)) continue;
    const comp = graph.component(id); comp.forEach((n) => seen.add(n));
    out.push(comp);
  }
  return advisory('clustering', out.sort((a, b) => b.length - a.length), out.length ? 0.7 : 0.3, [`${out.length} connected component(s) as candidate clusters`]);
}
function allNodeIds(graph) { const ids = new Set(); for (const t of ['Person', 'Organization', 'Investigation', 'Evidence', 'Asset', 'Location', 'Communication', 'Financial']) for (const id of graph.nodesOfType(t)) ids.add(id); return [...ids].sort(); }

// Suspicious-pattern discovery: high-degree hubs + tight triangles → advisory flags with a
// confidence. A determination of wrongdoing is a HUMAN decision, never this function's.
function suspiciousPatterns(graph, { minDegree = 3 } = {}) {
  const hubs = graph.hubs(minDegree); const triangles = graph.triangles();
  const flags = [
    ...hubs.map((h) => ({ pattern: 'hub', node: h.id, degree: h.degree, confidence: Math.min(0.9, 0.3 + 0.1 * h.degree) })),
    ...triangles.slice(0, 20).map((t) => ({ pattern: 'triangle', nodes: t, confidence: 0.5 })),
  ];
  return advisory('suspicious-pattern', flags, flags.length ? 0.6 : 0.2, ['structural signals only (hubs/triangles)', 'NOT a determination — human review mandatory']);
}

// Explainable traversal: shortest path plus a per-hop explanation.
function explainPath(graph, from, to) {
  const path = graph.shortestPath(from, to);
  if (!path) return advisory('path', null, 0, [`no relationship path from ${from} to ${to}`]);
  const hops = path.slice(1).map((n, i) => `${path[i]} → ${n}`);
  return advisory('path', { path, hops }, 0.8, [`shortest relationship path (${path.length - 1} hop(s))`, ...hops]);
}

module.exports = { advisory, similarity, predictLinks, clusters, suspiciousPatterns, explainPath };
