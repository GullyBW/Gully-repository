'use strict';
// Observability by DOMAIN and AUDIENCE (Stabilization Part 12). One "national dashboard" serves
// nobody: an architect, a security officer, an SRE, an oversight board member, a service owner
// and an infrastructure operator need different questions answered at different cadences.
//
// Six domains, each with a named audience, the governance board that consumes it, and widgets
// resolved from live sources by dotted path. Deterministic; privacy-preserving (identity is
// refused and small counts are suppressed, exactly as in analytics).
const analytics = require('../analytics');

// Values that must never reach a dashboard, whoever the audience is.
const IDENTITY_MARKER = /(^|[^a-z])(email|omang|nationalid|phone|address|dob|reporter)([^a-z]|$)|@[a-z0-9.-]+\.[a-z]{2,}/i;

const DOMAINS = {
  'engineering-health': {
    title: 'Engineering Health', audience: 'Architects and engineering leads', board: 'ARB', cadence: 'per build',
    question: 'Is the architecture still true, and is the platform still buildable?',
    widgets: [
      { id: 'invariants-held', title: 'Architecture invariants held', source: 'fitness.held', type: 'ratio', of: 'fitness.total' },
      { id: 'failing-invariants', title: 'Failing invariants', source: 'fitness.failing', type: 'list' },
      { id: 'context-map-valid', title: 'Architecture-of-record valid', source: 'architecture.valid', type: 'boolean' },
      { id: 'contract-coverage', title: 'Boundary crossings under contract', source: 'contracts.covered', type: 'count' },
      { id: 'technical-debt', title: 'Open invariant failures', source: 'evolution.openInvariantFailures', type: 'count' },
      { id: 'maturity-grade', title: 'Engineering maturity grade', source: 'maturity.grade', type: 'label' },
    ],
  },
  'security-posture': {
    title: 'Security Posture', audience: 'Security officers and the security operations centre', board: 'ISRB', cadence: 'continuous',
    question: 'Is the platform defensible right now, and is anything degrading?',
    widgets: [
      { id: 'policy-certified', title: 'Access policy certified', source: 'security.policiesCertified', type: 'boolean' },
      { id: 'devsecops-clean', title: 'DevSecOps findings (credential class)', source: 'security.credentialFindings', type: 'count' },
      { id: 'cert-rotation', title: 'Certificates due for rotation', source: 'security.certificatesDue', type: 'count' },
      { id: 'crypto-independence', title: 'Algorithm independence holds', source: 'security.algorithmIndependence', type: 'boolean' },
      { id: 'supply-chain', title: 'Third-party dependencies', source: 'security.thirdPartyDependencies', type: 'count' },
      { id: 'threat-posture', title: 'Threat intelligence posture', source: 'security.threatPosture', type: 'label' },
    ],
  },
  'operational-performance': {
    title: 'Operational Performance', audience: 'Site reliability engineers and operations managers', board: 'ORB', cadence: 'live',
    question: 'Are we meeting our objectives, and how much error budget is left?',
    widgets: [
      { id: 'slo-healthy', title: 'All SLOs met', source: 'operations.sloHealthy', type: 'boolean' },
      { id: 'availability', title: 'Availability SLI', source: 'operations.availability', type: 'ratio' },
      { id: 'latency-p95', title: 'Latency p95 (ms)', source: 'operations.p95', type: 'number' },
      { id: 'error-budget', title: 'Error budget consumed', source: 'operations.errorBudgetConsumed', type: 'number' },
      { id: 'open-alerts', title: 'Open alerts', source: 'operations.alerts', type: 'count' },
      { id: 'resilience', title: 'Resilience suite passing', source: 'operations.resiliencePass', type: 'boolean' },
    ],
  },
  'governance-effectiveness': {
    title: 'Governance Effectiveness', audience: 'Oversight board members and governance officials', board: 'OB', cadence: 'weekly',
    question: 'Are humans actually deciding, and is every decision traceable?',
    widgets: [
      { id: 'decisions-recorded', title: 'Governance decisions recorded', source: 'governance.decisionsRecorded', type: 'count' },
      { id: 'human-density', title: 'Human governance density', source: 'governance.humanGovernanceDensity', type: 'number' },
      { id: 'pending-approvals', title: 'Recommendations awaiting human approval', source: 'governance.pendingApprovals', type: 'count' },
      { id: 'ledger-integrity', title: 'Decision ledger integrity', source: 'governance.ledgerIntegrity', type: 'boolean' },
      { id: 'ownership-complete', title: 'Subsystems with a complete owner', source: 'governance.ownedSubsystems', type: 'count' },
      { id: 'compliance-coverage', title: 'Compliance coverage', source: 'governance.complianceCoverage', type: 'ratio' },
    ],
  },
  'citizen-service-delivery': {
    title: 'Citizen Service Delivery', audience: 'Service owners and the service delivery board', board: 'SDB', cadence: 'daily',
    question: 'Is the public actually being served, and where is the service failing them?',
    widgets: [
      { id: 'cases-received', title: 'Reports received', source: 'service.total', type: 'count' },
      { id: 'resolution-rate', title: 'Resolution rate', source: 'service.resolutionRate', type: 'ratio' },
      { id: 'sla-compliance', title: 'SLA compliance', source: 'service.slaCompliance', type: 'ratio' },
      { id: 'backlog', title: 'Backlog', source: 'service.backlog', type: 'count' },
      { id: 'time-to-first-review', title: 'Mean time to first review (ms)', source: 'service.avgTimeToFirstReviewMs', type: 'number' },
      { id: 'usability-blockers', title: 'Open usability blockers', source: 'service.usabilityBlockers', type: 'count' },
    ],
  },
  'infrastructure-health': {
    title: 'Infrastructure Health', audience: 'Infrastructure operators and the data centre authority', board: 'ORB', cadence: 'continuous',
    question: 'Is the estate compliant, current and recoverable?',
    widgets: [
      { id: 'residency-compliant', title: 'Residency policy compliant', source: 'infrastructure.compliant', type: 'boolean' },
      { id: 'drift', title: 'Unreviewed drift', source: 'infrastructure.drift', type: 'boolean' },
      { id: 'iac-valid', title: 'Infrastructure-as-Code valid', source: 'infrastructure.iacValid', type: 'boolean' },
      { id: 'backup-verified', title: 'Backup restore-verified', source: 'infrastructure.backupVerified', type: 'boolean' },
      { id: 'unsupported', title: 'Unsupported components', source: 'infrastructure.unsupported', type: 'count' },
      { id: 'eol-approaching', title: 'Components approaching end of life', source: 'infrastructure.approachingEol', type: 'count' },
    ],
  },
};

