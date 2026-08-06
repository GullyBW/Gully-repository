'use strict';
// Control Effectiveness Analytics (Phase 15, Part 3). Extends the assurance bounded context.
//
// The platform has spent five phases asking whether a control EXISTS. Phase 14's global invariant
// asked the sharper question — would anything notice this dependency breaking? — and answered it by
// checking that a control of the right name runs and passes.
//
// That is still a question about existence. A control can run on every build, pass on every build,
// and be useless: it can fire so long after the fact that the incident is over, fire so often on
// nothing that people mute it, or never fire on the thing it was written for. None of that is visible
// from "the control is green".
//
// So effectiveness is measured from OBSERVATIONS of the control doing its job, and:
//
//   A CONTROL WITH NO PERFORMANCE EVIDENCE IS `unknown`. Not effective, not ineffective, not
//   "assumed working". A control nobody has watched work is exactly as informative as a control
//   nobody has written, and the report says so rather than letting a green build stand in for
//   operational evidence.
//
// The register ships EMPTY, like every other register in this platform. Nothing here has been
// observed, so every control reports `unknown`, and that is the truth of a platform whose controls
// have never been exercised against a real incident.
const evidenceConfidence = require('./evidence-confidence');

const MINUTE = 60_000;
const HOUR = 3600_000;

// What can be observed about a control doing its job. Each says what it means and what it costs to
// be bad at it, because a latency figure with no consequence attached is a number on a dashboard.
const EFFECTIVENESS_DIMENSIONS = {
  detectionLatency: {
    unit: 'ms', lowerIsBetter: true,
    question: 'How long after the condition arose did the control fire?',
    ifBad: 'The control is a post-mortem tool. It tells you what happened rather than letting you act.',
  },
  acknowledgementLatency: {
    unit: 'ms', lowerIsBetter: true,
    question: 'How long after firing did a named human pick it up?',
    ifBad: 'The detection worked and nobody was listening, which is the same outcome as no detection.',
  },
  remediationLatency: {
    unit: 'ms', lowerIsBetter: true,
    question: 'How long after acknowledgement was the condition actually cleared?',
    ifBad: 'The organisation knows and cannot act, which is a capacity problem wearing a monitoring costume.',
  },
  falsePositiveRate: {
    unit: 'rate', lowerIsBetter: true,
    question: 'How often did it fire on nothing?',
    ifBad: 'People mute it. A muted control is worse than an absent one because the gap is invisible.',
  },
  falseNegativeRate: {
    unit: 'rate', lowerIsBetter: true,
    question: 'How often did the condition occur and the control stay silent?',
    ifBad: 'The thing the control exists for happens and nothing says so. This is the dimension nobody measures.',
  },
  historicalReliability: {
    unit: 'rate', lowerIsBetter: false,
    question: 'Of everything it should have caught, how much did it catch?',
    ifBad: 'The control is decorative and the estate believes it is covered.',
  },
  operationalAvailability: {
    unit: 'rate', lowerIsBetter: false,
    question: 'How often was the control actually running when it was needed?',
    ifBad: 'It works and it was not there. A control that is down during the incident is a control that did not exist during the incident.',
  },
};

// The states a control's effectiveness can be in. `unknown` is first because it is where everything
// starts and where most things stay.
const EFFECTIVENESS_STATES = {
  unknown: { effective: null, means: 'No performance evidence has been recorded. Nobody has watched this control do its job.' },
  ineffective: { effective: false, means: 'Observed, and it does not do what it is for: it misses things, fires on nothing, or arrives too late to act on.' },
  degraded: { effective: false, means: 'Observed, and working badly enough that somebody should be told.' },
  effective: { effective: true, means: 'Observed doing what it is for, within the thresholds declared below.' },
};

// The thresholds. DECLARED, and said to be declared — these are judgements about what "fast enough"
// means for a governance control, not measurements of anything.
const THRESHOLDS = {
  detectionLatency: { degradedAbove: 15 * MINUTE, ineffectiveAbove: 4 * HOUR, basis: 'declared: a control that takes longer than a working day to fire is a post-mortem tool' },
  acknowledgementLatency: { degradedAbove: HOUR, ineffectiveAbove: 24 * HOUR, basis: 'declared: matches the 24-hour escalation acknowledgement window the ownership model already uses' },
  remediationLatency: { degradedAbove: 24 * HOUR, ineffectiveAbove: 7 * 24 * HOUR, basis: 'declared: a week to clear a detected condition is a capacity problem, not a monitoring one' },
  falsePositiveRate: { degradedAbove: 0.2, ineffectiveAbove: 0.5, basis: 'declared: above one in five, people start ignoring it; above half, it is noise' },
  falseNegativeRate: { degradedAbove: 0.05, ineffectiveAbove: 0.2, basis: 'declared and deliberately strict — a missed detection is the failure the control exists to prevent' },
  historicalReliability: { degradedBelow: 0.9, ineffectiveBelow: 0.7, basis: 'declared' },
  operationalAvailability: { degradedBelow: 0.99, ineffectiveBelow: 0.95, basis: 'declared: a control is needed exactly when things are going wrong, which is when it is most likely to be down' },
};

