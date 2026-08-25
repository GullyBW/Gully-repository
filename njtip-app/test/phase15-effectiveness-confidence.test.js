'use strict';
// Phase 15, Parts 3 & 10 — control effectiveness analytics and statistical confidence evolution.
const test = require('node:test');
const assert = require('node:assert');
const ce = require('../src/assurance/control-effectiveness');
const ec = require('../src/assurance/evidence-confidence');
const dp = require('../src/architecture/drift-prevention');

const MIN = 60_000;
const HOUR = 3600_000;

function observed() {
  const reg = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 20; i++) {
    reg.record('GOOD', { outcome: 'true-positive', occurredAt: i * HOUR, detectedAt: i * HOUR + 2 * MIN, acknowledgedAt: i * HOUR + 10 * MIN, acknowledgedBy: 'SRE', remediatedAt: i * HOUR + 30 * MIN, observedBy: 'CI' });
  }
  for (let i = 0; i < 10; i++) {
    reg.record('NOISY', { outcome: i < 3 ? 'true-positive' : 'false-positive', occurredAt: i * HOUR, detectedAt: i * HOUR + MIN, acknowledgedAt: i * HOUR + 2 * MIN, acknowledgedBy: 'SRE', observedBy: 'CI' });
  }
  for (let i = 0; i < 10; i++) {
    reg.record('SILENT', {
      outcome: i < 2 ? 'true-positive' : 'false-negative', occurredAt: i * HOUR,
      detectedAt: i < 2 ? i * HOUR + MIN : null, acknowledgedAt: i < 2 ? i * HOUR + 2 * MIN : null,
      acknowledgedBy: i < 2 ? 'SRE' : null, observedBy: 'an auditor',
    });
  }
  return reg;
}

// --- Part 3: control effectiveness ------------------------------------------------------------------

test('seven dimensions, each saying what it costs to be bad at it', () => {
  for (const required of ['detectionLatency', 'acknowledgementLatency', 'remediationLatency', 'falsePositiveRate', 'falseNegativeRate', 'historicalReliability', 'operationalAvailability']) {
    assert.ok(ce.EFFECTIVENESS_DIMENSIONS[required], required);
    assert.ok(ce.THRESHOLDS[required], required);
  }
  for (const [id, d] of Object.entries(ce.EFFECTIVENESS_DIMENSIONS)) {
    assert.ok(d.question.endsWith('?'), id);
    assert.ok(d.ifBad.length > 30, id);
    assert.strictEqual(typeof d.lowerIsBetter, 'boolean', id);
  }
  // No threshold is a measurement, and each says so.
  for (const [id, t] of Object.entries(ce.THRESHOLDS)) assert.match(t.basis, /declared/, id);
});