const ids = () => Object.keys(DOMAINS);
const resolve = (sources, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), sources);

// Render one widget from the live sources, applying the privacy rules for its type.
function renderWidget(w, sources) {
  const raw = resolve(sources, w.source);
  if (raw === undefined) return { ...w, value: null, status: 'unavailable' };
  if (typeof raw === 'string' && IDENTITY_MARKER.test(raw)) return { ...w, value: null, status: 'refused', reason: 'identity value refused on a dashboard' };
  if (w.type === 'count' && typeof raw === 'number') {
    // Small-cell suppression: the same rule analytics applies, applied at the dashboard too.
    const s = analytics.suppress ? analytics.suppress(raw) : { count: raw };
    return { ...w, value: s.count, suppressed: !!s.suppressed, status: 'ok' };
  }
  if (w.type === 'ratio' && w.of) {
    const total = resolve(sources, w.of);
    return { ...w, value: typeof raw === 'number' && typeof total === 'number' && total ? +(raw / total).toFixed(3) : null, numerator: raw, denominator: total ?? null, status: 'ok' };
  }
  if (w.type === 'list' && Array.isArray(raw)) return { ...w, value: raw.slice(0, 10), count: raw.length, status: 'ok' };
  return { ...w, value: raw, status: 'ok' };
}

function dashboard(id, sources = {}) {
  const d = DOMAINS[id];
  if (!d) throw new Error('unknown observability domain: ' + id);
  const widgets = d.widgets.map((w) => renderWidget(w, sources));
  return {
    domain: id, title: d.title, audience: d.audience, board: d.board, cadence: d.cadence, question: d.question,
    widgets,
    available: widgets.filter((w) => w.status === 'ok').length,
    informationalOnly: true, authorizes: false,
    note: 'Informational dashboard for its named audience. No dashboard authorizes an action.',
  };
}
function all(sources = {}) { return Object.fromEntries(ids().map((id) => [id, dashboard(id, sources)])); }
function audiences() { return ids().map((id) => ({ domain: id, audience: DOMAINS[id].audience, board: DOMAINS[id].board, cadence: DOMAINS[id].cadence, question: DOMAINS[id].question })); }

// Every domain must name an audience, a board, a question, and carry distinct widgets.
function validate({ boards = [] } = {}) {
  const violations = [];
  const known = new Set(boards);
  const seenWidgets = new Set();
  for (const id of ids()) {
    const d = DOMAINS[id];
    if (!d.audience) violations.push(`${id}: no named audience`);
    if (!d.question) violations.push(`${id}: no question the dashboard answers`);
    if (!d.cadence) violations.push(`${id}: no cadence`);
    if (known.size && !known.has(d.board)) violations.push(`${id}: board '${d.board}' is not a recognised governance board`);
    if (d.widgets.length < 4) violations.push(`${id}: fewer than four widgets`);
    for (const w of d.widgets) {
      const key = `${id}:${w.id}`;
      if (seenWidgets.has(key)) violations.push(`${id}: duplicate widget '${w.id}'`);
      seenWidgets.add(key);
      if (!w.source) violations.push(`${id}.${w.id}: no source`);
      if (w.type === 'ratio' && !w.of && !/rate|compliance|coverage|availability/i.test(w.source)) violations.push(`${id}.${w.id}: ratio widget without a denominator`);
    }
  }
  return { valid: violations.length === 0, violations, domains: ids().length };
}

module.exports = { DOMAINS, ids, dashboard, all, audiences, validate, renderWidget, IDENTITY_MARKER };
