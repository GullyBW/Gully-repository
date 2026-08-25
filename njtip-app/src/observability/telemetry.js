'use strict';
// Enterprise Observability (Phase 10, Part 5). The Tracer already produces W3C-traceparent
// spans with identity redaction; this module is the ANALYSIS layer on top: OpenTelemetry-shaped
// resource and semantic attributes, business- and audit-event tracing, the service map and
// dependency graph, runtime topology, failure-propagation analysis, alert routing and a
// computed health score.
//
// Deterministic and identity-free. Every output is derived from spans, topology and health
// signals — nothing here is hand-entered.

// OpenTelemetry resource attributes for this service (semantic conventions).
const RESOURCE = {
  'service.name': 'njtip-app',
  'service.namespace': 'njtip',
  'telemetry.sdk.language': 'nodejs',
  'telemetry.sdk.name': 'njtip-reference-tracer',
  'deployment.environment': 'synthetic',
};

// Span kinds and the semantic attribute sets the platform allows on each. Anything not on an
// allow-list never reaches a span — the Tracer's redaction is the second line, not the first.
const SPAN_KINDS = {
  server: ['http.method', 'http.route', 'http.status_code', 'network.protocol.version'],
  client: ['peer.service', 'http.method', 'http.status_code'],
  internal: ['code.function', 'code.namespace'],
  producer: ['messaging.system', 'messaging.destination.name', 'messaging.operation'],
  consumer: ['messaging.system', 'messaging.destination.name', 'messaging.operation'],
};
// Domain-specific event attributes: business and audit tracing, all non-identifying.
const EVENT_ATTRS = ['event.domain', 'event.name', 'event.outcome', 'njtip.case_code', 'njtip.zone', 'njtip.actor_role', 'njtip.decision'];

