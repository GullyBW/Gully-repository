'use strict';
// Digital Engineering Twin 3.0 (Phase 29). DETERMINISTIC Monte-Carlo simulation (seeded
// PRNG → reproducible replay) plus predictive OPERATIONAL what-if models: investigator
// workload, staffing shortages, budget constraints, incident trends, and a predictive
// readiness score. These INFORM human planning; they authorize nothing.
const { rng } = require('../twin');

// Core Monte-Carlo runner: draws `trials` samples from `sample(rand)` and summarises.
// Deterministic: the same seed yields the same distribution (replay).
function monteCarlo({ trials = 1000, seed = 1, sample }) {
  const rand = rng.mulberry32(seed);
  const xs = [];
  for (let i = 0; i < trials; i++) xs.push(sample(rand));
  xs.sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const pct = (p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return { trials, mean: +mean.toFixed(2), p50: +pct(0.5).toFixed(2), p90: +pct(0.9).toFixed(2), p95: +pct(0.95).toFixed(2), min: +xs[0].toFixed(2), max: +xs[xs.length - 1].toFixed(2) };
}

// Triangular sample (min, mode, max) — a transparent, dependency-free distribution.
function triangular(rand, min, mode, max) {
  const u = rand(); const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

// Investigator workload forecast: distribution of cases-per-investigator over a horizon.
function workloadForecast({ arrivalPerDay = 20, days = 30, investigators = 10, seed = 1 } = {}) {
  const dist = monteCarlo({ trials: 1000, seed, sample: (r) => triangular(r, arrivalPerDay * 0.7, arrivalPerDay, arrivalPerDay * 1.4) * days / investigators });
  return { model: 'workload', horizonDays: days, investigators, perInvestigator: dist, note: 'Advisory forecast; deterministic replay for a given seed.' };
}

// Staffing shortage: probability that demand exceeds capacity.
function staffingShortage({ demandMean = 200, capacity = 180, seed = 1 } = {}) {
  const rand = rng.mulberry32(seed); let short = 0; const trials = 1000;
  for (let i = 0; i < trials; i++) if (triangular(rand, demandMean * 0.8, demandMean, demandMean * 1.3) > capacity) short++;
  return { model: 'staffing', capacity, shortageProbability: +(short / trials).toFixed(3), note: 'Advisory; informs staffing decisions (human).' };
}

// Budget constraint: distribution of cost vs a cap.
function budgetForecast({ perCaseCost = 500, casesMean = 300, budget = 180000, seed = 1 } = {}) {
  const dist = monteCarlo({ trials: 1000, seed, sample: (r) => triangular(r, casesMean * 0.8, casesMean, casesMean * 1.3) * perCaseCost });
  return { model: 'budget', budget, cost: dist, withinBudgetP90: dist.p90 <= budget, note: 'Advisory forecast.' };
}

// National incident trend: projected incident volume with growth + variance.
function incidentTrend({ base = 100, growthRate = 0.05, months = 12, seed = 1 } = {}) {
  const points = [];
  const rand = rng.mulberry32(seed);
  let level = base;
  for (let m = 1; m <= months; m++) { level = level * (1 + growthRate) * (0.9 + 0.2 * rand()); points.push({ month: m, projected: Math.round(level) }); }
  return { model: 'incident-trend', months, points, note: 'Advisory projection; deterministic per seed.' };
}

// What-if: run a model across parameter scenarios and compare.
function whatIf(model, scenarios) {
  return scenarios.map((s) => ({ scenario: s.name || JSON.stringify(s.params), result: model(s.params) }));
}

// Predictive readiness score: blends current fitness pass-rate with a simulated failure risk.
// NEVER an authorization — a transparent, human-gated advisory signal.
function predictiveReadiness({ fitnessPassRate = 1, failureRisk = 0 }) {
  const score = +Math.max(0, Math.min(1, fitnessPassRate * (1 - failureRisk))).toFixed(3);
  return { score, band: score >= 0.95 ? 'ready-candidate' : score >= 0.8 ? 'improving' : 'not-ready', humanGate: true, note: 'Predictive advisory only — deployment approval remains a human governance decision.' };
}

module.exports = { monteCarlo, triangular, workloadForecast, staffingShortage, budgetForecast, incidentTrend, whatIf, predictiveReadiness };
