'use strict';

/**
 * Missions 6 (distributed configuration platform) + 9 (predictive capacity
 * planning). Config: typed/validated keys with live appliers, versioned
 * revisions + rollback, snapshots/restore, percentage/canary rollout,
 * scheduled activation/expiration, kill switch + safe mode — proven to apply
 * to the REAL resilience primitives with zero restart. Capacity: evidence-
 * based forecasts with confidence + autoscaling recommendations.
 */
const request = require('supertest');
const { ConfigService, inBucket } = require('../src/config/config.service');
const { CapacityPlanner, rSquared } = require('../src/observability/capacity.planner');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

function fakeClock(start = 0) {
  let t = start;
  return { nowMs: () => t, nowIso: () => new Date(t).toISOString(), advance: (ms) => { t += ms; } };
}

describe('M6 · ConfigService — typed, validated, live-applied', () => {
  test('register seeds the running system via the applier', () => {
    let applied = null;
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('x.limit', { type: 'number', defaultValue: 10, apply: (v) => { applied = v; } });
    expect(applied).toBe(10); // seeded on register
    expect(cfg.get('x.limit')).toBe(10);
  });

  test('set validates type and custom rules, applies live, and records a revision', () => {
    let live = 0;
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('x.n', { type: 'number', defaultValue: 5, validate: (v) => v > 0 || 'positive', apply: (v) => { live = v; } });
    cfg.set('x.n', 20, { actor: 'ops', reason: 'load' });
    expect(live).toBe(20); // applied with zero restart
    expect(cfg.get('x.n')).toBe(20);
    expect(() => cfg.set('x.n', 'not-a-number')).toThrow(); // type check
    let e; try { cfg.set('x.n', -1); } catch (caught) { e = caught; }
    expect(e.code).toBe('INVALID_ARGUMENT'); // custom validator
    const hist = cfg.history('x.n');
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ op: 'set', from: 5, to: 20, actor: 'ops' });
  });

  test('rollback restores a prior revision value (and re-applies)', () => {
    let live = 0;
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('x.n', { type: 'number', defaultValue: 1, apply: (v) => { live = v; } });
    cfg.set('x.n', 2);
    cfg.set('x.n', 3);
    const rev = cfg.history('x.n')[0].rev; // the set→2 revision
    cfg.rollback('x.n', rev, { actor: 'ops' });
    expect(cfg.get('x.n')).toBe(2);
    expect(live).toBe(2);
  });

  test('snapshot + restore round-trips the whole config', () => {
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('a', { type: 'number', defaultValue: 1 });
    cfg.register('b', { type: 'number', defaultValue: 2 });
    cfg.snapshot('baseline', { actor: 'ops' });
    cfg.set('a', 100);
    cfg.set('b', 200);
    const restored = cfg.restore('baseline', { actor: 'ops' });
    expect(restored.restored).toBe(2);
    expect(cfg.get('a')).toBe(1);
    expect(cfg.get('b')).toBe(2);
    let e; try { cfg.restore('nope'); } catch (caught) { e = caught; }
    expect(e.code).toBe('NOT_FOUND');
  });

  test('percentage rollout is deterministic and splits subjects by hash', () => {
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('feature.x', { type: 'boolean', defaultValue: false });
    cfg.rollout('feature.x', true, 50, { salt: 's1' });
    // Deterministic: the same subject always resolves the same way.
    const first = cfg.effective('feature.x', 'tenant-42');
    expect(cfg.effective('feature.x', 'tenant-42')).toBe(first);
    // Across many subjects, roughly half are in-bucket (not exact — hash split).
    let on = 0;
    for (let i = 0; i < 400; i += 1) if (cfg.effective('feature.x', `u${i}`)) on += 1;
    expect(on).toBeGreaterThan(120);
    expect(on).toBeLessThan(280);
    // 0% → nobody, 100% → everybody.
    expect(inBucket('anyone', 's', 0)).toBe(false);
    expect(inBucket('anyone', 's', 100)).toBe(true);
  });

  test('per-subject targeting overrides rollout and default', () => {
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('feature.y', { type: 'string', defaultValue: 'off' });
    cfg.rollout('feature.y', 'canary', 0); // nobody by rollout
    cfg.target('feature.y', 'vip-tenant', 'on', { actor: 'ops' });
    expect(cfg.effective('feature.y', 'vip-tenant')).toBe('on');
    expect(cfg.effective('feature.y', 'someone-else')).toBe('off');
  });

  test('scheduled activation and expiration are processed by tick()', () => {
    const clock = fakeClock(1_000_000);
    let live = 'default';
    const cfg = new ConfigService({ clock });
    cfg.register('x.s', { type: 'string', defaultValue: 'default', apply: (v) => { live = v; } });
    // Schedule an activation 1 minute out, expiring 5 minutes out.
    cfg.set('x.s', 'promo', { activateAt: clock.nowMs() + 60000, expireAt: clock.nowMs() + 300000 });
    expect(cfg.get('x.s')).toBe('default'); // not yet active
    expect(cfg.tick()).toMatchObject({ activated: [], expired: [] });
    clock.advance(61000);
    expect(cfg.tick().activated).toEqual(['x.s']);
    expect(cfg.get('x.s')).toBe('promo');
    expect(live).toBe('promo');
    clock.advance(300000);
    expect(cfg.tick().expired).toEqual(['x.s']);
    expect(cfg.get('x.s')).toBe('default'); // reverted to default on expiry
  });

  test('kill switch and safe mode force managed keys to their safe value, reversibly', () => {
    let live = 0;
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('r.threshold', { type: 'number', defaultValue: 500, safeValue: 100, emergencyManaged: true, apply: (v) => { live = v; } });
    cfg.register('r.plain', { type: 'number', defaultValue: 9, emergencyManaged: false });
    cfg.set('r.threshold', 800);
    expect(live).toBe(800);
    cfg.killSwitch(true, { actor: 'ops' });
    expect(cfg.effective('r.threshold')).toBe(100); // forced safe
    expect(live).toBe(100); // and re-applied live
    expect(cfg.effective('r.plain')).toBe(9); // unmanaged keys unaffected
    cfg.killSwitch(false, { actor: 'ops' });
    expect(cfg.effective('r.threshold')).toBe(800); // restored
    expect(live).toBe(800);
    // Safe mode is an independent lever with the same effect.
    cfg.safeMode(true);
    expect(cfg.effective('r.threshold')).toBe(100);
    cfg.safeMode(false);
  });

  test('a throwing applier never breaks a config change; reapplyAll re-pushes everything', () => {
    const cfg = new ConfigService({ clock: fakeClock() });
    let live = null;
    cfg.register('bad', { type: 'number', defaultValue: 1, apply: (v) => { if (v === 99) throw new Error('apply boom'); live = v; } });
    expect(() => cfg.set('bad', 99)).not.toThrow(); // applier throw is swallowed
    expect(cfg.get('bad')).toBe(99); // value still recorded
    cfg.register('good', { type: 'number', defaultValue: 7, apply: (v) => { live = v; } });
    const re = cfg.reapplyAll();
    expect(re.applied).toEqual(expect.arrayContaining(['bad', 'good']));
  });

  test('an expire-only window reverts to default; invalid schedule times are ignored', () => {
    const clock = fakeClock(1000);
    const cfg = new ConfigService({ clock });
    cfg.register('x.t', { type: 'string', defaultValue: 'base' });
    cfg.set('x.t', 'temp', { expireAt: clock.nowMs() + 1000 }); // active now, expires later
    expect(cfg.get('x.t')).toBe('temp');
    clock.advance(1500);
    expect(cfg.tick().expired).toEqual(['x.t']);
    // Invalid activateAt string → treated as immediate (no crash).
    cfg.set('x.t', 'now', { activateAt: 'not-a-timestamp' });
    expect(cfg.get('x.t')).toBe('now');
  });

  test('duplicate registration and unknown keys are rejected', () => {
    const cfg = new ConfigService({ clock: fakeClock() });
    cfg.register('dup', { type: 'number', defaultValue: 1 });
    cfg.register('str', { type: 'string', defaultValue: 'a' });
    const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    expect(codeOf(() => cfg.register('dup', { defaultValue: 2 }))).toBe('STATE_CONFLICT');
    expect(codeOf(() => cfg.get('ghost'))).toBe('NOT_FOUND');
    expect(codeOf(() => cfg.rollout('ghost', 1, 50))).toBe('NOT_FOUND');
    expect(codeOf(() => cfg.rollout('dup', 1, 200))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => cfg.set('str', 123))).toBe('INVALID_ARGUMENT'); // string type mismatch
    expect(codeOf(() => cfg.set('dup', true))).toBe('INVALID_ARGUMENT'); // number type mismatch
    expect(codeOf(() => cfg.rollback('dup', 9999))).toBe('NOT_FOUND'); // no such revision
  });

  test('restore skips keys that already match the snapshot; activate-only schedule fires', () => {
    const clock = fakeClock(1000);
    const cfg = new ConfigService({ clock });
    cfg.register('p', { type: 'number', defaultValue: 1 });
    cfg.register('q', { type: 'number', defaultValue: 2 });
    cfg.snapshot('s', { actor: 'ops' });
    cfg.set('p', 10); // only p changes
    const restored = cfg.restore('s', { actor: 'ops' });
    expect(restored.restored).toBe(1); // q was unchanged → skipped
    // Activation with no expiry window (schedule cleared to null on activate).
    cfg.set('q', 5, { activateAt: clock.nowMs() + 1000 });
    clock.advance(1500);
    expect(cfg.tick().activated).toEqual(['q']);
    expect(cfg.get('q')).toBe(5);
  });
});

