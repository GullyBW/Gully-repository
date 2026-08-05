'use strict';
// Documentation Assurance Framework (Phase 13, Parts 6 & 7). Extends the architecture bounded
// context, generalising the Phase 12 runbook gate from one document to the whole corpus.
//
// Phase 12 checked that the runbook's API routes existed. That closed the sharpest gap — a route
// renamed in `server.js` leaving the runbook telling an operator to call something that 404s — and
// left everything else: an ADR cross-reference to a decision that was never written, a documented
// npm script that no longer exists, a fitness identifier quoted in a governance document after the
// control was renamed, a link to a document somebody deleted.
//
// The design rule that keeps this from being decorative:
//
//   AN UNPARSEABLE OR UNRESOLVABLE CLAIM IS A FINDING, NOT A SKIP.
//
// The obvious failure mode of a documentation checker is that its extractor quietly stops matching,
// coverage reads 100%, and nothing has been verified for months. So the extractor's own yield is
// checked: a document with no extractable claims is reported, and a corpus below a floor of claims
// fails outright.
//
// What this CANNOT do is execute a shell command, so it does not claim to. A documented command is
// verified to RESOLVE — the npm script exists, the file it runs is present — and the report says
// that is what was checked. Claiming to have run it would be the same lie in the other direction.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');

// What a document can claim, how it is found, and what "resolved" means for it.
const CLAIM_KINDS = {
  'api-route': {
    description: 'An HTTP path a reader is told to call.',
    resolvedMeans: 'A route in src/server.js matches it, by literal or by path pattern.',
    ifWrong: 'An operator calls it under pressure and gets a 404.',
  },
  'npm-command': {
    description: 'An `npm run <script>` a reader is told to run.',
    resolvedMeans: 'The script is defined in package.json.',
    ifWrong: 'The documented procedure cannot be followed at all.',
  },
  'adr-reference': {
    description: 'A citation of ADR-NNNN.',
    resolvedMeans: 'An ADR with that number exists in docs/adr/.',
    ifWrong: 'A decision is cited as authority for something, and the decision does not exist.',
  },
  'doc-link': {
    description: 'A relative markdown link to another file in this repository.',
    resolvedMeans: 'The target file exists on disk.',
    ifWrong: 'The reader is sent to a document that is not there.',
  },
  'fitness-id': {
    description: 'A control identifier quoted as the thing that enforces a claim.',
    resolvedMeans: 'A fitness function of that identifier actually runs.',
    ifWrong: 'A document claims a guarantee is enforced by a control nobody runs.',
  },
  'source-module': {
    description: 'A `src/...` path named as where something lives.',
    resolvedMeans: 'The file exists on disk.',
    ifWrong: 'A reader looking for the implementation cannot find it.',
  },
};

// Documents an operator or a reviewer is actually sent to, and what each is for. A corpus defined by
// a glob would silently start checking scratch files; naming them makes the scope a decision.
//
// `operational-procedure` is the strongest role and is held to PROCEDURE_REQUIREMENTS below.
// `operational-reference` is documentation an operator reads to understand something rather than to
// follow it step by step; holding reference material to a rollback-section requirement would train
// people to add empty sections, which is worse than the gap.
const GOVERNED_DOCUMENTS = {
  'operations/runbook.md': { role: 'operational-procedure', audience: 'operator' },
  'architecture-governance.md': { role: 'governance-documentation', audience: 'reviewer' },
  'context-map.md': { role: 'architecture-documentation', audience: 'reviewer' },
  'governance-ownership.md': { role: 'governance-documentation', audience: 'reviewer' },
  'recovery-framework.md': { role: 'recovery-documentation', audience: 'operator' },
  'multi-region.md': { role: 'operational-reference', audience: 'operator' },
  'zero-trust.md': { role: 'policy-documentation', audience: 'reviewer' },
  'compliance-intelligence.md': { role: 'compliance-reference', audience: 'reviewer' },
  'assumptions.md': { role: 'governance-documentation', audience: 'reviewer' },
  'operations-twin.md': { role: 'operational-reference', audience: 'reviewer' },
  'enterprise-graph.md': { role: 'architecture-documentation', audience: 'reviewer' },
  'evidence-confidence.md': { role: 'governance-documentation', audience: 'reviewer' },
  // Phase 14. Governed from the day they were written, so neither can quietly stop describing the
  // implementation the way an unregistered document would.
  'adaptive-governance.md': { role: 'governance-documentation', audience: 'reviewer' },
  'strategic-planning.md': { role: 'governance-documentation', audience: 'reviewer' },
};

