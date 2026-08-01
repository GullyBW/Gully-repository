'use strict';
// Process Governance Mining (Stabilization Part 10). Extends process mining beyond operational
// efficiency into GOVERNANCE: deviation from the mandated sequence, policy violations,
// separation-of-duties breaches, approval anomalies, fraud indicators, unusual workflow
// patterns, bottlenecks and compliance failures — and correlates each finding class with the
// architectural fitness function that is supposed to prevent it.
//
// Deterministic. Reads only non-identifying event metadata (type / actor id / logical time).
// Every output is a SIGNAL, never a verdict: findings are advisory and explainable, and a
// finding about a person is impossible because no person is in the data.
const processMining = require('./process-mining');

// Which fitness function is expected to prevent each class of governance finding. A finding
// raised while its control is green means the control's SCOPE is wrong — that is the useful
// signal, and it is why this correlation exists.
const CONTROL_MAP = {
  'governance-deviation': 'APP-FIT-WORKFLOW-SIMULATION',
  'policy-violation': 'APP-FIT-POLICY-AS-DATA',
  'sod-breach': 'APP-FIT-AUTHZ-DEFAULT-DENY',
  'approval-anomaly': 'FIT-GOVERNANCE',
  'fraud-indicator': 'APP-FIT-WORKFLOW-INTEGRITY',
  'unusual-pattern': 'APP-FIT-PROCESS-MINING',
  'compliance-failure': 'APP-FIT-LIFECYCLE-DEFAULT-DENY',
};

// Activities that must not be performed on the same case by the same actor.
const DEFAULT_SOD_PAIRS = [
  ['CaseSubmitted', 'CaseReviewed'],
  ['CaseReviewed', 'GovernanceDecided'],
  ['EvidenceAttached', 'EvidenceAdmitted'],
];

const finding = (kind, detail) => ({ kind, control: CONTROL_MAP[kind] || null, ...detail });

// --- Governance deviation ----------------------------------------------------------------

// Cases that skipped a mandated step or performed steps out of the mandated order.
function governanceDeviations(events, { requiredSequence = [] } = {}) {
  const out = [];
  if (!requiredSequence.length) return { findings: out, cases: 0, requiredSequence };
  for (const [caseId, seq] of processMining.traces(events)) {
    const types = seq.map((e) => e.type);
    const missing = requiredSequence.filter((t) => !types.includes(t));
    if (missing.length) out.push(finding('governance-deviation', { caseId, reason: 'mandated step missing', detail: missing, severity: 'high' }));
    // Order check over the steps that ARE present.
    const present = requiredSequence.filter((t) => types.includes(t));
    const positions = present.map((t) => types.indexOf(t));
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] < positions[i - 1]) { out.push(finding('governance-deviation', { caseId, reason: 'mandated steps out of order', detail: `${present[i]} preceded ${present[i - 1]}`, severity: 'high' })); break; }
    }
  }
  return { findings: out, cases: processMining.traces(events).size, requiredSequence };
}

// --- Policy violation ----------------------------------------------------------------------

// Rules are DATA: { id, forbiddenEdge } or { id, requires: {activity, precededBy} }.
function policyViolations(events, { rules = [] } = {}) {
  const out = [];
  for (const [caseId, seq] of processMining.traces(events)) {
    const types = seq.map((e) => e.type);
    for (const rule of rules) {
      if (rule.forbiddenEdge) {
        for (let i = 0; i < types.length - 1; i++) if (`${types[i]}->${types[i + 1]}` === rule.forbiddenEdge) out.push(finding('policy-violation', { caseId, rule: rule.id, reason: 'forbidden transition observed', detail: rule.forbiddenEdge, severity: 'high' }));
      }
      if (rule.requires) {
        const at = types.indexOf(rule.requires.activity);
        const before = types.indexOf(rule.requires.precededBy);
        if (at !== -1 && (before === -1 || before > at)) out.push(finding('policy-violation', { caseId, rule: rule.id, reason: `${rule.requires.activity} without a preceding ${rule.requires.precededBy}`, severity: 'high' }));
      }
    }
  }
  return { findings: out, rules: rules.length };
}

// --- Separation of duties -------------------------------------------------------------------

