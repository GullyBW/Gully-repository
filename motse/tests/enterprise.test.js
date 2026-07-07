'use strict';

/**
 * Missions 1–3 (enterprise operational platform) — each mission fixes one
 * evidence-based finding from the production-validation harness:
 *
 *   M1 DependencyHealthEngine — active probes + state machine (healthy/
 *      degraded/recovering/maintenance/failed); readiness now SEES a KV
 *      outage (finding 1).
 *   M2 AdaptiveRateLimiter — identity-aware quotas; authenticated users are
 *      no longer starved by an exhausted anonymous IP bucket (finding 2);
 *      anonymous traffic delegates to the existing limiter unchanged.
 *   M3 Outbox event platform — transaction-safe pending index (finding 3),
 *      delayed/scheduled events, priorities, correlation replay, retention.
 */
const request = require('supertest');
const { DependencyHealthEngine } = require('../src/observability/dependency.health');
const { AdaptiveRateLimiter } = require('../src/security/adaptive.rateLimiter');
const { OutboxService } = require('../src/persistence/outbox');
const { ChaosKv } = require('../src/distributed/chaos.kv');
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { EventBus } = require('../src/kernel/eventBus');
const { Metrics } = require('../src/monitoring/metrics');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

function engine(opts = {}) {
  return new DependencyHealthEngine({ clock: new Clock(), ...opts });
}

describe('M1 · DependencyHealthEngine — state machine', () => {
  test('a healthy probe records latency, last success and version', async () => {
    const e = engine().register('db', { probe: async () => ({ version: '15.2', detail: 'pg' }), impact: 'writes fail' });
    const r = await e.check('db');
    expect(r.state).toBe('healthy');
    expect(r.version).toBe('15.2');
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    expect(r.last_success_at).toBeTruthy();
    expect(r.consecutive_successes).toBe(1);
    expect(r.impact).toBe('writes fail');
    expect(r.probe).toBeUndefined(); // internals never leak from views
  });

  test('failure → failed with the reason; success → recovering → healthy after the threshold', async () => {
    let up = false;
    const e = engine({ recoveryThreshold: 2 }).register('redis', { probe: async () => { if (!up) throw new Error('ECONNREFUSED'); } });
    await e.check('redis');
    expect(e.summary().redis).toBe('failed');
    expect(e.diagnostics()[0].degradation_reason).toBe('ECONNREFUSED');
    up = true;
    await e.check('redis');
    expect(e.summary().redis).toBe('recovering'); // one success is not enough
    await e.check('redis');
    expect(e.summary().redis).toBe('healthy');
    expect(e.diagnostics()[0].degradation_reason).toBeNull();
  });

  test('a probe reporting degraded sets the state and reason; clearing recovers it', async () => {
    let slow = true;
    const e = engine().register('queue', { probe: async () => ({ degraded: slow, reason: slow ? 'backlog high' : null }) });
    await e.check('queue');
    expect(e.summary().queue).toBe('degraded');
    expect(e.diagnostics()[0].degradation_reason).toBe('backlog high');
    slow = false;
    await e.check('queue');
    expect(e.summary().queue).toBe('healthy');
  });

  test('maintenance pins the state through probe failures and restores on exit', async () => {
    const e = engine().register('storage', { probe: async () => { throw new Error('down for upgrade'); } });
    e.setMaintenance('storage', true, 'planned upgrade');
    await e.check('storage');
    expect(e.summary().storage).toBe('maintenance'); // failures don't page during maintenance
    expect(e.verdict().healthy).toBe(true); // maintenance never breaks readiness
    e.setMaintenance('storage', false);
    expect(e.summary().storage).toBe('healthy'); // restored to the pre-maintenance state
  });

  test('a hung probe times out and counts as failed', async () => {
    const e = new DependencyHealthEngine({ clock: new Clock(), timeoutMs: 30 });
    e.register('api', { probe: () => new Promise(() => {}) }); // never resolves
    const r = await e.check('api');
    expect(r.state).toBe('failed');
    expect(r.degradation_reason).toContain('timeout');
  });

  test('verdict: only a FAILED CRITICAL dependency breaks readiness', async () => {
    const e = engine()
      .register('core', { probe: async () => {}, critical: true })
      .register('optional', { probe: async () => { throw new Error('meh'); }, critical: false });
    await e.checkAll();
    const v = e.verdict();
    expect(v.healthy).toBe(true); // non-critical failure → still ready
    expect(v.degraded).toBe(true);
    expect(v.attention).toEqual(['optional:failed']);
  });

  test('summary is public-safe (states only); diagnostics carries the detail', async () => {
    const e = engine().register('x', { probe: async () => { throw new Error('secret-internal-host refused'); } });
    await e.checkAll();
    expect(JSON.stringify(e.summary())).not.toContain('secret-internal-host');
    expect(e.diagnostics()[0].degradation_reason).toContain('secret-internal-host');
  });

  test('checking an unregistered dependency throws', () => {
    expect(() => engine().setMaintenance('ghost', true)).toThrow('unknown dependency');
  });
});