// Below this, the extractor has broken rather than the corpus being clean.
const MINIMUM_CLAIMS = 100;

function readIfPresent(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } }

// --- Reality: what actually exists ----------------------------------------------------------------

function serverRoutes() {
  const src = readIfPresent(path.join(ROOT, 'src', 'server.js')) || '';
  // Every literal path the server compares against, not only `/api/...` — the OpenAPI check below
  // needs `/healthz`, `/readyz` and `/metrics` too, and they are routes like any other.
  const literals = new Set([...src.matchAll(/p === '(\/[^']*)'/g)].map((m) => m[1]));
  const patterns = [...src.matchAll(/p\.match\((\/(?:\\.|\[[^\]]*\]|[^/\\])+\/)\)/g)]
    .map((m) => m[1]).filter((r) => r.includes('api')).map((r) => new RegExp(r.slice(1, -1)));
  return { literals, patterns };
}
function npmScripts() {
  try { return new Set(Object.keys(JSON.parse(readIfPresent(path.join(ROOT, 'package.json'))).scripts || {})); }
  catch (_) { return new Set(); }
}
function adrNumbers() {
  try {
    return new Set(fs.readdirSync(path.join(DOCS, 'adr')).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => Number(f.slice(0, 4))));
  } catch (_) { return new Set(); }
}

// --- Extraction -----------------------------------------------------------------------------------

