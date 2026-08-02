'use strict';
// Site Reliability Engineering (Phase 10, Part 4). Turns the existing SLI/SLO evaluation into
// a reliability practice: service-level objectives per user journey, error budgets with burn
// rate, availability / latency / recovery targets, capacity planning, autoscaling policy
// validation, resource forecasting, and a RELEASE GATE driven by SLO health.
//
// Deterministic: every projection is a pure function of its inputs. The release gate is
// FAIL-CLOSED — an exhausted error budget blocks a release until a named human accepts the
// risk, and accepting it is recorded, not assumed.
const slo = require('./slo');

// Objectives per user journey. The anonymous reporting path carries the strictest targets
// because it is the constitutional guarantee: a citizen must be able to file a report.
const SERVICE_LEVELS = {
  'anonymous-reporting': {
    journey: 'Citizen files an anonymous report', tier: 'constitutional',
    availability: 0.999, latencyMs: 300, latencyTarget: 0.95,
    rtoMinutes: 15, rpoMinutes: 0,
    rationale: 'If this path is down the platform has failed at its purpose; recovery must lose nothing.',
  },
  'case-status': {
    journey: 'Reporter checks status by case code', tier: 'critical',
    availability: 0.995, latencyMs: 300, latencyTarget: 0.95,
    rtoMinutes: 30, rpoMinutes: 5,
    rationale: 'Status is how a reporter retains agency without an account.',
  },
  'investigation': {
    journey: 'Investigator works a case', tier: 'critical',
    availability: 0.995, latencyMs: 500, latencyTarget: 0.95,
    rtoMinutes: 60, rpoMinutes: 5,
    rationale: 'Staff work can queue briefly; evidence integrity may not be traded for speed.',
  },
  'oversight': {
    journey: 'Oversight board reviews aggregate posture', tier: 'important',
    availability: 0.99, latencyMs: 1000, latencyTarget: 0.9,
    rtoMinutes: 240, rpoMinutes: 60,
    rationale: 'Aggregate views tolerate delay; correctness matters more than latency.',
  },
  'governance-decision': {
    journey: 'A named human records a governance decision', tier: 'critical',
    availability: 0.995, latencyMs: 500, latencyTarget: 0.95,
    rtoMinutes: 30, rpoMinutes: 0,
    rationale: 'A recorded decision must never be lost — RPO zero, no exceptions.',
  },
};

// Error budget for one objective over a window. burnRate > 1 means the budget will be gone
// before the window ends at the current rate.
function errorBudget({ objective, attained, windowDays = 30, elapsedDays = 30 }) {
  const budget = +(1 - objective).toFixed(6);
  const consumedFraction = budget > 0 ? Math.max(0, 1 - attained) / budget : (attained >= 1 ? 0 : Infinity);
  const elapsedFraction = windowDays > 0 ? Math.min(1, elapsedDays / windowDays) : 1;
  const burnRate = elapsedFraction > 0 ? +(consumedFraction / elapsedFraction).toFixed(3) : 0;
  const remaining = +Math.max(0, 1 - consumedFraction).toFixed(4);
  return {
    objective, attained: +attained.toFixed(6), budget,
    consumed: +Math.min(consumedFraction, 9.99).toFixed(4), remaining, burnRate,
    exhausted: consumedFraction >= 1,
    severity: consumedFraction >= 1 ? 'exhausted' : burnRate >= 2 ? 'fast-burn' : burnRate > 1 ? 'over-pace' : 'healthy',
  };
}

// Evaluate every service level from measured SLIs: { [service]: { availability, latencyUnder } }.
function evaluate(measurements = {}, { windowDays = 30, elapsedDays = 30 } = {}) {
  const results = Object.entries(SERVICE_LEVELS).map(([id, sl]) => {
    const m = measurements[id];
    if (!m) return { service: id, tier: sl.tier, measured: false, meets: null, note: 'no measurement supplied' };
    const availability = errorBudget({ objective: sl.availability, attained: m.availability ?? 1, windowDays, elapsedDays });
    const latency = errorBudget({ objective: sl.latencyTarget, attained: m.latencyUnder ?? 1, windowDays, elapsedDays });
    const meets = (m.availability ?? 1) >= sl.availability && (m.latencyUnder ?? 1) >= sl.latencyTarget;
    return { service: id, tier: sl.tier, measured: true, meets, availability, latency, targets: { availability: sl.availability, latencyMs: sl.latencyMs, latencyTarget: sl.latencyTarget, rtoMinutes: sl.rtoMinutes, rpoMinutes: sl.rpoMinutes } };
  });
  const breached = results.filter((r) => r.measured && !r.meets);
  return {
    results, breached: breached.map((r) => r.service),
    healthy: breached.length === 0,
    worstBurnRate: Math.max(0, ...results.filter((r) => r.measured).map((r) => Math.max(r.availability.burnRate, r.latency.burnRate))),
  };
}