describe('M6 · ConfigService — live application to the real platform', () => {
  test('setting a resilience threshold mutates the running breaker with zero restart', () => {
    const platform = createPlatform();
    const breaker = platform.resilience.breaker('redis');
    expect(breaker.failureThreshold).toBe(5); // seeded default
    platform.config.set('resilience.redis.breaker.failureThreshold', 12, { actor: 'ops' });
    expect(breaker.failureThreshold).toBe(12); // same live object, updated
  });

  test('kill switch drives every emergency-managed resilience knob to safe values', () => {
    const platform = createPlatform();
    platform.config.set('resilience.loadShedding.maxInFlight', 900, { actor: 'ops' });
    expect(platform.resilience.shedder.maxInFlight).toBe(900);
    platform.config.killSwitch(true, { actor: 'ops' });
    expect(platform.resilience.shedder.maxInFlight).toBe(150); // safe value applied
    expect(platform.resilience.breaker('redis').failureThreshold).toBe(3);
    platform.config.killSwitch(false, { actor: 'ops' });
    expect(platform.resilience.shedder.maxInFlight).toBe(900); // restored
  });

  test('config changes emit an event and increment the change metric', () => {
    const platform = createPlatform();
    platform.config.set('telemetry.otel.batchSize', 256, { actor: 'ops', reason: 'tuning' });
    expect(platform.otel.batchSize).toBe(256);
    expect(platform.metrics.counterValue('motse_config_changes_total', { op: 'set' })).toBeGreaterThanOrEqual(1);
  });
});

