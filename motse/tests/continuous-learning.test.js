'use strict';

/**
 * FINAL Phase 4 — Continuous Learning. Every measured outcome becomes future
 * knowledge: the service keeps a persisted time-series of the platform's own
 * confidence signals (observed from the executive briefing) and learns from it —
 * trends, a forecast-confidence multiplier calibrated to measured accuracy, and a
 * learned operational-maturity score gated by evidence volume and trend.
 */
const request = require('supertest');
const { ContinuousLearning } = require('../src/observability/continuous.learning');
const { Clock } = require('../src/kernel/clock');
const { Metrics } = require('../src/monitoring/metrics');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

// A fake platform whose executive briefing yields a controllable confidence series.
function fakePlatform({ conf = [], forecastRows = null, hasForecast = true, hasRec = true } = {}) {
  let i = 0;
  return {
    executive: {
      report: () => ({
        operational_confidence: conf.length ? conf[Math.min(i++, conf.length - 1)] : 0.9,
        domains: {
          business_validation: { data_confidence: 0.9 },
          forecast_accuracy: { overall_accuracy: 0.85 },
          recommendation_quality: { operator_trust_score: 0.75, precision: 0.8 },
          governance: { compliance_score: 0.9, operational_maturity_score: 0.85 },
          disaster_recovery: { recovery_confidence: 0.8 },
        },
      }),
    },
    forecastAccuracy: hasForecast ? { report: () => ({ calibration: { rows: forecastRows || [] } }) } : undefined,
    recommendationEffectiveness: hasRec ? { recalibration: () => ({ signals: [{ signal: 'memory_pressure', calibrated_confidence: 0.7, observed_hit_rate: 0.6 }] }) } : undefined,
  };
}
function observeN(cl, n) { for (let k = 0; k < n; k += 1) cl.observe(); }

describe('FINAL P4 · ContinuousLearning — knowledge base + trends', () => {
  test('accumulates a knowledge base and learns an improving trend', () => {
    const metrics = new Metrics();
    const cl = new ContinuousLearning({ platform: fakePlatform({ conf: [0.5, 0.6, 0.7, 0.8, 0.9] }), clock: new Clock(), metrics });
    observeN(cl, 5);
    const r = cl.learn();
    expect(r.samples).toBe(5);
    expect(r.trends.operational_confidence.direction).toBe('improving');
    expect(r.improving).toBe('improving');
    expect(r.learned_operational_maturity.samples).toBe(5);
    expect(r.learned_operational_maturity.score).toBeGreaterThan(0);
    expect(r.learning_confidence).toBeCloseTo(5 / 20, 4);
    expect(metrics.render()).toContain('motse_learning_operational_maturity');
    expect(metrics.render()).toContain('motse_learning_samples');
  });

  test('detects a regressing trend', () => {
    const cl = new ContinuousLearning({ platform: fakePlatform({ conf: [0.9, 0.8, 0.7, 0.6, 0.5] }), clock: new Clock() });
    observeN(cl, 5);
    const r = cl.learn();
    expect(r.trends.operational_confidence.direction).toBe('regressing');
    expect(r.learned_operational_maturity.trend).toBe('regressing');
  });

  test('reports insufficient data with fewer than three observations', () => {
    const cl = new ContinuousLearning({ platform: fakePlatform({ conf: [0.8, 0.8] }), clock: new Clock() });
    observeN(cl, 2);
    const r = cl.learn();
    expect(r.trends.operational_confidence.direction).toBe('insufficient_data');
    expect(r.trends.operational_confidence.latest).toBe(0.8);
    expect(r.learned_operational_maturity.trend).toBe('stable'); // <3 → slope 0
  });

  test('learn() before any observation is safe (null maturity, zero window)', () => {
    const cl = new ContinuousLearning({ platform: fakePlatform(), clock: new Clock() });
    const r = cl.learn();
    expect(r.samples).toBe(0);
    expect(r.window_ms).toBe(0);
    expect(r.learned_operational_maturity.score).toBeNull();
    expect(r.trends.operational_confidence.latest).toBeNull();
  });

  test('bounds the knowledge base to maxSnapshots (oldest dropped)', () => {
    const cl = new ContinuousLearning({ platform: fakePlatform({ conf: [0.5, 0.6, 0.7, 0.8, 0.9] }), clock: new Clock(), maxSnapshots: 3 });
    observeN(cl, 5);
    expect(cl.knowledge().length).toBe(3);
    // The retained window is the most recent observations.
    expect(cl.knowledge()[cl.knowledge().length - 1].operational_confidence).toBe(0.9);
  });
});