// Recovery targets are met only when the chosen strategy satisfies BOTH objectives.
function recoveryCompliance({ service, strategyRtoMinutes, strategyRpoMinutes }) {
  const sl = SERVICE_LEVELS[service];
  if (!sl) throw new Error('unknown service level: ' + service);
  const rtoOk = strategyRtoMinutes <= sl.rtoMinutes;
  const rpoOk = strategyRpoMinutes <= sl.rpoMinutes;
  return {
    service, rtoOk, rpoOk, compliant: rtoOk && rpoOk,
    required: { rtoMinutes: sl.rtoMinutes, rpoMinutes: sl.rpoMinutes },
    offered: { rtoMinutes: strategyRtoMinutes, rpoMinutes: strategyRpoMinutes },
    reason: rtoOk && rpoOk ? 'strategy meets both recovery objectives' : `${!rtoOk ? 'RTO' : ''}${!rtoOk && !rpoOk ? ' and ' : ''}${!rpoOk ? 'RPO' : ''} objective not met`,
  };
}

// --- Capacity planning & forecasting -------------------------------------------------------

// Deterministic capacity plan: demand compounds monthly; headroom is reserved for surge.
function capacityPlan({ currentRps = 10, monthlyGrowthPct = 8, months = 12, headroomPct = 40, rpsPerInstance = 25 } = {}) {
  const rows = [];
  let rps = currentRps;
  for (let m = 0; m <= months; m++) {
    const withHeadroom = rps * (1 + headroomPct / 100);
    rows.push({ month: m, projectedRps: +rps.toFixed(2), requiredRpsWithHeadroom: +withHeadroom.toFixed(2), instances: Math.max(1, Math.ceil(withHeadroom / rpsPerInstance)) });
    rps = rps * (1 + monthlyGrowthPct / 100);
  }
  return {
    horizonMonths: months, headroomPct, rpsPerInstance,
    plan: rows, peakInstances: Math.max(...rows.map((r) => r.instances)),
    note: 'Deterministic projection from the stated growth rate. Advisory input to a human capacity decision.',
  };
}

// Resource forecast across several dimensions (compute, storage, events).
function resourceForecast({ months = 12, storageGbNow = 100, storageGrowthPctPerMonth = 6, eventsPerDayNow = 5000, eventGrowthPctPerMonth = 8 } = {}) {
  const compound = (v, pct, m) => +(v * Math.pow(1 + pct / 100, m)).toFixed(2);
  return {
    horizonMonths: months,
    storageGb: Array.from({ length: months + 1 }, (_, m) => ({ month: m, value: compound(storageGbNow, storageGrowthPctPerMonth, m) })),
    eventsPerDay: Array.from({ length: months + 1 }, (_, m) => ({ month: m, value: Math.round(compound(eventsPerDayNow, eventGrowthPctPerMonth, m)) })),
    note: 'Deterministic compound projection; it informs procurement, it does not authorize it.',
  };
}

// Autoscaling policy validation — the checks that stop a policy from being decorative.
function validateAutoscaling(policy = {}) {
  const { minReplicas = 0, maxReplicas = 0, targetCpuPct = 0, scaleUpCooldownS = 0, scaleDownCooldownS = 0 } = policy;
  const violations = [];
  if (minReplicas < 2) violations.push('minReplicas < 2 — no high availability during a node loss');
  if (maxReplicas <= minReplicas) violations.push('maxReplicas must exceed minReplicas — the policy cannot scale');
  if (!(targetCpuPct > 0 && targetCpuPct <= 80)) violations.push('targetCpuPct must be in (0, 80] — above 80% there is no room to react');
  if (scaleDownCooldownS <= scaleUpCooldownS) violations.push('scale-down cooldown must exceed scale-up cooldown, or the policy will flap');
  if (maxReplicas / Math.max(1, minReplicas) < 2) violations.push('the policy provides less than 2× burst headroom');
  return { valid: violations.length === 0, violations, policy: { minReplicas, maxReplicas, targetCpuPct, scaleUpCooldownS, scaleDownCooldownS } };
}
const DEFAULT_AUTOSCALING = { minReplicas: 3, maxReplicas: 12, targetCpuPct: 60, scaleUpCooldownS: 60, scaleDownCooldownS: 300 };

