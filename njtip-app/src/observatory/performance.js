'use strict';
// National Performance Observatory (Phase 58). Extends Executive Intelligence into a
// national, cross-agency performance view: a service-performance dashboard, cross-agency
// analytics, digital-government KPIs, longitudinal trend analysis, operational benchmarking,
// service-delivery forecasting, national readiness indicators, and governance-effectiveness
// metrics. Dashboards are INFORMATIONAL ONLY. Deterministic, aggregate, and privacy-
// preserving (non-identifying rows; small-cell suppression inherited from analytics).
const analytics = require('../analytics');
const twin3 = require('../twin2/monte-carlo');

// Digital-government KPIs from non-identifying case rows.
function digitalGovKpis(rows, now) {
  const k = analytics.kpis(rows, now);
  return { total: k.total, resolutionRate: k.resolutionRate, slaCompliance: +(1 - k.slaBreachRate).toFixed(3), backlog: k.backlog, avgTimeToFirstReviewMs: k.avgTimeToFirstReviewMs };
}

// Cross-agency analytics: KPIs grouped by recipient agency, with small-cell suppression.
function crossAgency(rows) {
  const byAgency = {};
  for (const r of rows) { const a = r.recipient || 'unknown'; (byAgency[a] = byAgency[a] || []).push(r); }
  const out = {};
  for (const [agency, arr] of Object.entries(byAgency)) {
    out[agency] = arr.length < analytics.K_ANON
      ? { suppressed: true }
      : { cases: arr.length, resolutionRate: analytics.kpis(arr).resolutionRate };
  }
  return out;
}

// Longitudinal trend: day-bucketed status trend (deterministic; delegates to analytics).
function longitudinal(rows) { return analytics.trends(rows, { field: 'status' }); }

// Operational benchmarking: each agency's resolution rate vs the national average.
function benchmarking(rows) {
  const national = analytics.kpis(rows).resolutionRate;
  const ca = crossAgency(rows);
  const rows2 = Object.entries(ca).filter(([, s]) => !s.suppressed).map(([agency, s]) => ({ agency, resolutionRate: s.resolutionRate, vsNational: +(s.resolutionRate - national).toFixed(3) }));
  return { nationalResolutionRate: national, agencies: rows2 };
}

// Service-delivery forecasting (deterministic Monte-Carlo via Twin 3.0).
function serviceForecast({ arrivalPerDay = 20, days = 30, investigators = 10, seed = 1 }) {
  const f = twin3.workloadForecast({ arrivalPerDay, days, investigators, seed });
  return { forecast: f.perInvestigator, note: 'Advisory forecast; deterministic per seed.' };
}

// National readiness indicators (composite, informational) + governance effectiveness.
function nationalReadinessIndicators(rows, { fitnessHeld = true, resiliencePass = true } = {}) {
  const k = digitalGovKpis(rows);
  return {
    serviceHealth: k.slaCompliance,
    architectureIntegrity: fitnessHeld ? 1 : 0,
    resilience: resiliencePass ? 1 : 0,
    note: 'Informational indicators; national readiness is a human governance determination.',
  };
}
function governanceEffectiveness({ decisionsRecorded = 0, automatedActions = 0 }) {
  // Effectiveness signal: human governance density (decisions per automated action).
  return { decisionsRecorded, automatedActions, humanGovernanceDensity: automatedActions ? +(decisionsRecorded / automatedActions).toFixed(2) : null, note: 'Automated actions never authorize; humans decide.' };
}

// Executive advisory report — a single informational digest (never authorizes).
function executiveReport(rows, opts = {}) {
  return {
    kpis: digitalGovKpis(rows, opts.now),
    crossAgency: crossAgency(rows),
    benchmarking: benchmarking(rows),
    readinessIndicators: nationalReadinessIndicators(rows, opts),
    informationalOnly: true,
    note: 'National Performance Observatory — informational dashboards only; operational decisions remain human-approved.',
  };
}

module.exports = { digitalGovKpis, crossAgency, longitudinal, benchmarking, serviceForecast, nationalReadinessIndicators, governanceEffectiveness, executiveReport };
