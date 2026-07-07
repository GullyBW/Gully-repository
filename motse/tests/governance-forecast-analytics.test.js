'use strict';

/**
 * Analytics Phase 1 (governance analytics) + Phase 2 (forecast accuracy).
 * Governance analytics turns the governance change records into KPIs,
 * compliance/maturity scores and evidence-backed process recommendations;
 * forecast accuracy backtests the capacity planner's own history to measure
 * whether its predictions hold up — the honest, evidence-based way to validate
 * a forecaster without waiting months.
 */
const request = require('supertest');
const { GovernanceAnalytics } = require('../src/observability/governance.analytics');
const { ForecastAccuracy } = require('../src/observability/forecast.accuracy');
const { ConfigService } = require('../src/config/config.service');
const { ConfigGovernance } = require('../src/config/config.governance');
const { CapacityPlanner } = require('../src/observability/capacity.planner');
const { Metrics } = require('../src/monitoring/metrics');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

function fakeClock(start = 0) {
  let t = start;
  return { nowMs: () => t, nowIso: () => new Date(t).toISOString(), advance: (ms) => { t += ms; } };
}

// A governance service pre-loaded with a representative change mix.
function seededGovernance(clock, metrics) {
  const config = new ConfigService({ clock, metrics });
  config.register('crit', { type: 'number', defaultValue: 1 });
  config.register('med', { type: 'number', defaultValue: 1 });
  const g = new ConfigGovernance({ config, clock, metrics });
  g.classify('crit', { risk: 'critical', affects: ['redis', 'locks'] });
  g.classify('med', { risk: 'medium', affects: ['outbox'] });
  return { config, g };
}