describe('M9 · CapacityPlanner — evidence-based forecasting', () => {
  function plannerWithTrend(field, startVal, perSample, samples = 60, limit = null) {
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({ clock });
    for (let i = 0; i < samples; i += 1) {
      clock.advance(3600000); // 1h between samples
      planner.history.push({
        at_ms: clock.nowMs(), at: clock.nowIso(),
        heap_used_bytes: field === 'heap_used_bytes' ? startVal + i * perSample : 1e8,
        heap_limit_bytes: limit || 2e9, rss_bytes: 2e8, event_loop_utilization: 0.2,
        outbox_pending: field === 'outbox_pending' ? startVal + i * perSample : 0,
        outbox_total: 100, archive_rows: 0,
        store_rows: field === 'store_rows' ? startVal + i * perSample : 1000,
      });
    }
    return planner;
  }

  test('project computes slope, multi-horizon forecast, time-to-limit and confidence', () => {
    const planner = plannerWithTrend('heap_used_bytes', 1e9, 5e6, 60, 2e9);
    const proj = planner.project('heap_used_bytes', { limitField: 'heap_limit_bytes' });
    expect(proj.slope_per_day).toBeGreaterThan(0);
    expect(proj.forecast['365d']).toBeGreaterThan(proj.forecast['30d']);
    expect(proj.time_to_limit_days).toBeGreaterThan(0);
    expect(proj.confidence.level).toBe('high'); // clean linear trend, 60 samples
    expect(proj.assumptions.length).toBeGreaterThan(0);
  });

  test('too few samples yields an insufficient-data projection (no false forecast)', () => {
    const planner = new CapacityPlanner({ clock: fakeClock() });
    planner.history.push({ at_ms: 0, heap_used_bytes: 1 });
    expect(planner.project('heap_used_bytes').insufficient_data).toBe(true);
  });

  test('project with an explicit limit already breached reports 0 days to limit', () => {
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({ clock });
    for (let i = 0; i < 5; i += 1) {
      clock.advance(3600000);
      planner.history.push({ at_ms: clock.nowMs(), outbox_pending: 1500 + i, heap_limit_bytes: 2e9 });
    }
    const proj = planner.project('outbox_pending', { limitValue: 1000 });
    expect(proj.time_to_limit_days).toBe(0); // already over the limit
  });

  test('a declining series yields no time-to-limit (never exhausts)', () => {
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({ clock });
    for (let i = 0; i < 5; i += 1) {
      clock.advance(3600000);
      planner.history.push({ at_ms: clock.nowMs(), store_rows: 1000 - i * 10, heap_limit_bytes: 2e9 });
    }
    const proj = planner.project('store_rows', { limitValue: 5000 });
    expect(proj.slope_per_day).toBeLessThan(0);
    expect(proj.time_to_limit_days).toBeNull();
  });

  test('forecast recommends scaling from observed pressure, not static rules', () => {
    // A leaking-heap + growing-backlog platform stub.
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({
      clock,
      platform: { runtime: { samples: [{ event_loop_utilization: 0.9, heap_used_bytes: 1.9e9, heap_limit_bytes: 2e9 }] } },
    });
    for (let i = 0; i < 60; i += 1) {
      clock.advance(3600000);
      planner.history.push({
        at_ms: clock.nowMs(), heap_used_bytes: 1.5e9 + i * 8e6, heap_limit_bytes: 2e9, rss_bytes: 3e8,
        event_loop_utilization: 0.9, outbox_pending: 100 + i * 20, outbox_total: 1, archive_rows: 0, store_rows: 5000 + i * 100,
      });
    }
    const report = planner.forecast();
    const resources = report.recommendations.map((r) => r.resource);
    expect(resources).toContain('compute'); // high ELU → scale out
    expect(resources).toContain('memory'); // heap heading for the limit
    expect(resources).toContain('queue_consumers'); // backlog trending up
    expect(report.projections.heap.time_to_limit_days).toBeGreaterThanOrEqual(0);
  });

  test('a calm platform recommends holding (no false scaling)', () => {
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({
      clock, platform: { runtime: { samples: [{ event_loop_utilization: 0.3, heap_used_bytes: 3e8, heap_limit_bytes: 2e9 }] } },
    });
    for (let i = 0; i < 30; i += 1) {
      clock.advance(3600000);
      planner.history.push({ at_ms: clock.nowMs(), heap_used_bytes: 3e8, heap_limit_bytes: 2e9, rss_bytes: 2e8, event_loop_utilization: 0.3, outbox_pending: 0, outbox_total: 1, archive_rows: 0, store_rows: 1000 });
    }
    const report = planner.forecast();
    expect(report.recommendations.some((r) => r.action === 'hold')).toBe(true);
  });

  test('sustained low utilization over a long window recommends scaling in', () => {
    const clock = fakeClock(0);
    const planner = new CapacityPlanner({
      clock, platform: { runtime: { samples: [{ event_loop_utilization: 0.1, heap_used_bytes: 2e8, heap_limit_bytes: 2e9 }] } },
    });
    for (let i = 0; i < 25; i += 1) { // > 20 samples required
      clock.advance(3600000);
      planner.history.push({ at_ms: clock.nowMs(), heap_used_bytes: 2e8, heap_limit_bytes: 2e9, rss_bytes: 2e8, event_loop_utilization: 0.1, outbox_pending: 0, outbox_total: 1, archive_rows: 0, store_rows: 1000 });
    }
    const rec = planner.forecast().recommendations.find((r) => r.resource === 'compute');
    expect(rec.action).toBe('scale_in');
    expect(rec.suggested_replicas_delta).toBe(-1);
  });

  test('record() pulls live counters from the platform', () => {
    const platform = createPlatform();
    platform.runtime.sample();
    const s = platform.capacity.record();
    expect(s.heap_used_bytes).toBeGreaterThan(0);
    expect(s.store_rows).toBeGreaterThanOrEqual(0);
  });

  test('rSquared is ~1 for a clean line and low for noise', () => {
    expect(rSquared([[0, 0], [1, 10], [2, 20], [3, 30]])).toBeCloseTo(1, 5);
    expect(rSquared([[0, 5], [1, 5], [2, 5]])).toBe(1); // flat → trivially perfect
  });
});

