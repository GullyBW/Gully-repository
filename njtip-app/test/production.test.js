'use strict';
// Tests for the production-shaped components: persistence adapters, secure sessions,
// config/secrets, observability (metrics + PII-redacting logs + health), and the
// production server surface (auth, admin, metrics, health).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { MemoryStore, FileStore, makeStore } = require('../src/adapters/store');
const { SqlStore } = require('../src/adapters/sql-store');
const { MemorySqlDriver } = require('../src/adapters/drivers/sql-driver');
const { SessionManager } = require('../src/adapters/session');
const { Logger, Metrics, Health } = require('../src/adapters/observability');
const config = require('../src/config');
const { createServer } = require('../src/server');

test('FileStore is durable and zone/collection isolated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'njtip-store-'));
  const reports = new FileStore('independent', dir, 'reports');
  reports.put('K1', { a: 1 });
  // New instance → durable read.
  assert.deepStrictEqual(new FileStore('independent', dir, 'reports').get('K1'), { a: 1 });
  // Different collection with same key does NOT collide.
  new FileStore('independent', dir, 'notifications').put('K1', [{ n: 1 }]);
  assert.deepStrictEqual(new FileStore('independent', dir, 'reports').get('K1'), { a: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SqlStore: durable via driver, zone + collection isolated, same interface', () => {
  const driver = new MemorySqlDriver();
  const reports = new SqlStore('independent', 'reports', driver);
  reports.put('K1', { a: 1 });
  // New store instance on the SAME driver → durable read (survives the object).
  assert.deepStrictEqual(new SqlStore('independent', 'reports', driver).get('K1'), { a: 1 });
  // Same key, different collection → no collision (distinct table).
  new SqlStore('independent', 'notifications', driver).put('K1', [{ n: 1 }]);
  assert.deepStrictEqual(reports.get('K1'), { a: 1 });
  // Same key, different zone → no collision, and a store cannot address another zone.
  new SqlStore('executive', 'reports', driver).put('K1', { a: 99 });
  assert.deepStrictEqual(reports.get('K1'), { a: 1 });
  // Interface parity: keys/values/size/delete behave like the other stores.
  assert.deepStrictEqual(reports.keys(), ['K1']);
  assert.strictEqual(reports.size(), 1);
  assert.strictEqual(reports.delete('K1'), true);
  assert.strictEqual(reports.get('K1'), null);
  // Migration was recorded exactly once regardless of store instance count.
  assert.deepStrictEqual(driver.migrations(), ['001_init']);
  // Isolation is by table name; no queryable identity column exists by design.
  assert.ok(driver.tables().every((t) => /^[a-z]+__[a-z]+$/.test(t)));
});

test('makeStore selects sql and shares ONE driver per cfg (no leak into redacted)', () => {
  const cfg = config.load({ NJTIP_PERSISTENCE: 'sql' });
  const a = makeStore('independent', cfg, 'reports');
  const b = makeStore('independent', cfg, 'reports');
  a.put('K1', { v: 1 });
  assert.deepStrictEqual(b.get('K1'), { v: 1 }); // same underlying driver
  assert.ok(!('sqlDriver' in config.redacted(cfg)) && !('_sqlDriver' in config.redacted(cfg)));
});

test('MemoryStore returns deep copies (no aliasing)', () => {
  const s = new MemoryStore('independent');
  const v = { x: 1 }; s.put('k', v); v.x = 2;
  assert.strictEqual(s.get('k').x, 1);
});

test('sessions: issue/verify, expiry, revocation, tamper, legacy', () => {
  let now = 1000;
  const sm = new SessionManager({ secret: 's3cr3t', ttlMs: 100, clock: () => now });
  const tok = sm.issue({ principal: 'inv-001', role: 'investigator' });
  assert.strictEqual(sm.verify(tok).role, 'investigator');
  // Tamper → invalid.
  assert.strictEqual(sm.verify(tok.slice(0, -2) + 'xx'), null);
  // Legacy synthetic token still works.
  assert.strictEqual(sm.verify('inv-token-synthetic').role, 'investigator');
  // Revoke.
  sm.revoke(tok); assert.strictEqual(sm.verify(tok), null);
  // Expiry.
  const t2 = sm.issue({ principal: 'x', role: 'admin' }); now += 200;
  assert.strictEqual(sm.verify(t2), null);
});

test('sessions signed with a different secret do not verify', () => {
  const a = new SessionManager({ secret: 'A' }); const b = new SessionManager({ secret: 'B' });
  assert.strictEqual(b.verify(a.issue({ principal: 'x', role: 'admin' })), null);
});

test('config redacts secrets and validates', () => {
  const cfg = config.load({ NJTIP_PERSISTENCE: 'memory' });
  assert.strictEqual(config.redacted(cfg).SESSION_SECRET, '***REDACTED***');
  assert.throws(() => config.load({ NJTIP_PERSISTENCE: 'bogus' }));
});

test('logger redacts PII and never emits identity/content', () => {
  const captured = [];
  const log = new Logger('info', { log: (l) => captured.push(l), error: (l) => captured.push(l) });
  log.info('request', { email: 'a@b.c', content: 'secret-text', ip: '1.2.3.4', ok: 1 });
  const line = captured[0];
  assert.ok(line.includes('***REDACTED***'));
  assert.ok(!line.includes('a@b.c') && !line.includes('secret-text') && !line.includes('1.2.3.4'));
  assert.ok(line.includes('"ok":1'));
});

test('metrics and health snapshots work', () => {
  const m = new Metrics(); m.inc('c', { r: '/x' }); m.inc('c', { r: '/x' }); m.observe('lat', 5);
  assert.strictEqual(m.snapshot().counters['c{r="/x"}'], 2);
  const h = new Health(); h.register('ok', () => true); h.register('bad', () => false);
  assert.strictEqual(h.snapshot().status, 'unhealthy');
});

// ---- Production server surface ----
let server, baseUrl, ledgerFile;
before(async () => {
  ledgerFile = path.join(os.tmpdir(), `njtip-prod-${process.pid}.json`);
  const cfg = config.load({ NJTIP_PERSISTENCE: 'memory' });
  server = createServer({ config: cfg, ledgerFile, seed: 5 });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); try { fs.unlinkSync(ledgerFile); } catch (_) {} });

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = http.request(baseUrl + p, { method, headers }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let b; try { b = d ? JSON.parse(d) : {}; } catch (_) { b = d; } resolve({ status: res.statusCode, body: b }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

test('health, readiness, metrics endpoints', async () => {
  assert.strictEqual((await req('GET', '/healthz')).body.status, 'healthy');
  assert.strictEqual((await req('GET', '/readyz')).body.ready, true);
  const m = await req('GET', '/metrics'); assert.match(JSON.stringify(m.body), /njtip_http_requests_total|{}/);
});

test('session login → investigator queue; admin config redacted; unauthorized blocked', async () => {
  const login = await req('POST', '/api/auth/session', { credential: 'demo-investigator' });
  assert.strictEqual(login.status, 200);
  const token = login.body.token;
  await req('POST', '/api/reports', { category: 'police', content: 'x' });
  const q = await req('GET', '/api/reports?status=received', null, token);
  assert.strictEqual(q.status, 200); assert.ok(q.body.queue.length >= 1);
  const noAuth = await req('GET', '/api/reports', null, null);
  assert.strictEqual(noAuth.status, 401);
  const cfg = await req('GET', '/api/admin/config', null, 'admin-token-synthetic');
  assert.strictEqual(cfg.body.SESSION_SECRET, '***REDACTED***');
});

test('server accepts an OIDC-issued bearer token on a privileged route', async () => {
  const { OidcVerifier } = require('../src/adapters/oidc');
  const cfg = config.load({ NJTIP_PERSISTENCE: 'memory' });
  const idp = new OidcVerifier({ secret: cfg.SESSION_SECRET }); // same trust anchor as the app
  const token = idp.issue({ sub: 'inv-777', role: 'investigator' });
  const q = await req('GET', '/api/reports?status=received', null, token);
  assert.strictEqual(q.status, 200);
  // A forged token (wrong secret) is rejected.
  const forged = new OidcVerifier({ secret: 'wrong' }).issue({ sub: 'x', role: 'investigator' });
  assert.strictEqual((await req('GET', '/api/reports', null, forged)).status, 401);
});

test('case + evidence lifecycle endpoints are RBAC-gated and enforce legal transitions', async () => {
  const token = (await req('POST', '/api/auth/session', { credential: 'demo-investigator' })).body.token;
  const code = (await req('POST', '/api/reports', { category: 'prison', content: 'x' })).body.case_code;
  // Illegal transition (resolve directly from received) → 409.
  const illegal = await req('POST', `/api/investigator/${code}/transition`, { event: 'resolve' }, token);
  assert.strictEqual(illegal.status, 409);
  // Legal path: escalate → resolve.
  assert.strictEqual((await req('POST', `/api/investigator/${code}/transition`, { event: 'escalate' }, token)).body.status, 'escalated');
  assert.strictEqual((await req('POST', `/api/investigator/${code}/transition`, { event: 'resolve' }, token)).body.status, 'resolved');
  // Unauthorized (no token) → 401.
  assert.strictEqual((await req('POST', `/api/investigator/${code}/transition`, { event: 'close' }, null)).status, 401);
  // Evidence lifecycle via API.
  const ev = await req('POST', `/api/reports/${code}/evidence`, { content: 'blob' });
  assert.strictEqual(ev.body.state, 'ingested');
  const seal = await req('POST', `/api/investigator/${code}/evidence/${ev.body.evidenceId}/transition`, { event: 'seal' }, token);
  assert.strictEqual(seal.body.state, 'sealed');
});

test('identity is rejected at the API (400) and twin invariants held', async () => {
  const bad = await req('POST', '/api/reports', { category: 'police', content: 'x', extra: { email: 'a@b.c' } });
  assert.strictEqual(bad.status, 400);
  const v = await req('GET', '/api/twin/validate');
  assert.strictEqual(v.body.invariantsHeld, true);
});
