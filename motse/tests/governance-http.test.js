'use strict';

/**
 * Phase 6 — HTTP surface + SDK for the governed DPI planes: identity
 * assertions, governed AI retrieval, the Policy Kernel, the cross-plane
 * audit graph, data products, cells and DPI certification.
 */
const request = require('supertest');
const { createApp } = require('../src/app');
const { world } = require('./helpers');
const { MotseClient } = require('../sdk/js/motse');

function session(w, msisdn = '+26771000002', deviceId = 'dev-kabo') {
  const otp = w.p.identity.requestOtp(msisdn);
  const { session: s } = w.p.identity.verifyOtp(msisdn, otp.sandbox_code, { deviceId });
  return (r) => r.set('Authorization', `Bearer ${s.access_token}`).set('X-Device-Id', deviceId);
}

function makeAdmin(w) {
  w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
  w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
}

let k = 0;
const idem = () => `gov-${k++}`;

describe('Governed planes — customer/dev API', () => {
  test('identity assertion + governed AI retrieval (public only for anonymous)', async () => {
    const w = world();
    makeAdmin(w);
    const { app } = createApp(w.p);
    const authed = session(w);

    // Admin seeds a public + a restricted corpus document.
    await authed(request(app).post('/v1/admin/ai/corpus')).set('Idempotency-Key', idem())
      .send({ classification: 'public', content: 'Tsodilo public heritage' });
    await authed(request(app).post('/v1/admin/ai/corpus')).set('Idempotency-Key', idem())
      .send({ classification: 'restricted', required_level: 'L2', content: 'restricted sacred lore' });

    // The caller's own assertion.
    const assertion = await authed(request(app).get('/v1/identity/assertion'));
    expect(assertion.body).toMatchObject({ authenticated: true, subject: w.kabo.id });

    // Anonymous retrieval → only public content, provenance-signed.
    const anon = await request(app).post('/v1/ai/retrieve').set('Idempotency-Key', idem()).send({ query: '' });
    expect(anon.body.output.permitted).toHaveLength(1);
    expect(JSON.stringify(anon.body)).not.toContain('sacred');
    expect(anon.body.provenance.signature).toBeTruthy();
  });
});

describe('Governed planes — admin API', () => {
  async function setup() {
    const w = world();
    makeAdmin(w);
    const { app } = createApp(w.p);
    const authed = session(w);
    return { w, app, authed };
  }

  test('policy kernel, audit graph, data products, cells, certification', async () => {
    const { w, app, authed } = await setup();
    const trace = 'trace-http-1';

    // A policy decision (recorded + event-sourced), correlated by trace id.
    const decide = await authed(request(app).post('/v1/admin/policy/decide')).set('Idempotency-Key', idem()).set('X-Trace-Id', trace)
      .send({ subject: w.kabo.id, action: 'read', resource: { classification: 'public' } });
    expect(decide.body.decision).toBe('ALLOW');

    // A governed AI retrieval correlated by the same trace id.
    await authed(request(app).post('/v1/ai/retrieve')).set('Idempotency-Key', idem()).set('X-Trace-Id', trace).send({ query: 'x' });

    // The cross-plane audit graph stitches the request.
    const graph = await authed(request(app).get(`/v1/admin/audit/graph/${trace}`));
    expect(graph.body.planes).toEqual(expect.arrayContaining(['policy', 'ai']));
    const planes = await authed(request(app).get('/v1/admin/audit/planes'));
    expect(planes.body.by_plane.policy).toBeGreaterThan(0);

    // Data products (projections only, authorized + signed).
    const products = await authed(request(app).get('/v1/admin/data-products'));
    expect(products.body.find((p) => p.name === 'qr_activity')).toBeTruthy();
    const product = await authed(request(app).get('/v1/admin/data-products/qr_activity'));
    expect(product.body.output.state).toBeDefined();
    expect(product.body.provenance.signature).toBeTruthy();

    // Cells.
    const cells = await authed(request(app).get('/v1/admin/cells'));
    expect(cells.body.map((c) => c.id)).toContain('cell-0');
    const contract = await authed(request(app).get('/v1/admin/cells/cell-0/contract'));
    expect(contract.body.recovery_strategy).toBe('event_replay_reconciliation');

    // DPI certification — signed, passing report.
    const cert = await authed(request(app).post('/v1/admin/certification/run')).set('Idempotency-Key', idem()).send({});
    expect(cert.body.output.passed).toBe(true);
    expect(cert.body.output.checks.ledger_balanced).toBe(true);
  });

  test('admin governance routes require platform_admin', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const authed = session(w); // ordinary member
    const res = await authed(request(app).post('/v1/admin/certification/run')).set('Idempotency-Key', idem()).send({});
    expect(res.status).toBe(403);
  });
});

describe('Governed planes — SDK', () => {
  test('identityAssertion and aiRetrieve via the SDK', async () => {
    const w = world();
    makeAdmin(w);
    const { app } = createApp(w.p);
    w.p.aiGateway.addDocument('u:admin', { classification: 'public', content: 'public doc for sdk' });

    const fetchLike = async (url, opts) => {
      const path = url.replace('http://sdk', '');
      let req = request(app)[opts.method.toLowerCase()](path);
      for (const [key, v] of Object.entries(opts.headers || {})) req = req.set(key, v);
      const res = opts.body ? await req.send(JSON.parse(opts.body)) : await req;
      return { ok: res.status < 400, status: res.status, text: async () => JSON.stringify(res.body), json: async () => res.body };
    };
    const sdk = new MotseClient({ baseUrl: 'http://sdk', fetch: fetchLike, deviceId: 'sdk-dev' });
    const otp = await sdk.requestOtp('+26771000002');
    await sdk.verifyOtp('+26771000002', otp.sandbox_code);

    const assertion = await sdk.identityAssertion();
    expect(assertion.authenticated).toBe(true);
    const retrieval = await sdk.aiRetrieve('public');
    expect(retrieval.output.permitted.length).toBeGreaterThanOrEqual(1);
    expect(retrieval.provenance.signature).toBeTruthy();
  });
});