describe('A1 · GovernanceAnalytics', () => {
  test('summarises changes by risk/status with approval, rollback and success KPIs', () => {
    const clock = fakeClock(1_000_000);
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    // A critical change: proposed, approved by two distinct admins over 1h.
    const c1 = g.request('crit', 5, { actor: 'alice', justification: 'peak' });
    clock.advance(3600000);
    g.approve(c1.id, 'bob'); g.approve(c1.id, 'carol');
    // A medium auto-applied change, then rolled back.
    const c2 = g.request('med', 9, { actor: 'alice', justification: 'tune' });
    g.rollbackChange(c2.id, 'ops');
    // A rejected critical change.
    const c3 = g.request('crit', 99, { actor: 'alice', justification: 'risky' });
    g.reject(c3.id, 'bob', { reason: 'too aggressive' });

    const analytics = new GovernanceAnalytics({ governance: g, metrics, clock });
    const r = analytics.report();
    expect(r.total_changes).toBe(3);
    expect(r.by_risk).toMatchObject({ critical: 2, medium: 1 });
    expect(r.by_status).toMatchObject({ applied: 1, rolled_back: 1, rejected: 1 });
    expect(r.approval.avg_turnaround_ms).toBe(3600000); // the approved change took 1h
    expect(r.rollback).toMatchObject({ count: 1 });
    expect(r.rejection.count).toBe(1);
    expect(r.rejection.reasons[0].reason).toBe('too aggressive');
    expect(r.change_success_rate).toBeCloseTo(1 / 3, 3); // 1 applied of 3 resolved
    expect(r.churn.most_modified.find((k) => k.name === 'crit').count).toBe(2);
    expect(r.service_impact.find((s) => s.name === 'redis')).toBeTruthy();
    expect(r.compliance_score).toBeGreaterThan(0);
    expect(r.operational_maturity_score).toBeGreaterThan(0);
  });

  test('compliance rewards separation of duties + justification', () => {
    const clock = fakeClock();
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    const c1 = g.request('crit', 5, { actor: 'alice', justification: 'j' });
    g.approve(c1.id, 'bob'); g.approve(c1.id, 'carol');
    const r = new GovernanceAnalytics({ governance: g, metrics, clock }).report();
    expect(r.compliance_detail.separation_of_duties).toBe(1); // distinct approvers, not the proposer
    expect(r.compliance_detail.justification).toBe(1);
    expect(metrics.render()).toContain('motse_governance_compliance_score');
  });

  test('counts emergency activations from the shared metrics registry', () => {
    const clock = fakeClock();
    const metrics = new Metrics();
    const { config, g } = seededGovernance(clock, metrics);
    config.killSwitch(true, { actor: 'ops' });
    config.killSwitch(false, { actor: 'ops' });
    config.killSwitch(true, { actor: 'ops' });
    config.safeMode(true, { actor: 'ops' });
    const r = new GovernanceAnalytics({ governance: g, metrics, clock }).report();
    expect(r.emergency.kill_switch_activations).toBe(2); // two "on" activations
    expect(r.emergency.safe_mode_activations).toBe(1);
  });

  test('recommends action for excessive rollbacks with supporting evidence', () => {
    const clock = fakeClock();
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    // Three applied-then-rolled-back medium changes → rollback rate 1.0.
    for (let i = 0; i < 3; i += 1) {
      const c = g.request('med', 10 + i, { actor: 'alice', justification: 'x' });
      g.rollbackChange(c.id, 'ops');
    }
    const rec = new GovernanceAnalytics({ governance: g, metrics, clock })
      .recommend().recommendations.find((x) => x.signal === 'excessive_rollbacks');
    expect(rec).toBeTruthy();
    expect(rec.urgency).toBe('high');
    expect(rec.evidence.rollback_rate).toBeGreaterThan(0.2);
    expect(rec).toHaveProperty('remediation');
    expect(rec).toHaveProperty('business_impact');
    expect(rec).toHaveProperty('confidence');
  });

  test('flags approval delays for changes pending beyond the SLA', () => {
    const clock = fakeClock(0);
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    g.request('crit', 5, { actor: 'alice', justification: 'j' }); // stays pending (needs 2 approvals)
    clock.advance(48 * 3600 * 1000); // 48h later — past a 24h SLA
    const rec = new GovernanceAnalytics({ governance: g, metrics, clock })
      .recommend({ pendingSlaMs: 24 * 3600 * 1000 }).recommendations.find((x) => x.signal === 'approval_delay');
    expect(rec).toBeTruthy();
    expect(rec.evidence.pending_over_sla).toBe(1);
  });

  test('flags a frequently-modified setting (recurring risky change)', () => {
    const clock = fakeClock();
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    for (let i = 0; i < 5; i += 1) g.request('med', 10 + i, { actor: 'alice', justification: 'tune' }); // 5 changes to one key
    const rec = new GovernanceAnalytics({ governance: g, metrics, clock })
      .recommend({ churnThreshold: 5 }).recommendations.find((x) => x.signal === 'recurring_risky_change');
    expect(rec).toBeTruthy();
    expect(rec.evidence.key).toBe('med');
    expect(rec.evidence.changes).toBeGreaterThanOrEqual(5);
  });

  test('flags a governance bottleneck when approval p95 exceeds the SLA', () => {
    const clock = fakeClock(0);
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    const c = g.request('crit', 5, { actor: 'alice', justification: 'j' });
    clock.advance(25 * 3600 * 1000); // approved 25h later — past a 24h SLA
    g.approve(c.id, 'bob'); g.approve(c.id, 'carol');
    const rec = new GovernanceAnalytics({ governance: g, metrics, clock })
      .recommend({ pendingSlaMs: 24 * 3600 * 1000 }).recommendations.find((x) => x.signal === 'governance_bottleneck');
    expect(rec).toBeTruthy();
    expect(rec.evidence.p95_turnaround_ms).toBeGreaterThan(24 * 3600 * 1000);
  });

  test('a healthy governance process yields a "healthy" recommendation', () => {
    const clock = fakeClock();
    const metrics = new Metrics();
    const { g } = seededGovernance(clock, metrics);
    const c = g.request('med', 5, { actor: 'alice', justification: 'j' }); // applied cleanly
    void c;
    const recs = new GovernanceAnalytics({ governance: g, metrics, clock }).recommend().recommendations;
    expect(recs.some((x) => x.signal === 'healthy')).toBe(true);
  });

  test('integrates with the real platform governance records', () => {
    const platform = createPlatform();
    const mk = (dev, msisdn) => {
      const otp = platform.identity.requestOtp(msisdn);
      const { user } = platform.identity.verifyOtp(msisdn, otp.sandbox_code, { deviceId: dev });
      platform.identity.grantInstitutional(user.id, { institution: 'Ops' }, 'system:bootstrap');
      platform.identity.grantRole(user.id, 'platform_admin', 'platform', 'system:bootstrap');
      return user.id;
    };
    const a = mk('a', '+26775100001'); const b = mk('b', '+26775100002'); const cId = mk('c', '+26775100003');
    const before = platform.resilience.breaker('redis').failureThreshold;
    const c = platform.configGovernance.request('resilience.redis.breaker.failureThreshold', before + 1, { actor: a, justification: 'j' });
    platform.configGovernance.approve(c.id, b); platform.configGovernance.approve(c.id, cId);
    const r = platform.governanceAnalytics.report();
    expect(r.total_changes).toBeGreaterThanOrEqual(1);
    expect(r.service_impact.some((s) => s.name === 'redis')).toBe(true);
  });
});