describe('M1 · platform integration — readiness sees a KV outage (finding 1 fixed)', () => {
  test('outage → probes fail → cached readiness flips; recovery restores it', async () => {
    const platform = createPlatform();
    expect((await platform.health.readyFull()).ready).toBe(true);
    const chaos = new ChaosKv(platform.kv).down();
    platform.kv = chaos;
    await platform.dependencies.checkAll();
    const during = platform.health.ready(); // sync, cached — what k8s consumes
    expect(during.ready).toBe(false);
    expect(during.checks.dependencies.detail).toContain('redis:failed');
    chaos.up();
    await platform.dependencies.check('redis');
    await platform.dependencies.check('redis');
    expect(platform.health.ready().ready).toBe(true);
  });

  test('GET /health/full re-probes and returns the public-safe dependency map', async () => {
    const { app } = createApp(createPlatform());
    const res = await request(app).get('/health/full');
    expect(res.status).toBe(200);
    expect(res.body.dependencies.redis).toBe('healthy');
    expect(res.body.dependencies.outbox_relay).toBe('healthy');
    // Public payload: state strings only, no reasons/impact/internals.
    expect(JSON.stringify(res.body.dependencies)).not.toContain('impact');
  });

  test('admin /dependencies exposes full diagnostics', async () => {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const res = await request(app)
      .get('/v1/admin/dependencies')
      .set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');
    expect(res.status).toBe(200);
    const redis = res.body.find((d) => d.name === 'redis');
    expect(redis).toMatchObject({ state: 'healthy', critical: true });
    expect(redis.impact).toContain('idempotency');
    expect(redis.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('M2 · AdaptiveRateLimiter — classification & quotas', () => {
  function authedPlatform() {
    const w = world();
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    return { w, token: session.access_token };
  }

  const fakeReq = (headers = {}, ip = '10.0.0.1') => ({ ip, get: (h) => headers[h.toLowerCase()] || null });

  test('classification: anonymous, user, admin and api-key callers land in their classes', () => {
    const { w, token } = authedPlatform();
    const rl = w.p.rateLimiterAdaptive;
    expect(rl.classify(fakeReq())).toEqual({ cls: 'anonymous', key: 'ip:10.0.0.1' });
    const user = rl.classify(fakeReq({ authorization: `Bearer ${token}`, 'x-device-id': 'dev-kabo' }));
    expect(user.cls).toBe('user');
    expect(user.key).toMatch(/^user:/);
    expect(rl.classify(fakeReq({ 'x-api-key': 'pk_live_abc' }))).toMatchObject({ cls: 'api_key' });
    // Invalid token → anonymous (soft identification never throws).
    expect(rl.classify(fakeReq({ authorization: 'Bearer garbage' })).cls).toBe('anonymous');
    // Admin grant upgrades the class.
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    expect(rl.classify(fakeReq({ authorization: `Bearer ${token}`, 'x-device-id': 'dev-kabo' })).cls).toBe('admin');
  });

  test('finding 2 fixed: an exhausted anonymous bucket no longer starves authenticated users', async () => {
    const { w, token } = authedPlatform();
    const { RateLimiter } = require('../src/security/rateLimiter');
    // Tiny anonymous bucket (as the sustained-load phase produces).
    w.p.rateLimiter = new RateLimiter({ clock: w.p.clock, capacity: 1, refillPerSecond: 0.0001 });
    const { app } = createApp(w.p);
    await request(app).get('/v1/kgetsi/campaigns'); // consumes the only anonymous token
    const anonLimited = await request(app).get('/v1/kgetsi/campaigns');
    expect(anonLimited.status).toBe(429); // anonymous IS limited (delegation intact)
    const authedOk = await request(app)
      .get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'dev-kabo');
    expect(authedOk.status).toBe(200); // authenticated rides its own quota
  });

  test('per-class quotas enforce independently and are runtime-adjustable', async () => {
    const { w, token } = authedPlatform();
    w.p.rateLimiterAdaptive.setQuota('user', { capacity: 2, refillPerSecond: 0.0001 });
    const { app } = createApp(w.p);
    const hit = () => request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'dev-kabo');
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED'); // envelope carries the code, not custom text
  });

  test('temporary bans block immediately and expire on their own', async () => {
    const { w, token } = authedPlatform();
    const rl = w.p.rateLimiterAdaptive;
    const { key } = rl.classify(fakeReq({ authorization: `Bearer ${token}`, 'x-device-id': 'dev-kabo' }));
    rl.ban(key, 60000, 'abuse pattern');
    const { app } = createApp(w.p);
    const banned = await request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'dev-kabo');
    expect(banned.status).toBe(429);
    expect(banned.body.code).toBe('RATE_LIMITED');
    w.p.clock.advance(61000); // ban expires
    const after = await request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'dev-kabo');
    expect(after.status).toBe(200);
    expect(rl.stats().bans).toHaveLength(0); // expired ban was reaped
  });

  test('emergency override scales identified-class quotas at runtime', () => {
    const { w } = authedPlatform();
    const rl = w.p.rateLimiterAdaptive;
    rl.setQuota('user', { capacity: 1, refillPerSecond: 0 });
    expect(rl.allow('user', 'user:u1')).toBe(true);
    expect(rl.allow('user', 'user:u1')).toBe(false);
    rl.setOverride(3); // emergency loosening
    expect(rl.allow('user', 'user:u2')).toBe(true); // fresh bucket at 3× capacity
    expect(rl.allow('user', 'user:u2')).toBe(true);
    expect(rl.allow('user', 'user:u2')).toBe(true);
    expect(rl.allow('user', 'user:u2')).toBe(false);
  });

  test('quota guard-rails: unknown and delegated classes are rejected', () => {
    const { w } = authedPlatform();
    let e1; try { w.p.rateLimiterAdaptive.setQuota('ghost', { capacity: 1 }); } catch (e) { e1 = e; }
    expect(e1 && e1.code).toBe('INVALID_ARGUMENT');
    let e2; try { w.p.rateLimiterAdaptive.setQuota('anonymous', { capacity: 1 }); } catch (e) { e2 = e; }
    expect(e2 && e2.code).toBe('INVALID_ARGUMENT'); // delegated class is not directly tunable
  });

  test('stats expose quotas, bans and top consumers; metrics count by class', async () => {
    const { w, token } = authedPlatform();
    const { app } = createApp(w.p);
    await request(app).get('/v1/kgetsi/campaigns'); // anonymous
    await request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'dev-kabo'); // user
    const stats = w.p.rateLimiterAdaptive.stats();
    expect(stats.quotas.user.capacity).toBeGreaterThan(0);
    expect(stats.top_consumers.length).toBeGreaterThanOrEqual(1);
    expect(w.p.metrics.counterValue('motse_ratelimit_adaptive_total', { class: 'anonymous', result: 'allowed' })).toBeGreaterThanOrEqual(1);
    expect(w.p.metrics.counterValue('motse_ratelimit_adaptive_total', { class: 'user', result: 'allowed' })).toBeGreaterThanOrEqual(1);
  });
});

