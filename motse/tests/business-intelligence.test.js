'use strict';

/**
 * Phase 1 (business observability) + Phase 2 (operational intelligence).
 * Business observability correlates the domain events modules already emit
 * with business capabilities (value, customers, SLA); operational intelligence
 * turns the runtime/capacity/resilience/dependency/business telemetry into
 * evidence-based, trend-driven recommendations — never static thresholds alone.
 */
const request = require('supertest');
const { BusinessObservability } = require('../src/observability/business.observability');
const { OperationalIntelligence } = require('../src/observability/operational.intelligence');
const { EventBus } = require('../src/kernel/eventBus');
const { Clock } = require('../src/kernel/clock');
const { Metrics } = require('../src/monitoring/metrics');
const { ChaosKv } = require('../src/distributed/chaos.kv');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world, liveCampaign } = require('./helpers');

function busWithSchemas() {
  const bus = new EventBus(new Clock());
  for (const t of ['payments.intent.completed', 'payments.intent.failed', 'card.captured',
    'ledger.payout.settled', 'ledger.payout.failed', 'kgetsi.contribution.received',
    'workflow.completed', 'notification.dispatched', 'heritage.item.published']) {
    bus.register(t, 1, []); // no required fields — the test controls payloads
  }
  return bus;
}

describe('P1 · BusinessObservability', () => {
  test('correlates events into capabilities with value, customers and SLA', () => {
    const bus = busWithSchemas();
    const metrics = new Metrics();
    const biz = new BusinessObservability({ bus, metrics, clock: new Clock() });
    bus.publish('card.captured', { intent_id: 'i1', amount_minor: 5000, user_ref: 'u1' });
    bus.publish('card.captured', { intent_id: 'i2', amount_minor: 3000, user_ref: 'u2' });
    bus.publish('payments.intent.failed', { intent_id: 'i3', provider: 'orange', user_ref: 'u3' });
    const snap = biz.snapshot();
    expect(snap.payments).toMatchObject({ completed: 2, failed: 1, value_minor: 8000, customers: 3 });
    expect(snap.payments.sla).toBeCloseTo(2 / 3, 3);
    expect(snap.payments.sla_met).toBe(false); // below the 0.98 target
    // Metrics reached the shared registry.
    expect(metrics.counterValue('motse_business_events_total', { capability: 'payments', outcome: 'success' })).toBe(2);
    expect(metrics.render()).toContain('motse_business_value_minor');
  });

  test('impactOf answers the customer-impact questions for a degraded capability', () => {
    const bus = busWithSchemas();
    const biz = new BusinessObservability({ bus, clock: new Clock() });
    bus.publish('payments.intent.failed', { intent_id: 'x', user_ref: 'cust-1' });
    bus.publish('payments.intent.failed', { intent_id: 'y', user_ref: 'cust-2' });
    const impact = biz.impactOf('payments');
    expect(impact).toMatchObject({ product: 'Wallet & Payments', customers_affected: 2, failures: 2, sla_breached: true });
    expect(impact.recent_failures.length).toBe(2);
    expect(biz.impactOf('nonexistent')).toBeNull();
  });

  test('executive and operations views summarise SLA + degradation', () => {
    const bus = busWithSchemas();
    const biz = new BusinessObservability({ bus, clock: new Clock() });
    bus.publish('card.captured', { amount_minor: 10000, user_ref: 'u1' });
    bus.publish('ledger.payout.failed', { payout_id: 'p1', user_ref: 'u2' });
    const exec = biz.executiveView();
    expect(exec.total_value_minor).toBe(10000);
    expect(exec.total_business_events).toBe(2);
    expect(exec.sla_breaches.map((b) => b.product)).toContain('Disbursements');
    const ops = biz.operationsView();
    expect(ops.degraded).toContain('payouts');
    expect(ops.services.find((s) => s.capability === 'payments').status).toBe('healthy');
  });

  test('a capability with no activity is idle and never a false SLA breach', () => {
    const biz = new BusinessObservability({ bus: busWithSchemas(), clock: new Clock() });
    const snap = biz.snapshot();
    expect(snap.heritage).toMatchObject({ total: 0, sla: 1, sla_met: true });
    expect(biz.operationsView().services.find((s) => s.capability === 'heritage').status).toBe('idle');
  });

  test('only subscribes to schemas the platform actually registered (no crash on absent types)', () => {
    const bus = new EventBus(new Clock());
    bus.register('card.captured', 1, ['amount_minor']); // only one type registered
    expect(() => new BusinessObservability({ bus, clock: new Clock() })).not.toThrow();
    bus.publish('card.captured', { amount_minor: 100 });
    // Constructs with no bus at all (metrics-only usage).
    expect(new BusinessObservability({}).snapshot().payments.total).toBe(0);
  });

  test('constructs with no arguments and caps the recent-failure buffer', () => {
    const biz = new BusinessObservability(); // no args (default opts)
    expect(biz.snapshot().payments.total).toBe(0);
    // Drive >50 failures on a bus-backed instance to exercise the buffer cap.
    const bus = busWithSchemas();
    const b2 = new BusinessObservability({ bus, clock: new Clock() });
    for (let i = 0; i < 60; i += 1) bus.publish('payments.intent.failed', { intent_id: `f${i}` });
    expect(b2.impactOf('payments').failures).toBe(60);
    expect(b2.impactOf('payments').recent_failures.length).toBeLessThanOrEqual(5);
  });

  test('integrates with the real platform: campaign contributions become business value', () => {
    const w = world();
    const camp = liveCampaign(w);
    w.p.kgetsi.contribute(camp.id, { sourceAccountId: w.kaboWallet.id, amountMinor: 4000, contributorRef: w.kabo.id, idempotencyKey: 'bz1' });
    const snap = w.p.business.snapshot();
    expect(snap.fundraising.completed).toBeGreaterThanOrEqual(1);
    expect(snap.fundraising.value_minor).toBeGreaterThanOrEqual(4000);
  });
});