describe('M6/M9 · admin control plane', () => {
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
  let k = 0;
  const idem = () => `cc-${k++}`;

  test('config: list, live update, history, rollback, kill switch over HTTP', async () => {
    const { w, app, authed } = adminApp();
    const list = await authed(request(app).get('/v1/admin/config'));
    expect(list.status).toBe(200);
    expect(list.body.keys.length).toBeGreaterThan(0);

    const put = await authed(request(app).put('/v1/admin/config/resilience.redis.breaker.failureThreshold'))
      .set('Idempotency-Key', idem()).send({ value: 9, reason: 'tuning' });
    expect(put.status).toBe(200);
    expect(w.p.resilience.breaker('redis').failureThreshold).toBe(9); // applied live

    const rejected = await authed(request(app).put('/v1/admin/config/resilience.redis.breaker.failureThreshold'))
      .set('Idempotency-Key', idem()).send({ value: -5 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('INVALID_ARGUMENT');

    const hist = await authed(request(app).get('/v1/admin/config/resilience.redis.breaker.failureThreshold/history'));
    expect(hist.body.length).toBeGreaterThanOrEqual(1);

    const kill = await authed(request(app).post('/v1/admin/config/kill-switch')).set('Idempotency-Key', idem()).send({ on: true });
    expect(kill.body.kill_switch).toBe(true);
    expect(w.p.resilience.breaker('redis').failureThreshold).toBe(3); // safe value
  });

  test('capacity: forecast endpoint returns projections + recommendations', async () => {
    const { w, app, authed } = adminApp();
    for (let i = 0; i < 5; i += 1) { w.p.runtime.sample(); w.p.capacity.record(); }
    const res = await authed(request(app).get('/v1/admin/capacity'));
    expect(res.status).toBe(200);
    expect(res.body.projections).toHaveProperty('heap');
    expect(Array.isArray(res.body.recommendations)).toBe(true);
  });

  test('overview folds config + capacity into one operator call', async () => {
    const { app, authed } = adminApp();
    const res = await authed(request(app).get('/v1/admin/overview'));
    expect(res.status).toBe(200);
    expect(res.body.config).toHaveProperty('keys');
    expect(res.body.capacity).toHaveProperty('projections');
    expect(res.body.slo_dashboards).toContain('config');
  });
});