test('an observation must be attributed, timestamped, and internally coherent', () => {
  const reg = new ce.ControlObservationRegister({ clock: () => 0 });
  assert.throws(() => reg.record('X', { outcome: 'true-positive', occurredAt: 0, detectedAt: 1 }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('X', { outcome: 'true-positive', detectedAt: 1, observedBy: 'CI' }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('X', { outcome: 'true-positive', occurredAt: 0, observedBy: 'CI' }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('X', { outcome: 'probably-fine', occurredAt: 0, observedBy: 'CI' }), /unknown outcome/);
  assert.throws(() => reg.record('X', { outcome: 'true-positive', occurredAt: 10, detectedAt: 1, observedBy: 'CI' }), /before the condition arose/);
  // An acknowledgement by nobody is the failure mode this measures.
  assert.throws(() => reg.record('X', { outcome: 'true-positive', occurredAt: 0, detectedAt: 1, acknowledgedAt: 2, observedBy: 'CI' }), (e) => e.failClosed === true);
  assert.throws(() => reg.record('X', { outcome: 'true-positive', occurredAt: 0, detectedAt: 1, remediatedAt: 5, observedBy: 'CI' }), /before it was acknowledged/);
});

test('a control with no performance evidence is unknown and is never averaged into a rate', () => {
  const blind = ce.effectivenessDashboard({ controls: ['A', 'B'], now: 0 });
  assert.deepStrictEqual(blind.unknown, ['A', 'B']);
  assert.strictEqual(blind.effectivenessRate, null);
  assert.strictEqual(blind.measurable, false);
  for (const r of blind.controls) {
    assert.strictEqual(r.effective, null, r.control);
    assert.match(r.reason, /green control is not operational evidence/);
  }
  assert.match(blind.effectivenessBasis, /nothing here can say whether/);
});

test('every effectiveness state is reachable, and by the thing it names', () => {
  const reg = observed();
  assert.strictEqual(ce.controlEffectiveness('GOOD', { register: reg }).state, 'effective');
  assert.strictEqual(ce.controlEffectiveness('GOOD', { register: reg }).unknownDimensions.length, 0);

  const noisy = ce.controlEffectiveness('NOISY', { register: reg });
  assert.strictEqual(noisy.state, 'ineffective');
  assert.strictEqual(noisy.weakestDimension, 'falsePositiveRate');

  const silent = ce.controlEffectiveness('SILENT', { register: reg });
  assert.strictEqual(silent.state, 'ineffective');
  assert.strictEqual(silent.weakestDimension, 'falseNegativeRate');

  // Degraded sits between, or the middle band is unreachable.
  const mid = new ce.ControlObservationRegister({ clock: () => 0 });
  for (let i = 0; i < 10; i++) mid.record('MID', { outcome: 'true-positive', occurredAt: i * HOUR, detectedAt: i * HOUR + 30 * MIN, acknowledgedAt: i * HOUR + 35 * MIN, acknowledgedBy: 'SRE', observedBy: 'CI' });
  assert.strictEqual(ce.controlEffectiveness('MID', { register: mid }).state, 'degraded');
});

test('the dashboard excludes unobserved controls from the rate and says how many', () => {
  const dash = ce.effectivenessDashboard({ register: observed(), controls: ['NEVER-WATCHED'], now: 0 });
  assert.ok(dash.unknown.includes('NEVER-WATCHED'));
  assert.ok(dash.effectivenessRate !== null);
  assert.match(dash.effectivenessBasis, /excluded from the rate rather than counted as working/);
  assert.strictEqual(dash.authorizes, false);
});

test('a false negative can actually be recorded — the dimension nobody measures', () => {
  assert.ok(ce.OUTCOMES['false-negative']);
  assert.strictEqual(ce.OUTCOMES['false-negative'].fired, false);
  assert.strictEqual(ce.OUTCOMES['false-negative'].real, true);
  const silent = ce.controlEffectiveness('SILENT', { register: observed() });
  const fn = silent.dimensions.find((d) => d.dimension === 'falseNegativeRate');
  assert.strictEqual(fn.value, 0.8);
  assert.strictEqual(fn.state, 'ineffective');
});

// --- Part 10: statistical confidence evolution -------------------------------------------------------

test('unknown is never a low estimate', () => {
  const none = ec.statisticalEstimate({ subject: 'nothing observed' });
  assert.strictEqual(none.state, 'unknown');
  assert.strictEqual(none.point, null);
  // No point estimate means no interval; a band around nothing implies a value sits inside it.
  assert.strictEqual(none.interval, null);
  assert.match(none.reason, /UNKNOWN is not a low estimate/);
  assert.strictEqual(ec.ESTIMATE_STATES.unknown.usable, false);
  assert.notStrictEqual(ec.ESTIMATE_STATES.unknown.means, ec.ESTIMATE_STATES.provisional.means);
});

test('every estimate exposes its sample size, interval, quality and limitations', () => {
  const e = ec.statisticalEstimate({
    subject: 'probe', successes: 18, observations: 20,
    quality: { band: 'high', weakestDimension: 'freshness', sound: true }, history: [0.88, 0.9, 0.91],
  });
  assert.strictEqual(e.sampleSize, 20);
  assert.ok(e.interval);
  assert.ok(e.evidenceQuality);
  assert.strictEqual(e.qualityAssessed, true);
  assert.ok(e.historicalStability);
  assert.ok(e.statisticalLimitations.some((l) => /not a statistical confidence interval/.test(l)));
  // With no quality assessment, that gap is itself a stated limitation.
  const noQuality = ec.statisticalEstimate({ subject: 'p', successes: 1, observations: 2 });
  assert.strictEqual(noQuality.qualityAssessed, false);
  assert.ok(noQuality.statisticalLimitations.some((l) => /unknown/.test(l)));
});

test('an estimate strengthens as evidence accumulates and weakens when it is lost', () => {
  const weak = ec.statisticalEstimate({ subject: 'x', successes: 2, observations: 2 });
  const strong = ec.statisticalEstimate({ subject: 'x', successes: 100, observations: 100 });
  assert.ok(strong.halfWidth < weak.halfWidth);
  assert.strictEqual(weak.state, 'provisional');
  assert.strictEqual(strong.state, 'established');
  assert.strictEqual(ec.statisticalEstimate({ subject: 'x', successes: 4, observations: 5 }).state, 'indicative');

  const up = ec.confidenceEvolution({ subject: 'x', snapshots: [{ successes: 2, observations: 2 }, { successes: 40, observations: 50 }] });
  assert.strictEqual(up.direction, 'strengthening');
  assert.strictEqual(up.strengthening, true);
  const down = ec.confidenceEvolution({ subject: 'x', snapshots: [{ successes: 40, observations: 50 }, { successes: 2, observations: 2 }] });
  assert.strictEqual(down.direction, 'weakening');
  assert.strictEqual(ec.confidenceEvolution({ subject: 'x', snapshots: [{ successes: 1, observations: 1 }] }).direction, 'insufficient-data');
});

test('volatility is reported rather than smoothed away', () => {
  const steady = ec.statisticalEstimate({ subject: 'x', successes: 5, observations: 10, history: [0.5, 0.51, 0.5, 0.49] });
  const swinging = ec.statisticalEstimate({ subject: 'x', successes: 5, observations: 10, history: [0.1, 0.9, 0.2, 0.8] });
  assert.strictEqual(steady.historicalStability.stable, true);
  assert.strictEqual(swinging.historicalStability.stable, false);
  assert.ok(swinging.statisticalLimitations.some((l) => /volatile/.test(l)));
});

test('there is one definition of the interval, not two', () => {
  const a = ec.interval(0.5, 25);
  const b = dp.forecastInterval(0.5, 25);
  assert.deepStrictEqual(a.interval, b.interval);
  assert.strictEqual(a.method, b.method);
  assert.strictEqual(b.constrained, true);
});
