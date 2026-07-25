'use strict';
// National Strategic Digital Twin 5.0 (Phase 70). Extends the Twin into LONG-TERM STRATEGIC
// simulation across national dimensions: demographic change, economic development,
// infrastructure investment, digital inclusion, climate resilience, workforce evolution,
// technology adoption, national modernization, cross-sector dependency, and strategic policy
// scenarios. Every projection is DETERMINISTIC, EXPLAINABLE, carries a CONFIDENCE metric and
// TRACKED ASSUMPTIONS. The Strategic Twin INFORMS decision-makers; it NEVER authorizes a
// policy or operational decision.

function projection(kind, points, { assumptions = [], confidence = 0.6 } = {}) {
  return { kind, points, assumptions, confidence: +Math.max(0, Math.min(1, confidence)).toFixed(2), explainable: true, informationalOnly: true, authorizes: false, note: 'Strategic projection — informs decision-makers; never authorizes policy or operations.' };
}

// A deterministic compounding projection over `years`.
function series(base, rate, years, cap) {
  const out = []; let v = base;
  for (let y = 1; y <= years; y++) { v = v * (1 + rate); if (cap != null) v = Math.min(cap, v); out.push({ year: y, value: +v.toFixed(2) }); }
  return out;
}

function demographicChange({ population = 2_600_000, growthRate = 0.018, years = 20 } = {}) {
  return projection('demographic', series(population, growthRate, years), { assumptions: [`growth ${(growthRate * 100).toFixed(1)}%/yr`], confidence: 0.7 });
}
function economicDevelopment({ gdpIndex = 100, growthRate = 0.03, years = 20 } = {}) {
  return projection('economic', series(gdpIndex, growthRate, years), { assumptions: [`GDP growth ${(growthRate * 100).toFixed(1)}%/yr`], confidence: 0.55 });
}
function infrastructureInvestment({ capacityIndex = 100, investmentRate = 0.05, years = 20 } = {}) {
  return projection('infrastructure', series(capacityIndex, investmentRate, years), { assumptions: [`investment-driven capacity +${(investmentRate * 100).toFixed(1)}%/yr`], confidence: 0.6 });
}
function digitalInclusion({ adoption = 0.55, rate = 0.06, years = 20, ceiling = 0.98 } = {}) {
  const out = []; let a = adoption; for (let y = 1; y <= years; y++) { a = a + rate * a * (1 - a / ceiling); out.push({ year: y, value: +Math.min(ceiling, a).toFixed(3) }); }
  return projection('digital-inclusion', out, { assumptions: ['logistic adoption toward ceiling ' + ceiling], confidence: 0.6 });
}
function climateResilience({ resilienceIndex = 70, adaptationRate = 0.02, years = 20 } = {}) {
  return projection('climate-resilience', series(resilienceIndex, adaptationRate, years, 100), { assumptions: [`adaptation +${(adaptationRate * 100).toFixed(1)}%/yr`], confidence: 0.5 });
}
function workforceEvolution({ digitalSkillsPct = 0.4, rate = 0.05, years = 20, ceiling = 0.95 } = {}) {
  const out = []; let s = digitalSkillsPct; for (let y = 1; y <= years; y++) { s = Math.min(ceiling, s + rate * (1 - s)); out.push({ year: y, value: +s.toFixed(3) }); }
  return projection('workforce', out, { assumptions: ['skills uplift toward ceiling ' + ceiling], confidence: 0.55 });
}
function technologyAdoption({ adoption = 0.3, rate = 0.4, years = 15, ceiling = 0.95 } = {}) {
  const out = []; let a = adoption; for (let y = 1; y <= years; y++) { a = a + rate * a * (1 - a / ceiling); out.push({ year: y, value: +Math.min(ceiling, a).toFixed(3) }); }
  return projection('technology-adoption', out, { assumptions: ['logistic diffusion'], confidence: 0.6 });
}

// Cross-sector dependency analysis: propagate a shock through a declared dependency map.
function crossSectorDependency({ sectors = {}, shockedSector }) {
  const impacted = new Set(); const stack = [shockedSector];
  while (stack.length) { const s = stack.pop(); for (const [sector, deps] of Object.entries(sectors)) if ((deps || []).includes(s) && !impacted.has(sector)) { impacted.add(sector); stack.push(sector); } }
  return { shockedSector, impactedSectors: [...impacted].sort(), informationalOnly: true, note: 'Cross-sector impact analysis; advisory.' };
}

// Strategic policy scenario comparison — compare projections under different assumptions.
function compareScenarios(model, scenarios) { return scenarios.map((sc) => ({ name: sc.name, projection: model(sc.params) })); }

// Executive advisory report — a bundle of key strategic projections (informational).
function executiveReport(opts = {}) {
  return {
    demographic: demographicChange(opts.demographic),
    economic: economicDevelopment(opts.economic),
    digitalInclusion: digitalInclusion(opts.digitalInclusion),
    workforce: workforceEvolution(opts.workforce),
    informationalOnly: true,
    note: 'Strategic Twin 5.0 executive report — informs decision-makers; never authorizes policy or operations.',
  };
}

module.exports = { demographicChange, economicDevelopment, infrastructureInvestment, digitalInclusion, climateResilience, workforceEvolution, technologyAdoption, crossSectorDependency, compareScenarios, executiveReport };
