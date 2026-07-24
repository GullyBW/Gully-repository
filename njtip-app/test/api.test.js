'use strict';
// API integration test: drive the HTTP server over an ephemeral port (Node http only).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('../src/server');
const { Workflow } = require('../src/workflow');

let server, base, ledgerFile;

before(async () => {
  ledgerFile = path.join(os.tmpdir(), `njtip-api-${process.pid}.json`);
  const workflow = new Workflow({ seed: 3, ledgerFile });
  server = createServer({ workflow });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); try { fs.unlinkSync(ledgerFile); } catch (_) {} });

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = http.request(base + p, { method, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

test('citizen can submit and check status; UI + openapi served', async () => {
  const s = await req('POST', '/api/reports', { category: 'police', content: 'x' });
  assert.strictEqual(s.status, 201);
  assert.notStrictEqual(s.body.recipient, 'police');
  const st = await req('GET', `/api/reports/${encodeURIComponent(s.body.case_code)}/status`);
  assert.strictEqual(st.body.status, 'received');
  const oapi = await req('GET', '/openapi.json');
  assert.strictEqual(oapi.body.info.version, '1.0.0');
});

test('privileged endpoints require auth', async () => {
  const s = await req('POST', '/api/reports', { category: 'official', content: 'x' });
  const noAuth = await req('POST', `/api/investigator/${encodeURIComponent(s.body.case_code)}/review`, { disposition: 'reviewed' });
  assert.strictEqual(noAuth.status, 401);
  const ok = await req('POST', `/api/investigator/${encodeURIComponent(s.body.case_code)}/review`, { disposition: 'reviewed' }, 'inv-token-synthetic');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.status, 'reviewed');
});

test('governance decision requires oversight-board auth + rationale', async () => {
  const noAuth = await req('POST', '/api/governance/decisions', { verdict: 'proceed', rationale: 'r' }, 'inv-token-synthetic');
  assert.strictEqual(noAuth.status, 401);
  const ok = await req('POST', '/api/governance/decisions', { reviewer: 'OB', subject: 'MVP', verdict: 'defer', rationale: 'await legal' }, 'gov-token-synthetic');
  assert.strictEqual(ok.status, 201);
});

test('twin validation endpoint reports invariants held', async () => {
  const v = await req('GET', '/api/twin/validate');
  assert.strictEqual(v.body.invariantsHeld, true);
});
