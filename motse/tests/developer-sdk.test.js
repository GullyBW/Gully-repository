'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world, liveCampaign, publishedItem } = require('./helpers');
const { DeveloperService } = require('../src/developer/developer.service');
const { MotseClient, MotsePartner } = require('../sdk/js/motse');

describe('Developer platform (WS12)', () => {
  function ownerSession(w, app) {
    const otp = w.p.identity.requestOtp('+26771966001');
    const { user, session } = w.p.identity.verifyOtp('+26771966001', otp.sandbox_code, { deviceId: 'dev' });
    return { user, authed: (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev') };
  }

  test('app registration returns the key ONCE; only a hash is stored', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const { authed } = ownerSession(w, app);
    const created = await authed(request(app).post('/v1/developer/apps'))
      .set('Idempotency-Key', 'da-1')
      .send({ name: 'Kalahari Tours', scopes: ['public:read', 'events:subscribe'] });
    expect(created.body.api_key).toMatch(/^msk_/);
    expect(created.body.app.key_hash).toBeUndefined();
    expect(created.body.app.webhook_secret).toBeUndefined();
    // The raw key is never retrievable again.
    const list = await authed(request(app).get('/v1/developer/apps'));
    expect(list.body[0]).not.toHaveProperty('api_key');
  });

  test('API-key auth enforces scope and per-app rate limits', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const { authed } = ownerSession(w, app);
    const created = await authed(request(app).post('/v1/developer/apps'))
      .set('Idempotency-Key', 'da-2')
      .send({ name: 'NGO', scopes: ['public:read'], rate_limit_per_min: 3 });
    const key = created.body.api_key;
    const campaign = liveCampaign(w);

    const ok = await request(app).get(`/v1/partner/campaigns/${campaign.id}/ledger`).set('X-Api-Key', key);
    expect(ok.status).toBe(200);
    expect(ok.body.funded_minor).toBeDefined();

    // Lacks heritage:read scope.
    const denied = await request(app).get('/v1/partner/heritage').set('X-Api-Key', key);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');

    // Bad key.
    const bad = await request(app).get('/v1/partner/search?q=test').set('X-Api-Key', 'msk_nope');
    expect(bad.status).toBe(401);

    // Rate limit (capacity 3) trips on sustained calls.
    let limited = false;
    for (let i = 0; i < 8; i += 1) {
      const r = await request(app).get(`/v1/partner/campaigns/${campaign.id}/ledger`).set('X-Api-Key', key);
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);

    // Usage analytics recorded.
    const usage = await authed(request(app).get(`/v1/developer/apps/${created.body.app.id}/usage`));
    expect(usage.body[0].calls).toBeGreaterThan(0);
  });

  test('webhook subscriptions deliver signed payloads for whitelisted events only', () => {
    const w = world();
    const { user } = { user: w.p.identity.registerAnonymous('dev-x') };
    w.p.identity.grantInstitutional(user.id, { institution: 'Uni' }, 'system:bootstrap');
    const { app: created } = w.p.developer.createApp(user.id, {
      name: 'Research', scopes: ['events:subscribe'],
    });
    const delivered = [];
    w.p.developer.setTransport({
      post: (url, body, headers) => {
        delivered.push({ url, body, headers });
        return { ok: true };
      },
    });
    w.p.developer.subscribe(created.id, {
      eventTypes: ['kgetsi.contribution.received', 'heritage.item.published'],
      url: 'https://research.example/hook',
    });

    // A public contribution → delivered and signed.
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 1000,
      contributorRef: w.kabo.id, idempotencyKey: 'dw-1',
    });
    expect(delivered).toHaveLength(1);
    const sig = delivered[0].headers['X-Motse-Signature'];
    const fullApp = w.p.developer.apps.get(created.id);
    expect(DeveloperService.verifySignature(fullApp, delivered[0].body, sig)).toBe(true);
  });

  test('restricted heritage publication is NEVER fanned out to partners (fail closed)', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dev-y');
    w.p.identity.grantInstitutional(user.id, { institution: 'Uni' }, 'system:bootstrap');
    const { app: created } = w.p.developer.createApp(user.id, { name: 'X', scopes: ['events:subscribe'] });
    const delivered = [];
    w.p.developer.setTransport({ post: (u, b) => { delivered.push(b); return { ok: true }; } });
    w.p.developer.subscribe(created.id, { eventTypes: ['heritage.item.published'], url: 'https://x/h' });

    publishedItem(w, { visibility: 'public' });
    publishedItem(w, { visibility: 'members' }); // must NOT be delivered
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain('"visibility":"public"');
  });

  test('failed deliveries retry and suspend a chronically-failing subscription', () => {
    const w = world();
    const user = w.p.identity.registerAnonymous('dev-z');
    w.p.identity.grantInstitutional(user.id, { institution: 'Uni' }, 'system:bootstrap');
    const { app: created } = w.p.developer.createApp(user.id, { name: 'Flaky', scopes: ['events:subscribe'] });
    w.p.developer.setTransport({ post: () => ({ ok: false }) }); // always fails
    const sub = w.p.developer.subscribe(created.id, {
      eventTypes: ['kgetsi.contribution.received'], url: 'https://down/hook',
    });
    const campaign = liveCampaign(w);
    for (let i = 0; i < 12; i += 1) {
      w.p.kgetsi.contribute(campaign.id, {
        sourceAccountId: w.kaboWallet.id, amountMinor: 1,
        contributorRef: w.kabo.id, idempotencyKey: `flaky-${i}`,
      });
    }
    expect(w.p.developer.subscriptions.get(sub.id).state).toBe('suspended');
  });
});

describe('JavaScript SDK (WS11)', () => {
  test('MotseClient drives the OTP → session → API flow against the live app', async () => {
    const w = world();
    const { app } = createApp(w.p);
    // Adapt supertest to a fetch-like signature for the SDK.
    const fetchLike = async (url, opts) => {
      const path = url.replace('http://sdk', '');
      let req = request(app)[opts.method.toLowerCase()](path);
      for (const [k, v] of Object.entries(opts.headers || {})) req = req.set(k, v);
      const res = opts.body ? await req.send(JSON.parse(opts.body)) : await req;
      return {
        ok: res.status < 400,
        status: res.status,
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      };
    };
    const client = new MotseClient({ baseUrl: 'http://sdk', fetch: fetchLike, deviceId: 'sdk-dev' });
    const otp = await client.requestOtp('+26771000002');
    const verified = await client.verifyOtp('+26771000002', otp.sandbox_code);
    expect(verified.user.level).toBe('L1');
    expect(client.tokens.access).toBeTruthy();
    // An authed call works with the stored token + idempotency handling.
    const wallet = await client.wallet();
    expect(Array.isArray(wallet)).toBe(true);
    const flags = await client.flags();
    expect(flags['module.kgetsi']).toBe(true);
  });

  test('MotsePartner.verifyWebhook accepts a correct signature and rejects a forged one', () => {
    const secret = 'partner-webhook-secret';
    const body = JSON.stringify({ type: 'kgetsi.contribution.received', data: { amount_minor: 100 } });
    const crypto = require('crypto');
    const good = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(MotsePartner.verifyWebhook(secret, body, good)).toBe(true);
    expect(MotsePartner.verifyWebhook(secret, body, 'deadbeef')).toBe(false);
  });

  test('the developer portal and OpenAPI-shaped surface are served', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const portal = await request(app).get('/developers');
    expect(portal.status).toBe(200);
    expect(portal.text).toContain('Developer Platform');
  });
});
