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

// --- Multi-window burn-rate alerting (Phase 11, Part 4) ----------------------------------------
// Google SRE multi-window, multi-burn-rate alerting. A single-window alert is either too slow
// (misses a fast outage) or too noisy (fires on a blip). Each severity pairs a LONG window that
// establishes the trend with a SHORT window that proves the burn is still happening RIGHT NOW.
// Both must be burning, or the alert does not fire — that is the whole point of the pair.
const BURN_ALERTS = [
  { id: 'fast-burn', longWindowHours: 1, shortWindowMinutes: 5, burnRate: 14.4, budgetConsumedPct: 2, severity: 'page', domain: 'reliability',
    meaning: 'At this rate a 30-day budget is gone in ~2 days. Wake a human.' },
  { id: 'medium-burn', longWindowHours: 6, shortWindowMinutes: 30, burnRate: 6, budgetConsumedPct: 5, severity: 'page', domain: 'reliability',
    meaning: 'A 30-day budget is gone in ~5 days. Wake a human, less urgently.' },
  { id: 'slow-burn', longWindowHours: 72, shortWindowMinutes: 360, burnRate: 1, budgetConsumedPct: 10, severity: 'ticket', domain: 'reliability',
    meaning: 'The budget will be spent exactly on schedule — no slack left for an incident. Ticket it.' },
];

// Fire an alert only when BOTH windows are burning above the threshold.
function burnRateAlerts({ service, objective, longWindowAttained = {}, shortWindowAttained = {} } = {}) {
  const sl = SERVICE_LEVELS[service];
  const target = objective ?? (sl ? sl.availability : null);
  if (target === null || target === undefined) throw new Error('burnRateAlerts: unknown service and no objective given: ' + service);
  const budget = 1 - target;
  const rateOf = (attained) => (budget > 0 ? +(Math.max(0, 1 - attained) / budget).toFixed(3) : 0);
  const fired = [];
  for (const a of BURN_ALERTS) {
    const longAttained = longWindowAttained[a.id];
    const shortAttained = shortWindowAttained[a.id];
    if (longAttained === undefined || shortAttained === undefined) continue;
    const longRate = rateOf(longAttained);
    const shortRate = rateOf(shortAttained);
    const longBurning = longRate >= a.burnRate;
    const shortBurning = shortRate >= a.burnRate;
    fired.push({
      alert: a.id, severity: a.severity, domain: a.domain, threshold: a.burnRate,
      longWindowHours: a.longWindowHours, shortWindowMinutes: a.shortWindowMinutes,
      longRate, shortRate, longBurning, shortBurning,
      firing: longBurning && shortBurning,
      suppressed: longBurning && !shortBurning,
      reason: longBurning && shortBurning
        ? `both windows burning at ≥${a.burnRate}× — ${a.meaning}`
        : longBurning
          ? 'long window is burning but the short window has recovered — the incident is over, no page'
          : 'burn rate below threshold',
    });
  }
  const firing = fired.filter((f) => f.firing);
  return {
    service, objective: target, budget: +budget.toFixed(6), alerts: fired,
    firing: firing.map((f) => f.alert),
    page: firing.some((f) => f.severity === 'page'),
    worst: firing.length ? firing.reduce((w, f) => (f.threshold > w.threshold ? f : w)).alert : null,
    note: 'Multi-window burn-rate alerting. A long window alone never pages — a recovered incident must stop paging.',
  };
}

// --- Trend analysis & forecasting ---------------------------------------------------------------

// Deterministic least-squares fit over evenly spaced observations. No randomness, no smoothing
// parameters to tune — the same history always yields the same line.
function trend(values = []) {
  const n = values.length;
  if (n < 2) return { n, slope: 0, intercept: n ? values[0] : 0, direction: 'insufficient-data', r2: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = i - meanX, dy = values[i] - meanY; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));
  return {
    n, slope: +slope.toFixed(8), intercept: +intercept.toFixed(8), mean: +meanY.toFixed(8), r2: +r2.toFixed(4),
    direction: Math.abs(slope) < 1e-9 ? 'flat' : slope > 0 ? 'improving' : 'degrading',
  };
}

