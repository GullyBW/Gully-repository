'use strict';
// Knowledge Graph Platform (Phase 23). A typed property graph for relationship discovery,
// link analysis, and pattern detection across investigations. Deterministic and in-memory.
//
// PRIVACY (by design): nodes are SYNTHETIC and identity-free — a node is an OPAQUE id plus a
// TYPE and non-identifying properties. The graph stores RELATIONSHIPS, never personal data;
// it never holds names, national ids, contact details, or case content. Enforced on add.
const NODE_TYPES = new Set(['Person', 'Organization', 'Investigation', 'Evidence', 'Asset', 'Location', 'Communication', 'Financial']);
const DENIED_PROPS = new Set(['name', 'omang', 'nationalid', 'email', 'phone', 'address', 'content', 'body', 'plaintext', 'dob']);

class KnowledgeGraph {
  constructor() { this._nodes = new Map(); this._adj = new Map(); this._edges = []; }

  addNode(id, type, props = {}) {
    if (!id) throw new Error('graph: node id required');
    if (!NODE_TYPES.has(type)) throw new Error('graph: unknown node type ' + type);
    for (const k of Object.keys(props)) if (DENIED_PROPS.has(k.toLowerCase())) throw new Error(`graph refuses identifying property: ${k}`);
    this._nodes.set(id, { id, type, props: { ...props } });
    if (!this._adj.has(id)) this._adj.set(id, new Set());
    return id;
  }
  addEdge(from, to, rel, props = {}) {
    if (!this._nodes.has(from) || !this._nodes.has(to)) throw new Error('graph: edge endpoints must exist');
    for (const k of Object.keys(props)) if (DENIED_PROPS.has(k.toLowerCase())) throw new Error(`graph refuses identifying edge property: ${k}`);
    this._edges.push({ from, to, rel, props: { ...props } });
    this._adj.get(from).add(to); this._adj.get(to).add(from); // undirected adjacency for analysis
    return this._edges.length;
  }
  node(id) { return this._nodes.get(id) || null; }
  neighbors(id) { return [...(this._adj.get(id) || [])]; }
  nodesOfType(type) { return [...this._nodes.values()].filter((n) => n.type === type).map((n) => n.id); }

  // Link analysis: shortest relationship path (BFS), deterministic by insertion/id order.
  shortestPath(from, to) {
    if (!this._nodes.has(from) || !this._nodes.has(to)) return null;
    const prev = new Map([[from, null]]); const q = [from];
    while (q.length) {
      const cur = q.shift(); if (cur === to) break;
      for (const nb of [...(this._adj.get(cur) || [])].sort()) if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
    if (!prev.has(to)) return null;
    const path = []; let c = to; while (c !== null) { path.unshift(c); c = prev.get(c); }
    return path;
  }
  // Connected component containing id (an investigation "network").
  component(id) {
    if (!this._nodes.has(id)) return [];
    const seen = new Set([id]); const q = [id];
    while (q.length) { const c = q.shift(); for (const nb of this._adj.get(c) || []) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
    return [...seen].sort();
  }
  // Pattern detection: HUBS (degree ≥ threshold) — potential coordinating nodes.
  hubs(minDegree = 3) { return [...this._adj.entries()].filter(([, set]) => set.size >= minDegree).map(([id, set]) => ({ id, degree: set.size, type: this._nodes.get(id).type })).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)); }
  // Pattern detection: TRIANGLES (three mutually-connected nodes) — tight clusters.
  triangles() {
    const out = []; const ids = [...this._nodes.keys()].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let k = j + 1; k < ids.length; k++) {
      const [a, b, c] = [ids[i], ids[j], ids[k]];
      if (this._adj.get(a).has(b) && this._adj.get(b).has(c) && this._adj.get(a).has(c)) out.push([a, b, c]);
    }
    return out;
  }
  stats() { return { nodes: this._nodes.size, edges: this._edges.length, types: [...NODE_TYPES].filter((t) => this.nodesOfType(t).length).length }; }
}

module.exports = { KnowledgeGraph, NODE_TYPES, DENIED_PROPS };
