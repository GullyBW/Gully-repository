'use strict';
// Enterprise Knowledge Graph (Phase 12, Part 20). Extends the graph bounded context (`src/graph/`)
// from the investigation graph to a graph of the PLATFORM itself: decisions, contexts, services,
// interfaces, risks, controls, evidence, policies, datasets, metrics, owners, readiness dimensions
// and compliance obligations, and the edges between them.
//
// WHY THIS IS NOT `KnowledgeGraph`. That class is the investigation graph: undirected, typed to
// Person/Organization/Evidence/…, and it refuses identifying properties on add. Widening its type
// set to admit ADRs and bounded contexts would let investigation code create architecture nodes and
// vice versa — a coupling defect dressed up as reuse. This is a separate graph in the same bounded
// context, directed, with its own types, and it holds no personal data at all because none of its
// node kinds is a person.
//
// The property Part 20 asks for — EVERY ENTITY TRACEABLE THROUGH VERIFIABLE EVIDENCE — is the one
// worth being careful about. A graph where everything is connected to everything proves nothing.
// So `traceability()` asks a narrow question of each node: is there a path from here to a piece of
// EVIDENCE, where evidence means an executable check that actually ran? A node with no such path is
// reported as UNTRACEABLE by name. That is the useful output; a green tick over the whole graph
// would not be.
//
// As everywhere: the graph is BUILT from the registries on each construction, never maintained
// beside them.
const contextMap = require('../architecture/context-map');
const adrGovernance = require('../architecture/adr-governance');
const ownership = require('../governance/ownership');
const multiRegion = require('../twin2/multi-region');
const telemetry = require('../observability/telemetry');
const threat = require('../security/threat-model');
const evidenceConfidence = require('../assurance/evidence-confidence');
const { hash } = require('../twin');

// The thirteen node kinds Part 20 names, each with the registry it is read from.
const NODE_KINDS = {
  adr: { source: 'docs/adr/*.md', label: 'An architectural decision record.' },
  'bounded-context': { source: 'src/architecture/context-map.js', label: 'A bounded context in the architecture-of-record.' },
  service: { source: 'src/observability/telemetry.js', label: 'A running service.' },
  api: { source: 'src/contracts/integration-contracts.js', label: 'A published interface contract.' },
  risk: { source: 'src/security/threat-model.js', label: 'A registered risk.' },
  control: { source: 'the executable fitness identifiers supplied by the caller', label: 'A control the platform claims.' },
  evidence: { source: 'fitness results supplied by the caller', label: 'An executable check that actually ran, and its result.' },
  policy: { source: 'src/twin2/multi-region.js', label: 'A declared operating rule.' },
  dataset: { source: 'the governed data estate supplied by the caller', label: 'A governed dataset.' },
  metric: { source: 'src/observability/business.js', label: 'A business metric derived from the event stream.' },
  owner: { source: 'src/governance/ownership.js', label: 'An accountable authority.' },
  'readiness-dimension': { source: 'src/assurance/evidence-confidence.js', label: 'One of the ten independent readiness dimensions.' },
  'compliance-obligation': { source: 'src/legislation/registry.js', label: 'A legal or regulatory obligation.' },
};

// Edge kinds, each stating what the edge MEANS. An edge whose meaning is not written down is a line
// on a diagram, and a graph of those answers questions confidently and wrongly.
const EDGE_KINDS = {
  decides: 'The ADR records the decision that governs the target.',
  'depends-on': 'The source cannot do its job without the target.',
  'runs-in': 'The service runs inside the bounded context.',
  exposes: 'The context publishes this interface.',
  governs: 'The policy or control governs the target.',
  'verified-by': 'The target is demonstrated by this evidence.',
  'owned-by': 'A named authority is accountable for the source.',
  'measures': 'The metric measures the target.',
  'assessed-by': 'The readiness dimension is scored from the target.',
  'mandated-by': 'The source exists because of this obligation.',
  'threatens': 'The risk bears on the target.',
  'derived-from': 'The dataset is derived from the target.',
};