// Project attainment forward and say WHEN the objective is expected to be breached.
function reliabilityForecast({ service, objective, history = [], periodsAhead = 6 } = {}) {
  const sl = SERVICE_LEVELS[service];
  const target = objective ?? (sl ? sl.availability : null);
  if (target === null || target === undefined) throw new Error('reliabilityForecast: unknown service and no objective given: ' + service);
  const t = trend(history);
  const projected = Array.from({ length: periodsAhead }, (_, k) => {
    const x = history.length + k;
    const value = Math.max(0, Math.min(1, t.intercept + t.slope * x));
    return { period: x, projected: +value.toFixed(6), meetsObjective: value >= target };
  });
  const firstBreach = projected.find((p) => !p.meetsObjective) || null;
  const currentlyMeets = history.length ? history[history.length - 1] >= target : null;
  return {
    service: service ?? null, objective: target, history: history.map((v) => +v.toFixed(6)),
    trend: t, projected,
    breachExpected: !!firstBreach,
    periodsToBreach: firstBreach ? firstBreach.period - (history.length - 1) : null,
    currentlyMeets,
    confidence: t.r2 >= 0.75 ? 'high' : t.r2 >= 0.4 ? 'moderate' : 'low',
    note: 'Linear projection of measured attainment. A forecast is an early warning, not a measurement — act on it, do not report it as fact.',
    authorizes: false,
  };
}

// Recovery forecasting: restore time grows with data volume while the RTO does not move.
// This is the projection that tells you when your backup strategy stops meeting its objective.
function recoveryForecast({ service = 'investigation', restoreMinutesPerGb = 0.5, dataGbNow = 100, monthlyGrowthPct = 6, months = 24 } = {}) {
  const sl = SERVICE_LEVELS[service];
  if (!sl) throw new Error('unknown service level: ' + service);
  const rows = [];
  for (let m = 0; m <= months; m++) {
    const gb = dataGbNow * Math.pow(1 + monthlyGrowthPct / 100, m);
    const restoreMinutes = +(gb * restoreMinutesPerGb).toFixed(2);
    rows.push({ month: m, dataGb: +gb.toFixed(2), restoreMinutes, meetsRto: restoreMinutes <= sl.rtoMinutes });
  }
  const breach = rows.find((r) => !r.meetsRto) || null;
  return {
    service, rtoMinutes: sl.rtoMinutes, restoreMinutesPerGb, projection: rows,
    breachExpected: !!breach, breachAtMonth: breach ? breach.month : null,
    currentRestoreMinutes: rows[0].restoreMinutes, currentlyMeetsRto: rows[0].meetsRto,
    remedy: breach
      ? 'Restore time scales with volume; the objective does not. Parallelise restore, shard the dataset, or renegotiate the RTO — before month ' + breach.month + '.'
      : 'Restore stays within RTO across the whole horizon.',
    authorizes: false,
  };
}

// --- Service dependency risk --------------------------------------------------------------------