// Pull every checkable claim out of one document. Each claim carries the raw text it came from, so a
// finding can be traced back to the sentence that made it.
function extractClaims(text, { relativeTo = '' } = {}) {
  const claims = [];
  const add = (kind, value, raw) => claims.push({ kind, value, raw: raw.trim().slice(0, 120) });

  for (const m of text.matchAll(/(\/api\/[A-Za-z0-9/{},:<>_-]*)/g)) {
    const raw = m[1].replace(/[.,)]+$/, '');
    const brace = raw.match(/^(.*)\{([^}]*)\}(.*)$/);
    const variants = brace ? brace[2].split(',').map((o) => `${brace[1]}${o.trim()}${brace[3]}`) : [raw];
    for (const variant of variants) {
      const normalised = variant.replace(/\/$/, '').split('/')
        .map((seg) => (seg.startsWith('<') || seg.startsWith(':') ? 'sample' : seg)).join('/');
      if (normalised.length > 4) add('api-route', normalised, m[0]);
    }
  }
  for (const m of text.matchAll(/npm run ([a-z0-9:-]+)/g)) add('npm-command', m[1], m[0]);
  for (const m of text.matchAll(/ADR-(\d{4})/g)) add('adr-reference', Number(m[1]), m[0]);
  for (const m of text.matchAll(/\]\((\.\.?\/[^)\s#]+)/g)) add('doc-link', path.posix.normalize(path.posix.join(relativeTo, m[1])), m[0]);
  for (const m of text.matchAll(/\b((?:APP-FIT|INFRA-FIT|FIT)-[A-Z0-9-]+)\b/g)) add('fitness-id', m[1], m[0]);
  for (const m of text.matchAll(/`(src\/[A-Za-z0-9/_.-]+\.js)`/g)) add('source-module', m[1], m[0]);
  return claims;
}

// --- Verification ---------------------------------------------------------------------------------

function verifyClaim(claim, { routes, scripts, adrs, controls }) {
  switch (claim.kind) {
    case 'api-route': {
      // A documented placeholder may stand for a word or a number, and a route may constrain which
      // it accepts. Both substitutions are tried — found by this check reporting a documented
      // `as-of/:instant` as unresolvable against a route whose parameter is `(\d+)`.
      const candidates = [claim.value, claim.value.replace(/\/sample\b/g, '/1'), `${claim.value}/sample`, `${claim.value}/1`];
      const ok = candidates.some((c) => routes.literals.has(c) || routes.patterns.some((r) => r.test(c)));
      return { resolved: ok, detail: ok ? 'a route serves this path' : 'no route serves this path' };
    }
    case 'npm-command': {
      const ok = scripts.has(claim.value);
      // Stated precisely: the script is DEFINED. Nothing here executed it.
      return { resolved: ok, detail: ok ? 'defined in package.json (resolved, not executed)' : 'no such npm script is defined' };
    }
    case 'adr-reference':
      return { resolved: adrs.has(claim.value), detail: adrs.has(claim.value) ? 'the ADR exists' : 'no ADR with this number exists' };
    case 'doc-link': {
      const ok = fs.existsSync(path.join(DOCS, claim.value)) || fs.existsSync(path.join(ROOT, claim.value));
      return { resolved: ok, detail: ok ? 'the target file exists' : 'the target file does not exist' };
    }
    case 'fitness-id':
      return { resolved: controls.has(claim.value), detail: controls.has(claim.value) ? 'this control runs' : 'no control of this identifier runs' };
    case 'source-module': {
      const ok = fs.existsSync(path.join(ROOT, claim.value));
      return { resolved: ok, detail: ok ? 'the module exists' : 'no such module' };
    }
    default:
      // An unknown claim kind is a finding, never a pass.
      return { resolved: false, detail: `unknown claim kind '${claim.kind}' — an unrecognised claim is unverified, not verified` };
  }
}

// Verify one document. `missing: true` is itself a finding — a governed document that is not there
// cannot be followed.
function verifyDocument(relative, { controls = [] } = {}) {
  const spec = GOVERNED_DOCUMENTS[relative] || { role: 'unclassified', audience: 'unknown' };
  const file = path.join(DOCS, relative);
  const text = readIfPresent(file);
  if (text === null) {
    return { document: relative, ...spec, missing: true, claims: 0, unresolved: [{ kind: 'document', value: relative, detail: 'the document does not exist' }], sound: false };
  }
  const world = {
    routes: serverRoutes(), scripts: npmScripts(), adrs: adrNumbers(),
    controls: new Set(controls.map((c) => (typeof c === 'string' ? c : c.id))),
  };
  const claims = extractClaims(text, { relativeTo: path.posix.dirname(relative) });
  const results = claims.map((c) => ({ ...c, ...verifyClaim(c, world) }));
  const unresolved = results.filter((r) => !r.resolved);
  const byKind = {};
  for (const r of results) {
    const b = (byKind[r.kind] = byKind[r.kind] || { kind: r.kind, total: 0, resolved: 0 });
    b.total += 1; if (r.resolved) b.resolved += 1;
  }
  return {
    document: relative, ...spec, missing: false,
    claims: claims.length, byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    unresolved: unresolved.map((r) => ({ kind: r.kind, value: r.value, raw: r.raw, detail: r.detail })),
    resolvedCount: results.length - unresolved.length,
    // A governed document from which nothing could be extracted is reported, because that is what a
    // broken extractor looks like from the outside.
    noClaims: claims.length === 0,
    sound: unresolved.length === 0 && claims.length > 0,
  };
}

function documents() { return Object.keys(GOVERNED_DOCUMENTS).sort(); }
function claimKinds() { return Object.entries(CLAIM_KINDS).map(([kind, spec]) => ({ kind, ...spec })); }

// The corpus-wide report.
function verify({ controls = [] } = {}) {
  const rows = documents().map((d) => verifyDocument(d, { controls }));
  const totalClaims = rows.reduce((a, r) => a + r.claims, 0);
  const unresolved = rows.flatMap((r) => r.unresolved.map((u) => ({ document: r.document, ...u })));
  const byKind = {};
  for (const r of rows) for (const b of r.byKind || []) {
    const acc = (byKind[b.kind] = byKind[b.kind] || { kind: b.kind, total: 0, resolved: 0 });
    acc.total += b.total; acc.resolved += b.resolved;
  }
  for (const b of Object.values(byKind)) b.coverage = b.total ? +(b.resolved / b.total).toFixed(4) : null;
  // The extractor guards itself: too few claims means it has stopped matching, and a check that
  // passes because it found nothing to check is worse than no check.
  const extractorSound = totalClaims >= MINIMUM_CLAIMS;
  return {
    documents: rows, documentCount: rows.length,
    claims: totalClaims, minimumClaims: MINIMUM_CLAIMS, extractorSound,
    byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    unresolved, unresolvedCount: unresolved.length,
    missingDocuments: rows.filter((r) => r.missing).map((r) => r.document),
    documentsWithNoClaims: rows.filter((r) => r.noClaims && !r.missing).map((r) => r.document),
    claimKinds: claimKinds(),
    sound: unresolved.length === 0 && extractorSound && rows.every((r) => !r.missing),
    verifiedNotExecuted: 'A documented command is verified to RESOLVE — the script exists — not to succeed. Nothing here runs a shell command, and claiming otherwise would be the same failure in the other direction.',
    failClosed: true, informationalOnly: true, authorizes: false,
  };
}

// --- Part 7: operational procedure verification ---------------------------------------------------
//
// A runbook that resolves every route it names can still be unfollowable: no prerequisites, no
// stated permission, no rollback, nobody to escalate to. These are the sections an operational
// document must carry to be worth opening at 03:00, checked by presence and by content.
const PROCEDURE_REQUIREMENTS = {
  prerequisites: { pattern: /prerequisit|before you (start|begin)|requires?:/i, why: 'An operator must know what has to be true before starting.' },
  permissions: { pattern: /\b(admin|oversight-board|investigator|requireRole|authenticated)\b/i, why: 'A procedure nobody can say who may run is one anybody might.' },
  recoveryTimes: { pattern: /\b(RTO|RPO|\d+\s*(min|minute|hour|h)\b)/i, why: 'An expected duration is what tells an operator whether it is going badly.' },
  dependencies: { pattern: /\b(depends?|dependency|dependencies|requires)\b/i, why: 'What must be available for the procedure to work.' },
  escalation: { pattern: /\b(escalat|Board|ARB|ORB|OB|ISRB)\b/, why: 'Somebody has to be named to escalate to.' },
  rollback: { pattern: /\b(rollback|roll back|revert|restore)\b/i, why: 'A procedure you cannot reverse is a bet.' },
  communication: { pattern: /\b(notify|communicat|inform|report to|announce)\b/i, why: 'Who is told, and when.' },
};

function verifyProcedures({ documentsToCheck = null } = {}) {
  const targets = (documentsToCheck || documents()).filter((d) => (GOVERNED_DOCUMENTS[d] || {}).role === 'operational-procedure');
  const rows = targets.map((relative) => {
    const text = readIfPresent(path.join(DOCS, relative));
    if (text === null) return { document: relative, missing: true, satisfied: [], absent: Object.keys(PROCEDURE_REQUIREMENTS), complete: false };
    const satisfied = [], absent = [];
    for (const [req, spec] of Object.entries(PROCEDURE_REQUIREMENTS)) (spec.pattern.test(text) ? satisfied : absent).push(req);
    return {
      document: relative, missing: false, satisfied, absent,
      complete: absent.length === 0,
      gaps: absent.map((a) => ({ requirement: a, why: PROCEDURE_REQUIREMENTS[a].why })),
    };
  });
  return {
    procedures: rows, count: rows.length,
    requirements: Object.entries(PROCEDURE_REQUIREMENTS).map(([id, s]) => ({ requirement: id, why: s.why })),
    incomplete: rows.filter((r) => !r.complete).map((r) => r.document),
    complete: rows.length > 0 && rows.every((r) => r.complete),
    // Said plainly: presence of a section is not proof the procedure works.
    caveat: 'This checks that an operational document CARRIES each element, not that the procedure succeeds. A rollback section that is wrong passes here and fails in an incident; only a rehearsal catches that.',
    failClosed: true, authorizes: false,
  };
}

// --- Diagram assurance (Phase 14, Part 5) ---------------------------------------------------------
//
// Prose claims were the easy half. A diagram is the part of the documentation people actually trust,
// because it is quick to read and looks authoritative — and it is the part that rots fastest, because
// nothing in a normal build touches it. A box labelled with a bounded context that was renamed two
// phases ago will sit in an architecture diagram indefinitely, and every reader will believe it.
//
// So diagrams are verified the same way prose is: every NODE must resolve to something that exists,
// and every EDGE must correspond to a relationship the implementation actually declares. A diagram
// that draws an arrow the architecture does not have is not a simplification — it is a claim about
// the system, and it is false.
//
// Two rules, both learned from the prose checker:
//
//   A DIAGRAM WITH NO EXTRACTABLE NODES IS A FINDING. Silently matching nothing is how a checker
//   reports 100% coverage of zero diagrams.
//
//   THE CORPUS HAS A FLOOR. `MINIMUM_DIAGRAMS` fails the build if the diagrams disappear, because a
//   documentation set with no diagrams passes every check here trivially.
const DIAGRAM_KINDS = {
  architecture: {
    description: 'Bounded contexts and the declared dependencies between them.',
    resolvedMeans: 'Every node is a bounded context in the context map; every edge is a declared dependency.',
    ifWrong: 'A reviewer reasons about a structure the platform does not have.',
  },
  sequence: {
    description: 'An ordered interaction between named participants.',
    resolvedMeans: 'Every participant is a modelled service, a bounded context, or a declared external actor.',
    ifWrong: 'An engineer implements against a conversation that never happens.',
  },
  deployment: {
    description: 'Regions, zones and what runs where.',
    resolvedMeans: 'Every node is a declared region or deployment zone.',
    ifWrong: 'A failover is planned against a topology that is not deployed.',
  },
  infrastructure: {
    description: 'Services and the dependencies between them.',
    resolvedMeans: 'Every node is a service in the operational topology; every edge is a declared dependency.',
    ifWrong: 'Blast radius is estimated from a picture rather than from the topology, and the picture is kinder.',
  },
  'process-flow': {
    description: 'A chain of consequences or steps through the platform.',
    resolvedMeans: 'Every node is a declared mission-chain node; every edge is a declared link.',
    ifWrong: 'A board is shown a consequence chain the forecast does not actually traverse.',
  },
  openapi: {
    description: 'A documented HTTP operation.',
    resolvedMeans: 'The path appears in the generated OpenAPI document and a route serves it.',
    ifWrong: 'An integrator builds against an endpoint that does not exist.',
  },
  state: {
    description: 'A state machine: states and the transitions between them.',
    resolvedMeans: 'Every state and every transition exists in the implementation\'s transition table.',
    ifWrong: 'An operator expects a transition the platform refuses, in the middle of an incident.',
  },
};

// Below this the diagrams have been deleted rather than the corpus being clean.
const MINIMUM_DIAGRAMS = 5;

// Pull every fenced mermaid block out of a document, along with the `kind:` marker the diagram must
// declare. An undeclared kind is a finding: a checker cannot verify a diagram it cannot classify, and
// guessing from the mermaid header would let a renamed diagram slip into the weakest ruleset.
function extractDiagrams(text, { document = '' } = {}) {
  const out = [];
  for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    const body = m[1];
    const declared = body.match(/%%\s*njtip:kind=([a-z-]+)\s*(?:source=([^\s%]+))?/);
    out.push({
      document, kind: declared ? declared[1] : null, source: declared ? declared[2] || null : null,
      body, header: (body.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%')) || '').trim(),
    });
  }
  return out;
}

// Mermaid node identifiers and edges, read structurally. Deliberately narrow: it understands the
// subset the platform's own diagrams use, and anything it cannot parse is reported rather than
// skipped.
function parseMermaid(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));
  const header = lines[0] || '';
  const nodes = new Set();
  const edges = [];
  const participants = [];
  const states = new Set();
  const unparsed = [];

  for (const line of lines.slice(1)) {
    if (/^(subgraph|end|direction|classDef|class |style |autonumber|Note )/.test(line)) continue;
    // sequenceDiagram: `participant X as Label`, `A->>B: message`
    const participant = line.match(/^participant\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.+))?$/);
    if (participant) { participants.push({ id: participant[1], label: participant[2] || participant[1] }); nodes.add(participant[1]); continue; }
    const message = line.match(/^([A-Za-z0-9_-]+)\s*-?->>?\+?\s*([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (message) { nodes.add(message[1]); nodes.add(message[2]); edges.push({ from: message[1], to: message[2], label: message[3] }); continue; }
    // stateDiagram: `A --> B: event`
    // flowchart/graph: `A[Label] --> B[Label]`, `A -->|label| B`
    const edge = line.match(/^([A-Za-z0-9_:-]+)(?:[[({][^\])}]*[\])}])?\s*-->\s*(?:\|([^|]*)\|\s*)?([A-Za-z0-9_:-]+)(?:[[({][^\])}]*[\])}])?$/);
    if (edge) {
      const [, from, label, to] = edge;
      nodes.add(from); nodes.add(to);
      if (header.startsWith('stateDiagram')) { states.add(from); states.add(to); }
      edges.push({ from, to, label: label ? label.trim() : null });
      continue;
    }
    const bare = line.match(/^([A-Za-z0-9_:-]+)[[({][^\])}]*[\])}]$/);
    if (bare) { nodes.add(bare[1]); continue; }
    unparsed.push(line);
  }
  return { header, nodes: [...nodes].sort(), edges, participants, states: [...states].sort(), unparsed };
}