// Which executable check would fail if an edge of this kind were wrong. This is what makes an edge
// evidenced rather than merely asserted.
const EDGE_EVIDENCE = {
  decides: 'APP-FIT-ADR-GOVERNANCE',
  'depends-on': 'APP-FIT-CONTEXT-MAP',
  'runs-in': 'APP-FIT-CONTEXT-MAP',
  exposes: 'APP-FIT-CONSUMER-IMPACT',
  governs: 'APP-FIT-RACI-GOVERNANCE',
  'verified-by': 'APP-FIT-ENTERPRISE-GRAPH',
  'owned-by': 'APP-FIT-RACI-GOVERNANCE',
  measures: 'APP-FIT-MISSION-CORRELATION',
  'assessed-by': 'APP-FIT-READINESS-MODEL',
  'mandated-by': 'APP-FIT-COMPLIANCE-INTELLIGENCE',
  threatens: 'APP-FIT-THREAT-MODEL',
  'derived-from': 'APP-FIT-DATA-GOVERNANCE',
};

class EnterpriseGraph {
  constructor({ fitnessResults = [], datasets = [], contracts = null, obligations = [], epoch = 0, history = [] } = {}) {
    this._epoch = epoch;                 // when the current graph state came into existence
    this._history = history.map((h) => ({ ...h }));   // superseded edges, supplied by the caller
    this._nodes = new Map();
    this._out = new Map();
    this._in = new Map();
    this._edges = [];
    this._build({ fitnessResults, datasets, contracts, obligations });
    this._digest = hash.sha256([...this._nodes.keys()].sort());
  }

  _add(kind, id, props = {}) {
    const key = `${kind}:${id}`;
    if (!NODE_KINDS[kind]) throw new Error(`unknown node kind '${kind}'`);
    if (!this._nodes.has(key)) { this._nodes.set(key, { key, kind, id, ...props }); this._out.set(key, new Set()); this._in.set(key, new Set()); }
    return key;
  }
  // Every edge is TEMPORAL (Phase 13, Part 5): it came into existence at some point, may have ended,
  // carries a version, and names what evidences it and who owns it. Without those five fields the
  // graph can only answer "what is true now", and the questions that matter in an investigation are
  // all of the form "what was true then".
  _link(from, to, rel, { createdAt = null, expiredAt = null, version = 1, evidence = null, owner = null } = {}) {
    if (!EDGE_KINDS[rel]) throw new Error(`unknown edge kind '${rel}' — an edge with no stated meaning is a line on a diagram`);
    if (!this._nodes.has(from) || !this._nodes.has(to)) return null;
    this._edges.push({
      from, to, rel, meaning: EDGE_KINDS[rel],
      createdAt: createdAt ?? this._epoch, expiredAt, version,
      evidence: evidence ?? this._edgeEvidence(from, to, rel),
      owner: owner ?? this._edgeOwner(from, to),
    });
    this._out.get(from).add(to); this._in.get(to).add(from);
    return true;
  }

  // What evidences this edge, and who owns it — derived rather than asked for, so an edge cannot be
  // added without them and they cannot drift from the registries.
  _edgeEvidence(from, to, rel) {
    if (rel === 'verified-by') return to.startsWith('evidence:') ? to : from;
    if (from.startsWith('control:')) return `evidence:${from.slice('control:'.length)}`;
    if (to.startsWith('control:')) return `evidence:${to.slice('control:'.length)}`;
    // Otherwise: the check that would FAIL if this edge were wrong. Declared per relationship
    // rather than guessed, on the same rule as everything else here — an edge whose evidence was
    // inferred from a name would eventually cite a control that checks something else entirely.
    return EDGE_EVIDENCE[rel] ? `evidence:${EDGE_EVIDENCE[rel]}` : null;
  }
  _edgeOwner(from, to) {
    for (const key of [from, to]) {
      const n = this._nodes.get(key);
      if (n && n.owner) return n.owner;
      if (n && n.kind === 'owner') return n.id;
      if (n && n.kind === 'bounded-context') { try { return ownership.describe(n.id).responsibleAuthority; } catch (_) { /* not a governed subsystem */ } }
    }
    return null;
  }

