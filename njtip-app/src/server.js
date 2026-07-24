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
    const u = app.session.verify(bearer(req));
    if (!u || u.role !== role) throw err(401, `${role} authentication required`);
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

  // --- Oversight (aggregate, read-only) ---
  if (method === 'GET' && p === '/api/oversight/dashboard') return json(200, app.workflow.oversightDashboard({ category: url.searchParams.get('category') }));
  if (method === 'GET' && p === '/api/oversight/report') return json(200, { generatedAt: new Date().toISOString(), ...app.workflow.oversightDashboard() });

  // --- Governance (privileged; records HUMAN decisions only) ---
  if (method === 'POST' && p === '/api/governance/decisions') { const u = requireRole('oversight-board'); return json(201, app.workflow.governanceDecision({ reviewer: body.reviewer || u.principal, role: u.role, subject: body.subject, verdict: body.verdict, rationale: body.rationale })); }

  // --- Evidence + Twin validation ---
  if (method === 'GET' && p === '/api/evidence/bundle') return json(200, app.workflow.generateEvidence());
  if (method === 'GET' && p === '/api/twin/validate') return json(200, twinValidate());

  // --- Administration (privileged) ---
  if (method === 'GET' && p === '/api/admin/health') { requireRole('admin'); return json(200, app.health.snapshot()); }
  if (method === 'GET' && p === '/api/admin/metrics') { requireRole('admin'); return json(200, app.metrics.snapshot()); }
  if (method === 'GET' && p === '/api/admin/config') { requireRole('admin'); return json(200, configMod.redacted(app.cfg)); }

  throw err(404, 'not-found');
}

function json(status, body) { return { status, body, type: 'application/json' }; }
function page(name) { return { status: 200, body: fs.readFileSync(path.join(__dirname, '..', 'ui', name), 'utf8'), type: 'text/html' }; }
function dec(s) { return decodeURIComponent(s); }

function createServer(overrides = {}) {
  const app = overrides.app || createApp(overrides);
  return http.createServer(async (req, res) => {
    const traceId = newTraceId();
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
    app.metrics.inc('njtip_http_requests_total', { route: routeLabel(url.pathname), status: out.status });
    app.metrics.observe('njtip_http_latency_ms', ms);
    // Structured, PII-redacting access log (never logs body/headers/identity).
    app.logger.info('request', { traceId, method: req.method, path: url.pathname, status: out.status, ms: Math.round(ms) });
    const payload = out.type === 'application/json' ? JSON.stringify(out.body) : out.body;
    res.writeHead(out.status, { 'content-type': out.type, 'x-njtip-synthetic': 'true', 'x-trace-id': traceId });
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
