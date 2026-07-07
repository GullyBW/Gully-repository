'use strict';

/**
 * FINAL Phase 3 — Executive Operational Intelligence. Fuses every analytics
 * surface into one briefing that answers the seven executive questions and a
 * single, sourced operational-confidence score. Read-only over the subsystems;
 * the top risk's confidence is recalibrated from the recommendation-effectiveness
 * history, so the exec view improves as the platform learns.
 */
const request = require('supertest');
const { ExecutiveIntelligence } = require('../src/observability/executive.intelligence');
const { Clock } = require('../src/kernel/clock');
const { Metrics } = require('../src/monitoring/metrics');
const { createApp } = require('../src/app');
const { world, liveCampaign } = require('./helpers');

// A fully-wired fake platform so every branch is deterministic.
function fakePlatform(over = {}) {
  return {
    business: {
      executiveView: () => ({
        total_value_minor: 10000, total_business_events: 5, customers_reached: 3,
        capabilities_healthy: 6, capabilities_total: 7,
        sla_breaches: [{ product: 'Wallet & Payments', sla: 0.5, target: 0.98 }],
      }),
      operationsView: () => ({ degraded: ['payments', 'ghost'] }),
      impactOf: (cap) => (cap === 'payments' ? { product: 'Wallet & Payments', customers_affected: 12, value_at_risk_minor: 5000 } : null),
    },
    health: { ready: () => ({ ready: true }) },
    dependencies: { summary: () => ({ a: 'failed', b: 'degraded', c: 'healthy' }), verdict: () => ({ attention: ['a:failed', 'b:degraded'] }) },
    governanceAnalytics: {
      report: () => ({ compliance_score: 0.9, operational_maturity_score: 0.85, rollback: { rate: 0.1 }, approval: { pending_over_sla: 1 } }),
      recommend: () => ({ recommendations: [
        { signal: 'healthy', urgency: 'none', confidence: 0.9 },
        { signal: 'approval_delay', urgency: 'high', confidence: 0.85, operational_impact: 'changes stuck', remediation: 'add approvers', business_impact: 'delays shipping' },
      ] }),
    },
    forecastAccuracy: { report: () => ({ overall_accuracy: 0.86, recommendation_gate: { trustworthy: true }, calibration: { well_calibrated: true } }) },
    recommendationEffectiveness: {
      effectiveness: () => ({ generated: 4, precision: 0.8, recall: 0.7, operator_trust_score: 0.75, outcomes: { incidents_prevented: 2 } }),
      calibratedConfidence: (signal, prior) => (prior == null ? prior : round(prior - 0.05)),
    },
    reconciliation: {
      reconcile: () => ({
        data_confidence: 0.9, financial_accuracy: 0.95, customer_impact_accuracy: 0.9,
        total_financial_exposure_minor: 3000,
        discrepancies: [{ product: 'Kgetsi Campaigns', kind: 'missing_events', severity: 'high', probable_root_cause: 'telemetry undercount', remediation: 'replay the ledger', operational_impact: 'stream incomplete', financial_exposure_minor: 3000, affected_customers: 4, confidence: 0.9 }],
      }),
    },
    dr: { latestReport: () => ({ recovery_confidence: 0.8, rto: { met: true }, rpo: { met: true } }) },
    opsIntel: { advise: () => ({ recommendations: [{ signal: 'memory_pressure', urgency: 'critical', confidence: 0.8, operational_impact: 'OOM risk', action: 'add memory', business_impact: 'downtime' }] }) },
    ...over,
  };
}
function round(n) { return Math.round(Number(n) * 10000) / 10000; }