  _build({ fitnessResults, datasets, contracts, obligations }) {
    // --- Nodes, each from its registry -----------------------------------------------------------
    for (const file of adrGovernance.adrFiles()) {
      const a = adrGovernance.parse(file);
      this._add('adr', `ADR-${String(a.number).padStart(4, '0')}`, { title: a.title, status: a.status, file });
    }
    for (const id of contextMap.ids()) {
      const c = contextMap.describe(id);
      this._add('bounded-context', id, { domain: c.domain, status: c.status });
    }
    for (const [svc, spec] of Object.entries(telemetry.TOPOLOGY)) this._add('service', svc, { zone: spec.zone, criticality: spec.criticality });
    if (contracts) for (const c of contracts.list()) this._add('api', c.id, { version: c.version, stability: c.stability, owner: c.owner });
    for (const id of threat.ids()) { const t = threat.describe(id); this._add('risk', id, { title: t.title || id, severity: t.severity || null }); }
    for (const r of fitnessResults) {
      this._add('control', r.id, { holds: r.pass === true });
      // `sourceKind`, not `kind` — a prop named `kind` would shadow the node's own kind field and
      // silently reclassify every evidence node. Caught by the traceability check reporting zero.
      this._add('evidence', r.id, { check: r.id, holds: r.pass === true, sourceKind: 'executable-check' });
    }
    for (const p of multiRegion.contextConsistency()) this._add('policy', `consistency:${p.context}`, { model: p.model, adr: p.adr || null });
    for (const d of datasets) this._add('dataset', typeof d === 'string' ? d : d.id, typeof d === 'object' ? { owner: d.owner || null, domain: d.domain || null } : {});
    for (const [id, m] of Object.entries(require('../observability/business').BUSINESS_METRICS)) this._add('metric', id, { title: m.title, board: m.board });
    for (const s of ownership.subsystems()) { const o = ownership.describe(s); this._add('owner', o.responsibleAuthority, { board: o.board ? o.board.name : null }); }
    for (const [id, d] of Object.entries(evidenceConfidence.READINESS_DIMENSIONS)) this._add('readiness-dimension', id, { title: d.title, owner: d.owner });
    for (const o of obligations) this._add('compliance-obligation', typeof o === 'string' ? o : o.id, typeof o === 'object' ? { title: o.title || null, status: o.status || null, mapsToControls: [...(o.mapsToControls || [])] } : {});

    // --- Edges -----------------------------------------------------------------------------------
    // A control is verified by the evidence of the same name. This is the edge the traceability
    // property rests on, and it exists only where a check actually ran.
    for (const r of fitnessResults) this._link(`control:${r.id}`, `evidence:${r.id}`, 'verified-by');
    // Contexts depend on contexts; services depend on services; services run in a context where the
    // context map claims the module.
    for (const id of contextMap.ids()) {
      for (const dep of contextMap.describe(id).dependsOn || []) this._link(`bounded-context:${id}`, `bounded-context:${dep.context}`, 'depends-on');
    }
    for (const [svc, spec] of Object.entries(telemetry.TOPOLOGY)) {
      for (const dep of spec.dependsOn || []) this._link(`service:${svc}`, `service:${dep}`, 'depends-on');
    }
    // Policies govern their context and are decided by an ADR.
    for (const p of multiRegion.contextConsistency()) {
      this._link(`policy:consistency:${p.context}`, `bounded-context:${p.context}`, 'governs');
      if (p.adr) this._link(`adr:${p.adr}`, `policy:consistency:${p.context}`, 'decides');
    }
    // Controls govern the context that owns them, via the RACI control-ownership map — the same
    // map the build already fails on when a control has no owning context.
    const raci = require('../governance/raci');
    for (const row of raci.controlOwnership(fitnessResults.map((r) => r.id)).controls) {
      this._link(`control:${row.control}`, `bounded-context:${row.context}`, 'governs');
      if (row.responsibleAuthority) this._link(`control:${row.control}`, `owner:${row.responsibleAuthority}`, 'owned-by');
      // And the traceability direction: a context, and the authority accountable for it, are
      // DEMONSTRATED by the controls that hold over them. `governs` and `verified-by` are not
      // redundant — they are the same relationship read for two different questions ("what does
      // this control cover?" and "what shows this context is what it claims?"), and traceability
      // only follows the second.
      this._link(`bounded-context:${row.context}`, `control:${row.control}`, 'verified-by');
      if (row.responsibleAuthority) this._link(`owner:${row.responsibleAuthority}`, `control:${row.control}`, 'verified-by');
    }
    // An interface is exposed by the context that owns it, so an API traces to that context's
    // controls rather than floating free.
    if (contracts) for (const c of contracts.list()) this._link(`bounded-context:${c.owner}`, `api:${c.id}`, 'exposes') && this._link(`api:${c.id}`, `bounded-context:${c.owner}`, 'depends-on');
    // Contexts are owned by their accountable authority.
    for (const s of ownership.subsystems()) {
      const o = ownership.describe(s);
      this._link(`bounded-context:${s}`, `owner:${o.responsibleAuthority}`, 'owned-by');
    }
    // Readiness dimensions are assessed by the controls their owning context holds, so a dimension
    // reaches evidence through the controls rather than by assertion.
    for (const [id, d] of Object.entries(evidenceConfidence.READINESS_DIMENSIONS)) {
      this._link(`readiness-dimension:${id}`, `bounded-context:${d.owner}`, 'assessed-by');
    }
    // Risks threaten the contexts they are registered against, and are mitigated by controls.
    for (const id of threat.ids()) {
      const t = threat.describe(id);
      for (const ctl of t.mitigations || t.controls || []) this._link(`risk:${id}`, `control:${ctl}`, 'governs');
      if (t.context) this._link(`risk:${id}`, `bounded-context:${t.context}`, 'threatens');
    }
    // Metrics measure the mission chain's business processes; each is linked to the context that
    // produces it, through the declared correlation chain rather than by name matching.
    const bus = require('../observability/business');
    for (const l of bus.chainLinks()) {
      if (l.toLayer === 'business') this._link(`metric:${l.to}`, `service:${l.from}`, 'measures');
    }
    // Obligations mandate the controls they map to.
    for (const o of obligations) {
      const id = typeof o === 'string' ? o : o.id;
      for (const ctl of (typeof o === 'object' ? o.mapsToControls : []) || []) {
        this._link(`control:${ctl}`, `compliance-obligation:${id}`, 'mandated-by');
        // An obligation is demonstrated by the controls that implement it. An obligation mapping to
        // no control therefore stays untraceable — which is precisely the Part 19 compliance gap,
        // surfacing here as well rather than only in the compliance report.
        this._link(`compliance-obligation:${id}`, `control:${ctl}`, 'verified-by');
      }
    }
    // Datasets are derived from the context that governs them. The link is the dataset's OWNER,
    // which is a bounded-context id — `domain` is a data domain ("Justice", "Governance") and
    // matching on it linked nothing, which showed up immediately as datasets tracing to no evidence.
    for (const d of datasets) {
      if (typeof d !== 'object') continue;
      const ctx = this._nodes.has(`bounded-context:${d.owner}`) ? d.owner : (this._nodes.has(`bounded-context:${d.domain}`) ? d.domain : null);
      if (ctx) this._link(`dataset:${d.id}`, `bounded-context:${ctx}`, 'derived-from');
    }
    // ADRs decide the contexts they name. Matched on the ADR's own text, because a curated index is
    // another artefact to keep in step and the text is the record of what was decided.
    for (const file of adrGovernance.adrFiles()) {
      const a = adrGovernance.parse(file);
      const key = `adr:ADR-${String(a.number).padStart(4, '0')}`;
      for (const ctx of contextMap.ids()) {
        if (new RegExp(`\\b${ctx.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(a.raw)) this._link(key, `bounded-context:${ctx}`, 'decides');
      }
    }
  }

  // --- Queries -----------------------------------------------------------------------------------

  digest() { return this._digest; }
  nodeKinds() { return Object.entries(NODE_KINDS).map(([kind, s]) => ({ kind, ...s })); }
  edgeKinds() { return Object.entries(EDGE_KINDS).map(([rel, meaning]) => ({ rel, meaning })); }
  nodes(kind = null) { return [...this._nodes.values()].filter((n) => !kind || n.kind === kind).map((n) => ({ ...n })); }
  node(key) { const n = this._nodes.get(key); return n ? { ...n } : null; }
  edges() { return this._edges.map((e) => ({ ...e })); }
  out(key) { return [...(this._out.get(key) || [])].sort(); }
  into(key) { return [...(this._in.get(key) || [])].sort(); }
  stats() {
    return {
      nodes: this._nodes.size, edges: this._edges.length,
      byKind: Object.fromEntries(Object.keys(NODE_KINDS).map((k) => [k, this.nodes(k).length])),
      byEdge: this._edges.reduce((acc, e) => ((acc[e.rel] = (acc[e.rel] || 0) + 1), acc), {}),
      digest: this._digest,
    };
  }

  // Impact analysis: everything that reaches this node (its dependents) and everything it reaches.
  // Both directions, because "what breaks if this changes?" and "what is this standing on?" are
  // different questions and a single-direction traversal quietly answers only one of them.
  impactOf(key, { maxDepth = 6 } = {}) {
    if (!this._nodes.has(key)) return { node: key, known: false, reason: 'no such entity in the graph — absence of a node is not absence of the thing' };
    const walk = (start, index) => {
      const seen = new Map([[start, 0]]);
      const queue = [[start, 0]];
      while (queue.length) {
        const [cur, d] = queue.shift();
        if (d >= maxDepth) continue;
        for (const next of index.get(cur) || []) if (!seen.has(next)) { seen.set(next, d + 1); queue.push([next, d + 1]); }
      }
      seen.delete(start);
      return [...seen.entries()].map(([k, depth]) => ({ node: k, kind: this._nodes.get(k).kind, depth })).sort((a, b) => a.depth - b.depth || a.node.localeCompare(b.node));
    };
    const downstream = walk(key, this._out);   // what this node rests on
    const upstream = walk(key, this._in);      // what rests on this node
    return {
      node: key, known: true, kind: this._nodes.get(key).kind, maxDepth,
      dependsOn: downstream, dependents: upstream,
      directDependencies: this.out(key), directDependents: this.into(key),
      blastRadius: upstream.length,
      byDependentKind: upstream.reduce((acc, n) => ((acc[n.kind] = (acc[n.kind] || 0) + 1), acc), {}),
      caveat: 'Traversal is over DECLARED edges. An undeclared relationship does not appear, so this is a lower bound.',
      informationalOnly: true, authorizes: false,
    };
  }

  // THE PART 20 PROPERTY. Is each entity traceable to a piece of evidence — an executable check that
  // actually ran and holds? Reported per node and per kind, with the untraceable ones NAMED.
  traceability({ requireHolding = true } = {}) {
    const evidenceKeys = new Set(this.nodes('evidence').filter((e) => !requireHolding || e.holds === true).map((e) => e.key));
    const reaches = (start) => {
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        if (evidenceKeys.has(cur)) return cur;
        for (const next of this._out.get(cur) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      return null;
    };
    const rows = this.nodes().map((n) => {
      const via = n.kind === 'evidence' ? (evidenceKeys.has(n.key) ? n.key : null) : reaches(n.key);
      return { node: n.key, kind: n.kind, traceable: via !== null, evidence: via };
    });
    const byKind = {};
    for (const r of rows) {
      const b = (byKind[r.kind] = byKind[r.kind] || { kind: r.kind, total: 0, traceable: 0, untraceable: [] });
      b.total += 1;
      if (r.traceable) b.traceable += 1; else b.untraceable.push(r.node);
    }
    for (const b of Object.values(byKind)) b.coverage = b.total ? +(b.traceable / b.total).toFixed(4) : null;
    const untraceable = rows.filter((r) => !r.traceable);
    return {
      nodes: rows, total: rows.length, traceable: rows.length - untraceable.length,
      // Aggregate to the WEAKEST kind, not the mean: one entirely untraceable kind is the graph's
      // traceability story, whatever the other twelve say.
      coverage: rows.length ? +((rows.length - untraceable.length) / rows.length).toFixed(4) : null,
      // Tie-broken on kind name: several kinds at the same coverage is the common case, and a
      // winner that depends on node insertion order would make this report non-deterministic.
      weakestKind: Object.values(byKind).filter((b) => b.coverage !== null).sort((a, b) => a.coverage - b.coverage || a.kind.localeCompare(b.kind))[0] || null,
      byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
      untraceable: untraceable.map((r) => r.node),
      complete: untraceable.length === 0,
      requireHolding,
      note: requireHolding
        ? 'Traceable means: a path exists from this entity to an executable check that ran AND held. A path to a FAILING check is not traceability — it is a demonstrated defect.'
        : 'Traceable means: a path exists to an executable check that ran, whether or not it held.',
      informationalOnly: true, authorizes: false,
    };
  }

  // --- Temporal queries (Phase 13, Part 5) --------------------------------------------------------

  // Every edge, current and superseded, as one series. Historical edges are supplied by the caller
  // rather than invented here: this module has no store, and manufacturing a history it never
  // observed is precisely the fabrication the global requirements forbid.
  allEdges() { return [...this._history.map((h) => ({ ...h, historical: true })), ...this._edges.map((e) => ({ ...e, historical: false }))]; }

  // Which edges were in force at an instant. An edge with no creation time cannot be placed in time
  // and is EXCLUDED rather than assumed to have always existed.
  edgesAsOf(at) {
    if (!Number.isFinite(at)) throw new Error('a temporal query needs an instant');
    return this.allEdges().filter((e) => Number.isFinite(e.createdAt) && e.createdAt <= at && (e.expiredAt === null || e.expiredAt === undefined || e.expiredAt > at));
  }

  // The Part 5 questions, answered by one traversal over the edges in force at that instant: which
  // policies governed this dataset then, which controls existed, which ADRs were active, which
  // owners were accountable, which readiness dimensions were assessed.
  asOf(at, { node = null } = {}) {
    const edges = this.edgesAsOf(at);
    const reachable = new Set();
    if (node) {
      const queue = [node]; reachable.add(node);
      while (queue.length) {
        const cur = queue.shift();
        for (const e of edges) {
          const next = e.from === cur ? e.to : (e.to === cur ? e.from : null);
          if (next && !reachable.has(next)) { reachable.add(next); queue.push(next); }
        }
      }
    }
    const universe = node ? reachable : new Set(edges.flatMap((e) => [e.from, e.to]));
    const of = (kind) => [...universe].filter((k) => k.startsWith(`${kind}:`)).sort();
    return {
      at, node,
      edges: node ? edges.filter((e) => e.from === node || e.to === node).length : edges.length,
      totalEdgesInForce: edges.length,
      policies: of('policy'), controls: of('control'), adrs: of('adr'),
      owners: of('owner'), readinessDimensions: of('readiness-dimension'),
      datasets: of('dataset'), obligations: of('compliance-obligation'),
      // An edge nobody dated cannot be placed in history, and saying so is the point.
      undated: this.allEdges().filter((e) => !Number.isFinite(e.createdAt)).map((e) => `${e.from} → ${e.to}`),
      informationalOnly: true, authorizes: false,
      note: 'Edges in force at the given instant. An edge with no creation time is excluded rather than assumed eternal — an undated relationship cannot honestly be placed in the past.',
    };
  }

  // What changed between two instants: what came into force, what ended, what was re-versioned.
  temporalImpact(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('a temporal impact analysis needs two instants');
    if (to < from) throw new Error('the second instant must not precede the first');
    const key = (e) => `${e.from}|${e.to}|${e.rel}`;
    const beforeEdges = this.edgesAsOf(from);
    const before = new Set(beforeEdges.map(key));
    const after = this.edgesAsOf(to);
    const afterKeys = new Set(after.map(key));
    const added = after.filter((e) => !before.has(key(e)));
    const removed = beforeEdges.filter((e) => !afterKeys.has(key(e)));
    const reversioned = this.allEdges().filter((e) => e.version > 1 && Number.isFinite(e.createdAt) && e.createdAt > from && e.createdAt <= to);
    return {
      from, to,
      added: added.map((e) => ({ edge: `${e.from} → ${e.to}`, rel: e.rel, owner: e.owner, evidence: e.evidence })),
      removed: removed.map((e) => ({ edge: `${e.from} → ${e.to}`, rel: e.rel, expiredAt: e.expiredAt })),
      reversioned: reversioned.map((e) => ({ edge: `${e.from} → ${e.to}`, version: e.version })),
      unchanged: after.length - added.length,
      informationalOnly: true, authorizes: false,
    };
  }

  // Are the edges actually placeable in time? Reported per edge rather than as a single boolean,
  // because "mostly temporal" is the state a half-migrated graph is in and it should be visible.
  temporalIntegrity() {
    const edges = this.allEdges();
    const undated = edges.filter((e) => !Number.isFinite(e.createdAt));
    const unowned = edges.filter((e) => !e.owner);
    const unevidenced = edges.filter((e) => !e.evidence);
    const backwards = edges.filter((e) => Number.isFinite(e.expiredAt) && Number.isFinite(e.createdAt) && e.expiredAt < e.createdAt);
    return {
      edges: edges.length,
      dated: edges.length - undated.length,
      coverage: edges.length ? +((edges.length - undated.length) / edges.length).toFixed(4) : null,
      undated: undated.map((e) => `${e.from} → ${e.to}`),
      unowned: unowned.map((e) => `${e.from} → ${e.to}`),
      unevidenced: unevidenced.map((e) => `${e.from} → ${e.to}`),
      expiredBeforeCreated: backwards.map((e) => `${e.from} → ${e.to}`),
      sound: undated.length === 0 && backwards.length === 0,
    };
  }

  // The graph must describe the platform rather than a convenient subset of it.
  validate() {
    const violations = [];
    for (const [kind, spec] of Object.entries(NODE_KINDS)) {
      if (!spec.source) violations.push(`node kind '${kind}' names no source registry`);
      if (!spec.label) violations.push(`node kind '${kind}' has no label`);
    }
    for (const [rel, meaning] of Object.entries(EDGE_KINDS)) if (!meaning) violations.push(`edge kind '${rel}' states no meaning`);
    for (const e of this._edges) {
      if (!this._nodes.has(e.from)) violations.push(`edge ${e.from} → ${e.to}: source is not a node`);
      if (!this._nodes.has(e.to)) violations.push(`edge ${e.from} → ${e.to}: target is not a node`);
      if (!EDGE_KINDS[e.rel]) violations.push(`edge ${e.from} → ${e.to}: unknown relationship '${e.rel}'`);
    }
    // Every context in the architecture-of-record is a node — the same drift check the twin makes.
    for (const id of contextMap.ids()) if (!this._nodes.has(`bounded-context:${id}`)) violations.push(`'${id}' is in the architecture-of-record but not in the graph`);
    // An isolated node is not an error, but it IS reported: an entity nothing connects to is an
    // entity nothing can be reasoned about from.
    const isolated = this.nodes().filter((n) => !this.out(n.key).length && !this.into(n.key).length).map((n) => n.key);
    return { valid: violations.length === 0, violations, isolated, nodes: this._nodes.size, edges: this._edges.length };
  }

  report({ requireHolding = true } = {}) {
    return {
      stats: this.stats(), nodeKinds: this.nodeKinds(), edgeKinds: this.edgeKinds(),
      validation: this.validate(),
      traceability: this.traceability({ requireHolding }),
      temporalIntegrity: this.temporalIntegrity(),
      informationalOnly: true, authorizes: false,
      note: 'Built from the registries on each construction, never maintained beside them. Traceability is a per-entity question with named answers, not a tick over the whole graph.',
    };
  }
}

module.exports = { EnterpriseGraph, NODE_KINDS, EDGE_KINDS, EDGE_EVIDENCE };
