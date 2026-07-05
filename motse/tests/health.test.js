'use strict';

/**
 * Phase 3 — Health & readiness. The HealthService composes a Foundation-aware
 * readiness view (Kubernetes-style liveness + readiness) on top of the
 * existing `/health` and `MonitoringService.readiness()` surfaces, which stay
 * unchanged. Verified here: the service unit (live/ready/register/degraded),
 * the HTTP probes (`/health/live` 200, `/health/full` 200/503), and the admin
 * observability routes.
 */
const request = require('supertest');
const { createApp } = require('../src/app');
const { createPlatform } = require('../src/container');
const { HealthService } = require('../src/observability/health.service');
const { world } = require('./helpers');

function session(w, msisdn = '+26771000002', deviceId = 'dev-kabo') {
  const otp = w.p.identity.requestOtp(msisdn);
  const { session: s } = w.p.identity.verifyOtp(msisdn, otp.sandbox_code, { deviceId });
  return (r) => r.set('Authorization', `Bearer ${s.access_token}`).set('X-Device-Id', deviceId);
}

function makeAdmin(w) {
  w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
  w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
}

describe('HealthService — liveness & readiness', () => {
  test('live() reports ok with a non-negative uptime', () => {
    const platform = createPlatform();
    const h = platform.health;
    const live = h.live();
    expect(live.status).toBe('ok');
    expect(live.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(typeof live.at).toBe('string');
  });

  test('ready() aggregates the default Foundation checks and is ready at boot', () => {
    const platform = createPlatform();
    const r = platform.health.ready();
    expect(r.ready).toBe(true);
    expect(r.degraded).toBe(false);
    expect(Object.keys(r.checks)).toEqual(
      expect.arrayContaining(['ledger', 'event_bus', 'event_store', 'outbox', 'distributed', 'payments'])
    );
    expect(r.checks.ledger.healthy).toBe(true);
    expect(r.checks.distributed.detail).toContain('KvAdapter');
  });

  test('a dead-lettered outbox row makes readiness degraded but still ready', () => {
    const platform = createPlatform();
    // Force a dead letter: publish a type with no schema so the bus rejects it.
    platform.outbox.maxAttempts = 1;
    platform.outbox.run(({ stage }) => stage('unregistered.type.for.health', { x: 1 }));
    const r = platform.health.ready();
    expect(platform.outbox.stats().dead).toBe(1);
    expect(r.checks.outbox.degraded).toBe(true);
    expect(r.degraded).toBe(true);
    // Degraded is a warning signal, not a readiness failure.
    expect(r.checks.outbox.healthy).toBe(true);
    expect(r.ready).toBe(true);
  });

  test('an unhealthy check flips ready to false', () => {
    const platform = createPlatform();
    platform.health.register('synthetic', () => ({ healthy: false, detail: 'forced down' }));
    const r = platform.health.ready();
    expect(r.ready).toBe(false);
    expect(r.checks.synthetic).toEqual({ healthy: false, detail: 'forced down' });
  });

  test('a throwing check is treated as unhealthy (fail-closed), not a crash', () => {
    const platform = createPlatform();
    platform.health.register('explodes', () => { throw new Error('probe error'); });
    const r = platform.health.ready();
    expect(r.ready).toBe(false);
    expect(r.checks.explodes).toEqual({ healthy: false, detail: 'probe error' });
  });

  test('a check returning nothing is treated as unhealthy', () => {
    const platform = createPlatform();
    platform.health.register('silent', () => undefined);
    const r = platform.health.ready();
    expect(r.checks.silent).toEqual({ healthy: false, detail: 'no result' });
    expect(r.ready).toBe(false);
  });

  test('payments check tolerates a platform without a payments service', () => {
    const clock = { nowMs: () => 0, nowIso: () => '1970-01-01T00:00:00.000Z' };
    const stub = {
      ledger: { trialBalance: () => ({ balanced: true }) },
      bus: { schemas: new Map([['e', 1]]) },
      eventStore: { stats: () => ({ total: 0 }) },
      outbox: { stats: () => ({ pending: 0, dead: 0 }) },
      kv: { constructor: { name: 'InMemoryKvAdapter' } },
      payments: null,
    };
    const h = new HealthService({ platform: stub, clock });
    const r = h.ready();
    expect(r.checks.payments).toEqual({ healthy: true, detail: 'n/a' });
    expect(r.ready).toBe(true);
  });
});

describe('Health & observability — HTTP surface', () => {
  test('GET /health/live returns 200 ok', async () => {
    const { app } = createApp(createPlatform());
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /health/full returns 200 when ready', async () => {
    const { app } = createApp(createPlatform());
    const res = await request(app).get('/health/full');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.ledger.healthy).toBe(true);
  });

  test('GET /health/full returns 503 when a check is unhealthy', async () => {
    const platform = createPlatform();
    platform.health.register('forced', () => ({ healthy: false }));
    const { app } = createApp(platform);
    const res = await request(app).get('/health/full');
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
  });

  test('the existing /health and /health/ready endpoints are unchanged', async () => {
    const { app } = createApp(createPlatform());
    const legacy = await request(app).get('/health');
    expect(legacy.status).toBe(200);
    expect(legacy.body).toMatchObject({ ok: true, service: 'motse-core' });
    const ready = await request(app).get('/health/ready');
    expect([200, 503]).toContain(ready.status);
    expect(ready.body).toHaveProperty('ready');
  });

  test('every response carries a trace id and a W3C traceparent header', async () => {
    const { app } = createApp(createPlatform());
    const res = await request(app).get('/health/live');
    expect(res.headers['x-trace-id']).toBeTruthy();
    // A minted trace id (no inbound traceparent) carries a `trc_` prefix.
    expect(res.headers.traceparent).toMatch(/^00-.+-[0-9a-f]{16}-01$/);
  });

  test('an inbound traceparent is honoured end-to-end', async () => {
    const traceId = 'a'.repeat(32);
    const { app } = createApp(createPlatform());
    const res = await request(app)
      .get('/health/live')
      .set('traceparent', `00-${traceId}-${'b'.repeat(16)}-01`);
    expect(res.headers['x-trace-id']).toBe(traceId);
    expect(res.headers.traceparent).toContain(traceId);
  });

  test('a request produces a root HTTP span queryable by trace id', async () => {
    const platform = createPlatform();
    const { app } = createApp(platform);
    const traceId = 'c'.repeat(32);
    await request(app).get('/health/live').set('traceparent', `00-${traceId}-${'d'.repeat(16)}-01`);
    const spans = platform.tracer.trace(traceId);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const root = spans.find((s) => s.name === 'HTTP GET');
    expect(root).toBeTruthy();
    expect(root.attributes['http.status_code']).toBe(200);
    expect(root.attributes['http.target']).toBe('/health/live');
  });

  test('/metrics renders Foundation instrumentation from real traffic', async () => {
    const { app } = createApp(createPlatform());
    await request(app).get('/health/live');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // The request middleware records http metrics; the registry is shared.
    expect(res.text).toContain('# TYPE');
  });
});