// Risk score per service, derived entirely from the declared topology: how much breaks when it
// fails (blast radius), whether it is a single point of failure on the constitutional path, its
// own criticality, and how many services depend on it. Nothing here is hand-entered.
const CRITICALITY_WEIGHT = { constitutional: 4, critical: 3, important: 2, supporting: 1 };
function dependencyRisk({ topology = require('./telemetry') } = {}) {
  const services = Object.keys(topology.TOPOLOGY);
  const total = services.length;
  const scored = services.map((s) => {
    const meta = topology.TOPOLOGY[s];
    const prop = topology.failurePropagation([s]);
    const dependents = services.filter((o) => o !== s && topology.TOPOLOGY[o].dependsOn.includes(s)).length;
    const blastFraction = total > 0 ? prop.blastRadius / total : 0;
    const weight = CRITICALITY_WEIGHT[meta.criticality] ?? 1;
    // 0..100, deterministic: 45% blast radius, 30% criticality, 15% fan-in, 10% SPOF.
    const score = +(
      45 * blastFraction +
      30 * (weight / 4) +
      15 * Math.min(1, dependents / 4) +
      10 * (prop.criticalPathBroken ? 1 : 0)
    ).toFixed(2);
    return {
      service: s, zone: meta.zone, criticality: meta.criticality,
      blastRadius: prop.blastRadius, blastFraction: +blastFraction.toFixed(4),
      dependents, singlePointOfFailure: prop.criticalPathBroken,
      degradedByLoss: prop.degraded.length,
      score, band: score >= 70 ? 'severe' : score >= 50 ? 'high' : score >= 30 ? 'moderate' : 'low',
    };
  }).sort((a, b) => b.score - a.score || a.service.localeCompare(b.service));
  return {
    services: scored,
    highest: scored[0] ? scored[0].service : null,
    severe: scored.filter((r) => r.band === 'severe').map((r) => r.service),
    singlePointsOfFailure: scored.filter((r) => r.singlePointOfFailure).map((r) => r.service),
    note: 'Risk derived from the declared topology, not opinion. A severe band means: invest in redundancy here first.',
    authorizes: false,
  };
}

// --- SLO compliance history ---------------------------------------------------------------------

// Append-only compliance history per service and period. Recording is deterministic and idempotent
// per (service, period) — a re-recorded period replaces nothing, it is refused.
class SloComplianceHistory {
  constructor() { this._byService = new Map(); }
  record({ service, period, availability, latencyUnder = null }) {
    if (!SERVICE_LEVELS[service]) throw new Error('unknown service level: ' + service);
    if (!Number.isInteger(period) || period < 0) throw new Error('period must be a non-negative integer');
    const rows = this._byService.get(service) || [];
    if (rows.some((r) => r.period === period)) throw new Error(`period ${period} already recorded for ${service} — history is append-only`);
    const sl = SERVICE_LEVELS[service];
    const row = {
      period, availability: +availability.toFixed(6),
      latencyUnder: latencyUnder === null ? null : +latencyUnder.toFixed(6),
      meetsAvailability: availability >= sl.availability,
      meetsLatency: latencyUnder === null ? null : latencyUnder >= sl.latencyTarget,
    };
    row.compliant = row.meetsAvailability && (row.meetsLatency === null || row.meetsLatency);
    rows.push(row);
    rows.sort((a, b) => a.period - b.period);
    this._byService.set(service, rows);
    return row;
  }
  history(service) { return (this._byService.get(service) || []).map((r) => ({ ...r })); }
  compliance(service) {
    const rows = this.history(service);
    if (!rows.length) return { service, periods: 0, compliantPeriods: 0, complianceRate: null, trend: trend([]), note: 'no history recorded' };
    const compliant = rows.filter((r) => r.compliant).length;
    return {
      service, periods: rows.length, compliantPeriods: compliant,
      complianceRate: +(compliant / rows.length).toFixed(4),
      trend: trend(rows.map((r) => r.availability)),
      consecutiveBreaches: (() => { let n = 0; for (let i = rows.length - 1; i >= 0 && !rows[i].compliant; i--) n++; return n; })(),
      history: rows,
    };
  }
  all() { return [...this._byService.keys()].sort().map((s) => this.compliance(s)); }
}

// --- Reliability scorecard & release readiness ---------------------------------------------------

