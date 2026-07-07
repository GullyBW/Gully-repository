'use strict';

/**
 * Phase 5 (WS2/WS3/WS21) — HTTP surface + SDK for the Event Store, CQRS
 * projections and the QR Code Platform.
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
const idem = () => `qrh-${k++}`;

describe('QR HTTP API (WS21)', () => {
  test('generate → verify → decode → list → revoke over HTTP', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const authed = session(w);

    const gen = await authed(request(app).post('/v1/qr')).set('Idempotency-Key', idem())
      .send({ kind: 'identity', subject_ref: w.kabo.id, data: { role: 'member' } });
    expect(gen.status).toBe(200);
    expect(gen.body.token).toBeTruthy();

    // verify is public (anonymous scanner allowed); all POSTs carry an Idempotency-Key.
    const verify = await request(app).post('/v1/qr/verify').set('Idempotency-Key', idem()).send({ token: gen.body.token });
    expect(verify.body).toMatchObject({ valid: true, kind: 'identity' });

    const decode = await request(app).post('/v1/qr/decode').set('Idempotency-Key', idem()).send({ token: gen.body.token });
    expect(decode.body.kind).toBe('identity');

    const mine = await authed(request(app).get('/v1/qr'));
    expect(mine.body.codes.length).toBeGreaterThanOrEqual(1);

    const revoke = await authed(request(app).post(`/v1/qr/${gen.body.qr_id}/revoke`)).set('Idempotency-Key', idem()).send({});
    expect(revoke.body.state).toBe('revoked');
    // Cannot revoke someone else's QR.
    const other = w.p.qr.generate('someone:else', { kind: 'access' });
    const denied = await authed(request(app).post(`/v1/qr/${other.qr_id}/revoke`)).set('Idempotency-Key', idem()).send({});
    expect(denied.status).toBe(403);
  });

  test('pay by scanning a payment QR over HTTP', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const authed = session(w);
    const dest = w.p.ledger.openAccount('merchant', 'community_trust').id;
    const card = await authed(request(app).post('/v1/cards')).set('Idempotency-Key', idem())
      .send({ hosted_field_ref: 'hf', brand: 'visa', last4: '4242' });
    const qr = w.p.qr.generate('u:merchant', { kind: 'payment', ref: dest, amountMinor: 15000, currency: 'BWP' });
    const pay = await authed(request(app).post('/v1/qr/pay')).set('Idempotency-Key', idem())
      .send({ token: qr.token, card_id: card.body.id });
    expect(pay.body.state).toBe('authorized');
    expect(pay.body.amount_minor).toBe(15000);
  });

  test('admin: event store, projections and QR management', async () => {
    const w = world();
    makeAdmin(w);
    const { app } = createApp(w.p);
    const authed = session(w);
    // Produce some events.
    const qr = w.p.qr.generate('u:admin', { kind: 'tourism', ref: 'booking:9' });
    w.p.qr.verify(qr.token, { scannerRef: w.kabo.id });

    const events = await authed(request(app).get('/v1/admin/events?stream=qr:' + qr.qr_id));
    expect(events.body.items.length).toBeGreaterThanOrEqual(2); // generated + scanned
    const stats = await authed(request(app).get('/v1/admin/events/stats'));
    expect(stats.body.total).toBeGreaterThan(0);
    const tt = await authed(request(app).get('/v1/admin/events/timetravel?at=' + encodeURIComponent(w.p.clock.nowIso())));
    expect(tt.body.items.length).toBeGreaterThan(0);

    const projections = await authed(request(app).get('/v1/admin/projections'));
    expect(projections.body.find((p) => p.name === 'qr_activity')).toBeTruthy();
    const proj = await authed(request(app).get('/v1/admin/projections/qr_activity'));
    expect(proj.body.state.generated).toBeGreaterThanOrEqual(1);
    const rebuilt = await authed(request(app).post('/v1/admin/projections/qr_activity/rebuild')).set('Idempotency-Key', idem()).send({});
    expect(rebuilt.body.state.generated).toBeGreaterThanOrEqual(1);

    const list = await authed(request(app).get('/v1/admin/qr?kind=tourism'));
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    const report = await authed(request(app).get('/v1/admin/qr/report'));
    expect(report.body.total).toBeGreaterThanOrEqual(1);
    const scans = await authed(request(app).get(`/v1/admin/qr/${qr.qr_id}/scans`));
    expect(scans.body.length).toBeGreaterThanOrEqual(1);
    const bulk = await authed(request(app).post('/v1/admin/qr/bulk')).set('Idempotency-Key', idem())
      .send({ items: [{ kind: 'learning', ref: 'l1' }, { kind: 'learning', ref: 'l2' }] });
    expect(bulk.body.codes).toHaveLength(2);
    const adminRevoke = await authed(request(app).post(`/v1/admin/qr/${qr.qr_id}/revoke`)).set('Idempotency-Key', idem()).send({ reason: 'ops' });
    expect(adminRevoke.body.state).toBe('revoked');
  });

  test('admin QR routes require platform_admin', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const authed = session(w); // ordinary member
    const res = await authed(request(app).get('/v1/admin/qr/report'));
    expect(res.status).toBe(403);
  });
});

describe('QR SDK (WS14/WS21)', () => {
  function client(w, app) {
    const fetchLike = async (url, opts) => {
      const path = url.replace('http://sdk', '');
      let req = request(app)[opts.method.toLowerCase()](path);
      for (const [key, v] of Object.entries(opts.headers || {})) req = req.set(key, v);
      const res = opts.body ? await req.send(JSON.parse(opts.body)) : await req;
      return { ok: res.status < 400, status: res.status, text: async () => JSON.stringify(res.body), json: async () => res.body };
    };
    return new MotseClient({ baseUrl: 'http://sdk', fetch: fetchLike, deviceId: 'sdk-dev' });
  }

  test('the SDK drives generate → verify → decode → revoke and offline verify', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const sdk = client(w, app);
    const otp = await sdk.requestOtp('+26771000002');
    await sdk.verifyOtp('+26771000002', otp.sandbox_code);

    const gen = await sdk.generateQr({ kind: 'wallet', subjectRef: w.kabo.id, data: { label: 'pay me' } });
    expect(gen.token).toBeTruthy();
    expect((await sdk.verifyQr(gen.token)).valid).toBe(true);
    expect((await sdk.decodeQr(gen.token)).kind).toBe('wallet');
    expect((await sdk.myQrCodes()).codes.length).toBeGreaterThanOrEqual(1);

    // Offline verification against the platform's signing secret.
    const secret = w.p.secrets.current('qr:signing').value;
    expect(MotseClient.verifyQrOffline(secret, gen.token).valid).toBe(true);
    expect(MotseClient.verifyQrOffline(secret, 'bad').valid).toBe(false);
    expect(MotseClient.verifyQrOffline('wrong', gen.token).valid).toBe(false);

    const rev = await sdk.revokeQr(gen.qr_id, 'done');
    expect(rev.state).toBe('revoked');
  });
});