describe('M3 · Outbox event platform', () => {
  function setup(opts = {}) {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    bus.register('evt.b', 1, ['n']);
    const outbox = new OutboxService({ store, clock, bus, metrics: new Metrics(), ...opts });
    const delivered = [];
    bus.subscribe('evt.a', 'probe', (e) => delivered.push({ type: 'evt.a', ...e.data }));
    bus.subscribe('evt.b', 'probe', (e) => delivered.push({ type: 'evt.b', ...e.data }));
    return { store, clock, bus, outbox, delivered };
  }

  test('a rolled-back transaction leaves no dangling index entries (transaction safety)', () => {
    const { outbox, delivered } = setup();
    outbox.run(({ stage }) => stage('evt.a', { n: 1 })); // builds the index
    expect(() =>
      outbox.run(({ stage }) => {
        stage('evt.a', { n: 999 });
        throw new Error('rollback');
      })
    ).toThrow('rollback');
    const result = outbox.drain(); // must not see ghosts of the rolled-back row
    expect(result).toMatchObject({ published: 0, dead: 0 });
    expect(delivered.map((d) => d.n)).toEqual([1]);
    expect(outbox.stats().pending).toBe(0);
  });

  test('scheduled events defer without burning attempts, then deliver when due', () => {
    const { outbox, clock, delivered } = setup();
    outbox.run(({ stage }) => stage('evt.a', { n: 1 }, { deliverAt: clock.nowMs() + 60000 }));
    expect(delivered).toHaveLength(0);
    expect(outbox.stats().pending).toBe(1);
    const early = outbox.drain();
    expect(early).toMatchObject({ published: 0, deferred: 1 });
    expect(outbox.outbox.find()[0].attempts).toBe(0); // deferral is free
    clock.advance(61000);
    expect(outbox.drain()).toMatchObject({ published: 1, deferred: 0 });
    expect(delivered.map((d) => d.n)).toEqual([1]);
  });

  test('deliverAt accepts an ISO timestamp', () => {
    const { outbox, clock, delivered } = setup();
    const due = new Date(clock.nowMs() + 30000).toISOString();
    outbox.run(({ stage }) => stage('evt.a', { n: 7 }, { deliverAt: due }));
    expect(delivered).toHaveLength(0);
    clock.advance(31000);
    outbox.drain();
    expect(delivered.map((d) => d.n)).toEqual([7]);
  });

  test('priority publishes first; equal priority preserves staging order', () => {
    const { outbox, delivered } = setup();
    outbox.run(({ stage }) => {
      stage('evt.a', { n: 1 }); // priority 0, seq 1
      stage('evt.b', { n: 2 }, { priority: 5 }); // urgent
      stage('evt.a', { n: 3 }); // priority 0, seq 3
    });
    expect(delivered.map((d) => d.n)).toEqual([2, 1, 3]);
  });

  test('replayWhere republishes by correlation id with the original stable outbox_id', () => {
    const { outbox, delivered } = setup();
    outbox.run(({ stage }) => {
      stage('evt.a', { n: 1 }, { correlationId: 'order-42' });
      stage('evt.a', { n: 2 }, { correlationId: 'other' });
    });
    expect(delivered).toHaveLength(2);
    const firstId = delivered[0].outbox_id;
    const replay = outbox.replayWhere({ correlationId: 'order-42' });
    expect(replay.replayed).toBe(1);
    expect(delivered).toHaveLength(3);
    expect(delivered[2].outbox_id).toBe(firstId); // consumers dedupe on this
  });

  test('replayWhere filters by type and time window and honours the limit', () => {
    const { outbox, clock } = setup();
    outbox.run(({ stage }) => stage('evt.a', { n: 1 }));
    clock.advance(1); // `since`/`until` are inclusive — move past the first staged_at
    const mid = clock.nowIso();
    clock.advance(5000);
    outbox.run(({ stage }) => { stage('evt.b', { n: 2 }); stage('evt.b', { n: 3 }); });
    expect(outbox.replayWhere({ type: 'evt.b' }).replayed).toBe(2);
    expect(outbox.replayWhere({ until: mid }).replayed).toBe(1);
    expect(outbox.replayWhere({ since: mid }).replayed).toBe(2);
    expect(outbox.replayWhere({ limit: 1 }).replayed).toBe(1);
  });

  test('prune archives published rows (keepLast) and archived events stay replayable', () => {
    const { outbox, delivered } = setup();
    for (let i = 0; i < 5; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    const pruned = outbox.prune({ keepLast: 2 });
    expect(pruned).toMatchObject({ archived: 3, live_published: 2 });
    expect(outbox.stats()).toMatchObject({ published: 2, archived: 3 });
    const replay = outbox.replayWhere({ type: 'evt.a' }); // live + archive
    expect(replay.replayed).toBe(5);
    expect(delivered).toHaveLength(10);
  });

  test('prune by age archives only rows older than the horizon', () => {
    const { outbox, clock } = setup();
    outbox.run(({ stage }) => stage('evt.a', { n: 1 }));
    clock.advance(60 * 60 * 1000); // 1h later
    outbox.run(({ stage }) => stage('evt.a', { n: 2 }));
    const pruned = outbox.prune({ olderThanMs: 30 * 60 * 1000 });
    expect(pruned.archived).toBe(1);
    expect(outbox.stats().published).toBe(1);
  });

  test('opt-in retention auto-prunes on the configured drain cadence', () => {
    const { store, clock, bus } = setup();
    const outbox = new OutboxService({
      store: new Store(), clock, bus, retention: { keepPublished: 3, everyDrains: 1 },
    });
    void store;
    for (let i = 0; i < 8; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    const s = outbox.stats();
    expect(s.published).toBeLessThanOrEqual(3);
    expect(s.archived + s.published).toBe(8);
  });

  test('crash recovery: a fresh relay over the same store rebuilds the index by scan', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    let down = true;
    bus.subscribe('evt.a', 'probe', () => { if (down) throw new Error('consumer down'); });
    const first = new OutboxService({ store, clock, bus, maxAttempts: 99 });
    first.run(({ stage }) => stage('evt.a', { n: 1 })); // stays pending (consumer down)
    expect(first.stats().pending).toBe(1);
    // "Crash": a new relay instance over the same persisted collections.
    down = false;
    const second = new OutboxService({ store, clock, bus });
    const recovered = second.drain();
    expect(recovered.published).toBe(1);
    expect(second.stats().pending).toBe(0);
  });

  test('drain cost stays flat as published rows accumulate (finding 3 fixed)', () => {
    const { outbox } = setup();
    // Seed 3,000 published rows — under the old full-scan drain this made
    // every subsequent op scan all of them.
    for (let i = 0; i < 3000; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    const usPerOp = Number(process.hrtime.bigint() - t0) / 1000 / 200;
    // Old implementation measured ~866µs/op at 5.5k rows; the index holds
    // this to double-digit µs. Generous bound for slow CI runners.
    expect(usPerOp).toBeLessThan(400);
  });
});

describe('branch coverage — defaults and guard rails', () => {
  test('DependencyHealthEngine constructs with no arguments (default clock/timeouts)', async () => {
    const e = new DependencyHealthEngine();
    e.register('bare', { probe: async () => {} });
    const r = await e.check('bare');
    expect(r.state).toBe('healthy');
  });

  test('leaving maintenance that was never entered restores healthy', () => {
    const e = engine().register('x', { probe: async () => {} });
    const r = e.setMaintenance('x', false); // prev_state undefined → healthy fallback
    expect(r.state).toBe('healthy');
  });

  test('a SUCCEEDING probe during maintenance keeps the pinned maintenance state', async () => {
    const e = engine().register('x', { probe: async () => ({ version: '1' }) });
    e.setMaintenance('x', true);
    await e.check('x');
    expect(e.summary().x).toBe('maintenance');
    expect(e.diagnostics()[0].version).toBe('1'); // telemetry still collected
  });

  test('AdaptiveRateLimiter: constructor quota overrides, no-metrics default, partial setQuota', () => {
    const rl = new AdaptiveRateLimiter({
      platform: {}, clock: new Clock(),
      quotas: { user: { capacity: 5 } }, // merge with defaults
    });
    expect(rl.quotas.user).toMatchObject({ capacity: 5, refillPerSecond: 10 });
    rl.setQuota('user', { capacity: 7 }); // only capacity
    rl.setQuota('user', { refillPerSecond: 3 }); // only refill
    expect(rl.quotas.user).toMatchObject({ capacity: 7, refillPerSecond: 3 });
    // A request object without get() classifies as anonymous.
    expect(rl.classify({ ip: '9.9.9.9' })).toEqual({ cls: 'anonymous', key: 'ip:9.9.9.9' });
    expect(rl.stats({ top: 1 }).top_consumers).toHaveLength(0);
  });

  test('outbox: an invalid deliverAt string is treated as immediate delivery', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    const delivered = [];
    bus.subscribe('evt.a', 'p', (e) => delivered.push(e.data.n));
    const outbox = new OutboxService({ store, clock, bus });
    outbox.run(({ stage }) => stage('evt.a', { n: 1 }, { deliverAt: 'not-a-date' }));
    expect(delivered).toEqual([1]);
  });

  test('outbox: prune with nothing to archive and with both filters combined', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    const outbox = new OutboxService({ store, clock, bus });
    expect(outbox.prune({ keepLast: 5 })).toEqual({ archived: 0, live_published: 0 });
    for (let i = 0; i < 4; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    clock.advance(3600 * 1000);
    outbox.run(({ stage }) => stage('evt.a', { n: 9 }));
    // Age filter selects the 4 old rows; keepLast then keeps 2 of those.
    const both = outbox.prune({ olderThanMs: 60 * 1000, keepLast: 2 });
    expect(both.archived).toBe(2);
  });

  test('outbox: replayWhere combined filters narrow correctly', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    bus.register('evt.b', 1, ['n']);
    const outbox = new OutboxService({ store, clock, bus });
    outbox.run(({ stage }) => stage('evt.a', { n: 1 }, { correlationId: 'c1' }));
    clock.advance(1);
    const mid = clock.nowIso();
    clock.advance(1000);
    outbox.run(({ stage }) => stage('evt.b', { n: 2 }, { correlationId: 'c1' }));
    const hit = outbox.replayWhere({ type: 'evt.b', correlationId: 'c1', since: mid, until: clock.nowIso() });
    expect(hit.replayed).toBe(1);
    const miss = outbox.replayWhere({ type: 'evt.a', correlationId: 'c1', since: mid });
    expect(miss.replayed).toBe(0);
  });

  test('outbox: retention without everyDrains uses the default cadence (100 drains)', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    const outbox = new OutboxService({ store, clock, bus, retention: { keepPublished: 1 } });
    for (let i = 0; i < 99; i += 1) outbox.run(({ stage }) => stage('evt.a', { n: i }));
    expect(outbox.stats().archived).toBe(0); // not yet at the default cadence
    outbox.run(({ stage }) => stage('evt.a', { n: 99 })); // 100th drain → prune
    expect(outbox.stats().archived).toBeGreaterThan(0);
    expect(outbox.stats().published).toBeLessThanOrEqual(1);
  });

  test('outbox: drain skips an indexed row that was resolved out-of-band', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('evt.a', 1, ['n']);
    let down = true;
    bus.subscribe('evt.a', 'p', () => { if (down) throw new Error('down'); });
    const outbox = new OutboxService({ store, clock, bus, maxAttempts: 99 });
    outbox.run(({ stage }) => stage('evt.a', { n: 1 })); // pending, in the index
    const row = outbox.outbox.find()[0];
    outbox.outbox.update(row.id, { status: 'dead' }); // resolved externally
    down = false;
    expect(outbox.drain()).toMatchObject({ published: 0 }); // guard skips it
  });
});