describe('A2 · ForecastAccuracy — backtesting', () => {
  function plannerWith(series, field = 'heap_used_bytes') {
    const planner = new CapacityPlanner({ clock: fakeClock() });
    series.forEach((v, i) => planner.history.push({
      at_ms: i * 3600000, heap_used_bytes: field === 'heap_used_bytes' ? v : 1e8,
      heap_limit_bytes: 2e9, rss_bytes: field === 'rss_bytes' ? v : 2e8,
      event_loop_utilization: 0.2, outbox_pending: field === 'outbox_pending' ? v : 0,
      outbox_total: 1, archive_rows: 0, store_rows: field === 'store_rows' ? v : 1000,
    }));
    return planner;
  }

  test('a clean linear trend backtests as highly accurate', () => {
    // A perfectly linear series → the hold-out prediction should match closely.
    const series = Array.from({ length: 20 }, (_, i) => 1e9 + i * 5e6);
    const fa = new ForecastAccuracy({ planner: plannerWith(series), clock: fakeClock() });
    const bt = fa.backtest('heap_used_bytes', { splitRatio: 0.6 });
    expect(bt.accuracy).toBeGreaterThan(0.95);
    expect(bt.accuracy_pct).toBeGreaterThan(95);
    expect(bt.trend_direction_correct).toBe(true);
    expect(bt.trustworthy).toBe(true);
  });

  test('a noisy / trend-reversing series backtests as less accurate', () => {
    // Rises then falls — a linear fit on the first half over-predicts the second.
    const series = [100, 200, 300, 400, 500, 600, 700, 800, 700, 500, 300, 100, 50, 30, 20];
    const fa = new ForecastAccuracy({ planner: plannerWith(series, 'outbox_pending'), clock: fakeClock() });
    const bt = fa.backtest('outbox_pending', { splitRatio: 0.5 });
    expect(bt.accuracy).toBeLessThan(0.95); // the model was wrong about the reversal
    expect(bt.trend_direction_correct).toBe(false);
  });

  test('insufficient history yields an explicit insufficient-data result', () => {
    const fa = new ForecastAccuracy({ planner: plannerWith([1, 2, 3]), clock: fakeClock(), minSamples: 10 });
    expect(fa.backtest('heap_used_bytes').insufficient_data).toBe(true);
    expect(fa.stability('heap_used_bytes').insufficient_data).toBe(true);
    // A whole report over too-short history → overall accuracy is null (honest).
    const rep = fa.report();
    expect(rep.overall_accuracy).toBeNull();
    expect(rep.recommendation_gate.trustworthy).toBe(false);
    expect(rep.calibration.rows).toEqual([]); // no projection confidence to compare
  });

  test('a very small split still fits a minimum training window', () => {
    const series = Array.from({ length: 12 }, (_, i) => 1000 + i * 10);
    const bt = new ForecastAccuracy({ planner: plannerWith(series), clock: fakeClock() })
      .backtest('heap_used_bytes', { splitRatio: 0.05 }); // floor(0.6) → clamped up to 2
    expect(bt.train_size).toBeGreaterThanOrEqual(2);
    expect(bt).toHaveProperty('accuracy');
  });

  test('a split that leaves fewer than two test points is insufficient', () => {
    const series = Array.from({ length: 12 }, (_, i) => 1000 + i * 10);
    const bt = new ForecastAccuracy({ planner: plannerWith(series), clock: fakeClock() })
      .backtest('heap_used_bytes', { splitRatio: 0.95 }); // almost all training → <2 test points
    expect(bt.insufficient_data).toBe(true);
  });

  test('a rise-then-fall series has near-zero mean slope but low stability', () => {
    // First window rises, second falls → window slopes are +k and −k: mean ≈ 0,
    // variance ≠ 0, which drives the relative-variance stability path.
    const riseFall = [...Array.from({ length: 9 }, (_, i) => 1000 + i * 100),
      ...Array.from({ length: 9 }, (_, i) => 1800 - i * 100)];
    const st = new ForecastAccuracy({ planner: plannerWith(riseFall), clock: fakeClock() })
      .stability('heap_used_bytes', { windows: 2 });
    expect(st.stability_score).toBeLessThan(0.5); // opposing slopes → unstable
  });

  test('num coerces a non-numeric history field to zero (defensive)', () => {
    const planner = new CapacityPlanner({ clock: fakeClock() });
    for (let i = 0; i < 12; i += 1) {
      planner.history.push({ at_ms: i * 3600000, heap_used_bytes: undefined, heap_limit_bytes: 2e9, rss_bytes: 2e8, event_loop_utilization: 0.2, outbox_pending: 0, outbox_total: 1, archive_rows: 0, store_rows: 1000 });
    }
    const bt = new ForecastAccuracy({ planner, clock: fakeClock() }).backtest('heap_used_bytes');
    expect(bt.accuracy).toBe(1); // all-zero series → a trivially perfect fit
  });

  test('stability measures slope variance and drift across sub-windows', () => {
    const steady = Array.from({ length: 18 }, (_, i) => 1000 + i * 10); // constant slope
    const st = new ForecastAccuracy({ planner: plannerWith(steady), clock: fakeClock() }).stability('heap_used_bytes');
    expect(st.stability_score).toBeGreaterThan(0.8); // steady slope → stable
    expect(Math.abs(st.drift)).toBeLessThan(5);
  });

  test('report aggregates accuracy across fields and gates recommendations on it', () => {
    const series = Array.from({ length: 20 }, (_, i) => 1e9 + i * 4e6);
    const planner = plannerWith(series);
    const fa = new ForecastAccuracy({ planner, clock: fakeClock(), accuracyThreshold: 0.8 });
    const rep = fa.report();
    expect(rep.overall_accuracy).toBeGreaterThan(0);
    expect(rep.overall_accuracy_pct).toBeGreaterThan(0);
    expect(rep.recommendation_gate).toHaveProperty('trustworthy');
    expect(rep.fields.heap_used_bytes).toHaveProperty('accuracy');
    expect(rep.calibration).toHaveProperty('well_calibrated');
  });

  test('report tolerates a planner whose forecast omits projections', () => {
    const planner = new CapacityPlanner({ clock: fakeClock() });
    for (let i = 0; i < 12; i += 1) {
      planner.history.push({ at_ms: i * 3600000, heap_used_bytes: 1e9 + i * 4e6, heap_limit_bytes: 2e9, rss_bytes: 2e8, event_loop_utilization: 0.2, outbox_pending: 0, outbox_total: 1, archive_rows: 0, store_rows: 1000 });
    }
    planner.forecast = () => ({}); // no projections → no stated confidence to calibrate against
    const rep = new ForecastAccuracy({ planner, clock: fakeClock() }).report();
    expect(rep.calibration.rows).toEqual([]);
    expect(rep.overall_accuracy).not.toBeNull(); // accuracy still measured from history
  });

  test('the metric registry receives the measured accuracy gauge', () => {
    const series = Array.from({ length: 20 }, (_, i) => 1e9 + i * 4e6);
    const metrics = new Metrics();
    new ForecastAccuracy({ planner: plannerWith(series), metrics, clock: fakeClock() }).report();
    expect(metrics.render()).toContain('motse_forecast_accuracy');
  });

  test('constructs with defaults and handles a drifting (accelerating) series', () => {
    // Accelerating growth → the slope changes across sub-windows (drift ≠ 0).
    const accel = Array.from({ length: 18 }, (_, i) => 1000 + i * i * 5);
    const fa = new ForecastAccuracy({ planner: plannerWith(accel) }); // default clock/metrics/thresholds
    const st = fa.stability('heap_used_bytes');
    expect(Math.abs(st.drift)).toBeGreaterThan(0); // slope is not constant
    expect(st.stability_score).toBeLessThan(1);
    // A perfectly flat series has zero variance → maximal stability.
    const flat = new ForecastAccuracy({ planner: plannerWith(Array(18).fill(500)) }).stability('heap_used_bytes');
    expect(flat.stability_score).toBe(1);
  });

  test('calibration compares the planner confidence against measured accuracy', () => {
    const series = Array.from({ length: 20 }, (_, i) => 1e9 + i * 4e6);
    const rep = new ForecastAccuracy({ planner: plannerWith(series), clock: fakeClock() }).report();
    // The real CapacityPlanner supplies a confidence per projection → rows populate.
    expect(Array.isArray(rep.calibration.rows)).toBe(true);
    expect(rep.calibration.rows.length).toBeGreaterThan(0);
    expect(rep.calibration.rows[0]).toHaveProperty('stated_confidence');
    expect(rep.calibration.rows[0]).toHaveProperty('measured_accuracy');
  });

  test('integrates with the real capacity planner history', () => {
    const platform = createPlatform();
    for (let i = 0; i < 15; i += 1) { platform.runtime.sample(); platform.capacity.record(); }
    const rep = platform.forecastAccuracy.report();
    expect(rep.fields).toHaveProperty('store_rows');
    expect(rep).toHaveProperty('overall_accuracy_pct');
  });
});

