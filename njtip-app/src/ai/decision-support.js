'use strict';
// Operational Decision Support (Phase 33). Predictive KPIs and operational RECOMMENDATIONS
// that extend Executive Intelligence with forecasts from the Twin 3.0 Monte-Carlo engine.
// Deterministic. Every output is ADVISORY, confidence-scored, and explainable — NO
// recommendation may automatically execute; a human decides.
const twin3 = require('../twin2/monte-carlo');

function advisory(kind, result, confidence, explanation) {
  return { kind, result, confidence: +Math.max(0, Math.min(1, confidence)).toFixed(2), explanation, advisoryOnly: true, autonomous: false, requiresHumanApproval: true };
}

// Predictive KPIs: project next-period case volume + backlog from recent throughput.
function predictiveKpis({ openCases = 0, arrivalPerDay = 20, resolvedPerDay = 18, horizonDays = 30, seed = 1 }) {
  const forecast = twin3.workloadForecast({ arrivalPerDay, days: horizonDays, investigators: 1, seed });
  const projectedBacklog = Math.max(0, openCases + (arrivalPerDay - resolvedPerDay) * horizonDays);
  return advisory('predictive-kpi', { projectedBacklog, projectedIntake: Math.round(forecast.perInvestigator.mean), horizonDays }, 0.7, [
    `intake ~${arrivalPerDay}/day vs resolution ~${resolvedPerDay}/day over ${horizonDays} days`,
    projectedBacklog > openCases ? 'backlog projected to GROW' : 'backlog projected to shrink',
  ]);
}

// Investigation completion forecast: days to clear the current backlog at current throughput.
function completionForecast({ openCases = 0, resolvedPerDay = 18 }) {
  const days = resolvedPerDay > 0 ? Math.ceil(openCases / resolvedPerDay) : Infinity;
  return advisory('completion-forecast', { days, openCases, resolvedPerDay }, resolvedPerDay > 0 ? 0.75 : 0.2, [`${openCases} open ÷ ${resolvedPerDay}/day ≈ ${days} day(s)`]);
}

// Resource / staffing recommendation from a workload forecast vs capacity (advisory).
function resourceRecommendation({ demandMean = 200, capacity = 180, seed = 1 }) {
  const shortage = twin3.staffingShortage({ demandMean, capacity, seed });
  const gap = Math.max(0, Math.ceil((demandMean - capacity) / 20)); // ~20 cases per investigator
  return advisory('staffing', { shortageProbability: shortage.shortageProbability, recommendedAdditionalInvestigators: shortage.shortageProbability >= 0.3 ? gap : 0 }, 0.7, [
    `shortage probability ${shortage.shortageProbability}`,
    shortage.shortageProbability >= 0.3 ? `consider +${gap} investigator(s)` : 'capacity adequate',
    'recommendation is advisory — a human decides staffing',
  ]);
}

// Budget + risk projections (thin wrappers over deterministic forecasts).
function budgetProjection(params) { const b = twin3.budgetForecast(params); return advisory('budget', b, b.withinBudgetP90 ? 0.75 : 0.6, [`P90 cost ${b.cost.p90} vs budget ${b.budget}`, b.withinBudgetP90 ? 'within budget at P90' : 'budget risk at P90']); }
function riskProjection({ base = 100, growthRate = 0.05, months = 12, seed = 1 }) { const t = twin3.incidentTrend({ base, growthRate, months, seed }); return advisory('risk-projection', t.points, 0.6, [`incident volume projected over ${months} months at ~${Math.round(growthRate * 100)}%/mo growth`]); }

module.exports = { advisory, predictiveKpis, completionForecast, resourceRecommendation, budgetProjection, riskProjection };
