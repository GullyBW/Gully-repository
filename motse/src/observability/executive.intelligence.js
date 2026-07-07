'use strict';

const NOOP_METRICS = { setGauge() {} };

/**
 * Executive operational intelligence (FINAL Phase 3). One briefing that FUSES
 * every analytics surface the platform already produces — business KPIs,
 * operational health, governance, forecast accuracy, recommendation quality,
 * business/financial risk, customer reach, DR readiness, compliance — into a
 * single executive view that answers the seven questions leadership actually
 * asks:
 *
 *   1. What happened?
 *   2. Why?
 *   3. Who was affected?
 *   4. How much business value was affected?
 *   5. What is recommended?
 *   6. How confident is that recommendation?
 *   7. What happens if nothing is done?
 *
 * It also computes a single **operational-confidence** score — a weighted blend
 * of the platform's own measured confidence signals (data confidence, forecast
 * accuracy, recommendation trust, governance compliance, DR readiness,
 * operational health). Every number carries its SOURCE, so the briefing is
 * auditable end to end and nothing is asserted without evidence.
 *
 * Read-only over the existing subsystems; it composes, it changes nothing. The
 * top recommendation's confidence is RECALIBRATED through the recommendation-
 * effectiveness tracker, so the exec view improves as the platform learns.
 */
const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

class ExecutiveIntelligence {
  constructor({ platform, clock, metrics = null } = {}) {
    this.platform = platform || {};
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
  }

  /** The full executive briefing. */
  report() {
    const business = this._business();
    const health = this._health();
    const governance = this._governance();
    const forecast = this._forecast();
    const recommendationQuality = this._recommendationQuality();
    const reconciliation = this._reconciliation();
    const dr = this._dr();

    const risks = this._risks();
    const top = risks[0] || null;

    const valueAtRisk = this._valueAtRisk(business, reconciliation);
    const customersAffected = this._customersAffected(business, risks);
    const operational = this._operationalConfidence({ reconciliation, forecast, recommendationQuality, governance, dr, health });

    const briefing = this._briefing({ business, health, reconciliation, risks, top, valueAtRisk, customersAffected });

    // operational.score is already rounded (or null when no evidence exists yet).
    if (operational.score != null) this.metrics.setGauge('motse_executive_operational_confidence', {}, operational.score);
    this.metrics.setGauge('motse_executive_value_at_risk_minor', {}, valueAtRisk);
    this.metrics.setGauge('motse_executive_customers_affected', {}, customersAffected);
    this.metrics.setGauge('motse_executive_open_risks', {}, risks.length);

    return {
      at: this.clock.nowIso(),
      operational_confidence: operational.score,
      operational_confidence_detail: operational,
      briefing,
      domains: {
        business_kpis: business,
        operational_health: health,
        governance,
        forecast_accuracy: forecast,
        recommendation_quality: recommendationQuality,
        business_validation: reconciliation,
        disaster_recovery: dr,
        compliance: { compliance_score: governance.compliance_score, operational_maturity_score: governance.operational_maturity_score, source: governance.source },
      },
      risks,
    };
  }

  // ── Domain extracts (each cites its source) ────────────────────────

  _business() {
    const p = this.platform;
    if (!p.business) return { available: false, source: 'business.observability (not wired)' };
    const ev = p.business.executiveView();
    const ops = p.business.operationsView();
    return {
      available: true,
      total_value_minor: ev.total_value_minor,
      total_business_events: ev.total_business_events,
      customers_reached: ev.customers_reached,
      capabilities_healthy: ev.capabilities_healthy,
      capabilities_total: ev.capabilities_total,
      sla_breaches: ev.sla_breaches,
      degraded_capabilities: ops.degraded,
      source: 'business.observability.executiveView (motse_business_*)',
    };
  }

  _health() {
    const p = this.platform;
    if (!p.health || !p.dependencies) return { available: false, score: null, source: 'health/dependency (not wired)' };
    const ready = p.health.ready().ready;
    const states = Object.values(p.dependencies.summary());
    const failed = states.filter((s) => s === 'failed').length;
    const degraded = states.filter((s) => s === 'degraded' || s === 'recovering').length;
    const total = states.length || 1;
    // Health is 0 when not ready; otherwise it degrades with failed/degraded deps.
    const score = ready ? Math.max(0, 1 - (failed / total) - 0.5 * (degraded / total)) : 0;
    const v = p.dependencies.verdict();
    return {
      available: true, ready, failed_dependencies: failed, degraded_dependencies: degraded,
      attention: v.attention, score: round(score),
      source: 'health.ready + dependency.health.verdict',
    };
  }