describe('M1/M2/M3 · admin control-plane routes', () => {
  function adminApp() {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');
    return { w, app, authed };
  }

  test('rate-limit control surface: stats, ban (default TTL), unban, quota, override', async () => {
    const { w, app, authed } = adminApp();
    let k = 0;
    const idem = () => `rl-admin-${k++}`;

    const banned = await authed(request(app).post('/v1/admin/ratelimit/bans')).set('Idempotency-Key', idem())
      .send({ key: 'ip:203.0.113.9' }); // no ttl_ms → default, no reason → default
    expect(banned.status).toBe(200);
    expect(banned.body.until_ms).toBeGreaterThan(w.p.clock.nowMs());

    const stats = await authed(request(app).get('/v1/admin/ratelimit?top=3'));
    expect(stats.status).toBe(200);
    expect(stats.body.bans).toHaveLength(1);
    expect(stats.body.quotas.user).toBeTruthy();

    const unbanned = await authed(request(app).post('/v1/admin/ratelimit/unban')).set('Idempotency-Key', idem())
      .send({ key: 'ip:203.0.113.9' });
    expect(unbanned.body.removed).toBe(true);

    const quota = await authed(request(app).post('/v1/admin/ratelimit/quota')).set('Idempotency-Key', idem())
      .send({ class: 'api_key', capacity: 99, refill_per_second: 9 });
    expect(quota.body).toMatchObject({ cls: 'api_key', capacity: 99, refillPerSecond: 9 });

    const override = await authed(request(app).post('/v1/admin/ratelimit/override')).set('Idempotency-Key', idem())
      .send({ multiplier: 0.5 });
    expect(override.body.override_multiplier).toBe(0.5);
    expect(w.p.rateLimiterAdaptive.overrideMultiplier).toBe(0.5);
  });

  test('dependency control surface: check-one, cached diagnostics, maintenance toggle', async () => {
    const { app, authed } = adminApp();
    let k = 0;
    const idem = () => `dep-admin-${k++}`;

    const one = await authed(request(app).post('/v1/admin/dependencies/redis/check')).set('Idempotency-Key', idem());
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ name: 'redis', state: 'healthy' });

    const maint = await authed(request(app).post('/v1/admin/dependencies/redis/maintenance')).set('Idempotency-Key', idem())
      .send({ on: true, reason: 'failover drill' });
    expect(maint.body.state).toBe('maintenance');

    const cached = await authed(request(app).get('/v1/admin/dependencies/cached'));
    expect(cached.status).toBe(200);
    expect(cached.body.find((d) => d.name === 'redis').state).toBe('maintenance');

    const off = await authed(request(app).post('/v1/admin/dependencies/redis/maintenance')).set('Idempotency-Key', idem())
      .send({ on: false });
    expect(off.body.state).toBe('healthy');
  });

  test('prune, replay and archive are operable from the control plane', async () => {
    const { w, app, authed } = adminApp();

    w.p.bus.register('admin.evt', 1, ['n']);
    w.p.outbox.run(({ stage }) => stage('admin.evt', { n: 1 }, { correlationId: 'corr-1' }));
    w.p.outbox.run(({ stage }) => stage('admin.evt', { n: 2 }));

    const prune = await authed(request(app).post('/v1/admin/outbox/prune')).set('Idempotency-Key', 'prune-1').send({ keep_last: 1 });
    expect(prune.status).toBe(200);
    expect(prune.body.archived).toBeGreaterThanOrEqual(1);

    const replay = await authed(request(app).post('/v1/admin/outbox/replay')).set('Idempotency-Key', 'replay-1').send({ correlation_id: 'corr-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(1);

    const archive = await authed(request(app).get('/v1/admin/outbox/archive'));
    expect(archive.status).toBe(200);
    expect(archive.body.items.length).toBeGreaterThanOrEqual(1);
  });
});