describe('A1/A2 · admin control plane', () => {
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

  test('governance analytics + forecast accuracy answer over the admin API', async () => {
    const { app, authed } = adminApp();
    await authed(request(app).post('/v1/admin/config/governance/requests')).set('Idempotency-Key', 'gfa-1')
      .send({ key: 'events.outbox.maxAttempts', value: 6, justification: 'analytics drill' });
    for (let i = 0; i < 12; i += 1) { await authed(request(app).post('/v1/admin/intelligence/sample')).set('Idempotency-Key', `gfa-s${i}`); }

    const gov = await authed(request(app).get('/v1/admin/governance/analytics'));
    expect(gov.status).toBe(200);
    expect(gov.body).toHaveProperty('compliance_score');
    expect(gov.body).toHaveProperty('operational_maturity_score');

    const recs = await authed(request(app).get('/v1/admin/governance/analytics/recommendations'));
    expect(recs.status).toBe(200);
    expect(Array.isArray(recs.body.recommendations)).toBe(true);

    const fc = await authed(request(app).get('/v1/admin/forecast/accuracy'));
    expect(fc.status).toBe(200);
    expect(fc.body).toHaveProperty('overall_accuracy_pct');
  });

  test('overview folds in governance analytics + forecast accuracy', async () => {
    const { app, authed } = adminApp();
    const res = await authed(request(app).get('/v1/admin/overview'));
    expect(res.status).toBe(200);
    expect(res.body.governance_analytics).toHaveProperty('compliance_score');
    expect(res.body).toHaveProperty('forecast_accuracy');
    expect(res.body.slo_dashboards).toContain('governance');
  });
});
