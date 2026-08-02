'use strict';
// Executive Engineering Dashboard (Phase 10, Part 14). Twelve executive metrics, each one
// traceable to the evidence that produced it and the control that verifies it.
//
// The rule: NO MANUALLY ENTERED METRICS. Every value resolves from an evidence bundle by
// declared path. A metric whose evidence is missing renders as `unavailable` naming what was
// missing — it is never filled in by hand, defaulted to zero, or quietly dropped. An executive
// dashboard that can be typed into is a reporting system, not a measurement system.
//
// Deterministic: the same evidence bundle always renders the same dashboard.

// Each metric declares WHERE its value comes from and WHAT verifies it.
const METRICS = {
  'architecture-health': {
    title: 'Architecture health', unit: 'ratio', target: 1, direction: 'higher-is-better',
    evidencePath: 'fitness.heldRatio', control: 'APP-FIT-CONTEXT-MAP',
    question: 'Is the architecture-of-record still true and every invariant holding?',
  },
  'security-posture': {
    title: 'Security posture', unit: 'ratio', target: 1, direction: 'higher-is-better',
    evidencePath: 'security.postureScore', control: 'APP-FIT-ZERO-TRUST-ARCHITECTURE',
    question: 'Are the security controls in place and holding right now?',
  },
  'compliance-posture': {
    title: 'Compliance posture', unit: 'ratio', target: 0.9, direction: 'higher-is-better',
    evidencePath: 'compliance.overallCoverage', control: 'APP-FIT-LEGISLATIVE-IMPACT',
    question: 'What fraction of mandated controls are implemented and verified?',
  },
  'reliability': {
    title: 'Reliability (SLOs met)', unit: 'boolean', target: true, direction: 'must-be-true',
    evidencePath: 'reliability.allSlosMet', control: 'APP-FIT-SRE-RELIABILITY',
    question: 'Are we meeting every service-level objective?',
  },
  'performance': {
    title: 'Latency p95', unit: 'ms', target: 300, direction: 'lower-is-better',
    evidencePath: 'reliability.latencyP95Ms', control: 'APP-FIT-SRE-RELIABILITY',
    question: 'How fast is the platform for the journeys that matter?',
  },
  'operational-readiness': {
    title: 'Operational readiness', unit: 'ratio', target: 1, direction: 'higher-is-better',
    evidencePath: 'operations.readinessScore', control: 'APP-FIT-INFRA-ASSURANCE',
    question: 'Is the estate compliant, current, backed up and drift-free?',
  },
  'technical-debt': {
    title: 'Open invariant failures', unit: 'count', target: 0, direction: 'lower-is-better',
    evidencePath: 'fitness.failingCount', control: 'APP-FIT-CONTEXT-MAP',
    question: 'How much of the platform is knowingly not holding its own rules?',
  },
  'deployment-readiness': {
    title: 'Deployment readiness', unit: 'boolean', target: true, direction: 'must-be-true',
    evidencePath: 'assurance.allDomainsPass', control: 'APP-FIT-CONTINUOUS-ASSURANCE',
    question: 'Would every assurance gate pass a deployment today? (It still would not authorize one.)',
  },
  'risk-exposure': {
    title: 'Residual threat exposure', unit: 'score', target: 0, direction: 'lower-is-better',
    evidencePath: 'risk.totalExposure', control: 'APP-FIT-THREAT-MODEL',
    question: 'Which modelled threats have a missing or failing control?',
  },
  'legislative-readiness': {
    title: 'Legislative readiness', unit: 'ratio', target: 1, direction: 'higher-is-better',
    evidencePath: 'legislation.mandatesImplementedRatio', control: 'APP-FIT-FORMAL-POLICY',
    question: 'Is every control a legal instrument mandates implemented and holding?',
  },
  'data-governance': {
    title: 'Data governance completeness', unit: 'ratio', target: 1, direction: 'higher-is-better',
    evidencePath: 'data.tracedRatio', control: 'APP-FIT-DATA-GOVERNANCE',
    question: 'Can every governed record answer origin → deletion?',
  },
  'recovery-readiness': {
    title: 'Recovery readiness', unit: 'boolean', target: true, direction: 'must-be-true',
    evidencePath: 'recovery.allScenariosMatch', control: 'APP-FIT-MULTI-REGION',
    question: 'Does every rehearsed failover behave as designed?',
  },
};

// Risk heat-map dimensions: likelihood × impact, populated from residual threat exposure.
const HEATMAP_BANDS = [
  { band: 'critical', min: 12 }, { band: 'high', min: 6 }, { band: 'medium', min: 3 }, { band: 'low', min: 1 }, { band: 'none', min: 0 },
];