// What an observation records. `outcome` is the field that makes false negatives measurable at all:
// somebody has to record that the condition occurred and the control said nothing.
const OUTCOMES = {
  'true-positive': { fired: true, real: true, means: 'The control fired and the condition was real.' },
  'false-positive': { fired: true, real: false, means: 'The control fired and there was nothing there.' },
  'false-negative': { fired: false, real: true, means: 'The condition occurred and the control stayed silent. Recorded by a human who found it another way.' },
  unavailable: { fired: false, real: true, means: 'The condition occurred and the control was not running.' },
};

class ControlObservationRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._observations = new Map(); }

  // Record one observation of a control doing — or failing to do — its job. Attributed, because an
  // unattributed observation of a control's performance is a rumour about a control.
  record(control, {
    outcome, occurredAt, detectedAt = null, acknowledgedAt = null, remediatedAt = null,
    // Phase 16, Part 5. Distinct from `remediatedAt` on purpose: remediation is when the fix was
    // applied, recovery is when the affected capability was actually back. Conflating them reports
    // the moment an engineer finished typing as the moment a citizen could file a report again.
    recoveredAt = null,
    acknowledgedBy = null, observedBy, note = null,
  } = {}) {
    if (!control) throw new Error('an observation must name the control it is about');
    if (!OUTCOMES[outcome]) throw new Error(`unknown outcome '${outcome}' — one of ${Object.keys(OUTCOMES).join(', ')}`);
    if (!observedBy) { const e = new Error('an observation must name who or what recorded it — an unattributed observation of a control is a rumour about a control'); e.failClosed = true; throw e; }
    if (!Number.isFinite(occurredAt)) { const e = new Error('an observation must record when the condition actually arose, or no latency can be derived from it'); e.failClosed = true; throw e; }
    if (OUTCOMES[outcome].fired && !Number.isFinite(detectedAt)) {
      const e = new Error(`outcome '${outcome}' means the control fired, so it must record when — a firing with no timestamp cannot be measured`);
      e.failClosed = true; throw e;
    }
    if (Number.isFinite(detectedAt) && detectedAt < occurredAt) throw new Error('a control cannot have fired before the condition arose');
    if (Number.isFinite(acknowledgedAt) && !acknowledgedBy) {
      const e = new Error('an acknowledgement must name the human who made it — an acknowledgement by nobody is the failure mode this measures');
      e.failClosed = true; throw e;
    }
    if (Number.isFinite(remediatedAt) && !Number.isFinite(acknowledgedAt)) {
      throw new Error('a condition cannot be remediated before it was acknowledged; if it was, record the acknowledgement');
    }
    if (Number.isFinite(recoveredAt) && recoveredAt < occurredAt) throw new Error('a capability cannot have recovered before the condition arose');
    const rec = {
      control, outcome, occurredAt, detectedAt, acknowledgedAt, remediatedAt, recoveredAt,
      acknowledgedBy, observedBy, note, at: this._clock(),
      detectionLatency: Number.isFinite(detectedAt) ? detectedAt - occurredAt : null,
      acknowledgementLatency: Number.isFinite(acknowledgedAt) && Number.isFinite(detectedAt) ? acknowledgedAt - detectedAt : null,
      remediationLatency: Number.isFinite(remediatedAt) && Number.isFinite(acknowledgedAt) ? remediatedAt - acknowledgedAt : null,
    };
    if (!this._observations.has(control)) this._observations.set(control, []);
    this._observations.get(control).push(rec);
    return { ...rec };
  }

  observations(control = null) {
    if (control) return (this._observations.get(control) || []).map((o) => ({ ...o }));
    return [...this._observations.keys()].sort().flatMap((c) => this.observations(c));
  }
  controls() { return [...this._observations.keys()].sort(); }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Effectiveness of one control. Every dimension reports its own state, and the overall state is the