// What each diagram kind is checked against. Every resolver reads the implementation directly — a
// curated list of "things a diagram may name" would be a second architecture-of-record.
function diagramWorld() {
  const contextMap = require('./context-map');
  const telemetry = require('../observability/telemetry');
  const multiRegion = require('../twin2/multi-region');
  const bus = require('../observability/business');
  const caseLifecycle = require('../domain/case-lifecycle');

  const contexts = new Set(contextMap.ids());
  const contextEdges = new Set(contextMap.ids().flatMap((id) => (contextMap.describe(id).dependsOn || []).map((d) => `${id}→${d.context}`)));
  const services = new Set(Object.keys(telemetry.TOPOLOGY));
  const serviceEdges = new Set(Object.entries(telemetry.TOPOLOGY).flatMap(([id, s]) => [
    ...(s.dependsOn || []).map((d) => `${id}→${d}`),
    ...(s.degradesOn || []).map((d) => `${id}→${d}`),
  ]));
  const zones = new Set(Object.values(telemetry.TOPOLOGY).map((s) => s.zone));
  const regions = new Set(Object.keys(multiRegion.REGIONS));
  const chainNodes = new Set(bus.missionDependencyGraph().nodes.map((n) => n.id));
  const chainEdges = new Set(bus.MISSION_IMPACT_LINKS.map((l) => `${l.from}→${l.to}`));
  // The case lifecycle's transitions are derived from `allowedEvents` and the event target table
  // rather than read from a literal map, because that is where the implementation actually decides.
  const caseStates = new Set(caseLifecycle.STATES);
  const caseTransitions = new Set(caseLifecycle.STATES.flatMap((from) => caseLifecycle.allowedEvents(from).map((ev) => `${from}→${caseLifecycle.targetFor(ev)}`)));
  return { contexts, contextEdges, services, serviceEdges, zones, regions, chainNodes, chainEdges, caseStates, caseTransitions };
}