const resolve = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Render one metric from the evidence bundle. Missing evidence is reported, never filled in.
function renderMetric(id, evidence = {}) {
  const m = METRICS[id];
  if (!m) throw new Error('unknown executive metric: ' + id);
  const value = resolve(evidence, m.evidencePath);
  if (value === undefined || value === null) {
    return { metric: id, title: m.title, value: null, status: 'unavailable', missingEvidence: m.evidencePath, control: m.control, question: m.question, note: 'No evidence for this metric. It is left unavailable rather than estimated.' };
  }
  let meets = null;
  if (m.direction === 'must-be-true') meets = value === true;
  else if (m.direction === 'higher-is-better') meets = typeof value === 'number' && value >= m.target;
  else if (m.direction === 'lower-is-better') meets = typeof value === 'number' && value <= m.target;
  return {
    metric: id, title: m.title, value, unit: m.unit, target: m.target, direction: m.direction,
    meets, status: 'measured', control: m.control, evidencePath: m.evidencePath, question: m.question,
  };
}

// The risk heat map: modelled threats placed by severity × control state.
function riskHeatmap({ residual = [] } = {}) {
  const cells = residual.map((r) => {
    const exposure = r.exposure ?? 0;
    const band = HEATMAP_BANDS.find((b) => exposure >= b.min).band;
    return { threat: r.threat, severity: r.severity, exposure, band, failingControls: r.failing || [], missingControls: r.unimplemented || [] };
  }).sort((a, b) => b.exposure - a.exposure || a.threat.localeCompare(b.threat));
  const byBand = cells.reduce((m, c) => ((m[c.band] = (m[c.band] || 0) + 1), m), {});
  return { cells, byBand, worst: cells[0] || null, clean: cells.length === 0, note: 'Placed by severity × control state. A threat with every control holding does not appear.' };
}

// The dashboard: every metric, its evidence trace, and the heat map.
function dashboard(evidence = {}) {
  const metrics = Object.keys(METRICS).map((id) => renderMetric(id, evidence));
  const measured = metrics.filter((m) => m.status === 'measured');
  const failing = measured.filter((m) => m.meets === false);
  return {
    audience: 'Executive and board', cadence: 'per build',
    metrics,
    coverage: +(measured.length / metrics.length).toFixed(3),
    unavailable: metrics.filter((m) => m.status === 'unavailable').map((m) => ({ metric: m.metric, missingEvidence: m.missingEvidence })),
    failing: failing.map((m) => ({ metric: m.metric, value: m.value, target: m.target })),
    healthy: failing.length === 0 && measured.length === metrics.length,
    riskHeatmap: riskHeatmap({ residual: (evidence.risk && evidence.risk.residual) || [] }),
    informationalOnly: true, authorizes: false,
    note: 'Every value is resolved from evidence by declared path. No metric can be entered by hand, and a metric without evidence stays unavailable.',
  };
}

// Traceability: metric → evidence path → verifying control. The answer to "where did this come from?"
function evidenceTrace() {
  return Object.entries(METRICS).map(([id, m]) => ({ metric: id, title: m.title, evidencePath: m.evidencePath, verifyingControl: m.control, question: m.question }));
}

function validate({ knownFitnessIds = [] } = {}) {
  const violations = [];
  const known = new Set(knownFitnessIds);
  const required = ['architecture-health', 'security-posture', 'compliance-posture', 'reliability', 'performance', 'operational-readiness', 'technical-debt', 'deployment-readiness', 'risk-exposure', 'legislative-readiness', 'data-governance', 'recovery-readiness'];
  for (const id of required) if (!METRICS[id]) violations.push(`executive dashboard is missing the '${id}' metric`);
  for (const [id, m] of Object.entries(METRICS)) {
    if (!m.evidencePath) violations.push(`${id}: no evidence path — this metric could only be entered by hand`);
    if (!m.control) violations.push(`${id}: no verifying control`);
    if (known.size && !known.has(m.control)) violations.push(`${id}: verifying control '${m.control}' is not a real fitness function`);
    if (!m.question) violations.push(`${id}: does not state the question it answers`);
    if (!['higher-is-better', 'lower-is-better', 'must-be-true'].includes(m.direction)) violations.push(`${id}: unknown direction`);
  }
  return { valid: violations.length === 0, violations, metrics: Object.keys(METRICS).length };
}

module.exports = { METRICS, HEATMAP_BANDS, renderMetric, dashboard, riskHeatmap, evidenceTrace, validate };