const SCORECARD_GRADES = [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F']];
function gradeOf(score) { return (SCORECARD_GRADES.find(([floor]) => score >= floor) || [0, 'F'])[1]; }

// A per-service reliability scorecard: attainment, budget remaining, burn, compliance history and
// trend, reduced to a grade. Every input is measured; nothing is entered by hand.
function scorecard({ measurements = {}, history = null, windowDays = 30, elapsedDays = 30 } = {}) {
  const ev = evaluate(measurements, { windowDays, elapsedDays });
  const cards = ev.results.map((r) => {
    if (!r.measured) {
      return { service: r.service, tier: r.tier, measured: false, score: 0, grade: 'F', reasons: ['no measurement — an unmeasured service is not a reliable one'] };
    }
    const reasons = [];
    // 50 pts objective attainment, 30 pts budget remaining, 20 pts compliance history.
    let score = 0;
    if (r.meets) score += 50; else reasons.push(`SLO breached (availability ${r.availability.attained}, latency ${r.latency.attained})`);
    const remaining = Math.min(r.availability.remaining, r.latency.remaining);
    score += 30 * remaining;
    if (remaining < 0.25) reasons.push(`only ${(remaining * 100).toFixed(1)}% of the error budget remains`);
    const compliance = history ? history.compliance(r.service) : null;
    if (compliance && compliance.periods > 0) {
      score += 20 * compliance.complianceRate;
      if (compliance.trend.direction === 'degrading') reasons.push('availability trend is degrading');
      if (compliance.consecutiveBreaches >= 2) reasons.push(`${compliance.consecutiveBreaches} consecutive periods breached`);
    } else {
      reasons.push('no SLO compliance history — trend cannot be assessed');
    }
    const final = +score.toFixed(2);
    return {
      service: r.service, tier: r.tier, measured: true, score: final, grade: gradeOf(final),
      attainedAvailability: r.availability.attained, budgetRemaining: +remaining.toFixed(4),
      worstBurnRate: Math.max(r.availability.burnRate, r.latency.burnRate),
      complianceRate: compliance ? compliance.complianceRate : null,
      trend: compliance ? compliance.trend.direction : 'unknown',
      reasons,
    };
  });
  const measured = cards.filter((c) => c.measured);
  const overall = cards.length ? +(cards.reduce((a, c) => a + c.score, 0) / cards.length).toFixed(2) : 0;
  return {
    services: cards, overallScore: overall, overallGrade: gradeOf(overall),
    measuredServices: measured.length, totalServices: cards.length,
    worst: cards.length ? cards.reduce((w, c) => (c.score < w.score ? c : w)).service : null,
    informationalOnly: true, authorizes: false,
    note: 'Reliability scorecard derived from measured SLIs and recorded history. A grade is evidence, not permission.',
  };
}

// Release readiness combines the error-budget gate with burn-rate alerting and compliance trend,
// and stays FAIL-CLOSED: no measurement, no release.
// --- Predictive operations (Phase 12, Part 4) ----------------------------------------------------
//
// Phase 11 forecast reliability. This forecasts the operational conditions that CAUSE reliability
// to fail — and does it in the same shape every time, so a dashboard can render them together and
// an operator can compare "how long have I got?" across six unrelated things.
//
// Every predictor returns: current value, the threshold it is heading for, the projected time to
// reach it, and a lead-time band. `null` when it cannot be projected — a prediction you cannot
// make is reported as absent, never as "fine".
const LEAD_TIME_BANDS = [
  { withinDays: 7, urgency: 'imminent', action: 'act this week; there is no slack left' },
  { withinDays: 30, urgency: 'near-term', action: 'schedule the work into the next maintenance window' },
  { withinDays: 90, urgency: 'planned', action: 'put it in the quarterly plan' },
  { withinDays: Infinity, urgency: 'distant', action: 'monitor at the review cadence' },
];
function leadTime(days) {
  if (days === null || days === undefined) return { urgency: 'unknown', action: 'the projection could not be made — measure before deciding' };
  if (days < 0) return { urgency: 'breached', action: 'the threshold has already been crossed' };
  const b = LEAD_TIME_BANDS.find((x) => days <= x.withinDays);
  return { urgency: b.urgency, action: b.action };
}
// Compound growth: days until `current` reaches `threshold` at `growthPctPerMonth`.
function daysUntil({ current, threshold, growthPctPerMonth }) {
  if (!(current > 0) || !(threshold > 0)) return null;
  if (current >= threshold) return -1;
  if (!(growthPctPerMonth > 0)) return null;               // not growing → never reached
  const months = Math.log(threshold / current) / Math.log(1 + growthPctPerMonth / 100);
  return Math.floor(months * 30);
}
function prediction({ id, title, current, threshold, unit, days, detail }) {
  const lt = leadTime(days);
  return {
    predictor: id, title, current, threshold, unit,
    daysUntilThreshold: days, projectedAt: days === null ? null : days,
    urgency: lt.urgency, recommendedAction: lt.action, detail,
    predicted: days !== null,
  };
}

// Storage exhaustion — the classic one nobody sees coming because the graph is linear until it is
// not, and because retention is what actually determines the ceiling.
function predictStorageExhaustion({ usedGb = null, capacityGb = null, growthPctPerMonth = null, warnAtPct = 85 } = {}) {
  if (usedGb === null || capacityGb === null) {
    return prediction({ id: 'storage-exhaustion', title: 'Storage exhaustion', current: usedGb, threshold: capacityGb, unit: 'GB', days: null, detail: 'storage usage or capacity is not measured' });
  }
  const warnAt = capacityGb * (warnAtPct / 100);
  const days = daysUntil({ current: usedGb, threshold: warnAt, growthPctPerMonth });
  return prediction({
    id: 'storage-exhaustion', title: 'Storage exhaustion', current: usedGb, threshold: +warnAt.toFixed(2), unit: 'GB', days,
    detail: growthPctPerMonth ? `${usedGb}GB of ${capacityGb}GB, growing ${growthPctPerMonth}%/month; the alarm is at ${warnAtPct}% of capacity, not 100% — the time you need is before it is full` : 'no growth rate measured',
  });
}

// Certificate expiry. Not a forecast so much as arithmetic nobody does until the outage.
function predictCertificateExpiry({ certificates = [], now = 0, renewWithinDays = 30 } = {}) {
  const rows = certificates.map((c) => {
    const days = c.notAfter === undefined || c.notAfter === null ? null : Math.floor((c.notAfter - now) / (24 * 3600_000));
    const lt = leadTime(days);
    return { subject: c.subject ?? c.serial ?? 'unnamed', serial: c.serial ?? null, daysUntilExpiry: days, urgency: lt.urgency, renewDue: days !== null && days <= renewWithinDays, expired: days !== null && days < 0 };
  }).sort((a, b) => (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity));
  const soonest = rows.length ? rows[0] : null;
  return {
    ...prediction({
      id: 'certificate-expiry', title: 'Certificate expiry', current: rows.length, threshold: renewWithinDays, unit: 'certificates',
      days: soonest ? soonest.daysUntilExpiry : null,
      detail: soonest ? `${soonest.subject} expires in ${soonest.daysUntilExpiry} day(s)` : 'no certificates supplied',
    }),
    certificates: rows, expiring: rows.filter((r) => r.renewDue).map((r) => r.subject), expired: rows.filter((r) => r.expired).map((r) => r.subject),
  };
}

// Resource utilization and capacity growth against the autoscaling ceiling.
function predictCapacity({ currentRps = null, rpsPerInstance = 25, maxReplicas = 12, monthlyGrowthPct = null, headroomPct = 40 } = {}) {
  if (currentRps === null || monthlyGrowthPct === null) {
    return prediction({ id: 'capacity-ceiling', title: 'Capacity ceiling', current: currentRps, threshold: null, unit: 'rps', days: null, detail: 'current demand or its growth rate is not measured' });
  }
  const ceiling = maxReplicas * rpsPerInstance / (1 + headroomPct / 100);
  const days = daysUntil({ current: currentRps, threshold: ceiling, growthPctPerMonth: monthlyGrowthPct });
  return prediction({
    id: 'capacity-ceiling', title: 'Capacity ceiling', current: currentRps, threshold: +ceiling.toFixed(2), unit: 'rps', days,
    detail: `${maxReplicas} replicas × ${rpsPerInstance} rps, less ${headroomPct}% reserved headroom — the ceiling is where surge capacity runs out, not where the service stops`,
  });
}

// Queue saturation. Little's law: a queue whose arrival rate exceeds its service rate has no
// steady state, and reporting its current depth tells you nothing about that.
function predictQueueSaturation({ depth = null, arrivalRate = null, serviceRate = null, maxDepth = 10_000 } = {}) {
  if (depth === null || arrivalRate === null || serviceRate === null) {
    return prediction({ id: 'queue-saturation', title: 'Queue saturation', current: depth, threshold: maxDepth, unit: 'messages', days: null, detail: 'queue depth, arrival rate or service rate is not measured' });
  }
  const net = arrivalRate - serviceRate;              // messages per second accumulating
  const utilization = serviceRate > 0 ? +(arrivalRate / serviceRate).toFixed(4) : Infinity;
  let days = null;
  if (net > 0) days = Math.floor((maxDepth - depth) / (net * 86_400));
  else if (depth >= maxDepth) days = -1;
  return {
    ...prediction({
      id: 'queue-saturation', title: 'Queue saturation', current: depth, threshold: maxDepth, unit: 'messages', days,
      detail: net > 0
        ? `arrivals exceed service by ${net}/s — the queue has no steady state and its current depth says nothing about that`
        : `service keeps up (utilization ${utilization}); the queue drains`,
    }),
    utilization, netAccumulation: net, stable: net <= 0,
  };
}

// Dependency degradation: a dependency whose latency is trending upward will breach its budget,
// and the useful question is when — not whether it is over the line right now.
function predictDependencyDegradation({ service = null, latencyHistory = [], budgetMs = 500, periodDays = 1 } = {}) {
  const t = trend(latencyHistory);
  if (t.direction === 'insufficient-data') {
    return prediction({ id: 'dependency-degradation', title: 'Dependency degradation', current: null, threshold: budgetMs, unit: 'ms', days: null, detail: `${service ?? 'dependency'}: fewer than two latency observations` });
  }
  const latest = latencyHistory[latencyHistory.length - 1];
  let days = null;
  if (latest >= budgetMs) days = -1;
  else if (t.slope > 0) days = Math.floor(((budgetMs - latest) / t.slope) * periodDays);
  return {
    ...prediction({
      id: 'dependency-degradation', title: 'Dependency degradation', current: latest, threshold: budgetMs, unit: 'ms', days,
      detail: `${service ?? 'dependency'}: p95 ${latest}ms against a ${budgetMs}ms budget, ${t.direction} at ${t.slope.toFixed(3)}ms/period`,
    }),
    service, trend: t, confidence: t.r2 >= 0.75 ? 'high' : t.r2 >= 0.4 ? 'moderate' : 'low',
  };
}

// SLO burn-rate prediction: at the current burn, when is the error budget gone?
function predictBudgetExhaustion({ service, objective = null, attained = null, windowDays = 30, elapsedDays = 1 } = {}) {
  const sl = SERVICE_LEVELS[service];
  const target = objective ?? (sl ? sl.availability : null);
  if (target === null || attained === null) {
    return prediction({ id: 'budget-exhaustion', title: 'Error budget exhaustion', current: attained, threshold: target, unit: 'attainment', days: null, detail: `${service ?? 'service'}: attainment or objective not measured` });
  }
  const eb = errorBudget({ objective: target, attained, windowDays, elapsedDays });
  let days = null;
  if (eb.exhausted) days = -1;
  else if (eb.burnRate > 0 && elapsedDays > 0) {
    const perDay = eb.consumed / elapsedDays;
    days = perDay > 0 ? Math.floor((1 - eb.consumed) / perDay) : null;
  }
  return {
    ...prediction({
      id: 'budget-exhaustion', title: 'Error budget exhaustion', current: +eb.consumed.toFixed(4), threshold: 1, unit: 'budget consumed', days,
      detail: `${service}: ${(eb.consumed * 100).toFixed(1)}% of the budget consumed in ${elapsedDays} of ${windowDays} days, burning at ${eb.burnRate}×`,
    }),
    service, errorBudget: eb,
  };
}

// The whole predictive picture, in one shape, ordered by how little time is left.
function predictiveOperations({ storage = {}, certificates = {}, capacity = {}, queue = {}, dependencies = [], budgets = [] } = {}) {
  const predictions = [
    predictStorageExhaustion(storage),
    predictCertificateExpiry(certificates),
    predictCapacity(capacity),
    predictQueueSaturation(queue),
    ...dependencies.map((d) => predictDependencyDegradation(d)),
    ...budgets.map((b) => predictBudgetExhaustion(b)),
  ];
  const ordered = [...predictions].sort((a, b) => {
    const av = a.daysUntilThreshold === null ? Infinity : a.daysUntilThreshold;
    const bv = b.daysUntilThreshold === null ? Infinity : b.daysUntilThreshold;
    return av - bv || String(a.predictor).localeCompare(String(b.predictor));
  });
  const actionable = ordered.filter((p) => ['breached', 'imminent', 'near-term'].includes(p.urgency));
  return {
    predictions: ordered,
    unmeasured: predictions.filter((p) => !p.predicted).map((p) => p.predictor),
    breached: ordered.filter((p) => p.urgency === 'breached').map((p) => p.predictor),
    imminent: ordered.filter((p) => p.urgency === 'imminent').map((p) => p.predictor),
    actionable: actionable.map((p) => ({ predictor: p.predictor, daysUntilThreshold: p.daysUntilThreshold, action: p.recommendedAction })),
    // A maintenance recommendation is what an operator actually wants: the ordered list of things
    // to do and roughly when, not six separate dashboards each insisting it is the urgent one.
    maintenanceRecommendations: actionable.map((p, i) => ({ order: i + 1, predictor: p.predictor, within: p.daysUntilThreshold === null ? 'unknown' : `${Math.max(0, p.daysUntilThreshold)} day(s)`, action: p.recommendedAction, detail: p.detail })),
    healthy: actionable.length === 0,
    leadTimeBands: LEAD_TIME_BANDS.map((b) => ({ ...b })),
    informationalOnly: true, authorizes: false,
    note: 'Operational predictions. Each states what is being measured, what threshold it is heading for and how long there is. An unmeasurable prediction reports as unmeasured, never as healthy.',
  };
}

// The release gate, extended with prediction (Phase 12). Reliability that is fine today but
// forecast to break inside the release horizon is not a reason to block — it is a reason to say
// so — but a threshold ALREADY breached, or breaching within a week, blocks.
function predictiveReleaseGate({ measurements = {}, history = null, windowDays = 30, elapsedDays = 30, predictions = null, riskAcceptedBy = null, riskRationale = null } = {}) {
  const base = releaseReadiness({ measurements, history, windowDays, elapsedDays, riskAcceptedBy, riskRationale });
  const pred = predictions || predictiveOperations({});
  const blockers = [];
  const warnings = [];
  for (const p of pred.predictions) {
    if (p.urgency === 'breached') blockers.push({ predictor: p.predictor, reason: `${p.title}: the threshold has already been crossed — ${p.detail}` });
    else if (p.urgency === 'imminent') blockers.push({ predictor: p.predictor, reason: `${p.title}: ${p.daysUntilThreshold} day(s) of headroom — shipping now spends slack that is not there` });
    else if (p.urgency === 'near-term') warnings.push({ predictor: p.predictor, warning: `${p.title}: ${p.daysUntilThreshold} day(s) of headroom` });
  }
  const clean = base.ready && blockers.length === 0;
  const override = !clean && !!(riskAcceptedBy && riskRationale);
  return {
    ready: clean || override,
    reliabilityGate: base.gate, predictions: pred,
    predictiveBlockers: blockers, predictiveWarnings: [...warnings, ...base.warnings],
    overridden: override, riskAcceptedBy: override ? riskAcceptedBy : null, riskRationale: override ? riskRationale : null,
    failClosed: true, authorizes: false,
    note: clean
      ? 'Reliability and its predictors both permit a release. Deployment remains a recorded human decision.'
      : override
        ? 'Release proceeds on a RECORDED risk acceptance by a named human authority.'
        : 'Release BLOCKED. A breached or imminent operational threshold is a reason not to ship, not a warning to read afterwards.',
  };
}

function releaseReadiness({ measurements = {}, history = null, windowDays = 30, elapsedDays = 30, riskAcceptedBy = null, riskRationale = null } = {}) {
  const gate = releaseGate({ measurements, windowDays, elapsedDays, riskAcceptedBy, riskRationale });
  const card = scorecard({ measurements, history, windowDays, elapsedDays });
  const warnings = [];
  for (const c of card.services) {
    if (!c.measured) continue;
    if (c.trend === 'degrading') warnings.push({ service: c.service, warning: 'availability trend is degrading even though the gate passes' });
    if (c.budgetRemaining < 0.25) warnings.push({ service: c.service, warning: `error budget below 25% (${(c.budgetRemaining * 100).toFixed(1)}%)` });
  }
  return {
    ready: gate.allow, gate, scorecard: card, warnings,
    overallGrade: card.overallGrade,
    failClosed: true, authorizes: false,
    note: gate.allow
      ? 'Reliability permits a release. Deployment remains a recorded decision by a named human authority.'
      : 'Release BLOCKED by reliability. Warnings below are advisory; the blockers are not.',
  };
}

// --- Reports ---------------------------------------------------------------------------------------

function serviceLevels() { return Object.entries(SERVICE_LEVELS).map(([id, sl]) => ({ id, ...sl })); }

function reliabilityReport({ measurements = {}, windowDays = 30, elapsedDays = 30, autoscaling = DEFAULT_AUTOSCALING, capacity = {}, forecast = {}, history = null, recovery = {}, predictions = {} } = {}) {
  const ev = evaluate(measurements, { windowDays, elapsedDays });
  return {
    serviceLevels: serviceLevels(), evaluation: ev,
    errorBudgets: ev.results.filter((r) => r.measured).map((r) => ({ service: r.service, availability: r.availability, latency: r.latency })),
    availability: ev.results.filter((r) => r.measured).map((r) => ({ service: r.service, attained: r.availability.attained, objective: r.targets.availability, meets: r.meets })),
    autoscaling: validateAutoscaling(autoscaling),
    capacity: capacityPlan(capacity), forecast: resourceForecast(forecast),
    burnAlertPolicy: BURN_ALERTS,
    predictive: predictiveOperations(predictions),
    scorecard: scorecard({ measurements, history, windowDays, elapsedDays }),
    complianceHistory: history ? history.all() : [],
    dependencyRisk: dependencyRisk(),
    recoveryForecast: recoveryForecast(recovery),
    releaseGate: releaseGate({ measurements, windowDays, elapsedDays }),
    releaseReadiness: releaseReadiness({ measurements, history, windowDays, elapsedDays }),
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

module.exports = {
  SERVICE_LEVELS, DEFAULT_AUTOSCALING, BURN_ALERTS, CRITICALITY_WEIGHT,
  serviceLevels, errorBudget, evaluate, recoveryCompliance, capacityPlan, resourceForecast,
  validateAutoscaling, releaseGate, reliabilityReport, fromSliSnapshot,
  burnRateAlerts, trend, reliabilityForecast, recoveryForecast, dependencyRisk,
  SloComplianceHistory, scorecard, releaseReadiness,
  LEAD_TIME_BANDS, leadTime, daysUntil,
  predictStorageExhaustion, predictCertificateExpiry, predictCapacity, predictQueueSaturation,
  predictDependencyDegradation, predictBudgetExhaustion, predictiveOperations, predictiveReleaseGate,
};