describe('P2 · OperationalIntelligence — evidence-based recommendations', () => {
  test('a healthy platform yields no recommendations (no false positives)', () => {
    const platform = createPlatform();
    for (let i = 0; i < 3; i += 1) platform.opsIntel.record();
    const advice = platform.opsIntel.advise();
    expect(advice.recommendations).toEqual([]);
    expect(advice.samples).toBeGreaterThanOrEqual(3);
  });

  test('a failed dependency yields a critical incident-response recommendation', async () => {
    const platform = createPlatform();
    const chaos = new ChaosKv(platform.kv).down();
    platform.kv = chaos;
    await platform.dependencies.checkAll();
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'dependency_failure');
    expect(rec).toBeTruthy();
    expect(rec.urgency).toBe('critical');
    expect(rec.action).toBe('trigger_incident_response');
    expect(rec.evidence.failed).toContain('redis');
    expect(rec.confidence).toBeGreaterThan(0);
    expect(rec).toHaveProperty('business_impact');
    expect(rec).toHaveProperty('rollback');
  });

  test('a rising outbox backlog is detected from the trend (not a static level)', () => {
    const platform = createPlatform();
    platform.bus.register('oi.evt', 1, ['n']);
    platform.bus.subscribe('oi.evt', 'x', () => { throw new Error('consumer down'); });
    platform.outbox.maxAttempts = 999;
    // Growing backlog across recorded cycles → positive slope.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      platform.outbox.run(({ stage }) => { for (let i = 0; i < 150; i += 1) stage('oi.evt', { n: i }); });
      platform.opsIntel.record();
    }
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'queue_growth');
    expect(rec).toBeTruthy();
    expect(rec.action).toBe('increase_queue_workers');
    expect(rec.evidence.pending_slope_per_sample).toBeGreaterThan(0);
  });

  test('an open circuit breaker suggests considering safe mode', async () => {
    const platform = createPlatform();
    const cb = platform.resilience.breaker('redis');
    cb.failureThreshold = 1; // the redis breaker already exists (wired via config appliers)
    await cb.exec(async () => { throw new Error('down'); }).catch(() => {});
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'circuit_open');
    expect(rec).toBeTruthy();
    expect(rec.resource).toBe('safe_mode');
    expect(rec.evidence.open_breakers).toContain('redis');
  });

  test('recommendations are sorted by urgency then confidence', async () => {
    const platform = createPlatform();
    const chaos = new ChaosKv(platform.kv).down();
    platform.kv = chaos;
    await platform.dependencies.checkAll();
    const cb = platform.resilience.breaker('redis');
    cb.failureThreshold = 1;
    await cb.exec(async () => { throw new Error('x'); }).catch(() => {});
    platform.opsIntel.record();
    const recs = platform.opsIntel.advise().recommendations;
    const urgencyRank = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
    for (let i = 1; i < recs.length; i += 1) {
      expect(urgencyRank[recs[i - 1].urgency]).toBeGreaterThanOrEqual(urgencyRank[recs[i].urgency]);
    }
    expect(recs[0].urgency).toBe('critical'); // dependency failure sorts first
  });

  test('memory pressure from runtime insights becomes a memory recommendation', () => {
    const platform = createPlatform();
    // Inject a leaking-heap window into the runtime buffer.
    const limit = 1_000_000_000;
    for (let i = 0; i < 8; i += 1) {
      const used = 800_000_000 + i * 3_000_000;
      platform.runtime.samples.push({
        at_ms: i * 60000, heap_used_bytes: used, heap_limit_bytes: limit, heap_utilization: used / limit,
        event_loop_delay_p99_ms: 2, event_loop_utilization: 0.2, active_handles: 10,
      });
    }
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'memory_pressure');
    expect(rec).toBeTruthy();
    expect(rec.resource).toBe('memory');
    expect(rec.evidence.detail).toMatch(/min to limit/);
  });

  test('event-loop saturation yields a scale-out recommendation', () => {
    const platform = createPlatform();
    for (let i = 0; i < 5; i += 1) {
      platform.runtime.samples.push({
        at_ms: i * 5000, heap_used_bytes: 1e8, heap_limit_bytes: 1e9, heap_utilization: 0.1,
        event_loop_delay_p99_ms: 600, event_loop_utilization: 0.97, active_handles: 10,
      });
    }
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.resource === 'compute');
    expect(rec).toBeTruthy();
    expect(rec.action).toBe('scale_out_application_instances');
  });

  test('lock contention yields a reduce-concurrency recommendation', async () => {
    const platform = createPlatform();
    // Drive concurrent lock attempts on one hot key → contended increments.
    await Promise.all(Array.from({ length: 10 }, () =>
      platform.distributed.lock.withLock('hot', () => new Promise((r) => { setImmediate(r); })).catch(() => {})
    ));
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'lock_contention');
    expect(rec).toBeTruthy();
    expect(rec.action).toBe('reduce_concurrency_on_hot_resource');
    expect(rec.evidence.contention_ratio).toBeGreaterThan(0.2);
  });

  test('a degraded (not failed) dependency yields an investigate recommendation', async () => {
    const platform = createPlatform();
    platform.dependencies.register('flaky', { probe: async () => ({ degraded: true, reason: 'slow' }), critical: false });
    await platform.dependencies.checkAll();
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'dependency_degraded');
    expect(rec).toBeTruthy();
    expect(rec.action).toBe('investigate_service_degradation');
  });

  test('cross-cutting signals report the worst current business impact', async () => {
    const platform = createPlatform();
    // Make a business capability breach SLA (failing payouts)...
    platform.bus.publish('ledger.payout.failed', { payout_id: 'a', reason: 'timeout', user_ref: 'c1' });
    // ...and trigger a cross-cutting memory-pressure signal.
    const limit = 1e9;
    for (let i = 0; i < 8; i += 1) {
      const used = 800e6 + i * 3e6;
      platform.runtime.samples.push({ at_ms: i * 60000, heap_used_bytes: used, heap_limit_bytes: limit, heap_utilization: used / limit, event_loop_delay_p99_ms: 2, event_loop_utilization: 0.2, active_handles: 10 });
    }
    platform.opsIntel.record();
    const mem = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'memory_pressure');
    expect(mem.business_impact).toMatch(/Disbursements|customers affected/);
  });

  test('record() tolerates a minimal platform (no outbox/runtime/metrics)', () => {
    const oi = new OperationalIntelligence({ platform: {}, clock: new Clock() });
    const s = oi.record();
    expect(s.outbox_pending).toBe(0);
    expect(s.event_loop_utilization).toBe(0);
    expect(oi.advise().recommendations).toEqual([]); // nothing to advise on
  });

  test('a cross-cutting signal without business observability reports impact as unknown', () => {
    // A stub platform with a leaking runtime but NO business module wired.
    const runtime = {
      samples: [{}],
      insights: () => [{ kind: 'memory_leak_suspected', severity: 'warning', detail: '+5MB/min, ~60min to limit', heap_utilization: 0.8 }],
    };
    const oi = new OperationalIntelligence({ platform: { runtime }, clock: new Clock() });
    oi.record();
    const rec = oi.advise().recommendations.find((r) => r.signal === 'memory_pressure');
    expect(rec).toBeTruthy();
    expect(rec.business_impact).toMatch(/unknown/); // business observability not wired
  });

  test('business SLA breach surfaces a customer-impact recommendation', () => {
    const platform = createPlatform();
    // Two failed payouts → payouts capability below its 0.99 SLA.
    platform.bus.publish('ledger.payout.failed', { payout_id: 'a', reason: 'provider_timeout', user_ref: 'c1' });
    platform.bus.publish('ledger.payout.failed', { payout_id: 'b', reason: 'provider_timeout', user_ref: 'c2' });
    platform.opsIntel.record();
    const rec = platform.opsIntel.advise().recommendations.find((r) => r.signal === 'business_sla_breach');
    expect(rec).toBeTruthy();
    expect(rec.business_impact).toMatch(/customers affected/);
  });
});