// WEAKEST — as everywhere else in this platform, because a control that detects perfectly and is
// never acknowledged is a control nobody acts on.
function controlEffectiveness(control, { register = null, now = 0 } = {}) {
  const observations = register ? register.observations(control) : [];
  const dimension = (id, value, samples) => {
    const spec = EFFECTIVENESS_DIMENSIONS[id];
    const th = THRESHOLDS[id];
    if (value === null || value === undefined) {
      return { dimension: id, ...spec, value: null, samples, state: 'unknown', threshold: th, reason: `no observation supports a ${id} figure` };
    }
    const state = spec.lowerIsBetter
      ? (value > th.ineffectiveAbove ? 'ineffective' : value > th.degradedAbove ? 'degraded' : 'effective')
      : (value < th.ineffectiveBelow ? 'ineffective' : value < th.degradedBelow ? 'degraded' : 'effective');
    return {
      dimension: id, ...spec, value: +Number(value).toFixed(4), samples, state, threshold: th,
      reason: state === 'effective' ? `${id} is within the declared threshold` : `${id} of ${Number(value).toFixed(4)} is ${state} against a declared threshold`,
    };
  };

  const fired = observations.filter((o) => OUTCOMES[o.outcome].fired);
  const truePositives = observations.filter((o) => o.outcome === 'true-positive');
  const falsePositives = observations.filter((o) => o.outcome === 'false-positive');
  const falseNegatives = observations.filter((o) => o.outcome === 'false-negative');
  const unavailable = observations.filter((o) => o.outcome === 'unavailable');
  const real = observations.filter((o) => OUTCOMES[o.outcome].real);

  const dimensions = [
    dimension('detectionLatency', mean(truePositives.map((o) => o.detectionLatency).filter((x) => x !== null)), truePositives.length),
    dimension('acknowledgementLatency', mean(fired.map((o) => o.acknowledgementLatency).filter((x) => x !== null)), fired.filter((o) => o.acknowledgementLatency !== null).length),
    dimension('remediationLatency', mean(observations.map((o) => o.remediationLatency).filter((x) => x !== null)), observations.filter((o) => o.remediationLatency !== null).length),
    dimension('falsePositiveRate', fired.length ? falsePositives.length / fired.length : null, fired.length),
    dimension('falseNegativeRate', real.length ? falseNegatives.length / real.length : null, real.length),
    dimension('historicalReliability', real.length ? truePositives.length / real.length : null, real.length),
    dimension('operationalAvailability', real.length ? (real.length - unavailable.length) / real.length : null, real.length),
  ];

  const measured = dimensions.filter((d) => d.state !== 'unknown');
  const order = ['ineffective', 'degraded', 'effective'];
  const state = !measured.length ? 'unknown' : measured.reduce((w, d) => (order.indexOf(d.state) < order.indexOf(w) ? d.state : w), 'effective');

  // The estimate, carrying its own sample size and interval — Part 10's discipline applied here.
  const reliability = evidenceConfidence.statisticalEstimate({
    subject: `${control} historical reliability`,
    successes: truePositives.length, observations: real.length,
    limitations: ['A control is only observed when somebody records an observation of it. Absence of observations is absence of watching, not absence of incidents.'],
  });

  return {
    control, dimensions, observations: observations.length,
    state, ...EFFECTIVENESS_STATES[state],
    unknownDimensions: dimensions.filter((d) => d.state === 'unknown').map((d) => d.dimension),
    weakestDimension: measured.length ? measured.slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.dimension.localeCompare(b.dimension))[0].dimension : null,
    reliabilityEstimate: reliability,
    // THE RULE, restated on the record itself.
    reason: state === 'unknown'
      ? `no performance evidence exists for '${control}'. It may run and pass on every build and still miss everything it was written for; a green control is not operational evidence.`
      : `weakest dimension is ${measured.slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))[0].dimension}`,
    informationalOnly: true, authorizes: false,
  };
}