describe('Admin observability routes', () => {
  async function setup() {
    const w = world();
    makeAdmin(w);
    const { app } = createApp(w.p);
    const authed = session(w);
    return { w, app, authed };
  }

  test('traces / trace-by-id / tracer-stats / health are admin-guarded and functional', async () => {
    const { w, app, authed } = await setup();
    // Generate a trace by hitting an endpoint.
    const traceId = 'e'.repeat(32);
    await request(app).get('/health/live').set('traceparent', `00-${traceId}-${'f'.repeat(16)}-01`);

    const recent = await authed(request(app).get('/v1/admin/observability/traces'));
    expect(recent.status).toBe(200);
    expect(Array.isArray(recent.body)).toBe(true);

    const byId = await authed(request(app).get(`/v1/admin/observability/traces/${traceId}`));
    expect(byId.status).toBe(200);
    expect(byId.body.some((s) => s.trace_id === traceId)).toBe(true);

    const stats = await authed(request(app).get('/v1/admin/observability/tracer'));
    expect(stats.status).toBe(200);
    expect(stats.body).toHaveProperty('spans');
    expect(stats.body).toHaveProperty('max_spans');

    const health = await authed(request(app).get('/v1/admin/observability/health'));
    expect(health.status).toBe(200);
    expect(health.body).toHaveProperty('ready');
    expect(health.body.checks).toHaveProperty('ledger');

    // Guard: an unauthenticated caller is rejected.
    const unauth = await request(app).get('/v1/admin/observability/tracer');
    expect(unauth.status).toBe(401);
  });
});