// Verify one diagram against the implementation.
function verifyDiagram(diagram, world = diagramWorld()) {
  const spec = DIAGRAM_KINDS[diagram.kind];
  const findings = [];
  if (!spec) {
    return {
      ...diagram, nodes: [], edges: 0,
      findings: [{ subject: diagram.header || '(empty)', detail: `the diagram declares no recognised kind — add '%% njtip:kind=<${Object.keys(DIAGRAM_KINDS).join('|')}>'. A diagram nothing can classify is a diagram nothing can check.` }],
      sound: false,
    };
  }
  const parsed = parseMermaid(diagram.body);
  for (const line of parsed.unparsed) findings.push({ subject: line, detail: 'this line could not be parsed — an unparseable line is unverified, not verified' });
  if (!parsed.nodes.length) findings.push({ subject: diagram.header || '(empty)', detail: 'no nodes could be extracted — a diagram nothing can be read out of cannot be checked against anything' });

  const check = (names, known, what) => {
    for (const n of names) if (!known.has(n)) findings.push({ subject: n, detail: `is not ${what}` });
  };
  const checkEdges = (known, what) => {
    for (const e of parsed.edges) if (!known.has(`${e.from}→${e.to}`)) findings.push({ subject: `${e.from} → ${e.to}`, detail: `is drawn as an arrow and ${what}` });
  };

  switch (diagram.kind) {
    case 'architecture':
      check(parsed.nodes, world.contexts, 'a bounded context in the context map');
      checkEdges(world.contextEdges, 'the context map declares no such dependency');
      break;
    case 'infrastructure':
      check(parsed.nodes, world.services, 'a service in the operational topology');
      checkEdges(world.serviceEdges, 'the topology declares no such dependency');
      break;
    case 'deployment':
      check(parsed.nodes, new Set([...world.regions, ...world.zones]), 'a declared region or deployment zone');
      break;
    case 'process-flow':
      check(parsed.nodes, world.chainNodes, 'a node in the mission chain');
      checkEdges(world.chainEdges, 'the mission chain declares no such link');
      break;
    case 'state':
      check(parsed.nodes, world.caseStates, 'a state in the case lifecycle');
      checkEdges(world.caseTransitions, 'the lifecycle declares no such transition');
      break;
    case 'sequence': {
      // Participants may be services, contexts, or an explicitly declared external actor written in
      // capitals — a citizen is a real participant and is not a service.
      const known = new Set([...world.services, ...world.contexts]);
      for (const p of parsed.participants) {
        if (!known.has(p.id) && !/^[A-Z][A-Za-z]*$/.test(p.id)) findings.push({ subject: p.id, detail: 'is neither a modelled service, a bounded context, nor an external actor written in CamelCase' });
      }
      if (!parsed.participants.length) findings.push({ subject: diagram.header, detail: 'a sequence diagram with no declared participants — every lifeline must be named so it can be resolved' });
      if (!parsed.edges.length) findings.push({ subject: diagram.header, detail: 'a sequence diagram with no messages is a list of participants' });
      break;
    }
    default:
      findings.push({ subject: diagram.kind, detail: 'no resolver exists for this diagram kind' });
  }
  return {
    document: diagram.document, kind: diagram.kind, header: parsed.header, source: diagram.source,
    nodes: parsed.nodes, edges: parsed.edges.length, findings, sound: findings.length === 0,
    ...spec,
  };
}