// The estate-wide dashboard. Controls with no evidence are counted separately and never averaged in.
function effectivenessDashboard({ register = null, controls = [], now = 0 } = {}) {
  const ids = [...new Set([...(controls || []).map((c) => (typeof c === 'string' ? c : c.id)), ...(register ? register.controls() : [])])].sort();
  const rows = ids.map((id) => controlEffectiveness(id, { register, now }));
  const byState = Object.fromEntries(Object.keys(EFFECTIVENESS_STATES).map((s) => [s, rows.filter((r) => r.state === s).length]));
  const measured = rows.filter((r) => r.state !== 'unknown');
  return {
    controls: rows, count: rows.length,
    dimensions: Object.entries(EFFECTIVENESS_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d, threshold: THRESHOLDS[dimension] })),
    states: Object.entries(EFFECTIVENESS_STATES).map(([state, s]) => ({ state, ...s })),
    outcomes: Object.entries(OUTCOMES).map(([outcome, o]) => ({ outcome, ...o })),
    byState,
    unknown: rows.filter((r) => r.state === 'unknown').map((r) => r.control),
    ineffective: rows.filter((r) => r.state === 'ineffective').map((r) => r.control),
    degraded: rows.filter((r) => r.state === 'degraded').map((r) => r.control),
    // An effectiveness rate computed over controls nobody has observed would be a rate over nothing,
    // so it is computed over the measured ones and says how many it excluded.
    effectivenessRate: measured.length ? +(measured.filter((r) => r.state === 'effective').length / measured.length).toFixed(4) : null,
    effectivenessBasis: measured.length
      ? `${measured.filter((r) => r.state === 'effective').length} of ${measured.length} OBSERVED controls are effective. ${byState.unknown} control(s) have no performance evidence and are excluded from the rate rather than counted as working.`
      : `No control has any performance evidence. ${rows.length} control(s) run and pass on every build, and nothing here can say whether any of them would catch the thing it was written for.`,
    measurable: measured.length > 0,
    now, failClosed: true, informationalOnly: true, authorizes: false,
    note: 'A control with no performance evidence is UNKNOWN — not effective, not ineffective, and never averaged into a rate. A green build says the control ran; it says nothing about whether it works.',
  };
}

// --- Control performance intelligence (Phase 16, Part 5) -------------------------------------------
//
// The seven dimensions above answer "is this control effective enough to rely on". Part 5 asks the
// operational question underneath: how well does it actually perform, in the vocabulary the people
// who run it already use — detection rate, precision, recall, and the four mean times.
//
// Two things this section is careful about, because both are the standard way these numbers lie:
//
//   PRECISION AND RECALL ARE DIFFERENT QUESTIONS AND ARE NEVER COMBINED. Precision asks "when it
//   fires, is it right"; recall asks "when it matters, does it fire". A control can be perfect at
//   one and useless at the other, and an F-score would hide exactly which.
//
//   A MEAN TIME OVER A SINGLE OBSERVATION IS NOT A MEAN. Every figure carries its sample size, and
//   a figure resting on fewer than the declared floor is marked as indicative rather than reported
//   as a measurement.
const PERFORMANCE_MEASURES = {
  detectionRate: {
    asks: 'Of the conditions that actually occurred, what share did this control detect?',
    formula: 'true positives ÷ (true positives + false negatives + unavailable)',
    ifUnknown: 'Nothing says whether the control catches what it exists to catch.',
    higherIsBetter: true,
  },
  precision: {
    asks: 'When it fires, how often is there really something there?',
    formula: 'true positives ÷ (true positives + false positives)',
    ifUnknown: 'Nothing says whether people are right to act on it.',
    higherIsBetter: true,
  },
  recall: {
    asks: 'Of the real conditions, how many did it not miss?',
    formula: 'true positives ÷ (true positives + false negatives)',
    ifUnknown: 'The misses are invisible, and the misses are the failure the control exists to prevent.',
    higherIsBetter: true,
  },
  falsePositives: { asks: 'How many times did it fire at nothing?', formula: 'count of false-positive observations', ifUnknown: 'Alert fatigue is unmeasurable.', higherIsBetter: false },
  falseNegatives: { asks: 'How many real conditions did it stay silent for?', formula: 'count of false-negative observations', ifUnknown: 'The most important number about a control is unknown.', higherIsBetter: false },
  meanTimeToDetect: { asks: 'How long from the condition arising to the control firing?', formula: 'mean(detectedAt − occurredAt) over true positives', ifUnknown: 'Nothing says whether detection is timely enough to matter.', higherIsBetter: false },
  meanTimeToAcknowledge: { asks: 'How long from firing to a human taking it?', formula: 'mean(acknowledgedAt − detectedAt) over fired observations', ifUnknown: 'A control nobody picks up is indistinguishable from one that never fired.', higherIsBetter: false },
  meanTimeToRespond: { asks: 'How long from a human taking it to the fix being applied?', formula: 'mean(remediatedAt − acknowledgedAt)', ifUnknown: 'Nothing separates a slow detection from a slow response.', higherIsBetter: false },
  meanTimeToRecover: {
    asks: 'How long from the condition arising to the affected capability being back?',
    formula: 'mean(recoveredAt − occurredAt)',
    ifUnknown: 'The only figure a citizen would recognise — how long the service was actually degraded — is unknown.',
    higherIsBetter: false,
  },
};