// The runtime topology. Dependencies are WITHIN a zone only — the three constitutional zones
// never depend on each other directly; they integrate exclusively through PII-free events
// (EVENT_FLOWS below), and the validator enforces that.
//
// `dependsOn` = the service cannot serve without it. `degradesOn` = its loss reduces function
// but the service keeps serving. That distinction is what makes failure analysis honest:
// losing notifications must not read as "anonymous reporting is down".
const TOPOLOGY = {
  // --- Independent zone: the anonymous reporting path -------------------------------------
  'intake-api': { zone: 'independent', criticality: 'constitutional', dependsOn: ['policy-engine', 'event-store-ind'], degradesOn: ['notification-service'] },
  'policy-engine': { zone: 'independent', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'event-store-ind': { zone: 'independent', criticality: 'critical', dependsOn: ['persistence-ind'], degradesOn: [] },
  'persistence-ind': { zone: 'independent', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'notification-service': { zone: 'independent', criticality: 'important', dependsOn: [], degradesOn: ['broker-ind'] },
  'broker-ind': { zone: 'independent', criticality: 'important', dependsOn: [], degradesOn: [] },
  // --- Executive zone: investigation and evidence ------------------------------------------
  'case-service': { zone: 'executive', criticality: 'critical', dependsOn: ['event-store-exec', 'identity'], degradesOn: ['evidence-store', 'analytics'] },
  'evidence-store': { zone: 'executive', criticality: 'critical', dependsOn: ['kms', 'object-store', 'custody-ledger'], degradesOn: [] },
  'kms': { zone: 'executive', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'object-store': { zone: 'executive', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'custody-ledger': { zone: 'executive', criticality: 'critical', dependsOn: ['persistence-exec'], degradesOn: [] },
  'identity': { zone: 'executive', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'event-store-exec': { zone: 'executive', criticality: 'critical', dependsOn: ['persistence-exec'], degradesOn: [] },
  'persistence-exec': { zone: 'executive', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'analytics': { zone: 'executive', criticality: 'important', dependsOn: ['event-store-exec'], degradesOn: [] },
  'broker-exec': { zone: 'executive', criticality: 'important', dependsOn: [], degradesOn: [] },
  // --- Judiciary zone: governance and oversight ---------------------------------------------
  'governance-ledger': { zone: 'judiciary', criticality: 'critical', dependsOn: ['persistence-jud'], degradesOn: [] },
  'persistence-jud': { zone: 'judiciary', criticality: 'critical', dependsOn: [], degradesOn: [] },
  'oversight-api': { zone: 'judiciary', criticality: 'important', dependsOn: ['governance-ledger'], degradesOn: [] },
  'broker-jud': { zone: 'judiciary', criticality: 'important', dependsOn: [], degradesOn: [] },
};

// Cross-zone integration happens ONLY as PII-free events over the brokers. These are flows,
// not dependencies: a zone keeps serving when the flow is interrupted (the outbox retains).
const EVENT_FLOWS = [
  { from: 'independent', to: 'executive', via: ['broker-ind', 'broker-exec'], topic: 'case.events', piiFree: true },
  { from: 'executive', to: 'judiciary', via: ['broker-exec', 'broker-jud'], topic: 'governance.events', piiFree: true },
  { from: 'executive', to: 'independent', via: ['broker-exec', 'broker-ind'], topic: 'case.status', piiFree: true },
];

// The path the constitution depends on: a citizen must be able to file a report.
const CRITICAL_PATH = ['intake-api', 'policy-engine', 'event-store-ind', 'persistence-ind'];

// --- Spans, correlation and event tracing ------------------------------------------------

// Build an OpenTelemetry-shaped span record. Only allow-listed attributes survive.
function span({ name, kind = 'internal', traceId, spanId, parentId = null, durationMs = 0, status = 'ok', attrs = {}, service = 'njtip-app' } = {}) {
  const allowed = new Set([...(SPAN_KINDS[kind] || []), ...EVENT_ATTRS]);
  const filtered = {};
  for (const [k, v] of Object.entries(attrs)) if (allowed.has(k)) filtered[k] = v;
  return { name, kind, traceId, spanId, parentId, durationMs, status, service, resource: { ...RESOURCE }, attrs: filtered, dropped: Object.keys(attrs).filter((k) => !allowed.has(k)) };
}
// Business-event trace: a domain outcome, correlated to the trace that produced it.
function businessEvent({ traceId, spanId, name, outcome = 'ok', caseCode = null, zone = null, service = 'njtip-app' }) {
  return span({ name: `business.${name}`, kind: 'internal', traceId, spanId, service, status: outcome, attrs: { 'event.domain': 'business', 'event.name': name, 'event.outcome': outcome, 'njtip.case_code': caseCode, 'njtip.zone': zone } });
}
// Audit-event trace: a governance-relevant act, correlated the same way.
function auditEvent({ traceId, spanId, name, actorRole = null, decision = null, outcome = 'ok', service = 'njtip-app' }) {
  return span({ name: `audit.${name}`, kind: 'internal', traceId, spanId, service, status: outcome, attrs: { 'event.domain': 'audit', 'event.name': name, 'event.outcome': outcome, 'njtip.actor_role': actorRole, 'njtip.decision': decision } });
}

// Assemble a trace into a tree with a latency breakdown (self time vs children).
function traceTree(spans = []) {
  const byId = new Map(spans.map((s) => [s.spanId, { ...s, children: [] }]));
  const roots = [];
  for (const s of byId.values()) {
    if (s.parentId && byId.has(s.parentId)) byId.get(s.parentId).children.push(s); else roots.push(s);
  }
  const selfTime = (n) => n.durationMs - n.children.reduce((a, c) => a + c.durationMs, 0);
  const flat = [...byId.values()].map((s) => ({ spanId: s.spanId, name: s.name, service: s.service, durationMs: s.durationMs, selfMs: selfTime(s), status: s.status }));
  flat.sort((a, b) => b.selfMs - a.selfMs || a.spanId.localeCompare(b.spanId));
  return { roots, spans: flat, slowest: flat[0] || null, totalMs: roots.reduce((a, r) => a + r.durationMs, 0), errors: flat.filter((s) => s.status !== 'ok').map((s) => s.name) };
}

// Correlation: one id joins traces, logs, business events and audit events.
function correlate({ traceId, spans = [], logs = [], events = [] } = {}) {
  const inTrace = (x) => x.traceId === traceId;
  const matched = { spans: spans.filter(inTrace), logs: logs.filter(inTrace), events: events.filter(inTrace) };
  return {
    traceId,
    counts: { spans: matched.spans.length, logs: matched.logs.length, events: matched.events.length },
    businessEvents: matched.events.filter((e) => (e.attrs || {})['event.domain'] === 'business').map((e) => e.attrs['event.name']),
    auditEvents: matched.events.filter((e) => (e.attrs || {})['event.domain'] === 'audit').map((e) => e.attrs['event.name']),
    complete: matched.spans.length > 0 && matched.logs.length > 0,
    tree: traceTree(matched.spans),
    note: 'One correlation id joins the request, its logs, its business outcome and its audit record.',
  };
}

// --- Topology, service map, dependency graph -------------------------------------------------

function serviceMap() {
  return Object.entries(TOPOLOGY).map(([service, meta]) => ({
    service, zone: meta.zone, criticality: meta.criticality,
    dependsOn: [...meta.dependsOn], degradesOn: [...(meta.degradesOn || [])],
    dependents: Object.entries(TOPOLOGY).filter(([, m]) => m.dependsOn.includes(service)).map(([s]) => s),
    degradedDependents: Object.entries(TOPOLOGY).filter(([, m]) => (m.degradesOn || []).includes(service)).map(([s]) => s),
  })).sort((a, b) => a.service.localeCompare(b.service));
}
function dependencyGraph() { const g = {}; for (const [s, m] of Object.entries(TOPOLOGY)) g[s] = [...m.dependsOn]; return g; }
function runtimeTopology() {
  const byZone = {};
  for (const [s, m] of Object.entries(TOPOLOGY)) (byZone[m.zone] = byZone[m.zone] || []).push(s);
  for (const z of Object.keys(byZone)) byZone[z].sort();
  return { zones: byZone, services: Object.keys(TOPOLOGY).length, criticalPath: [...CRITICAL_PATH], eventFlows: EVENT_FLOWS.map((f) => ({ ...f, via: [...f.via] })), resource: { ...RESOURCE } };
}
// Cycles in the runtime topology would make failure analysis meaningless.
function cycles() {
  const g = dependencyGraph(); const found = []; const state = {};
  const walk = (n, stack) => {
    if (state[n] === 'done') return;
    if (state[n] === 'open') { found.push([...stack.slice(stack.indexOf(n)), n]); return; }
    state[n] = 'open'; stack.push(n);
    for (const next of g[n] || []) walk(next, stack);
    stack.pop(); state[n] = 'done';
  };
  for (const s of Object.keys(g)) walk(s, []);
  return found;
}

// Failure propagation: if `failed` goes down, which services follow, and is the critical path
// broken? This is the analysis that turns a dependency diagram into an operational answer.
function failurePropagation(failed = []) {
  const down = new Set(failed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [s, m] of Object.entries(TOPOLOGY)) {
      if (down.has(s)) continue;
      // A service is DOWN when a dependency it cannot serve without is down.
      if (m.dependsOn.some((d) => down.has(d))) { down.add(s); changed = true; }
    }
  }
  // Degradation propagates one hop from anything down, but does not take a service with it.
  const degraded = new Set();
  for (const [s, m] of Object.entries(TOPOLOGY)) {
    if (down.has(s)) continue;
    if ((m.degradesOn || []).some((d) => down.has(d))) degraded.add(s);
  }
  const impacted = [...down].sort();
  const criticalPathBroken = CRITICAL_PATH.some((s) => down.has(s));
  return {
    failed: [...failed].sort(), impacted, degraded: [...degraded].sort(),
    blastRadius: impacted.length,
    criticalPathBroken,
    constitutionalImpact: criticalPathBroken ? 'anonymous reporting is unavailable — the constitutional guarantee is broken' : 'anonymous reporting survives',
    byCriticality: impacted.reduce((m, s) => ((m[TOPOLOGY[s].criticality] = (m[TOPOLOGY[s].criticality] || 0) + 1), m), {}),
    byZone: impacted.reduce((m, s) => ((m[TOPOLOGY[s].zone] = (m[TOPOLOGY[s].zone] || 0) + 1), m), {}),
    note: 'Deterministic transitive impact. `impacted` cannot serve; `degraded` serves with reduced function.',
  };
}
// Single points of failure: a service whose loss breaks the critical path.
function singlePointsOfFailure() {
  return Object.keys(TOPOLOGY).filter((s) => failurePropagation([s]).criticalPathBroken).sort();
}

// --- Alert routing & health score -----------------------------------------------------------------

// Alerts route by domain to the accountable board — never to a generic inbox.
const ALERT_ROUTES = {
  reliability: { team: 'Site Reliability Engineering', board: 'ORB', page: true },
  security: { team: 'Security Operations Centre', board: 'ISRB', page: true },
  privacy: { team: 'Privacy Engineering Team', board: 'OB', page: true },
  architecture: { team: 'Assurance Engineering Team', board: 'ARB', page: false },
  governance: { team: 'Governance Operations Team', board: 'OB', page: false },
  infrastructure: { team: 'Infrastructure Operations', board: 'ORB', page: true },
  'service-delivery': { team: 'Service Portfolio Team', board: 'SDB', page: false },
};
function alertRoute({ domain, severity = 'ticket' } = {}) {
  const route = ALERT_ROUTES[domain];
  if (!route) return { routed: false, reason: `no route for domain '${domain}' — an unrouted alert is an unowned alert`, fallback: { team: 'Platform Engineering', board: 'ARB' } };
  return { routed: true, domain, ...route, severity, page: route.page && severity === 'page', note: 'Routed to the accountable team and its governance board.' };
}

// Health score: a weighted, evidence-derived composite. Every input is a measured signal;
// none is hand-entered, and each contribution is shown.
const HEALTH_WEIGHTS = { architecture: 0.25, reliability: 0.2, security: 0.2, privacy: 0.15, infrastructure: 0.1, governance: 0.1 };
function healthScore(signals = {}) {
  const contributions = [];
  let score = 0, weightUsed = 0;
  for (const [domain, weight] of Object.entries(HEALTH_WEIGHTS)) {
    const raw = signals[domain];
    if (raw === undefined || raw === null) { contributions.push({ domain, weight, value: null, contribution: 0, status: 'unmeasured' }); continue; }
    const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Math.max(0, Math.min(1, raw));
    const contribution = +(weight * value).toFixed(4);
    contributions.push({ domain, weight, value, contribution, status: 'measured' });
    score += contribution; weightUsed += weight;
  }
  const normalised = weightUsed > 0 ? +(score / weightUsed).toFixed(4) : null;
  return {
    score: normalised, coverage: +weightUsed.toFixed(2), contributions,
    band: normalised === null ? 'unknown' : normalised >= 0.95 ? 'healthy' : normalised >= 0.8 ? 'degraded' : 'unhealthy',
    note: 'Every input is a measured signal. An unmeasured domain lowers COVERAGE, never silently inflates the score.',
  };
}

// --- Validation -----------------------------------------------------------------------------------

function validate() {
  const violations = [];
  const known = new Set(Object.keys(TOPOLOGY));
  for (const [s, m] of Object.entries(TOPOLOGY)) {
    for (const d of m.dependsOn) if (!known.has(d)) violations.push(`${s}: depends on unknown service '${d}'`);
    for (const d of (m.degradesOn || [])) if (!known.has(d)) violations.push(`${s}: degrades on unknown service '${d}'`);
    if (!['constitutional', 'critical', 'important'].includes(m.criticality)) violations.push(`${s}: unknown criticality '${m.criticality}'`);
    if (!['independent', 'executive', 'judiciary'].includes(m.zone)) violations.push(`${s}: unknown zone '${m.zone}'`);
  }
  for (const c of cycles()) violations.push('dependency cycle in the runtime topology: ' + c.join(' → '));
  for (const s of CRITICAL_PATH) if (!known.has(s)) violations.push(`critical path names unknown service '${s}'`);
  // A cross-zone dependency must not exist: zones are constitutionally isolated.
  for (const [s, m] of Object.entries(TOPOLOGY)) for (const d of [...m.dependsOn, ...(m.degradesOn || [])]) {
    if (TOPOLOGY[d] && TOPOLOGY[d].zone !== m.zone) violations.push(`${s} (${m.zone}) depends directly on ${d} (${TOPOLOGY[d].zone}) — zones integrate by event, never by direct dependency`);
  }
  // Cross-zone event flows must be PII-free and travel over declared brokers.
  for (const f of EVENT_FLOWS) {
    if (!f.piiFree) violations.push(`event flow ${f.from} → ${f.to} is not declared PII-free`);
    for (const b of f.via) if (!known.has(b)) violations.push(`event flow ${f.from} → ${f.to} routes via unknown service '${b}'`);
  }
  return { valid: violations.length === 0, violations, services: Object.keys(TOPOLOGY).length };
}

function report({ signals = {}, spans = [] } = {}) {
  return {
    resource: { ...RESOURCE }, topology: runtimeTopology(), serviceMap: serviceMap(),
    dependencyGraph: dependencyGraph(), singlePointsOfFailure: singlePointsOfFailure(),
    failurePropagation: { 'persistence-ind': failurePropagation(['persistence-ind']), 'kms': failurePropagation(['kms']), 'notification-service': failurePropagation(['notification-service']) },
    trace: spans.length ? traceTree(spans) : null,
    alertRoutes: Object.keys(ALERT_ROUTES), healthScore: healthScore(signals),
    validation: validate(),
    informationalOnly: true, authorizes: false,
    note: 'Observability analysis derived from telemetry and declared topology. No metric is hand-entered.',
  };
}

module.exports = { RESOURCE, SPAN_KINDS, EVENT_ATTRS, TOPOLOGY, EVENT_FLOWS, CRITICAL_PATH, ALERT_ROUTES, HEALTH_WEIGHTS, span, businessEvent, auditEvent, traceTree, correlate, serviceMap, dependencyGraph, runtimeTopology, cycles, failurePropagation, singlePointsOfFailure, alertRoute, healthScore, validate, report };