// The same actor performing both halves of a conflicting pair on one case.
function segregationOfDutiesBreaches(events, { pairs = DEFAULT_SOD_PAIRS } = {}) {
  const out = [];
  for (const [caseId, seq] of processMining.traces(events)) {
    for (const [a, b] of pairs) {
      const actorsA = new Set(seq.filter((e) => e.type === a).map((e) => e.actor));
      const actorsB = new Set(seq.filter((e) => e.type === b).map((e) => e.actor));
      for (const actor of actorsA) if (actorsB.has(actor) && actor != null) out.push(finding('sod-breach', { caseId, actor, reason: `same actor performed ${a} and ${b}`, severity: 'high' }));
    }
  }
  return { findings: out, pairs };
}

// --- Approval anomalies ------------------------------------------------------------------------

// Rubber-stamping (an approval faster than a plausible minimum dwell) and unreviewed approvals.
function approvalAnomalies(events, { approvalTypes = ['GovernanceDecided', 'CaseReviewed'], minDwellMs = 60_000, reviewType = null } = {}) {
  const out = [];
  for (const [caseId, seq] of processMining.traces(events)) {
    for (let i = 0; i < seq.length; i++) {
      if (!approvalTypes.includes(seq[i].type)) continue;
      const prev = seq[i - 1];
      if (prev) {
        const dwell = seq[i].at - prev.at;
        if (dwell < minDwellMs) out.push(finding('approval-anomaly', { caseId, reason: 'approval faster than the minimum plausible review time', detail: { activity: seq[i].type, dwellMs: dwell, minDwellMs }, severity: 'medium' }));
      } else {
        out.push(finding('approval-anomaly', { caseId, reason: 'approval is the first recorded activity on the case', detail: seq[i].type, severity: 'high' }));
      }
      if (reviewType && !seq.slice(0, i).some((e) => e.type === reviewType)) out.push(finding('approval-anomaly', { caseId, reason: `approval without a preceding ${reviewType}`, detail: seq[i].type, severity: 'high' }));
    }
  }
  return { findings: out, minDwellMs };
}

// --- Unusual patterns ----------------------------------------------------------------------------

// Rare directly-follows edges: paths the process almost never takes are worth a human look.
function unusualPatterns(events, { rareThreshold = 0.05 } = {}) {
  const dfg = processMining.discover(events).edges;
  const total = Object.values(dfg).reduce((a, b) => a + b, 0);
  const out = [];
  if (!total) return { findings: out, edges: 0 };
  for (const [edge, count] of Object.entries(dfg)) {
    const share = count / total;
    if (share <= rareThreshold) out.push(finding('unusual-pattern', { reason: 'rare transition', detail: { edge, count, share: +share.toFixed(4) }, severity: 'low' }));
  }
  out.sort((a, b) => a.detail.share - b.detail.share || a.detail.edge.localeCompare(b.detail.edge));
  return { findings: out, edges: Object.keys(dfg).length };
}

// --- Fraud indicators -------------------------------------------------------------------------------

// Composite, explainable indicators. Each one names the observations that produced it; none is
// an accusation, and none identifies a person — actors are role-coded principal ids.
function fraudIndicators(events, { minDwellMs = 60_000, reversalTypes = [] } = {}) {
  const sod = segregationOfDutiesBreaches(events).findings;
  const fast = approvalAnomalies(events, { minDwellMs }).findings.filter((f) => /faster than/.test(f.reason));
  const byCase = new Map();
  const add = (caseId, signal) => { if (!byCase.has(caseId)) byCase.set(caseId, []); byCase.get(caseId).push(signal); };
  for (const f of sod) add(f.caseId, 'separation-of-duties breach');
  for (const f of fast) add(f.caseId, 'approval faster than plausible review');
  // Repeated reversals on one case (decide → undo → decide) are a classic manipulation shape.
  if (reversalTypes.length) {
    for (const [caseId, seq] of processMining.traces(events)) {
      const reversals = seq.filter((e) => reversalTypes.includes(e.type)).length;
      if (reversals >= 2) add(caseId, `repeated reversals (${reversals})`);
    }
  }
  const out = [...byCase.entries()].map(([caseId, signals]) => finding('fraud-indicator', {
    caseId, signals, signalCount: signals.length,
    severity: signals.length >= 2 ? 'high' : 'medium',
    reason: 'multiple governance signals coincide on one case',
  })).sort((a, b) => b.signalCount - a.signalCount || String(a.caseId).localeCompare(String(b.caseId)));
  return { findings: out, advisoryOnly: true, note: 'Indicators are signals for human review, never findings of fraud. No personal data is involved.' };
}