describe('FINAL P4 · ContinuousLearning — learned adjustments', () => {
  test('forecast confidence is discounted by measured accuracy (never inflated)', () => {
    // stated 0.9/0.8 (avg 0.85), measured 0.45/0.35 (avg 0.40) → multiplier ~0.47.
    const rows = [{ stated_confidence: 0.9, measured_accuracy: 0.45 }, { stated_confidence: 0.8, measured_accuracy: 0.35 }];
    const cl = new ContinuousLearning({ platform: fakePlatform({ forecastRows: rows }), clock: new Clock() });
    const m = cl._forecastMultiplier();
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
    expect(cl.learnedForecastConfidence(0.8)).toBeCloseTo(0.8 * m, 3);
    expect(cl.learnedForecastConfidence(null)).toBeNull(); // null prior stays null
  });

  test('an over-performing forecast is clamped to 1 (no inflation)', () => {
    const rows = [{ stated_confidence: 0.5, measured_accuracy: 0.95 }];
    const cl = new ContinuousLearning({ platform: fakePlatform({ forecastRows: rows }), clock: new Clock() });
    expect(cl._forecastMultiplier()).toBe(1);
    expect(cl.learnedForecastConfidence(0.9)).toBe(0.9); // unchanged
  });

  test('forecast multiplier is null with no calibration evidence', () => {
    expect(new ContinuousLearning({ platform: fakePlatform({ forecastRows: [] }), clock: new Clock() })._forecastMultiplier()).toBeNull();
    expect(new ContinuousLearning({ platform: fakePlatform({ hasForecast: false }), clock: new Clock() })._forecastMultiplier()).toBeNull();
    // stated sums to zero → null (avoids divide-by-zero).
    expect(new ContinuousLearning({ platform: fakePlatform({ forecastRows: [{ stated_confidence: 0, measured_accuracy: 0.5 }] }), clock: new Clock() })._forecastMultiplier()).toBeNull();
    // learnedForecastConfidence with a null multiplier returns the prior unchanged.
    expect(new ContinuousLearning({ platform: fakePlatform({ hasForecast: false }), clock: new Clock() }).learnedForecastConfidence(0.7)).toBe(0.7);
  });

  test('surfaces the recommendation-confidence model, or an empty model when absent', () => {
    const withRec = new ContinuousLearning({ platform: fakePlatform(), clock: new Clock() });
    observeN(withRec, 3);
    expect(withRec.learn().recommendation_confidence_model[0].signal).toBe('memory_pressure');
    const noRec = new ContinuousLearning({ platform: fakePlatform({ hasRec: false }), clock: new Clock() });
    observeN(noRec, 3);
    expect(noRec.learn().recommendation_confidence_model).toEqual([]);
  });

  test('an empty/absent platform is safe (all-null sample, no crash, no-arg construct)', () => {
    const cl = new ContinuousLearning({}); // no platform, store, clock or metrics
    const snap = cl.observe();
    expect(snap.operational_confidence).toBeNull();
    const r = cl.learn();
    expect(r.learned_operational_maturity.score).toBeNull();
    expect(r.learned_forecast_confidence.multiplier).toBeNull();
    expect(new ContinuousLearning().learn().samples).toBe(0); // no-arg construct
  });
});

describe('FINAL P4 · ContinuousLearning — real platform + admin API', () => {
  test('observing the real executive briefing builds a knowledge base and learns', () => {
    const w = world();
    for (let i = 0; i < 12; i += 1) { w.p.runtime.sample(); w.p.capacity.record(); }
    const g = w.p.recommendationEffectiveness.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    w.p.recommendationEffectiveness.accept(g.id); w.p.recommendationEffectiveness.resolve(g.id, { success: true });
    for (let i = 0; i < 5; i += 1) w.p.continuousLearning.observe();
    const r = w.p.continuousLearning.learn();
    expect(r.samples).toBe(5);
    expect(r.learned_operational_maturity.score).toBeGreaterThan(0);
    expect(r.recommendation_confidence_model.length).toBeGreaterThanOrEqual(1);
    expect(w.p.continuousLearning.knowledge().length).toBe(5);
  });

  test('admin API: GET /learning, /learning/knowledge, POST /learning/observe, overview', async () => {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const authed = (rq) => rq.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');

    const obs = await authed(request(app).post('/v1/admin/learning/observe')).set('Idempotency-Key', 'lrn-1');
    expect(obs.status).toBe(200);
    expect(obs.body).toHaveProperty('operational_confidence');

    const learn = await authed(request(app).get('/v1/admin/learning'));
    expect(learn.status).toBe(200);
    expect(learn.body).toHaveProperty('learned_operational_maturity');
    expect(learn.body).toHaveProperty('trends.operational_confidence');

    const kb = await authed(request(app).get('/v1/admin/learning/knowledge'));
    expect(kb.status).toBe(200);
    expect(Array.isArray(kb.body)).toBe(true);
    expect(kb.body.length).toBeGreaterThanOrEqual(1);

    const overview = await authed(request(app).get('/v1/admin/overview'));
    expect(overview.body).toHaveProperty('continuous_learning.learned_operational_maturity');
    expect(overview.body.slo_dashboards).toContain('learning');
  });
});