// Below this, a figure is a reading rather than a measurement. Declared, and the same floor the
// evidence-confidence module uses for an indicative estimate.
const PERFORMANCE_MIN_SAMPLES = 3;

function controlPerformance(control, { register = null, now = 0 } = {}) {
  const observations = register ? register.observations(control) : [];
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round = (x) => (x === null || x === undefined ? null : +Number(x).toFixed(4));

  const truePositives = observations.filter((o) => o.outcome === 'true-positive');
  const falsePositives = observations.filter((o) => o.outcome === 'false-positive');
  const falseNegatives = observations.filter((o) => o.outcome === 'false-negative');
  const unavailable = observations.filter((o) => o.outcome === 'unavailable');
  const real = observations.filter((o) => OUTCOMES[o.outcome].real);
  const fired = observations.filter((o) => OUTCOMES[o.outcome].fired);

  const measure = (id, value, samples, detail = null) => ({
    measure: id, ...PERFORMANCE_MEASURES[id],
    value: round(value), samples,
    // A mean over one observation is not a mean, and a rate over two is a coin toss.
    measured: value !== null && value !== undefined,
    indicative: value !== null && value !== undefined && samples < PERFORMANCE_MIN_SAMPLES,
    detail: detail || (value === null || value === undefined
      ? `no observation supports a ${id} figure — ${PERFORMANCE_MEASURES[id].ifUnknown}`
      : `over ${samples} observation(s)`),
  });

  // Detection rate counts `unavailable` as a miss: a control that was not running when the
  // condition arose did not detect it, whatever the reason.
  const detectable = truePositives.length + falseNegatives.length + unavailable.length;
  const recallable = truePositives.length + falseNegatives.length;
  const ackLatencies = fired.map((o) => o.acknowledgementLatency).filter((x) => x !== null);
  const respondLatencies = observations.map((o) => o.remediationLatency).filter((x) => x !== null);
  const recoverLatencies = observations
    .filter((o) => Number.isFinite(o.recoveredAt) && Number.isFinite(o.occurredAt))
    .map((o) => o.recoveredAt - o.occurredAt);

  const measures = [
    measure('detectionRate', detectable ? truePositives.length / detectable : null, detectable),
    measure('precision', fired.length ? truePositives.length / fired.length : null, fired.length),
    measure('recall', recallable ? truePositives.length / recallable : null, recallable),
    measure('falsePositives', observations.length ? falsePositives.length : null, observations.length),
    measure('falseNegatives', observations.length ? falseNegatives.length : null, observations.length),
    measure('meanTimeToDetect', mean(truePositives.map((o) => o.detectionLatency).filter((x) => x !== null)), truePositives.filter((o) => o.detectionLatency !== null).length),
    measure('meanTimeToAcknowledge', mean(ackLatencies), ackLatencies.length),
    measure('meanTimeToRespond', mean(respondLatencies), respondLatencies.length),
    measure('meanTimeToRecover', mean(recoverLatencies), recoverLatencies.length),
  ];
  const measured = measures.filter((m) => m.measured);
  return {
    control, measures, observations: observations.length,
    measured: measured.length > 0,
    unknownMeasures: measures.filter((m) => !m.measured).map((m) => m.measure),
    indicativeMeasures: measures.filter((m) => m.indicative).map((m) => m.measure),
    // Precision and recall are reported side by side and never combined into one score.
    precisionRecall: {
      precision: measures.find((m) => m.measure === 'precision').value,
      recall: measures.find((m) => m.measure === 'recall').value,
      combined: false,
      whyNotCombined: 'Precision asks "when it fires, is it right"; recall asks "when it matters, does it fire". A control can be perfect at one and useless at the other, and a single score would hide which.',
    },
    basis: observations.length
      ? `${measured.length} of ${measures.length} measures computed over ${observations.length} observation(s); ${measures.filter((m) => m.indicative).length} rest on fewer than ${PERFORMANCE_MIN_SAMPLES} samples and are indicative rather than measured`
      : `no observation exists for '${control}'. Its performance is unknown — which is not the same as poor, and not the same as the green build the control produces on every run.`,
    now, informationalOnly: true, authorizes: false,
  };
}