  _governance() {
    const p = this.platform;
    if (!p.governanceAnalytics) return { available: false, compliance_score: null, operational_maturity_score: null, source: 'governance.analytics (not wired)' };
    const r = p.governanceAnalytics.report();
    return {
      available: true,
      compliance_score: r.compliance_score,
      operational_maturity_score: r.operational_maturity_score,
      rollback_rate: r.rollback.rate,
      pending_over_sla: r.approval.pending_over_sla,
      source: 'governance.analytics.report (motse_governance_*)',
    };
  }

  _forecast() {
    const p = this.platform;
    if (!p.forecastAccuracy) return { available: false, overall_accuracy: null, source: 'forecast.accuracy (not wired)' };
    const r = p.forecastAccuracy.report();
    return {
      available: true,
      overall_accuracy: r.overall_accuracy,
      trustworthy: r.recommendation_gate.trustworthy,
      well_calibrated: r.calibration.well_calibrated,
      source: 'forecast.accuracy.report (motse_forecast_accuracy)',
    };
  }

  _recommendationQuality() {
    const p = this.platform;
    if (!p.recommendationEffectiveness) return { available: false, operator_trust_score: null, source: 'recommendation.effectiveness (not wired)' };
    const r = p.recommendationEffectiveness.effectiveness();
    return {
      available: true,
      generated: r.generated,
      precision: r.precision,
      recall: r.recall,
      operator_trust_score: r.operator_trust_score,
      incidents_prevented: r.outcomes.incidents_prevented,
      source: 'recommendation.effectiveness.effectiveness (motse_recommendation_*)',
    };
  }

  _reconciliation() {
    const p = this.platform;
    if (!p.reconciliation) return { available: false, data_confidence: null, source: 'business.reconciliation (not wired)' };
    const r = p.reconciliation.reconcile();
    return {
      available: true,
      data_confidence: r.data_confidence,
      financial_accuracy: r.financial_accuracy,
      customer_impact_accuracy: r.customer_impact_accuracy,
      financial_exposure_minor: r.total_financial_exposure_minor,
      open_discrepancies: r.discrepancies.length,
      source: 'business.reconciliation.reconcile (motse_reconciliation_*)',
    };
  }

  _dr() {
    const p = this.platform;
    const rep = p.dr ? p.dr.latestReport() : null;
    if (!rep) return { available: false, recovery_confidence: null, source: 'dr.validator (no run yet)' };
    return {
      available: true,
      recovery_confidence: rep.recovery_confidence,
      rto_met: rep.rto.met, rpo_met: rep.rpo.met,
      source: 'dr.validator.latestReport (motse_dr_*)',
    };
  }

  // ── Risk fusion (normalise every advisory into one ranked list) ─────

