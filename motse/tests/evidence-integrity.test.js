'use strict';

/**
 * FINAL Phase 5 — Enterprise Validation. The evidence-integrity gate must FAIL CI
 * whenever evidence quality regresses: a dashboard references a metric the code
 * never emits, a recommendation lacks evidence, a confidence score is unjustified,
 * a config knob is ungoverned, or a domain report drops an evidence field. These
 * tests prove it catches each regression — and passes a healthy platform.
 */
const {
  EvidenceIntegrity, metricsInCode, metricsInExpr, dashboardMetrics, alertMetrics, stripHistogramSuffix,
} = require('../src/observability/evidence.integrity');
const { createPlatform } = require('../src/container');

describe('FINAL P5 · pure metric extractors', () => {
  test('metricsInCode captures only emitted (produced) metrics, not reads', () => {
    const code = `
      metrics.setGauge('motse_x_total', {}, 1);
      this.metrics.inc('foundation_y_total', { r: 'ok' });
      m.observe('motse_z_ms', {}, 5);
      metrics.gaugeFn('motse_g', () => 1);
      metrics.counterValue('motse_not_emitted');   // a READ, not an emit
      metrics.counterTotal('foundation_also_read'); // a READ
    `;
    const emitted = metricsInCode(code);
    expect([...emitted].sort()).toEqual(['foundation_y_total', 'motse_g', 'motse_x_total', 'motse_z_ms']);
    expect(emitted.has('motse_not_emitted')).toBe(false);
  });

  test('metricsInExpr extracts metric tokens, ignoring PromQL functions and labels', () => {
    const expr = 'sum by (le) (rate(motse_a_total[5m])) / clamp_min(foundation_b_total, 1)';
    expect([...metricsInExpr(expr)].sort()).toEqual(['foundation_b_total', 'motse_a_total']);
    expect(metricsInExpr(null).size).toBe(0); // non-string is safe
  });

  test('dashboardMetrics maps every panel target metric to its panel title', () => {
    const dash = { panels: [
      { id: 1, title: 'A', targets: [{ expr: 'motse_a' }, { expr: 'sum(motse_b)' }] },
      { id: 2, targets: [{ expr: 'foundation_c_total' }] }, // no title → falls back to id
      { id: 3 }, // no targets
    ] };
    const map = dashboardMetrics(dash);
    expect(map.get('motse_a')).toEqual(['A']);
    expect(map.get('foundation_c_total')).toEqual(['panel 2']);
    expect(dashboardMetrics({}).size).toBe(0); // no panels
  });

  test('alertMetrics + stripHistogramSuffix', () => {
    expect([...alertMetrics('expr: motse_alert_x > 0\nexpr: foundation_alert_y')].sort()).toEqual(['foundation_alert_y', 'motse_alert_x']);
    expect(stripHistogramSuffix('motse_dr_recovery_ms_bucket')).toBe('motse_dr_recovery_ms');
    expect(stripHistogramSuffix('motse_plain')).toBe('motse_plain');
  });
});

describe('FINAL P5 · EvidenceIntegrity.auditMetrics — dead references fail', () => {
  const ei = new EvidenceIntegrity();
  test('flags a referenced metric the code never emits', () => {
    const findings = ei.auditMetrics({ emitted: new Set(['motse_live']), referenced: new Map([['motse_live', ['d1']], ['motse_dead', ['d2', 'd3']]]) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'dashboard_integrity', detail: { metric: 'motse_dead', referenced_by: ['d2', 'd3'] } });
  });
  test('a histogram _bucket reference matches its base emitted metric', () => {
    const findings = ei.auditMetrics({ emitted: new Set(['motse_dr_recovery_ms']), referenced: new Map([['motse_dr_recovery_ms_bucket', ['d']]]) });
    expect(findings).toEqual([]);
  });
});

// ── Fakes for the dynamic checks ──────────────────────────────────────
function goodPlatform(over = {}) {
  return {
    opsIntel: { advise: () => ({ recommendations: [{ id: 'r1', signal: 'memory_pressure', confidence: 0.8, business_impact: 'downtime', action: 'add memory', evidence: { x: 1 } }] }) },
    governanceAnalytics: {
      recommend: () => ({ recommendations: [{ id: 'g0', signal: 'healthy', confidence: 0.9 }, { id: 'g1', signal: 'approval_delay', confidence: 0.85, evidence: { p: 1 }, remediation: 'add approvers' }] }),
      report: () => ({ compliance_score: 0.9, operational_maturity_score: 0.85 }),
    },
    reconciliation: { reconcile: () => ({ data_confidence: 0.9, financial_accuracy: 0.95, telemetry_accuracy: 1, capabilities: {}, discrepancies: [{ id: 'd1', probable_root_cause: 'x', confidence: 0.9, remediation: 'y', financial_exposure_minor: 100 }] }) },
    executive: { report: () => ({
      operational_confidence: 0.9,
      operational_confidence_detail: { components: [{ name: 'a', value: 0.9, source: 'src' }] },
      briefing: { what_happened: 'a', why: 'b', who_was_affected: {}, business_value_affected_minor: 0, recommended_action: 'c', recommendation_confidence: 0.8, if_nothing_is_done: 'd' },
      risks: [{ signal: 's', source: 'src', confidence: 0.8, recommended_action: 'act' }],
    }) },
    forecastAccuracy: { report: () => ({ overall_accuracy: 0.86, recommendation_gate: { trustworthy: true } }) },
    recommendationEffectiveness: { effectiveness: () => ({ precision: 0.8, recall: 0.7, operator_trust_score: 0.75, by_signal: [] }) },
    continuousLearning: { learn: () => ({ learned_operational_maturity: { score: 0.7 }, learning_confidence: 0.5 }) },
    config: { keys: new Map([['k1', { key: 'k1', validate: () => true, emergency_managed: true, safe_value: 3 }]]) },
    configGovernance: { risk: new Map([['k1', { risk: 'high' }]]) },
    dr: { latestReport: () => ({ recovery_confidence: 0.8 }) },
    ...over,
  };
}