// Historical trend. Periods are supplied by the caller as [from, to) boundaries: this module owns no
// clock and no calendar, and inventing a period boundary would invent the trend.
function performanceTrend(control, { register = null, periods = [], now = 0 } = {}) {
  if (!Array.isArray(periods) || periods.length < 2) {
    return {
      control, periods: [], trend: null, direction: 'unknown', measurable: false,
      reason: 'fewer than two periods were supplied — a trend needs at least two, and one observation window is a reading',
      now, informationalOnly: true, authorizes: false,
    };
  }
  const all = register ? register.observations(control) : [];
  const rows = periods.slice(0, -1).map((from, i) => {
    const to = periods[i + 1];
    const window = all.filter((o) => o.occurredAt >= from && o.occurredAt < to);
    const tp = window.filter((o) => o.outcome === 'true-positive').length;
    const real = window.filter((o) => OUTCOMES[o.outcome].real).length;
    return {
      from, to, observations: window.length,
      detectionRate: real ? +(tp / real).toFixed(4) : null,
      // A period with no observations is not a period with a detection rate of zero.
      measured: window.length > 0,
    };
  });
  const measured = rows.filter((r) => r.measured && r.detectionRate !== null);
  if (measured.length < 2) {
    return {
      control, periods: rows, trend: null, direction: 'unknown', measurable: false,
      reason: `${measured.length} of ${rows.length} period(s) contain observations — a direction needs at least two measured periods, and a period with nothing in it is not a period scoring zero`,
      now, informationalOnly: true, authorizes: false,
    };
  }
  const first = measured[0].detectionRate;
  const last = measured[measured.length - 1].detectionRate;
  const delta = +(last - first).toFixed(4);
  return {
    control, periods: rows, measuredPeriods: measured.length,
    trend: delta,
    direction: delta > 0.05 ? 'improving' : delta < -0.05 ? 'degrading' : 'steady',
    measurable: true,
    reason: `detection rate moved ${first} → ${last} across ${measured.length} measured period(s)`,
    now, informationalOnly: true, authorizes: false,
  };
}

// The Part 5 dashboard over the whole estate.
function performanceDashboard({ register = null, controls = [], periods = [], now = 0 } = {}) {
  const ids = [...new Set([...(controls || []).map((c) => (typeof c === 'string' ? c : c.id)), ...(register ? register.controls() : [])])].sort();
  const rows = ids.map((id) => controlPerformance(id, { register, now }));
  const measured = rows.filter((r) => r.measured);
  const trends = measured.map((r) => performanceTrend(r.control, { register, periods, now }));
  return {
    controls: rows, count: rows.length,
    measures: Object.entries(PERFORMANCE_MEASURES).map(([measure, m]) => ({ measure, ...m })),
    minimumSamples: PERFORMANCE_MIN_SAMPLES,
    measuredControls: measured.map((r) => r.control),
    unmeasured: rows.filter((r) => !r.measured).map((r) => r.control),
    trends: trends.filter((t) => t.measurable),
    degrading: trends.filter((t) => t.direction === 'degrading').map((t) => t.control),
    // Over observed controls only. A rate that counted unobserved controls would be a rate over
    // nothing, dressed as a rate over everything.
    meanDetectionRate: measured.length
      ? +(measured.map((r) => r.measures.find((m) => m.measure === 'detectionRate').value).filter((x) => x !== null)
        .reduce((a, b, _, arr) => a + b / arr.length, 0)).toFixed(4)
      : null,
    measurable: measured.length > 0,
    basis: measured.length
      ? `${measured.length} of ${rows.length} controls have performance observations. The other ${rows.length - measured.length} are excluded from every figure rather than counted as performing.`
      : `No control has a single performance observation. All ${rows.length} run and pass on every build, and how well any of them actually performs is unknown.`,
    now, failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Precision and recall are reported side by side and never combined: a control can be perfect at one and useless at the other, and a single score hides which. A mean over fewer than three observations is marked indicative rather than reported as a measurement.',
  };
}

module.exports = {
  EFFECTIVENESS_DIMENSIONS, EFFECTIVENESS_STATES, THRESHOLDS, OUTCOMES,
  ControlObservationRegister, controlEffectiveness, effectivenessDashboard,
  PERFORMANCE_MEASURES, PERFORMANCE_MIN_SAMPLES, controlPerformance, performanceTrend, performanceDashboard,
};