  _risks() {
    const p = this.platform;
    const out = [];
    // Operational recommendations (trend-based advisor).
    if (p.opsIntel) {
      for (const r of p.opsIntel.advise().recommendations) {
        out.push(this._risk({
          source: 'operational_intelligence', signal: r.signal, severity: r.urgency,
          confidence: r.confidence, what: r.signal, why: r.operational_impact,
          recommended_action: r.action, if_nothing_done: r.business_impact,
          business_value_affected_minor: 0, customers_affected: 0,
        }));
      }
    }
    // Data/business-validation discrepancies (telemetry vs ledger).
    if (p.reconciliation) {
      for (const d of p.reconciliation.reconcile().discrepancies) {
        out.push(this._risk({
          source: 'business_reconciliation', signal: `reconciliation_${d.kind}`, severity: d.severity,
          confidence: d.confidence, what: `${d.kind} in ${d.product}`, why: d.probable_root_cause,
          recommended_action: d.remediation, if_nothing_done: d.operational_impact,
          business_value_affected_minor: d.financial_exposure_minor, customers_affected: d.affected_customers,
        }));
      }
    }
    // Governance process recommendations.
    if (p.governanceAnalytics) {
      for (const r of p.governanceAnalytics.recommend().recommendations) {
        if (r.signal === 'healthy') continue;
        out.push(this._risk({
          source: 'governance_analytics', signal: r.signal, severity: r.urgency,
          confidence: r.confidence, what: r.signal, why: r.operational_impact,
          recommended_action: r.remediation, if_nothing_done: r.business_impact,
          business_value_affected_minor: 0, customers_affected: 0,
        }));
      }
    }
    out.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.confidence - a.confidence);
    return out;
  }

  /** Normalise a risk and RECALIBRATE its confidence from measured history. */
  _risk(r) {
    let confidence = r.confidence;
    if (this.platform.recommendationEffectiveness) {
      confidence = this.platform.recommendationEffectiveness.calibratedConfidence(r.signal, r.confidence);
    }
    return { ...r, confidence: confidence == null ? r.confidence : round(confidence) };
  }

  // ── Synthesis ──────────────────────────────────────────────────────

  _valueAtRisk(business, reconciliation) {
    let v = reconciliation.available ? reconciliation.financial_exposure_minor : 0;
    if (business.available && this.platform.business) {
      for (const cap of business.degraded_capabilities) {
        const impact = this.platform.business.impactOf(cap);
        if (impact) v += impact.value_at_risk_minor;
      }
    }
    return v;
  }

  _customersAffected(business, risks) {
    let c = 0;
    if (business.available && this.platform.business) {
      for (const cap of business.degraded_capabilities) {
        const impact = this.platform.business.impactOf(cap);
        if (impact) c += impact.customers_affected;
      }
    }
    for (const r of risks) c += r.customers_affected || 0;
    return c;
  }

  /**
   * Operational confidence: a weighted blend of the platform's own measured
   * confidence signals. Components with no evidence yet are omitted and the
   * weights renormalised, so the score is honest about what it actually knows.
   */
  _operationalConfidence({ reconciliation, forecast, recommendationQuality, governance, dr, health }) {
    const candidates = [
      { name: 'data_confidence', value: reconciliation.data_confidence, weight: 0.2, source: reconciliation.source },
      { name: 'operational_health', value: health.score, weight: 0.2, source: health.source },
      { name: 'governance_compliance', value: governance.compliance_score, weight: 0.15, source: governance.source },
      { name: 'forecast_accuracy', value: forecast.overall_accuracy, weight: 0.15, source: forecast.source },
      { name: 'recommendation_trust', value: recommendationQuality.operator_trust_score, weight: 0.15, source: recommendationQuality.source },
      { name: 'dr_readiness', value: dr.recovery_confidence, weight: 0.15, source: dr.source },
    ];
    const present = candidates.filter((c) => c.value != null);
    const totalWeight = present.reduce((s, c) => s + c.weight, 0);
    const score = totalWeight > 0 ? present.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight : null;
    return {
      score: score == null ? null : round(score),
      components: present.map((c) => ({ name: c.name, value: round(c.value), weight: round(c.weight / totalWeight), source: c.source })),
      missing_evidence: candidates.filter((c) => c.value == null).map((c) => c.name),
    };
  }

  /** Answer the seven executive questions from the fused state. */
  _briefing({ business, health, reconciliation, risks, top, valueAtRisk, customersAffected }) {
    const slaBreaches = business.available ? business.sla_breaches.length : 0;
    const discrepancies = reconciliation.available ? reconciliation.open_discrepancies : 0;
    const failedDeps = health.available ? health.failed_dependencies : 0;
    const degradedDeps = health.available ? health.degraded_dependencies : 0;
    const nominal = slaBreaches === 0 && discrepancies === 0 && failedDeps === 0 && degradedDeps === 0 && risks.length === 0;

    const what = nominal
      ? 'All systems nominal: no SLA breaches, no data discrepancies, no dependency degradation, no open operational risks.'
      : `${slaBreaches} SLA breach(es), ${discrepancies} data discrepancy(ies), ${failedDeps} failed and ${degradedDeps} degraded dependency(ies); ${risks.length} open risk(s).`;
    const why = top
      ? `Primary driver: ${top.why} (source: ${top.source}).`
      : 'No active drivers — the platform is operating within its measured envelope.';

    return {
      what_happened: what,
      why,
      who_was_affected: {
        customers_affected: customersAffected,
        customers_reached: business.available ? business.customers_reached : 0,
        source: 'business.observability.impactOf + business_reconciliation',
      },
      business_value_affected_minor: valueAtRisk,
      recommended_action: top ? top.recommended_action : 'No action required; continue monitoring.',
      recommendation_confidence: top ? top.confidence : null,
      if_nothing_is_done: top
        ? top.if_nothing_done
        : 'No degradation is projected on current evidence; monitoring continues.',
    };
  }
}

function round(n) { return Math.round(Number(n) * 10000) / 10000; }

module.exports = { ExecutiveIntelligence };