describe('FINAL P5 · dynamic checks catch regressions', () => {
  test('a healthy fake platform produces no findings', () => {
    const r = new EvidenceIntegrity({ platform: goodPlatform() }).report();
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  test('recommendation missing evidence/confidence/remediation fails', () => {
    const p = goodPlatform({
      opsIntel: { advise: () => ({ recommendations: [{ id: 'r1', signal: 'x', confidence: 0.8, action: 'a' /* no evidence/business_impact */ }] }) },
      governanceAnalytics: { recommend: () => ({ recommendations: [{ id: 'g1', signal: 'approval_delay', confidence: 0.8, evidence: {} /* no remediation */ }] }), report: () => ({ compliance_score: 0.9, operational_maturity_score: 0.85 }) },
      reconciliation: { reconcile: () => ({ data_confidence: 0.9, capabilities: {}, discrepancies: [{ id: 'd1', confidence: 0.9 /* no root cause/remediation/exposure */ }] }) },
      executive: { report: () => ({ operational_confidence: null, operational_confidence_detail: { components: [] }, briefing: goodPlatform().executive.report().briefing, risks: [{ signal: 's', confidence: 0.8 /* no source/action */ }] }) },
    });
    const findings = new EvidenceIntegrity({ platform: p }).recommendations();
    expect(findings.map((f) => f.category)).toEqual(['recommendation_evidence', 'recommendation_evidence', 'recommendation_evidence', 'recommendation_evidence']);
  });

  test('an out-of-range or unsourced confidence fails', () => {
    const p = goodPlatform({
      executive: { report: () => ({ operational_confidence: 1.5 /* out of range */, operational_confidence_detail: { components: [] }, briefing: goodPlatform().executive.report().briefing, risks: [] }) },
      reconciliation: { reconcile: () => ({ data_confidence: -0.1, financial_accuracy: 0.9, telemetry_accuracy: 1, capabilities: {}, discrepancies: [] }) },
    });
    const findings = new EvidenceIntegrity({ platform: p }).confidenceScores();
    const cats = findings.map((f) => f.message);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(cats.some((m) => /not backed by sourced components/.test(m))).toBe(true);
    expect(cats.some((m) => /out of the \[0,1\] range/.test(m))).toBe(true);
  });

  test('an ungoverned or unvalidated config knob fails', () => {
    const p = goodPlatform({
      config: { keys: new Map([['bad', { key: 'bad', validate: null, emergency_managed: true, safe_value: undefined }]]) },
      configGovernance: { risk: new Map() }, // not classified
    });
    const findings = new EvidenceIntegrity({ platform: p }).configuration();
    expect(findings).toHaveLength(3); // no validator + not classified + emergency w/o safe value
    expect(findings.every((f) => f.category === 'configuration_integrity')).toBe(true);
  });

  test('a domain report that drops an evidence field fails', () => {
    const p = goodPlatform({
      governanceAnalytics: { recommend: () => ({ recommendations: [] }), report: () => ({ compliance_score: 'nope' }) },
      forecastAccuracy: { report: () => ({ overall_accuracy: 0.8 /* no recommendation_gate */ }) },
      executive: { report: () => ({ operational_confidence: 0.9, operational_confidence_detail: { components: [{ name: 'a', value: 0.9, source: 's' }] }, briefing: { what_happened: 'a' /* missing the other six */ }, risks: [] }) },
    });
    const findings = new EvidenceIntegrity({ platform: p }).domainReports();
    expect(findings.map((f) => f.category).sort()).toEqual(['executive_dashboards', 'forecast_accuracy', 'governance']);
  });

  test('an empty platform is safe (no subsystems → no dynamic findings) and no-arg construct', () => {
    const r = new EvidenceIntegrity({ platform: {} }).report({ referenced: new Map(), emitted: new Set() });
    expect(r.ok).toBe(true);
    expect(new EvidenceIntegrity().recommendations()).toEqual([]); // no-arg construct, platform defaults to {}
  });
});

describe('FINAL P5 · the real platform passes its own gate', () => {
  test('a driven real platform has no evidence-integrity findings', () => {
    const platform = createPlatform();
    for (let i = 0; i < 14; i += 1) { platform.runtime.sample(); platform.capacity.record(); }
    const g = platform.recommendationEffectiveness.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    platform.recommendationEffectiveness.accept(g.id);
    platform.recommendationEffectiveness.resolve(g.id, { success: true });
    const r = new EvidenceIntegrity({ platform }).report();
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('a dead dashboard reference against the real platform is caught', () => {
    const platform = createPlatform();
    const r = new EvidenceIntegrity({ platform }).report({ emitted: new Set(), referenced: new Map([['motse_ghost_metric', ['dashboard:ghost.json:Panel']]]) });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.category === 'dashboard_integrity' && f.detail.metric === 'motse_ghost_metric')).toBe(true);
  });
});
