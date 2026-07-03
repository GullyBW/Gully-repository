'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { createPlatform } = require('../src/container');
const { RateLimiter } = require('../src/security/rateLimiter');
const { Logger } = require('../src/monitoring/logger');
const { Clock } = require('../src/kernel/clock');
const { world, liveCampaign } = require('./helpers');

describe('Monitoring (§16)', () => {
  test('domain events, payments and ledger invariants land in /metrics', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 100,
      contributorRef: w.kabo.id,
      idempotencyKey: 'm-give',
    });
    await request(app).get('/health'); // counted once its response finishes
    const res = await request(app).get('/metrics');
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('motse_domain_events_total{type="ledger.posting.committed"}');
    expect(res.text).toContain('motse_ledger_trial_balance_minor 0');
    expect(res.text).toContain('motse_users_total');
    expect(res.text).toContain('motse_http_requests_total');
  });

  test('http middleware records request counters and latency histograms', async () => {
    const w = world();
    const { app } = createApp(w.p);
    await request(app).get('/health');
    await request(app).get('/health');
    expect(
      w.p.metrics.counterValue('motse_http_requests_total', {
        method: 'GET',
        route: '/health',
        code: 200,
      })
    ).toBe(2);
    const rendered = w.p.metrics.render();
    expect(rendered).toContain('motse_http_request_duration_ms_bucket');
    expect(rendered).toContain('motse_http_request_duration_ms_count');
  });

  test('structured logs carry trace ids end-to-end', async () => {
    const lines = [];
    const platform = createPlatform({ logSink: (l) => lines.push(JSON.parse(l)) });
    platform.logger.threshold = 20; // info — the test asserts on log lines
    const { app } = createApp(platform);
    await request(app).get('/health').set('X-Trace-Id', 'trc_test123');
    const httpLine = lines.find((l) => l.message === 'http');
    expect(httpLine.trace_id).toBe('trc_test123');
    expect(httpLine.code).toBe(200);
  });

  test('logger levels filter and child loggers bind fields', () => {
    const lines = [];
    const logger = new Logger({ clock: new Clock(), sink: (l) => lines.push(JSON.parse(l)), level: 'warn' });
    logger.info('hidden');
    logger.with({ module: 'ledger' }).error('boom', { x: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', module: 'ledger', x: 1 });
  });

  test('stuck escrow detection uses the 30-day window', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 1000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'stuck-1',
    });
    expect(w.p.monitoring.stuckEscrows()).toHaveLength(0);
    w.p.clock.advance(31 * 24 * 3600 * 1000);
    expect(w.p.monitoring.stuckEscrows()).toHaveLength(1);
  });

  test('readiness reflects ledger balance and payment health', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const ok = await request(app).get('/health/ready');
    expect(ok.status).toBe(200);
    w.p.payments.retryQueue.deadLetters.push({ label: 'x' });
    const degraded = await request(app).get('/health/ready');
    expect(degraded.status).toBe(503);
    expect(degraded.body.checks.retry_queue_healthy).toBe(false);
  });
});

describe('Security hardening (§13)', () => {
  test('rate limiter: token bucket denies at capacity and refills over time', () => {
    const clock = new Clock();
    const limiter = new RateLimiter({ clock, capacity: 3, refillPerSecond: 1 });
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    expect(limiter.allow('other')).toBe(true); // isolation per key
    clock.advance(2000);
    expect(limiter.allow('k')).toBe(true); // refilled
  });

  test('over-limit requests get RATE_LIMITED with the problem envelope', async () => {
    const w = world();
    w.p.rateLimiter = new RateLimiter({ clock: w.p.clock, capacity: 2, refillPerSecond: 0.001 });
    const { app } = createApp(w.p);
    await request(app).get('/v1/heritage/search');
    await request(app).get('/v1/heritage/search');
    const limited = await request(app).get('/v1/heritage/search');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  test('root/jailbreak device signals disable payouts on that device (§13.1)', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const { sandbox_code } = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', sandbox_code, {
      deviceId: 'rooted-phone',
    });
    const authed = (req) =>
      req.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'rooted-phone');

    await authed(request(app).post('/v1/identity/devices/signals'))
      .set('Idempotency-Key', 'sig-1')
      .send({ rooted: true });

    const res = await authed(request(app).post('/v1/payments/payouts'))
      .set('Idempotency-Key', 'payout-rooted')
      .send({
        provider: 'orange_money',
        source_account_id: w.kaboWallet.id,
        msisdn: '+26771000002',
        amount_minor: 500,
      });
    expect(res.status).toBe(403);
    expect(res.body.domain_reason).toContain('device');
    // The denial is in the permission audit trail.
    const denials = w.p.store.collection('security_denials').find();
    expect(denials.some((d) => d.path.includes('/payments/payouts'))).toBe(true);
  });

  test('security headers ship on every response', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('secret manager: values never appear in describe(); rotation is versioned', () => {
    const w = world();
    const described = JSON.stringify(w.p.secrets.describe());
    expect(described).not.toContain('sandbox-orange_money-secret');
    const v2 = w.p.secrets.rotate('webhook:orange_money');
    expect(v2.version).toBe(2);
    expect(w.p.secrets.validForVerification('webhook:orange_money')).toHaveLength(2);
    w.p.secrets.rotate('webhook:orange_money');
    // Verify window is current + previous only.
    expect(
      w.p.secrets.validForVerification('webhook:orange_money').map((s) => s.version)
    ).toEqual([3, 2]);
  });

  test('unauthenticated and unauthorized requests are counted for permission auditing', async () => {
    const w = world();
    const { app } = createApp(w.p);
    await request(app).get('/v1/notifications'); // 401 — no token
    expect(w.p.metrics.counterValue('motse_authz_denials_total', { code: 'UNAUTHENTICATED' })).toBe(1);
    expect(w.p.store.collection('security_denials').count()).toBe(1);
  });
});
