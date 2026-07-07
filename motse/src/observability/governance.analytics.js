'use strict';

const NOOP_METRICS = { setGauge() {}, counterValue() { return 0; } };

/**
 * Governance analytics (Phase 1). Transforms the configuration-governance
 * RECORDS the platform already keeps (proposals, approvals, rollbacks,
 * rejections, risk classifications) into actionable governance intelligence —
 * KPIs, trends, a compliance score, an operational-maturity score, and
 * evidence-backed process recommendations. Read-only over the governance
 * service; it computes, it never changes governance state.
 *
 * Emergency (kill-switch / safe-mode) activation counts come from the shared
 * metrics registry (`motse_config_emergency_total`), which ConfigService
 * already increments — so this stays pure analytics.
 */
class GovernanceAnalytics {
  constructor({ governance, config = null, metrics = null, clock } = {}) {
    this.governance = governance;
    this.config = config;
    this.metrics = metrics || NOOP_METRICS;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
  }

  _changes() {
    return [...this.governance.changes.values()];
  }

  /** Approval turnaround (ms) for changes that went through an approval chain. */
  _turnarounds() {
    const out = [];
    for (const c of this._changes()) {
      if (c.applied_at && c.approvals.length > 0) {
        const ms = Date.parse(c.applied_at) - Date.parse(c.created_at);
        if (Number.isFinite(ms) && ms >= 0) out.push(ms);
      }
    }
    return out;
  }

  /**
   * The full governance analytics report: counts by risk/status, approval
   * timing, rollback and rejection rates, churn, emergency activations,
   * service impact, and the compliance + maturity scores.
   */
  report({ pendingSlaMs = 24 * 3600 * 1000 } = {}) {
    const changes = this._changes();
    const total = changes.length;
    const byRisk = { critical: 0, high: 0, medium: 0, low: 0 };
    const byStatus = { pending: 0, applied: 0, rejected: 0, rolled_back: 0 };
    const perKey = new Map();
    const perService = new Map();
    const rejectReasons = [];
    const now = this.clock.nowMs();
    let pendingOverSla = 0;
    for (const c of changes) {
      byRisk[c.risk] = (byRisk[c.risk] || 0) + 1;
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      perKey.set(c.key, (perKey.get(c.key) || 0) + 1);
      for (const svc of c.affects || []) perService.set(svc, (perService.get(svc) || 0) + 1);
      if (c.status === 'rejected' && c.reject_reason) rejectReasons.push({ key: c.key, reason: c.reject_reason });
      if (c.status === 'pending' && now - Date.parse(c.created_at) > pendingSlaMs) pendingOverSla += 1;
    }
    const turnarounds = this._turnarounds().sort((a, b) => a - b);
    const applied = byStatus.applied || 0;
    const rejected = byStatus.rejected || 0;
    const rolledBack = byStatus.rolled_back || 0;
    const resolved = applied + rejected + rolledBack;
    // A rolled-back change WAS applied first, so "ever applied" is the honest
    // denominator for rollback rate (else reverting drops it out of the base).
    const everApplied = applied + rolledBack;
    const rollbackRate = everApplied > 0 ? rolledBack / everApplied : 0;
    const rejectRate = resolved > 0 ? rejected / resolved : 0;
    const changeSuccessRate = resolved > 0 ? applied / resolved : 1;
    const highRiskShare = total > 0 ? (byRisk.critical + byRisk.high) / total : 0;

    const compliance = this._complianceScore({ changes, rollbackRate, rejectRate });
    const maturity = this._maturityScore({ compliance, rollbackRate, highRiskShare, pendingOverSla, total });

    this.metrics.setGauge('motse_governance_compliance_score', {}, round(compliance.score));
    this.metrics.setGauge('motse_governance_maturity_score', {}, round(maturity.score));
    this.metrics.setGauge('motse_governance_rollback_rate', {}, round(rollbackRate));

    return {
      at: this.clock.nowIso(),
      total_changes: total,
      by_risk: byRisk,
      by_status: byStatus,
      approval: {
        avg_turnaround_ms: turnarounds.length ? Math.round(mean(turnarounds)) : 0,
        p95_turnaround_ms: turnarounds.length ? Math.round(pct(turnarounds, 0.95)) : 0,
        pending: byStatus.pending || 0,
        pending_over_sla: pendingOverSla,
      },
      rollback: { count: rolledBack, rate: round(rollbackRate) },
      rejection: { count: rejected, rate: round(rejectRate), reasons: rejectReasons.slice(-10) },
      change_success_rate: round(changeSuccessRate),
      high_risk_share: round(highRiskShare),
      churn: {
        total_changes: total,
        distinct_keys: perKey.size,
        most_modified: topN(perKey, 5),
      },
      emergency: {
        kill_switch_activations: this.metrics.counterValue('motse_config_emergency_total', { type: 'kill_switch' }),
        safe_mode_activations: this.metrics.counterValue('motse_config_emergency_total', { type: 'safe_mode' }),
      },
      service_impact: topN(perService, 5),
      compliance_score: round(compliance.score),
      compliance_detail: compliance,
      operational_maturity_score: round(maturity.score),
      maturity_detail: maturity,
    };
  }

