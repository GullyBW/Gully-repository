'use strict';
// Digital Engineering Twin 4.0 (Phase 44). STRATEGIC national simulations that let leadership
// reason about system-of-systems changes WITHOUT touching production. Deterministic what-if
// models over declared inputs (reproducible replay). Every output is ADVISORY and human-gated
// — it informs national planning; it authorizes nothing.
const twin3 = require('./monte-carlo');

const DAY = 24 * 3600_000;

// National policy change: project caseload + capacity impact of a policy that shifts intake.
function nationalPolicyChange({ baseCaseloadPerDay = 100, intakeDeltaPct = 0, capacityPerDay = 110, horizonDays = 90 }) {
  const newIntake = baseCaseloadPerDay * (1 + intakeDeltaPct / 100);
  const backlogDelta = Math.round((newIntake - capacityPerDay) * horizonDays);
  return advisory('national-policy-change', { newIntake: +newIntake.toFixed(1), capacityPerDay, projectedBacklogDelta: backlogDelta, coping: newIntake <= capacityPerDay }, ['intake vs capacity over the horizon']);
}

// Budget reduction: translate a % cut into capacity + backlog impact.
function budgetReduction({ currentBudget = 200000, reductionPct = 10, perCaseCost = 500, intakePerDay = 100, horizonDays = 90 }) {
  const newBudget = currentBudget * (1 - reductionPct / 100);
  const casesFundable = Math.floor(newBudget / perCaseCost);
  const capacityPerDay = casesFundable / horizonDays;
  const backlogDelta = Math.round((intakePerDay - capacityPerDay) * horizonDays);
  return advisory('budget-reduction', { newBudget, casesFundable, capacityPerDay: +capacityPerDay.toFixed(1), projectedBacklogDelta: backlogDelta, sustainable: capacityPerDay >= intakePerDay }, [`${reductionPct}% cut → ${casesFundable} fundable cases over ${horizonDays} days`]);
}

// Agency restructuring: redistribute workload when agencies merge (deterministic split).
function agencyRestructuring({ agencyLoads = {}, merges = [] }) {
  const loads = { ...agencyLoads };
  for (const { from, into } of merges) { if (from in loads) { loads[into] = (loads[into] || 0) + loads[from]; delete loads[from]; } }
  const max = Math.max(0, ...Object.values(loads));
  return advisory('agency-restructuring', { redistributedLoads: loads, peakLoad: max }, ['loads redistributed by the declared merges']);
}

// Workforce shortage (delegates to the deterministic staffing model).
function workforceShortage(params) { const s = twin3.staffingShortage(params); return advisory('workforce-shortage', s, [`shortage probability ${s.shortageProbability}`]); }

// Legislative reform: new mandate adds categories/volume; project capacity gap.
function legislativeReform({ addedVolumePerDay = 20, capacityPerDay = 110, currentIntakePerDay = 100 }) {
  const newIntake = currentIntakePerDay + addedVolumePerDay;
  const additionalInvestigators = Math.max(0, Math.ceil((newIntake - capacityPerDay) / 20));
  return advisory('legislative-reform', { newIntake, capacityGapPerDay: Math.max(0, newIntake - capacityPerDay), recommendedAdditionalInvestigators: additionalInvestigators }, ['reform intake vs capacity']);
}

// Emergency response: can the system absorb a temporary surge?
function emergencyResponse({ surgeMultiplier = 3, baseIntakePerDay = 100, capacityPerDay = 110, headroomPct = 30 }) {
  const surge = baseIntakePerDay * surgeMultiplier;
  const effectiveCapacity = capacityPerDay * (1 + headroomPct / 100);
  return advisory('emergency-response', { surge, effectiveCapacity: +effectiveCapacity.toFixed(1), absorbed: surge <= effectiveCapacity, overflowPerDay: Math.max(0, Math.round(surge - effectiveCapacity)) }, [`surge ${surge}/day vs effective capacity`]);
}

// Long-term capacity planning: year-by-year backlog projection under growth.
function longTermCapacity({ years = 5, intakePerYear = 36500, growthRate = 0.05, capacityPerYear = 40000 }) {
  const points = []; let intake = intakePerYear; let backlog = 0;
  for (let y = 1; y <= years; y++) { intake = intake * (1 + growthRate); backlog = Math.max(0, backlog + Math.round(intake - capacityPerYear)); points.push({ year: y, intake: Math.round(intake), backlog }); }
  return advisory('long-term-capacity', { points, endBacklog: points[points.length - 1].backlog }, [`${years}-year projection at ${Math.round(growthRate * 100)}%/yr growth`]);
}

// National digital transformation: digital-channel adoption curve (logistic-ish, deterministic).
function nationalTransformation({ years = 5, startAdoption = 0.2, ceiling = 0.95, rate = 0.4 }) {
  const points = []; let a = startAdoption;
  for (let y = 1; y <= years; y++) { a = a + rate * a * (1 - a / ceiling); points.push({ year: y, adoption: +Math.min(ceiling, a).toFixed(3) }); }
  return advisory('national-transformation', { points, endAdoption: points[points.length - 1].adoption }, ['deterministic adoption curve']);
}

function advisory(kind, result, explanation) { return { kind, result, explanation, advisoryOnly: true, autonomous: false, humanGate: true, note: 'Strategic simulation — informs national planning; never authorizes.' }; }

module.exports = { nationalPolicyChange, budgetReduction, agencyRestructuring, workforceShortage, legislativeReform, emergencyResponse, longTermCapacity, nationalTransformation };