// The OpenAPI half of Part 5. The document is generated from code, so the risk is not that it drifts
// from the server — it is that the DOCUMENTATION tells an integrator about operations the spec does
// not contain, or the spec publishes operations no route serves.
function verifyOpenApi() {
  const spec = require('../openapi').spec();
  const routes = serverRoutes();
  const findings = [];
  const paths = Object.keys(spec.paths || {});
  if (!paths.length) findings.push({ subject: 'openapi', detail: 'the generated specification publishes no paths at all' });
  for (const p of paths) {
    // `{param}` in OpenAPI; the server matches a literal or a pattern. A trailing `?` distinguishes
    // a query-string operation from the same path under another verb, and is not part of the route.
    const base = p.replace(/\?$/, '');
    const candidates = [base, base.replace(/\{[^}]+\}/g, 'sample'), base.replace(/\{[^}]+\}/g, '1')];
    if (!candidates.some((c) => routes.literals.has(c) || routes.patterns.some((r) => r.test(c)))) {
      findings.push({ subject: p, detail: 'is published in the OpenAPI document and no route serves it' });
    }
  }
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!op.operationId) findings.push({ subject: `${method.toUpperCase()} ${p}`, detail: 'has no operationId, so nothing can refer to it' });
      if (!op.summary) findings.push({ subject: `${method.toUpperCase()} ${p}`, detail: 'has no summary' });
      if (!op.responses || !Object.keys(op.responses).length) findings.push({ subject: `${method.toUpperCase()} ${p}`, detail: 'declares no responses' });
    }
  }
  return {
    paths: paths.length,
    operations: Object.values(spec.paths || {}).reduce((a, ops) => a + Object.keys(ops).length, 0),
    findings, sound: findings.length === 0,
    note: 'The specification is generated from code, so this checks the other direction: that everything it publishes is actually served, and that every operation carries what an integrator needs.',
  };
}