  /**
   * Compliance = are high-risk changes going through proper separation of
   * duties, and are changes justified? Measured over the actual records.
   */
  _complianceScore({ changes, rollbackRate, rejectRate }) {
    const highRisk = changes.filter((c) => (c.risk === 'critical' || c.risk === 'high') && c.status === 'applied');
    const withDistinct = highRisk.filter((c) => {
      const approvers = new Set(c.approvals.map((a) => a.by));
      return approvers.size >= c.required_approvals && !approvers.has(c.actor);
    });
    const mediumPlus = changes.filter((c) => c.risk !== 'low');
    const justified = mediumPlus.filter((c) => !!c.justification);
    const separationRatio = highRisk.length ? withDistinct.length / highRisk.length : 1;
    const justificationRatio = mediumPlus.length ? justified.length / mediumPlus.length : 1;
    // Compliance blends separation of duties, justification, and stability.
    const score = 0.4 * separationRatio + 0.3 * justificationRatio + 0.2 * (1 - rollbackRate) + 0.1 * (1 - rejectRate);
    return {
      score, separation_of_duties: round(separationRatio), justification: round(justificationRatio),
      high_risk_applied: highRisk.length,
    };
  }

  /** Operational maturity blends compliance with churn/stability signals. */
  _maturityScore({ compliance, rollbackRate, highRiskShare, pendingOverSla, total }) {
    const stability = 1 - Math.min(1, rollbackRate * 2);
    const backlogHealth = total > 0 ? 1 - Math.min(1, pendingOverSla / total) : 1;
    const riskDiscipline = 1 - Math.min(1, highRiskShare); // fewer high-risk changes = more mature process
    const score = 0.4 * compliance.score + 0.3 * stability + 0.2 * backlogHealth + 0.1 * riskDiscipline;
    return { score, stability: round(stability), backlog_health: round(backlogHealth), risk_discipline: round(riskDiscipline) };
  }

  /**
   * Evidence-backed governance recommendations: approval delays, excessive
   * rollbacks, recurring risky changes, governance bottlenecks. Each cites the
   * records that justify it.
   */
  recommend({ pendingSlaMs = 24 * 3600 * 1000, rollbackRateThreshold = 0.2, churnThreshold = 5 } = {}) {
    const r = this.report({ pendingSlaMs });
    const recs = [];

    if (r.approval.pending_over_sla > 0) {
      recs.push(this._rec({
        signal: 'approval_delay', urgency: 'high',
        evidence: { pending_over_sla: r.approval.pending_over_sla, sla_ms: pendingSlaMs },
        affected_services: r.service_impact.map((s) => s.name),
        operational_impact: 'high-risk changes are stuck awaiting approval',
        business_impact: 'operators cannot ship needed resilience/config changes promptly',
        confidence: 0.85, remediation: 'add approvers, lower the approval threshold for the affected tier, or set an escalation policy',
      }));
    }
    if (r.rollback.rate > rollbackRateThreshold && r.rollback.count >= 2) {
      recs.push(this._rec({
        signal: 'excessive_rollbacks', urgency: 'high',
        evidence: { rollback_rate: r.rollback.rate, rollbacks: r.rollback.count, threshold: rollbackRateThreshold },
        affected_services: r.service_impact.map((s) => s.name),
        operational_impact: 'applied changes are frequently reverted — instability from configuration',
        business_impact: 'repeated config churn risks customer-facing degradation',
        confidence: 0.8, remediation: 'require a canary/validation step before applying high-risk changes; review the most-modified keys',
      }));
    }
    for (const key of r.churn.most_modified) {
      if (key.count >= churnThreshold) {
        recs.push(this._rec({
          signal: 'recurring_risky_change', urgency: 'medium',
          evidence: { key: key.name, changes: key.count, threshold: churnThreshold },
          affected_services: [], operational_impact: `${key.name} is modified unusually often`,
          business_impact: 'a knob changed this frequently may indicate an unstable default or a missing autoscaler',
          confidence: 0.65, remediation: `investigate why ${key.name} needs frequent tuning; consider an adaptive default`,
        }));
      }
    }
    if (r.approval.p95_turnaround_ms > pendingSlaMs) {
      recs.push(this._rec({
        signal: 'governance_bottleneck', urgency: 'medium',
        evidence: { p95_turnaround_ms: r.approval.p95_turnaround_ms },
        affected_services: [], operational_impact: 'approval turnaround p95 exceeds the SLA',
        business_impact: 'slow change management delays operational response',
        confidence: 0.7, remediation: 'streamline the approval chain or add on-call approvers',
      }));
    }
    if (recs.length === 0) {
      recs.push(this._rec({ signal: 'healthy', urgency: 'none', evidence: { compliance_score: r.compliance_score }, affected_services: [], operational_impact: 'governance process is healthy', business_impact: 'none', confidence: 0.9, remediation: 'no action needed' }));
    }
    recs.sort((a, b) => URGENCY[b.urgency] - URGENCY[a.urgency] || b.confidence - a.confidence);
    return { at: this.clock.nowIso(), recommendations: recs };
  }

  _rec(r) { return { id: `gov-${r.signal}`, evidence_at: this.clock.nowIso(), ...r }; }
}

const URGENCY = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function pct(sorted, q) { return sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)] || 0; }
function round(n) { return Math.round(Number(n) * 1000) / 1000; }
function topN(map, n) {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

module.exports = { GovernanceAnalytics };