// --- Release gate ------------------------------------------------------------------------------

// A release is gated on SLO health. FAIL-CLOSED: an exhausted or fast-burning error budget
// blocks the release until a NAMED human accepts the risk, and the acceptance is recorded.
function releaseGate({ measurements = {}, windowDays = 30, elapsedDays = 30, riskAcceptedBy = null, riskRationale = null } = {}) {
  const ev = evaluate(measurements, { windowDays, elapsedDays });
  const blockers = [];
  for (const r of ev.results) {
    if (!r.measured) { blockers.push({ service: r.service, reason: 'no reliability measurement — a release cannot be judged blind' }); continue; }
    if (!r.meets) blockers.push({ service: r.service, reason: `SLO breached (availability ${r.availability.attained} / latency ${r.latency.attained})` });
    else if (r.availability.exhausted || r.latency.exhausted) blockers.push({ service: r.service, reason: 'error budget exhausted' });
    else if (r.availability.burnRate >= 2 || r.latency.burnRate >= 2) blockers.push({ service: r.service, reason: `fast burn (${Math.max(r.availability.burnRate, r.latency.burnRate)}×) — spend the budget on reliability, not features` });
  }
  const clean = blockers.length === 0;
  const override = !clean && !!(riskAcceptedBy && riskRationale);
  return {
    allow: clean || override, clean, blockers,
    overridden: override, riskAcceptedBy: override ? riskAcceptedBy : null, riskRationale: override ? riskRationale : null,
    failClosed: true, authorizes: false,
    note: clean
      ? 'Reliability permits a release. It does not authorize one — deployment is a recorded human decision.'
      : override
        ? 'Release proceeds on a RECORDED risk acceptance by a named human authority.'
        : 'Release BLOCKED by reliability. A named human authority may accept the risk, with a rationale.',
  };
}

// --- Reports ---------------------------------------------------------------------------------------

function serviceLevels() { return Object.entries(SERVICE_LEVELS).map(([id, sl]) => ({ id, ...sl })); }

function reliabilityReport({ measurements = {}, windowDays = 30, elapsedDays = 30, autoscaling = DEFAULT_AUTOSCALING, capacity = {}, forecast = {} } = {}) {
  const ev = evaluate(measurements, { windowDays, elapsedDays });
  return {
    serviceLevels: serviceLevels(), evaluation: ev,
    errorBudgets: ev.results.filter((r) => r.measured).map((r) => ({ service: r.service, availability: r.availability, latency: r.latency })),
    availability: ev.results.filter((r) => r.measured).map((r) => ({ service: r.service, attained: r.availability.attained, objective: r.targets.availability, meets: r.meets })),
    autoscaling: validateAutoscaling(autoscaling),
    capacity: capacityPlan(capacity), forecast: resourceForecast(forecast),
    releaseGate: releaseGate({ measurements, windowDays, elapsedDays }),
    informationalOnly: true, authorizes: false,
    note: 'Reliability engineering report. Deterministic and evidence-derived; it never authorizes a deployment.',
  };
}

// Bridge: turn a live SLI snapshot from observability/slo.js into SRE measurements.
function fromSliSnapshot({ total = 0, failed = 0, latencies = [], services = ['anonymous-reporting'] } = {}) {
  const slis = slo.computeSlis({ total, failed, latencies });
  const out = {};
  for (const service of services) {
    const sl = SERVICE_LEVELS[service];
    if (!sl) continue;
    out[service] = { availability: slis.availability, latencyUnder: slis.underThreshold(sl.latencyMs) };
  }
  return out;
}

module.exports = { SERVICE_LEVELS, DEFAULT_AUTOSCALING, serviceLevels, errorBudget, evaluate, recoveryCompliance, capacityPlan, resourceForecast, validateAutoscaling, releaseGate, reliabilityReport, fromSliSnapshot };