// The corpus-wide diagram report.
function verifyDiagrams({ documentsToCheck = null } = {}) {
  const world = diagramWorld();
  const rows = [];
  for (const relative of documentsToCheck || documents()) {
    const text = readIfPresent(path.join(DOCS, relative));
    if (text === null) continue;
    for (const d of extractDiagrams(text, { document: relative })) rows.push(verifyDiagram(d, world));
  }
  const findings = rows.flatMap((r) => r.findings.map((f) => ({ document: r.document, kind: r.kind, ...f })));
  const byKind = {};
  for (const r of rows) {
    const acc = (byKind[r.kind] = byKind[r.kind] || { kind: r.kind, diagrams: 0, sound: 0, nodes: 0, edges: 0 });
    acc.diagrams += 1; acc.nodes += r.nodes.length; acc.edges += r.edges; if (r.sound) acc.sound += 1;
  }
  const openapi = verifyOpenApi();
  return {
    diagrams: rows, count: rows.length,
    diagramKinds: Object.entries(DIAGRAM_KINDS).map(([kind, s]) => ({ kind, ...s })),
    byKind: Object.values(byKind).sort((a, b) => String(a.kind).localeCompare(String(b.kind))),
    findings, findingCount: findings.length,
    openapi,
    // The floor. A corpus with no diagrams passes every rule above trivially, which is exactly how a
    // diagram checker comes to be verifying nothing.
    minimumDiagrams: MINIMUM_DIAGRAMS,
    extractorSound: rows.length >= MINIMUM_DIAGRAMS,
    unclassified: rows.filter((r) => !DIAGRAM_KINDS[r.kind]).map((r) => `${r.document}: ${r.header}`),
    sound: findings.length === 0 && rows.length >= MINIMUM_DIAGRAMS && openapi.sound,
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Every node in a governed diagram must resolve to something the implementation contains, and every arrow to a relationship it declares. An arrow the architecture does not have is not a simplification — it is a false claim about the system.',
  };
}

