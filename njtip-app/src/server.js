'use strict';
// NJTIP v1.0 MVP — HTTP API (Node built-in http only; zero dependencies).
// Serves the vertical-slice workflow + a minimal UI. SYNTHETIC ONLY: bearer tokens,
// data, and crypto are synthetic; no production systems or data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Workflow } = require('./workflow');
const openapi = require('./openapi');

// Synthetic bearer tokens → identified principals (production: OIDC + FIDO2, see
// component-transition-matrix.md). NOT real credentials.
const TOKENS = {
  'inv-token-synthetic': { principal: 'inv-001', role: 'investigator' },
  'gov-token-synthetic': { principal: 'gov-001', role: 'oversight-board' },
};

function auth(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? TOKENS[m[1]] || null : null;
}

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': type, 'x-njtip-synthetic': 'true' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); } });
  });
}

function createServer(opts = {}) {
  const wf = opts.workflow || new Workflow(opts.workflowOpts || {});
  const uiDir = path.join(__dirname, '..', 'ui');

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      // --- Static UI ---
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        return send(res, 200, fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8'), 'text/html');
      }
      if (req.method === 'GET' && p === '/openapi.json') return send(res, 200, openapi.spec());

      // --- Citizen (anonymous, no auth) ---
      if (req.method === 'POST' && p === '/api/reports') {
        const b = await readBody(req);
        return send(res, 201, wf.submitReport({ category: b.category, content: b.content, extra: b.extra }));
      }
      let m;
      if (req.method === 'GET' && (m = p.match(/^\/api\/reports\/([^/]+)\/status$/))) {
        const s = wf.status(decodeURIComponent(m[1]));
        return s ? send(res, 200, s) : send(res, 404, { error: 'not-found' });
      }
      if (req.method === 'POST' && (m = p.match(/^\/api\/reports\/([^/]+)\/evidence$/))) {
        const b = await readBody(req);
        return send(res, 201, wf.attachEvidence({ case_code: decodeURIComponent(m[1]), content: b.content }));
      }

      // --- Oversight (aggregate, read-only) ---
      if (req.method === 'GET' && p === '/api/oversight/dashboard') return send(res, 200, wf.oversightDashboard());

      // --- Twin validation (assurance layer, invoked from the running product) ---
      if (req.method === 'GET' && p === '/api/twin/validate') return send(res, 200, twinValidate());

      // --- Investigator (privileged) ---
      if (req.method === 'POST' && (m = p.match(/^\/api\/investigator\/([^/]+)\/review$/))) {
        const u = auth(req); if (!u || u.role !== 'investigator') return send(res, 401, { error: 'investigator auth required' });
        const b = await readBody(req);
        return send(res, 200, wf.investigatorReview({ principal: u.principal, case_code: decodeURIComponent(m[1]), note: b.note, disposition: b.disposition }));
      }

      // --- Governance (privileged; records HUMAN decisions only) ---
      if (req.method === 'POST' && p === '/api/governance/decisions') {
        const u = auth(req); if (!u || u.role !== 'oversight-board') return send(res, 401, { error: 'oversight-board auth required' });
        const b = await readBody(req);
        return send(res, 201, wf.governanceDecision({ reviewer: b.reviewer || u.principal, role: u.role, subject: b.subject, verdict: b.verdict, rationale: b.rationale }));
      }

      // --- Evidence generation ---
      if (req.method === 'GET' && p === '/api/evidence/bundle') return send(res, 200, wf.generateEvidence());

      return send(res, 404, { error: 'not-found', path: p });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  });
}

// Invoke the Digital Engineering Twin's fitness gate from the running product.
function twinValidate() {
  const fitness = require('../../njtip-twin/verification/fitness');
  const { build } = require('../../njtip-twin/src/platform/orchestrator');
  const twin = build();
  const results = fitness.map((f) => f.check(twin));
  return {
    invariantsHeld: results.every((r) => r.pass),
    passed: results.filter((r) => r.pass).length, total: results.length,
    failing: results.filter((r) => !r.pass).map((r) => r.id),
    note: 'Architecture invariants continuously verified by the Digital Engineering Twin. Evidence ≠ authorization.',
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8087);
  createServer().listen(port, () => console.log(`NJTIP v1.0 MVP (SYNTHETIC) listening on http://localhost:${port}`));
}

module.exports = { createServer, TOKENS, twinValidate };