// --- Compliance failures -------------------------------------------------------------------------------

// Cases that breached the SLA or never reached a terminal activity.
function complianceFailures(events, { slaMs = 7 * 24 * 3600_000, terminalTypes = ['CaseTransitioned'] } = {}) {
  const out = [];
  const sla = processMining.slaDeviations(events, { thresholdMs: slaMs });
  for (const c of sla.cases) out.push(finding('compliance-failure', { caseId: c.caseId, reason: 'SLA breached', detail: { cycleMs: c.cycleMs, slaMs }, severity: 'medium' }));
  for (const [caseId, seq] of processMining.traces(events)) {
    if (seq.length && !seq.some((e) => terminalTypes.includes(e.type))) out.push(finding('compliance-failure', { caseId, reason: 'case never reached a terminal activity', severity: 'low' }));
  }
  return { findings: out, slaMs };
}

// --- Correlation with the fitness gate ------------------------------------------------------------------

// Correlate findings with the architectural controls meant to prevent them. Two useful states:
// a finding whose control is FAILING (expected — fix the control) and a finding whose control is
// GREEN (the control's scope does not cover this path — that is the discovery).
function correlateWithFitness(findings, fitnessResults = []) {
  const state = new Map(fitnessResults.map((r) => [r.id, r.pass]));
  const byControl = {};
  for (const f of findings) {
    const control = f.control || 'uncontrolled';
    if (!byControl[control]) byControl[control] = { control, findings: 0, controlKnown: state.has(control), controlHolding: state.get(control) ?? null, kinds: new Set() };
    byControl[control].findings++; byControl[control].kinds.add(f.kind);
  }
  const rows = Object.values(byControl).map((r) => ({
    control: r.control, findings: r.findings, kinds: [...r.kinds].sort(),
    controlKnown: r.controlKnown, controlHolding: r.controlHolding,
    interpretation: !r.controlKnown ? 'no fitness function covers this finding class — a control gap'
      : r.controlHolding === false ? 'the control is already failing — the finding corroborates it'
        : 'the control holds yet the behaviour occurred — the control does not cover this path (review its scope)',
  })).sort((a, b) => b.findings - a.findings || a.control.localeCompare(b.control));
  return { correlations: rows, advisoryOnly: true, note: 'Correlation explains findings against architectural controls; it never re-classifies a control as passing or failing.' };
}

// --- Consolidated governance report -------------------------------------------------------------------------

function report(events, { requiredSequence = [], rules = [], sodPairs = DEFAULT_SOD_PAIRS, minDwellMs = 60_000, slaMs = 7 * 24 * 3600_000, reversalTypes = [], fitnessResults = [] } = {}) {
  const deviations = governanceDeviations(events, { requiredSequence });
  const policy = policyViolations(events, { rules });
  const sod = segregationOfDutiesBreaches(events, { pairs: sodPairs });
  const approvals = approvalAnomalies(events, { minDwellMs });
  const unusual = unusualPatterns(events);
  const fraud = fraudIndicators(events, { minDwellMs, reversalTypes });
  const compliance = complianceFailures(events, { slaMs });
  const all = [...deviations.findings, ...policy.findings, ...sod.findings, ...approvals.findings, ...unusual.findings, ...fraud.findings, ...compliance.findings];
  return {
    findings: all,
    bySeverity: all.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}),
    byKind: all.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {}),
    governanceDeviations: deviations, policyViolations: policy, sodBreaches: sod,
    approvalAnomalies: approvals, unusualPatterns: unusual, fraudIndicators: fraud,
    complianceFailures: compliance,
    bottlenecks: processMining.bottlenecks(events),
    correlation: correlateWithFitness(all, fitnessResults),
    advisoryOnly: true, authorizes: false,
    note: 'Process governance findings are explainable signals for human review. They never authorize an action and never identify a person.',
  };
}

module.exports = {
  CONTROL_MAP, DEFAULT_SOD_PAIRS,
  governanceDeviations, policyViolations, segregationOfDutiesBreaches, approvalAnomalies,
  unusualPatterns, fraudIndicators, complianceFailures, correlateWithFitness, report,
};