describe('FINAL P3 · ExecutiveIntelligence — the seven-question briefing', () => {
  test('fuses every domain, answers the seven questions, and ranks + recalibrates risks', () => {
    const metrics = new Metrics();
    const exec = new ExecutiveIntelligence({ platform: fakePlatform(), clock: new Clock(), metrics });
    const r = exec.report();

    // Composite confidence blends all six sourced components, weights renormalised.
    expect(r.operational_confidence).toBeGreaterThan(0);
    expect(r.operational_confidence).toBeLessThanOrEqual(1);
    expect(r.operational_confidence_detail.components.map((c) => c.name).sort()).toEqual(
      ['data_confidence', 'dr_readiness', 'forecast_accuracy', 'governance_compliance', 'operational_health', 'recommendation_trust']
    );
    expect(r.operational_confidence_detail.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 4);
    r.operational_confidence_detail.components.forEach((c) => expect(typeof c.source).toBe('string'));

    // The seven executive questions are all answered.
    expect(r.briefing.what_happened).toMatch(/SLA breach|discrepancy|risk/);
    expect(r.briefing.why).toMatch(/Primary driver/);
    expect(r.briefing.who_was_affected.customers_affected).toBe(12 + 4); // payments impact + discrepancy
    expect(r.briefing.business_value_affected_minor).toBe(3000 + 5000); // exposure + payments value-at-risk
    expect(r.briefing.recommended_action).toBe('add memory'); // top (critical) risk
    expect(r.briefing.if_nothing_is_done).toBe('downtime');

    // Risks are fused from all advisors, healthy skipped, sorted worst-first.
    expect(r.risks[0].source).toBe('operational_intelligence');
    expect(r.risks[0].severity).toBe('critical');
    expect(r.risks.some((x) => x.signal === 'healthy')).toBe(false);
    expect(r.risks.map((x) => x.source)).toEqual(expect.arrayContaining(['operational_intelligence', 'business_reconciliation', 'governance_analytics']));
    // Top-risk confidence is recalibrated (0.8 → 0.75 via the fake tracker).
    expect(r.briefing.recommendation_confidence).toBe(0.75);

    // Domains + compliance are surfaced with sources.
    expect(r.domains.compliance.compliance_score).toBe(0.9);
    expect(r.domains.disaster_recovery.recovery_confidence).toBe(0.8);
    // Gauges reached the registry.
    expect(metrics.render()).toContain('motse_executive_operational_confidence');
    expect(metrics.render()).toContain('motse_executive_value_at_risk_minor');
  });

  test('health score degrades with failed/degraded dependencies and collapses when not ready', () => {
    const degraded = new ExecutiveIntelligence({ platform: fakePlatform(), clock: new Clock() }).report();
    expect(degraded.domains.operational_health.failed_dependencies).toBe(1);
    expect(degraded.domains.operational_health.degraded_dependencies).toBe(1);
    expect(degraded.domains.operational_health.score).toBeLessThan(1);

    const notReady = new ExecutiveIntelligence({ platform: fakePlatform({ health: { ready: () => ({ ready: false }) } }), clock: new Clock() }).report();
    expect(notReady.domains.operational_health.score).toBe(0);

    const allHealthy = new ExecutiveIntelligence({ platform: fakePlatform({ dependencies: { summary: () => ({ a: 'healthy', b: 'healthy' }), verdict: () => ({ attention: [] }) } }), clock: new Clock() }).report();
    expect(allHealthy.domains.operational_health.score).toBe(1);
  });

  test('missing advisors: components omitted, confidence honestly reflects what is known', () => {
    // No recommendation-effectiveness → trust omitted and risk confidence NOT recalibrated.
    const noTrust = new ExecutiveIntelligence({ platform: fakePlatform({ recommendationEffectiveness: undefined }), clock: new Clock() }).report();
    expect(noTrust.operational_confidence_detail.missing_evidence).toContain('recommendation_trust');
    expect(noTrust.briefing.recommendation_confidence).toBe(0.8); // raw opsIntel confidence, un-recalibrated

    // No DR run yet → dr_readiness omitted.
    const noDr = new ExecutiveIntelligence({ platform: fakePlatform({ dr: { latestReport: () => null } }), clock: new Clock() }).report();
    expect(noDr.domains.disaster_recovery.available).toBe(false);
    expect(noDr.operational_confidence_detail.missing_evidence).toContain('dr_readiness');
  });

  test('a recalibration that returns null falls back to the raw confidence', () => {
    const p = fakePlatform({ recommendationEffectiveness: { effectiveness: () => ({ generated: 0, precision: null, recall: null, operator_trust_score: null, outcomes: { incidents_prevented: 0 } }), calibratedConfidence: () => null } });
    const r = new ExecutiveIntelligence({ platform: p, clock: new Clock() }).report();
    expect(r.risks[0].confidence).toBe(0.8); // calibrated null → raw confidence retained
    expect(r.operational_confidence_detail.missing_evidence).toContain('recommendation_trust');
  });

  test('an empty platform is safe: everything unavailable, nominal briefing, null confidence', () => {
    const r = new ExecutiveIntelligence({}).report(); // no clock/metrics/platform
    expect(r.operational_confidence).toBeNull();
    expect(r.operational_confidence_detail.components).toEqual([]);
    expect(r.risks).toEqual([]);
    expect(r.briefing.what_happened).toMatch(/nominal/);
    expect(r.briefing.recommended_action).toMatch(/No action required/);
    expect(r.briefing.recommendation_confidence).toBeNull();
    expect(r.briefing.if_nothing_is_done).toMatch(/No degradation is projected/);
    expect(r.domains.business_kpis.available).toBe(false);
    expect(new ExecutiveIntelligence().report().operational_confidence).toBeNull(); // no-arg construct
  });
});

describe('FINAL P3 · ExecutiveIntelligence — real platform + admin API', () => {
  test('a real, quiet platform reports full operational confidence and a nominal briefing', () => {
    const w = world();
    const r = w.p.executive.report();
    expect(r.operational_confidence).toBe(1);
    expect(r.briefing.what_happened).toMatch(/nominal/);
    expect(r.risks).toEqual([]);
    // The evidenced components all cite a live source.
    r.operational_confidence_detail.components.forEach((c) => expect(c.source).toBeTruthy());
  });

  test('a real telemetry gap surfaces as the top executive risk with exposure + remediation', () => {
    const w = world();
    const camp = liveCampaign(w);
    w.p.kgetsi.contribute(camp.id, { sourceAccountId: w.kaboWallet.id, amountMinor: 4000, contributorRef: w.kabo.id, idempotencyKey: 'x1' });
    // Simulate telemetry that dropped the fundraising value events.
    w.p.business.caps.get('fundraising').value_events = 0;
    w.p.business.caps.get('fundraising').value_minor = 0;
    const r = w.p.executive.report();
    expect(r.operational_confidence).toBeLessThan(1);
    expect(r.risks[0].source).toBe('business_reconciliation');
    expect(r.briefing.business_value_affected_minor).toBe(4000);
    expect(r.briefing.recommended_action).toMatch(/replay|schema/i);
    expect(r.briefing.who_was_affected.customers_affected).toBeGreaterThanOrEqual(1);
  });

  test('GET /v1/admin/executive returns the briefing; /overview folds in the summary', async () => {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const authed = (rq) => rq.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');

    const exec = await authed(request(app).get('/v1/admin/executive'));
    expect(exec.status).toBe(200);
    expect(exec.body).toHaveProperty('operational_confidence');
    expect(exec.body).toHaveProperty('briefing.what_happened');
    expect(exec.body).toHaveProperty('domains.business_kpis');

    const overview = await authed(request(app).get('/v1/admin/overview'));
    expect(overview.status).toBe(200);
    expect(overview.body).toHaveProperty('executive.operational_confidence');
    expect(overview.body.slo_dashboards).toContain('executive');
  });
});