describe('P1/P2 · admin control plane', () => {
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

  test('business + intelligence endpoints answer over the admin API', async () => {
    const { w, app, authed } = adminApp();
    const camp = liveCampaign(w);
    w.p.kgetsi.contribute(camp.id, { sourceAccountId: w.kaboWallet.id, amountMinor: 2500, contributorRef: w.kabo.id, idempotencyKey: 'ba1' });

    const exec = await authed(request(app).get('/v1/admin/business/executive'));
    expect(exec.status).toBe(200);
    expect(exec.body.total_value_minor).toBeGreaterThanOrEqual(2500);

    const impact = await authed(request(app).get('/v1/admin/business/fundraising/impact'));
    expect(impact.status).toBe(200);
    expect(impact.body.product).toBe('Kgetsi Campaigns');

    const unknown = await authed(request(app).get('/v1/admin/business/ghost/impact'));
    expect(unknown.status).toBe(404);

    const intel = await authed(request(app).get('/v1/admin/intelligence'));
    expect(intel.status).toBe(200);
    expect(Array.isArray(intel.body.recommendations)).toBe(true);
  });

  test('overview folds in business + intelligence for one operator view', async () => {
    const { app, authed } = adminApp();
    const res = await authed(request(app).get('/v1/admin/overview'));
    expect(res.status).toBe(200);
    expect(res.body.business).toHaveProperty('by_capability');
    expect(res.body).toHaveProperty('intelligence');
    expect(res.body.slo_dashboards).toContain('business');
  });
});
