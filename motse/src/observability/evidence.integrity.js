'use strict';

/**
 * Evidence integrity (FINAL Phase 5). The capstone that enforces the invariants
 * every earlier phase established — so evidence quality can never silently
 * regress:
 *
 *   - METRIC / DASHBOARD / ALERT integrity — every metric a dashboard or alert
 *     references must actually be EMITTED by the code (no dead references).
 *   - RECOMMENDATION evidence — every recommendation/discrepancy/risk the live
 *     advisors produce must carry evidence, a numeric confidence and a remediation.
 *   - CONFIDENCE justification — every confidence/score is in [0,1] and every
 *     composite exposes its components + sources (never an asserted black box).
 *   - CONFIGURATION integrity — every runtime knob is validated AND governed
 *     (risk-classified; emergency-managed knobs carry a safe value).
 *   - DOMAIN reports — governance, forecast, recommendation, business validation,
 *     DR, operational and executive intelligence each expose their evidence fields.
 *
 * The pure extractors (metric catalogs from code / dashboards / alerts) are
 * separated from the dynamic checks (run against a live platform) so both are
 * independently testable. `report()` aggregates findings; any finding fails CI.
 */

// An emitted metric is one PRODUCED by the code: inc / setGauge / observe / gaugeFn.
const EMIT_RE = /\.(?:inc|setGauge|observe|gaugeFn)\(\s*(['"`])((?:motse|foundation)_[a-z0-9_]+)\1/g;
// A referenced metric is any motse_/foundation_ token in a PromQL expression.
const METRIC_TOKEN_RE = /\b((?:motse|foundation)_[a-z0-9_]+)\b/g;

/** Metric names emitted by a source file (literal inc/setGauge/observe/gaugeFn). */
function metricsInCode(text) {
  const out = new Set();
  let m;
  EMIT_RE.lastIndex = 0;
  while ((m = EMIT_RE.exec(text)) !== null) out.add(m[2]);
  return out;
}

/** Metric names referenced by a PromQL expression. */
function metricsInExpr(expr) {
  const out = new Set();
  if (typeof expr !== 'string') return out;
  let m;
  METRIC_TOKEN_RE.lastIndex = 0;
  while ((m = METRIC_TOKEN_RE.exec(expr)) !== null) out.add(m[1]);
  return out;
}

/** Metric → panel titles, for every target expression in a Grafana dashboard. */
function dashboardMetrics(dashboard) {
  const out = new Map();
  for (const panel of dashboard.panels || []) {
    for (const target of panel.targets || []) {
      for (const metric of metricsInExpr(target.expr)) {
        if (!out.has(metric)) out.set(metric, []);
        out.get(metric).push(panel.title || `panel ${panel.id}`);
      }
    }
  }
  return out;
}

/** Metric names referenced across a Prometheus alert-rules document (text). */
function alertMetrics(yamlText) { return metricsInExpr(yamlText); }

/** Histograms render as name_bucket/_sum/_count; match against the base name too. */
function stripHistogramSuffix(name) { return name.replace(/_(bucket|sum|count)$/, ''); }

const inRange = (v) => v == null || (typeof v === 'number' && v >= 0 && v <= 1);

class EvidenceIntegrity {
  constructor({ platform } = {}) { this.platform = platform || {}; }

  /**
   * Dead references: metrics a dashboard/alert references that the code never
   * emits. `referenced` is a Map(metric → sources); `emitted` is a Set of names.
   */
  auditMetrics({ emitted, referenced }) {
    const findings = [];
    for (const [metric, sources] of referenced) {
      if (emitted.has(metric) || emitted.has(stripHistogramSuffix(metric))) continue;
      findings.push(finding('dashboard_integrity', 'error',
        `Dashboard/alert references metric "${metric}" that the code never emits`,
        { metric, referenced_by: sources }));
    }
    return findings;
  }

  /** Every live recommendation/discrepancy/risk carries evidence + confidence + a fix. */
  recommendations() {
    const p = this.platform;
    const findings = [];
    if (p.opsIntel) {
      for (const r of p.opsIntel.advise().recommendations) {
        if (!r.evidence || typeof r.confidence !== 'number' || !r.business_impact || !r.action) {
          findings.push(finding('recommendation_evidence', 'error', `Operational recommendation "${r.signal}" is missing evidence/confidence/action`, { rec: r.id }));
        }
      }
    }
    if (p.governanceAnalytics) {
      for (const r of p.governanceAnalytics.recommend().recommendations) {
        if (r.signal === 'healthy') continue;
        if (!r.evidence || typeof r.confidence !== 'number' || !r.remediation) {
          findings.push(finding('recommendation_evidence', 'error', `Governance recommendation "${r.signal}" is missing evidence/confidence/remediation`, { rec: r.id }));
        }
      }
    }
    if (p.reconciliation) {
      for (const d of p.reconciliation.reconcile().discrepancies) {
        if (!d.probable_root_cause || typeof d.confidence !== 'number' || !d.remediation || d.financial_exposure_minor == null) {
          findings.push(finding('recommendation_evidence', 'error', `Reconciliation discrepancy "${d.id}" is missing root cause/confidence/exposure/remediation`, { discrepancy: d.id }));
        }
      }
    }
    if (p.executive) {
      for (const r of p.executive.report().risks) {
        if (!r.source || typeof r.confidence !== 'number' || !r.recommended_action) {
          findings.push(finding('recommendation_evidence', 'error', `Executive risk "${r.signal}" is missing source/confidence/action`, { signal: r.signal }));
        }
      }
    }
    return findings;
  }

  /** Every confidence/score is in [0,1]; composites expose their provenance. */
  confidenceScores() {
    const p = this.platform;
    const findings = [];
    const scores = [];
    if (p.executive) {
      const e = p.executive.report();
      scores.push(['executive.operational_confidence', e.operational_confidence]);
      // A composite confidence must expose its weighted components + their sources.
      if (e.operational_confidence != null) {
        const comps = e.operational_confidence_detail.components;
        if (!comps.length || comps.some((c) => !c.source || typeof c.value !== 'number')) {
          findings.push(finding('confidence_justification', 'error', 'Executive operational confidence is not backed by sourced components', {}));
        }
      }
    }
    if (p.reconciliation) {
      const r = p.reconciliation.reconcile();
      scores.push(['reconciliation.data_confidence', r.data_confidence], ['reconciliation.financial_accuracy', r.financial_accuracy], ['reconciliation.telemetry_accuracy', r.telemetry_accuracy]);
    }
    if (p.governanceAnalytics) {
      const g = p.governanceAnalytics.report();
      scores.push(['governance.compliance_score', g.compliance_score], ['governance.operational_maturity_score', g.operational_maturity_score]);
    }
    if (p.forecastAccuracy) scores.push(['forecast.overall_accuracy', p.forecastAccuracy.report().overall_accuracy]);
    if (p.recommendationEffectiveness) {
      const eff = p.recommendationEffectiveness.effectiveness();
      scores.push(['recommendation.precision', eff.precision], ['recommendation.recall', eff.recall], ['recommendation.operator_trust_score', eff.operator_trust_score]);
    }
    if (p.continuousLearning) {
      const l = p.continuousLearning.learn();
      scores.push(['learning.operational_maturity', l.learned_operational_maturity.score], ['learning.learning_confidence', l.learning_confidence]);
    }
    for (const [name, value] of scores) {
      if (!inRange(value)) findings.push(finding('confidence_justification', 'error', `Score "${name}" is out of the [0,1] range`, { name, value }));
    }
    return findings;
  }

  /** Every runtime knob is validated and governed (classified; safe emergency value). */
  configuration() {
    const p = this.platform;
    const findings = [];
    if (!p.config || !p.configGovernance) return findings;
    for (const def of p.config.keys.values()) {
      if (typeof def.validate !== 'function') {
        findings.push(finding('configuration_integrity', 'error', `Config knob "${def.key}" has no validator`, { key: def.key }));
      }
      if (!p.configGovernance.risk.has(def.key)) {
        findings.push(finding('configuration_integrity', 'error', `Config knob "${def.key}" is not risk-classified in governance`, { key: def.key }));
      }
      if (def.emergency_managed && def.safe_value === undefined) {
        findings.push(finding('configuration_integrity', 'error', `Emergency-managed knob "${def.key}" has no safe value`, { key: def.key }));
      }
    }
    return findings;
  }

  /** Each domain report exposes its evidence fields (structure integrity). */
  domainReports() {
    const p = this.platform;
    const findings = [];
    const need = (cond, category, message) => { if (!cond) findings.push(finding(category, 'error', message, {})); };
    if (p.governanceAnalytics) {
      const g = p.governanceAnalytics.report();
      need(typeof g.compliance_score === 'number' && typeof g.operational_maturity_score === 'number', 'governance', 'Governance report missing compliance/maturity scores');
    }
    if (p.forecastAccuracy) {
      const f = p.forecastAccuracy.report();
      need(f.recommendation_gate && typeof f.recommendation_gate.trustworthy === 'boolean', 'forecast_accuracy', 'Forecast report missing the accuracy-gated recommendation flag');
    }
    if (p.reconciliation) {
      const r = p.reconciliation.reconcile();
      need(typeof r.data_confidence === 'number' && Array.isArray(r.discrepancies) && r.capabilities, 'business_validation', 'Reconciliation report missing data confidence/discrepancies/capabilities');
    }
    if (p.recommendationEffectiveness) {
      const e = p.recommendationEffectiveness.effectiveness();
      need('precision' in e && 'recall' in e && Array.isArray(e.by_signal), 'recommendation_accuracy', 'Recommendation effectiveness missing precision/recall/by-signal');
    }
    if (p.executive) {
      const e = p.executive.report();
      const b = e.briefing || {};
      const seven = ['what_happened', 'why', 'who_was_affected', 'business_value_affected_minor', 'recommended_action', 'recommendation_confidence', 'if_nothing_is_done'];
      need(seven.every((k) => k in b), 'executive_dashboards', 'Executive briefing does not answer all seven questions');
    }
    if (p.opsIntel) need(Array.isArray(p.opsIntel.advise().recommendations), 'operational_intelligence', 'Operational intelligence did not return a recommendations array');
    if (p.dr) {
      const rep = p.dr.latestReport();
      need(rep == null || typeof rep.recovery_confidence === 'number', 'disaster_recovery', 'DR report missing recovery confidence');
    }
    return findings;
  }

  /** Run every check; any finding is a CI failure. */
  report({ emitted = new Set(), referenced = new Map() } = {}) {
    const findings = [
      ...this.auditMetrics({ emitted, referenced }),
      ...this.recommendations(),
      ...this.confidenceScores(),
      ...this.configuration(),
      ...this.domainReports(),
    ];
    return { findings, ok: findings.length === 0, checked: referenced.size };
  }
}

function finding(category, severity, message, detail) { return { category, severity, message, detail }; }

module.exports = {
  EvidenceIntegrity,
  metricsInCode,
  metricsInExpr,
  dashboardMetrics,
  alertMetrics,
  stripHistogramSuffix,
};
