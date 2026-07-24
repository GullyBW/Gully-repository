'use strict';
// NJTIP HTTP API (Node built-in http; zero dependencies). Production-shaped:
// composition root, session auth, structured observability, health/metrics,
// centralized error handling. SYNTHETIC ONLY — no production systems or data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');
const openapi = require('./openapi');
const { newTraceId } = require('./adapters/observability');
const configMod = require('./config');
const { twinValidate } = require('./twin-validate');
const { makePackage } = require('../scripts/evidence-package');
const { assess } = require('../scripts/readiness');

// Synthetic login credentials → roles. Production: OIDC/FIDO2 assertion verification.
const CREDS = {
  'demo-investigator': { principal: 'inv-001', role: 'investigator' },
  'demo-oversight': { principal: 'gov-001', role: 'oversight-board' },
  'demo-admin': { principal: 'adm-001', role: 'admin' },
};

function bearer(req) { const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i); return m ? m[1] : null; }
function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function route(app, req, url, body) {
  const p = url.pathname, method = req.method;
  const requireRole = (role) => {
    // Accept a session token OR a verified OIDC/OAuth2 token (same authorization outcome).
    const u = app.auth.verify(bearer(req));
    if (!u || u.role !== role) throw err(401, `${role} authentication required`);
    return u;
  };
  // Authenticate, then apply the app-level RBAC+ABAC gate for a specific action.
  const requirePermission = (action, attributes = {}) => {
    const u = app.auth.verify(bearer(req));
    if (!u) throw err(401, 'authentication required');
    const d = app.authz.authorize({ role: u.role, action, attributes });
    if (!d.allow) throw err(403, d.reason);
    return u;
  };

  // --- Ops & contract ---
  if (method === 'GET' && (p === '/' || p === '/index.html')) return page('index.html');
  if (method === 'GET' && p === '/openapi.json') return json(200, openapi.spec());
  if (method === 'GET' && p === '/healthz') { const h = app.health.snapshot(); return json(h.status === 'healthy' ? 200 : 503, h); }
  if (method === 'GET' && p === '/readyz') { const ok = app.health.snapshot().checks['architecture-invariants'] === 'ok'; return json(ok ? 200 : 503, { ready: ok }); }
  if (method === 'GET' && p === '/metrics') return { status: 200, body: app.metrics.prometheus(), type: 'text/plain' };

  // --- Auth (synthetic login → session token) ---
  if (method === 'POST' && p === '/api/auth/session') {
    const c = CREDS[body.credential]; if (!c) throw err(401, 'invalid credential');
    return json(200, { token: app.session.issue(c), role: c.role, expiresInMs: app.cfg.sessionTtlMs });
  }

  // --- Citizen (anonymous) ---
  if (method === 'POST' && p === '/api/reports') return json(201, app.workflow.submitReport({ category: body.category, content: body.content, extra: body.extra }));
  let m;
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/status$/))) { const s = app.workflow.status(dec(m[1])); return s ? json(200, s) : json(404, { error: 'not-found' }); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/notifications$/))) { const n = app.workflow.notificationsFor(dec(m[1])); return n ? json(200, { notifications: n }) : json(404, { error: 'not-found' }); }
  if (method === 'POST' && (m = p.match(/^\/api\/reports\/([^/]+)\/evidence$/))) return json(201, app.workflow.attachEvidence({ case_code: dec(m[1]), content: body.content }));

  // --- Investigator (privileged) ---
  if (method === 'GET' && p === '/api/reports') { requireRole('investigator'); return json(200, { queue: app.workflow.listReports({ category: url.searchParams.get('category'), status: url.searchParams.get('status') }) }); }
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/review$/))) { const u = requireRole('investigator'); return json(200, app.workflow.investigatorReview({ principal: u.principal, case_code: dec(m[1]), note: body.note, disposition: body.disposition })); }
  // Case lifecycle transition (review/escalate/resolve/close) — RBAC+ABAC gated.
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/transition$/))) { const u = requirePermission('transition-case', { caseCode: dec(m[1]) }); return json(200, app.workflow.transitionCase({ principal: u.principal, case_code: dec(m[1]), event: body.event })); }
  // Evidence handling lifecycle transition (seal/open/admit/exclude/purge).
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/evidence\/([^/]+)\/transition$/))) { requirePermission('seal-evidence', { caseCode: dec(m[1]) }); return json(200, app.workflow.evidenceTransition({ case_code: dec(m[1]), evidenceId: dec(m[2]), event: body.event })); }

  // --- Enterprise operational workflows (assignment, SLA, stages, appeals, retention) ---
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/assign$/))) { requireRole('investigator'); return json(200, app.workflow.assignCase({ case_code: dec(m[1]) })); }
  if (method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/stage$/))) { const u = requireRole('investigator'); return json(200, app.workflow.advanceStage({ principal: u.principal, case_code: dec(m[1]) })); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/sla$/))) { const s = app.workflow.slaStatus(dec(m[1])); return json(200, s); }
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/retention$/))) { requireRole('investigator'); return json(200, app.workflow.retentionPlan(dec(m[1]))); }
  if (method === 'POST' && (m = p.match(/^\/api\/reports\/([^/]+)\/appeal$/))) return json(201, app.workflow.fileAppeal({ case_code: dec(m[1]), by: body.by, reason: body.reason }));
  if (method === 'GET' && p === '/api/investigator/workloads') { requireRole('investigator'); return json(200, { workloads: app.workflow.workloads() }); }

  // --- Oversight (aggregate, read-only) ---
  if (method === 'GET' && p === '/api/oversight/dashboard') return json(200, app.workflow.oversightDashboard({ category: url.searchParams.get('category') }));
  if (method === 'GET' && p === '/api/oversight/report') return json(200, { generatedAt: new Date().toISOString(), ...app.workflow.oversightDashboard() });

  // --- Search, analytics, intelligence (privacy-preserving, non-attributable) ---
  if (method === 'GET' && p === '/api/search') { requireRole('investigator'); return json(200, { results: app.workflow.searchCases(url.searchParams.get('q'), { limit: Number(url.searchParams.get('limit') || 50) }) }); }
  if (method === 'GET' && p === '/api/analytics') return json(200, app.workflow.analytics({ by: url.searchParams.get('by') || 'category' }));
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/timeline$/))) { requireRole('investigator'); return json(200, app.workflow.caseTimeline(dec(m[1]))); }
  if (method === 'GET' && p === '/api/analytics/export') {
    requireRole('oversight-board');
    const fmt = url.searchParams.get('format') || 'json';
    const out = app.workflow.exportCases({ format: fmt, filter: { category: url.searchParams.get('category'), status: url.searchParams.get('status') } });
    return fmt === 'csv' ? { status: 200, body: out, type: 'text/csv' } : json(200, { rows: out });
  }

  // --- Governance (privileged; records HUMAN decisions only) ---
  if (method === 'POST' && p === '/api/governance/decisions') { const u = requireRole('oversight-board'); return json(201, app.workflow.governanceDecision({ reviewer: body.reviewer || u.principal, role: u.role, subject: body.subject, verdict: body.verdict, rationale: body.rationale })); }

  // --- Evidence + Twin validation ---
  if (method === 'GET' && p === '/api/evidence/bundle') return json(200, app.workflow.generateEvidence());
  if (method === 'GET' && p === '/api/twin/validate') return json(200, twinValidate());

  // --- Assurance (Phase 9/10): deterministic evidence package + human-gated readiness ---
  if (method === 'GET' && p === '/api/assurance/evidence-package') { requireRole('admin'); return json(200, makePackage()); }
  if (method === 'GET' && p === '/api/assurance/readiness') { requireRole('admin'); return json(200, assess([])); }

  // --- Administration (privileged) ---
  if (method === 'GET' && p === '/api/admin/health') { requireRole('admin'); return json(200, app.health.snapshot()); }
  if (method === 'GET' && p === '/api/admin/metrics') { requireRole('admin'); return json(200, app.metrics.snapshot()); }
  if (method === 'GET' && p === '/api/admin/config') { requireRole('admin'); return json(200, configMod.redacted(app.cfg)); }
  if (method === 'GET' && p === '/api/admin/slo') { requireRole('admin'); return json(200, app.evaluateSlo()); }
  if (method === 'GET' && p === '/api/admin/traces') { requireRole('admin'); return json(200, { spans: app.tracer.recent(Number(url.searchParams.get('limit') || 50)) }); }

  // --- Event sourcing / CQRS (Phase 11) ---
  if (method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/events$/))) { requireRole('investigator'); return json(200, { events: app.workflow.caseEvents(dec(m[1])), replayState: app.workflow.replayCase(dec(m[1])) }); }
  if (method === 'GET' && p === '/api/admin/events/verify') { requireRole('admin'); return json(200, app.workflow.verifyEventIntegrity()); }
  if (method === 'GET' && p === '/api/admin/readmodel/rebuild') { requireRole('admin'); return json(200, { rebuilt: app.workflow.rebuildReadModel() }); }

  // --- National IAM (Phase 12) + Zero Trust (Phase 19) ---
  if (method === 'POST' && p === '/api/authz/evaluate') { requireRole('admin'); return json(200, app.iam.policies.evaluate({ subject: body.subject, action: body.action, resource: body.resource, env: body.env })); }
  if (method === 'GET' && p === '/api/admin/policies') { requireRole('admin'); return json(200, { policies: app.iam.policies.list() }); }
  if (method === 'POST' && p === '/api/admin/policies') { requireRole('admin'); app.iam.policies.load(body.policies || []); return json(200, { loaded: app.iam.policies.list().length }); }
  if (method === 'POST' && p === '/api/breakglass') { const u = requireRole('admin'); return json(201, app.iam.breakGlass.request({ principal: body.principal || u.principal, justification: body.justification, approver: body.approver })); }
  if (method === 'GET' && p === '/api/admin/breakglass') { requireRole('admin'); return json(200, { grants: app.iam.breakGlass.ledger() }); }

  // --- Advisory AI (Phase 13) — recommendations only; human approval required ---
  if (method === 'GET' && (m = p.match(/^\/api\/ai\/recommend\/([^/]+)$/))) {
    requireRole('investigator');
    const rows = app.workflow.listReports();
    const cur = app.workflow.status(dec(m[1])); if (!cur) return json(404, { error: 'not-found' });
    const full = { case_code: dec(m[1]), category: (rows.find((r) => r.case_code === dec(m[1])) || {}).category, status: cur.status };
    const rec = app.ai.advisor.recommendPriority(full);
    const q = app.ai.queue.submit(rec, { caseCode: dec(m[1]) });
    return json(200, { recommendation: rec, queued: q });
  }
  if (method === 'GET' && p === '/api/ai/pending') { requireRole('oversight-board'); return json(200, { pending: app.ai.queue.pending() }); }
  if (method === 'POST' && (m = p.match(/^\/api\/ai\/decide\/([^/]+)$/))) { const u = requireRole('oversight-board'); return json(200, app.ai.queue.decide(dec(m[1]), { by: body.by || u.principal, decision: body.decision, note: body.note })); }

  // --- Workflow orchestration (Phase 20) — configurable, versioned ---
  if (method === 'POST' && p === '/api/orchestration/start') { requireRole('investigator'); return json(201, app.orchestration.start(body.defId || 'investigation', { context: body.context })); }
  if (method === 'POST' && (m = p.match(/^\/api\/orchestration\/([^/]+)\/fire$/))) { const u = requireRole('investigator'); return json(200, app.orchestration.fire(dec(m[1]), body.event, { by: u.principal })); }
  if (method === 'GET' && p === '/api/orchestration/analytics') { requireRole('oversight-board'); return json(200, app.orchestration.analytics()); }

  // --- Chain of custody (Phase 16), GIS (Phase 15), compliance (Phase 25) ---
  if (method === 'POST' && p === '/api/custody/record') { const u = requireRole('investigator'); return json(201, app.custody.record({ evidenceId: body.evidenceId, action: body.action, actor: u.principal, contentHash: body.contentHash, witness: body.witness })); }
  if (method === 'GET' && p === '/api/admin/custody/verify') { requireRole('admin'); return json(200, app.custody.verify()); }
  if (method === 'GET' && p === '/api/admin/custody/archive') { requireRole('admin'); return json(200, app.custody.archive()); }
  if (method === 'GET' && p === '/api/geo/heatmap') { requireRole('oversight-board'); return json(200, app.gis.heatmap()); }
  if (method === 'GET' && p === '/api/compliance/assess') { requireRole('admin'); return json(200, app.compliance.assess()); }

  // --- Executive intelligence (Phase 21), Twin 2.0 sims (Phase 17/24), data fabric (Phase 14) ---
  if (method === 'GET' && p === '/api/executive/scorecard') { requireRole('oversight-board'); return json(200, app.workflow.executiveScorecard()); }
  if (method === 'POST' && p === '/api/twin2/simulate') {
    requireRole('admin');
    const k = body.kind;
    const fn = { capacity: app.twin2.capacityForecast, failure: app.twin2.failurePrediction, recovery: app.twin2.recoverySimulation, deployment: app.twin2.deploymentSimulation, failover: app.twin2.failoverSimulation }[k];
    if (!fn) throw err(400, 'unknown simulation kind');
    return json(200, { kind: k, result: fn(body.input || {}) });
  }
  if (method === 'GET' && p === '/api/fabric/catalog') { requireRole('admin'); return json(200, { subjects: app.fabric.schemaRegistry.subjects(), services: app.fabric.serviceRegistry.list(), canonical: Object.keys(app.fabric.canonical) }); }

  throw err(404, 'not-found');
}