function report({ controls = [] } = {}) {
  const verification = verify({ controls });
  const procedures = verifyProcedures({});
  const diagrams = verifyDiagrams({});
  return {
    verification, procedures, diagrams,
    governedDocuments: Object.entries(GOVERNED_DOCUMENTS).map(([doc, spec]) => ({ document: doc, ...spec })),
    sound: verification.sound && procedures.complete && diagrams.sound,
    blockers: [
      ...verification.unresolved.map((u) => `${u.document}: ${u.kind} '${u.value}' — ${u.detail}`),
      ...(verification.extractorSound ? [] : [`only ${verification.claims} claims were extracted from ${verification.documentCount} documents — the extractor has stopped working, and a check that finds nothing to check is worse than no check`]),
      ...procedures.incomplete.map((d) => `${d}: incomplete operational procedure`),
      ...diagrams.findings.map((f) => `${f.document}: ${f.kind} diagram — '${f.subject}' ${f.detail}`),
      ...(diagrams.extractorSound ? [] : [`only ${diagrams.count} governed diagram(s) were found, below the floor of ${MINIMUM_DIAGRAMS} — a corpus with no diagrams passes every diagram rule trivially`]),
      ...diagrams.openapi.findings.map((f) => `openapi: '${f.subject}' ${f.detail}`),
    ],
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Documentation is verified against the implementation on every build. An unresolvable claim is a finding, never a skip; the extractor\'s own yield is checked so it cannot pass by matching nothing; and diagrams are held to the same rule as prose.',
  };
}

module.exports = {
  CLAIM_KINDS, GOVERNED_DOCUMENTS, PROCEDURE_REQUIREMENTS, MINIMUM_CLAIMS,
  documents, claimKinds, extractClaims, verifyClaim, verifyDocument, verify, verifyProcedures, report,
  serverRoutes, npmScripts, adrNumbers,
  DIAGRAM_KINDS, MINIMUM_DIAGRAMS, extractDiagrams, parseMermaid, diagramWorld,
  verifyDiagram, verifyDiagrams, verifyOpenApi,
};