function json(status, body) { return { status, body, type: 'application/json' }; }
function page(name) { return { status: 200, body: fs.readFileSync(path.join(__dirname, '..', 'ui', name), 'utf8'), type: 'text/html' }; }
function dec(s) { return decodeURIComponent(s); }

function createServer(overrides = {}) {
  const app = overrides.app || createApp(overrides);
  return http.createServer(async (req, res) => {
    // Distributed tracing: continue an incoming trace (traceparent) or start a new one.
    const span = app.tracer.startSpan('http.request', { traceparent: req.headers.traceparent, attrs: { method: req.method } });
    const traceId = span.traceId;
    const start = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
    let out;
    try {
      out = await route(app, req, url, body);
    } catch (e) {
      out = json(e.status || 500, { error: e.message, traceId });
      if (!e.status || e.status >= 500) app.logger.error('request.error', { traceId, path: url.pathname, error: e.message });
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    span.setAttr('route', routeLabel(url.pathname)); span.setAttr('status', out.status);
    span.end(out.status >= 500 ? 'error' : 'ok');
    app.metrics.inc('njtip_http_requests_total', { route: routeLabel(url.pathname), status: out.status });
    app.metrics.observe('njtip_http_latency_ms', ms);
    // Structured, PII-redacting access log (never logs body/headers/identity).
    app.logger.info('request', { traceId, method: req.method, path: url.pathname, status: out.status, ms: Math.round(ms) });
    const payload = out.type === 'application/json' ? JSON.stringify(out.body) : out.body;
    res.writeHead(out.status, { 'content-type': out.type, 'x-njtip-synthetic': 'true', 'x-trace-id': traceId, 'traceparent': span.traceparent() });
    res.end(payload);
  });
}

function routeLabel(p) { return p.replace(/NJ-[A-Z0-9]+/g, ':code').replace(/[0-9]+/g, ':n'); }
function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch (_) { r({}); } }); }); }

if (require.main === module) {
  const cfg = configMod.load();
  createServer().listen(cfg.port, () => console.log(`NJTIP v${cfg.version} (${cfg.mode}/${cfg.persistence}) listening on http://localhost:${cfg.port}`));
}

module.exports = { createServer, twinValidate, CREDS };
