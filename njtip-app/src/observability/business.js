'use strict';
// Business Observability (Phase 11, Part 5). Technical telemetry answers "is the system up?".
// This module answers the question the Oversight Board actually asks: "is justice moving?"
//
// Every metric here is DERIVED from the platform's own event stream — none is hand-entered, and
// the derivation refuses any event carrying an identity field, so a business dashboard can never
// become a surveillance surface. Metrics are correlated with the technical signals that plausibly
// drive them, but correlation is reported as correlation: it names a hypothesis for a human to
// investigate, it never asserts a cause.
const { IDENTITY_FIELDS } = require('../privacy/privacy-engineering');
const sre = require('./sre');

// --- Metric catalogue ---------------------------------------------------------------------------
// direction: 'higher-better' | 'lower-better'. `objective` is the level the service owner
// committed to; `warn` is the level at which the trend is worth a conversation.
const BUSINESS_METRICS = {
  'case-throughput': {
    title: 'Case throughput', unit: 'cases/period', direction: 'higher-better',
    objective: 20, warn: 25, board: 'SDB',
    derivedFrom: 'CaseTransitioned events reaching a terminal state',
    correlatesWith: ['case-status', 'investigation'],
    meaning: 'Cases closed per period. A falling throughput means the backlog is growing.',
  },
  'investigation-latency': {
    title: 'Investigation latency', unit: 'hours', direction: 'lower-better',
    objective: 168, warn: 120, board: 'SDB',
    derivedFrom: 'CaseCreated → terminal CaseTransitioned dwell time',
    correlatesWith: ['investigation'],
    meaning: 'How long a case takes end to end. This is what a reporter experiences as "nothing is happening".',
  },
  'evidence-processing-time': {
    title: 'Evidence processing time', unit: 'hours', direction: 'lower-better',
    objective: 48, warn: 36, board: 'SDB',
    derivedFrom: 'EvidenceIngested → EvidenceAdmitted dwell time',
    correlatesWith: ['investigation'],
    meaning: 'Evidence sitting unprocessed is evidence decaying. Chain of custody holds; relevance does not.',
  },
  'judicial-workflow-duration': {
    title: 'Judicial workflow duration', unit: 'hours', direction: 'lower-better',
    objective: 336, warn: 240, board: 'OB',
    derivedFrom: 'CaseReviewed → GovernanceDecided dwell time',
    correlatesWith: ['governance-decision', 'oversight'],
    meaning: 'Time from a matter reaching the judiciary to a recorded decision.',
  },
  'policy-violation-rate': {
    title: 'Policy violation rate', unit: 'violations/100 events', direction: 'lower-better',
    objective: 2, warn: 1, board: 'OB',
    derivedFrom: 'PolicyViolated events per 100 domain events',
    correlatesWith: ['investigation', 'governance-decision'],
    meaning: 'Rising violations mean policy and practice have drifted apart. One of them is wrong.',
  },
  'audit-completion-rate': {
    title: 'Audit completion rate', unit: 'fraction', direction: 'higher-better',
    objective: 0.95, warn: 0.98, board: 'OB',
    derivedFrom: 'AuditCompleted / AuditScheduled',
    correlatesWith: ['oversight'],
    meaning: 'An audit programme that does not complete is an assurance claim with no evidence behind it.',
  },
  'governance-review-time': {
    title: 'Governance review time', unit: 'hours', direction: 'lower-better',
    objective: 120, warn: 96, board: 'OB',
    derivedFrom: 'ReviewRequested → ReviewCompleted dwell time',
    correlatesWith: ['governance-decision'],
    meaning: 'How long a governance board takes to review what is put in front of it.',
  },
  'approval-delay': {
    title: 'Approval delay', unit: 'hours', direction: 'lower-better',
    objective: 72, warn: 48, board: 'OB',
    derivedFrom: 'ApprovalRequested → ApprovalGranted/ApprovalRejected dwell time',
    correlatesWith: ['governance-decision'],
    meaning: 'Delay between asking a named human to decide and that human deciding.',
  },
  'compliance-rate': {
    title: 'Compliance rate', unit: 'fraction', direction: 'higher-better',
    objective: 0.98, warn: 0.99, board: 'OB',
    derivedFrom: 'ComplianceChecked events with outcome ok',
    correlatesWith: ['oversight', 'governance-decision'],
    meaning: 'Share of compliance checks that passed in the period.',
  },
};

// Dwell-time metric definitions: start event → any of the end events, keyed by correlation id.
const DWELL_METRICS = {
  'investigation-latency': { from: ['CaseCreated'], to: ['CaseTransitioned'], terminal: ['closed', 'resolved', 'referred'] },
  'evidence-processing-time': { from: ['EvidenceIngested'], to: ['EvidenceAdmitted'] },
  'judicial-workflow-duration': { from: ['CaseReviewed'], to: ['GovernanceDecided'] },
  'governance-review-time': { from: ['ReviewRequested'], to: ['ReviewCompleted'] },
  'approval-delay': { from: ['ApprovalRequested'], to: ['ApprovalGranted', 'ApprovalRejected'] },
};

const HOUR_MS = 3600_000;

// The platform's own event vocabulary mapped onto the metric vocabulary. Keeping these separate
// means a domain event can be renamed without silently zeroing a national KPI — the alias is the
// seam, and an unmapped type simply carries through under its own name.
const EVENT_ALIASES = {
  CaseSubmitted: 'CaseCreated',
  EvidenceAttached: 'EvidenceIngested',
  EvidenceAdmitted: 'EvidenceAdmitted',
  CaseReviewed: 'CaseReviewed',
  CaseTransitioned: 'CaseTransitioned',
  GovernanceDecided: 'GovernanceDecided',
};

// Bridge: turn immutable event-store records into the PII-free shape the metrics read. Only the
// four fields a business metric needs are carried across — everything else is deliberately dropped
// at the boundary, so a new field in the domain cannot leak into an analytics surface by default.
function fromEventLog(records = []) {
  return records.map((r) => {
    const data = r.data || {};
    return {
      type: EVENT_ALIASES[r.type] || r.type,
      correlationId: r.streamId ?? r.correlationId ?? null,
      at: (r.meta && r.meta.at) ?? r.at ?? 0,
      to: data.to ?? null,
      outcome: data.outcome ?? null,
    };
  });
}

// --- Event hygiene --------------------------------------------------------------------------------

// A business metric may only be derived from PII-free events. This is checked, not assumed: an
// event carrying an identity field is REFUSED, not stripped — silently dropping a field would hide
// the fact that something upstream is emitting identity into an analytics stream.
function assertPiiFree(events = []) {
  const offences = [];
  events.forEach((e, i) => {
    for (const k of Object.keys(e || {})) {
      if (IDENTITY_FIELDS.has(String(k).toLowerCase())) offences.push({ index: i, type: e.type ?? null, field: k });
    }
  });
  if (offences.length) {
    const f = offences[0];
    throw new Error(`business observability refuses identity-bearing events: event ${f.index} (${f.type}) carries '${f.field}'`);
  }
  return true;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// --- Derivation -------------------------------------------------------------------------------------

// Dwell time between a start and an end event sharing a correlation id. Unmatched starts are
// counted as `open` — an in-flight case is not a fast case, and averaging only completed work is
// the classic way to make a growing backlog look healthy.
function dwellTimes(events = [], metric) {
  const def = DWELL_METRICS[metric];
  if (!def) throw new Error('unknown dwell metric: ' + metric);
  const starts = new Map();
  const durations = [];
  const ordered = [...events].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || String(a.type).localeCompare(String(b.type)));
  for (const e of ordered) {
    const key = e.correlationId ?? e.caseCode ?? e.subjectId ?? null;
    if (key === null) continue;
    if (def.from.includes(e.type)) { if (!starts.has(key)) starts.set(key, e.at ?? 0); continue; }
    if (def.to.includes(e.type)) {
      if (def.terminal && !def.terminal.includes(e.to)) continue;
      if (!starts.has(key)) continue;
      durations.push(((e.at ?? 0) - starts.get(key)) / HOUR_MS);
      starts.delete(key);
    }
  }
  durations.sort((a, b) => a - b);
  return {
    metric, completed: durations.length, open: starts.size,
    hours: durations.map((d) => +d.toFixed(3)),
    mean: durations.length ? +(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(3) : null,
    median: durations.length ? +percentile(durations, 50).toFixed(3) : null,
    p90: durations.length ? +percentile(durations, 90).toFixed(3) : null,
    max: durations.length ? +durations[durations.length - 1].toFixed(3) : null,
  };
}

// Derive every catalogue metric from one event stream. Missing evidence yields `null`, never a
// default — a metric with no evidence behind it must look absent, not healthy.
function derive(events = [], { periods = 1 } = {}) {
  assertPiiFree(events);
  const count = (pred) => events.filter(pred).length;
  const values = {};

  const terminal = DWELL_METRICS['investigation-latency'].terminal;
  const closed = count((e) => e.type === 'CaseTransitioned' && terminal.includes(e.to));
  values['case-throughput'] = periods > 0 ? +(closed / periods).toFixed(3) : null;

  for (const m of Object.keys(DWELL_METRICS)) {
    const d = dwellTimes(events, m);
    values[m] = d.median;
  }

  const domainEvents = count((e) => !!e.type);
  const violations = count((e) => e.type === 'PolicyViolated');
  values['policy-violation-rate'] = domainEvents > 0 ? +((violations / domainEvents) * 100).toFixed(3) : null;

  const scheduled = count((e) => e.type === 'AuditScheduled');
  const completedAudits = count((e) => e.type === 'AuditCompleted');
  values['audit-completion-rate'] = scheduled > 0 ? +Math.min(1, completedAudits / scheduled).toFixed(4) : null;

  const checks = count((e) => e.type === 'ComplianceChecked');
  const passed = count((e) => e.type === 'ComplianceChecked' && e.outcome === 'ok');
  values['compliance-rate'] = checks > 0 ? +(passed / checks).toFixed(4) : null;

  return values;
}

// Compare a derived value with its objective. `status` is one of met / warn / breached / no-evidence.
function assess(metric, value) {
  const def = BUSINESS_METRICS[metric];
  if (!def) throw new Error('unknown business metric: ' + metric);
  if (value === null || value === undefined) {
    return { metric, title: def.title, value: null, objective: def.objective, status: 'no-evidence', direction: def.direction, board: def.board, detail: 'no evidence in the period — a metric without evidence is not a passing metric' };
  }
  const higher = def.direction === 'higher-better';
  const met = higher ? value >= def.objective : value <= def.objective;
  const warn = higher ? value >= def.warn : value <= def.warn;
  return {
    metric, title: def.title, value, objective: def.objective, warnAt: def.warn, unit: def.unit,
    direction: def.direction, board: def.board,
    status: met ? (warn ? 'met' : 'warn') : 'breached',
    detail: met
      ? (warn ? 'comfortably within objective' : 'within objective but past the warning level')
      : `objective missed (${value} ${def.unit} vs ${def.objective})`,
  };
}

// --- Correlation with technical reliability ---------------------------------------------------------

// Pearson correlation over paired series. Deterministic; returns null when it cannot be computed
// rather than a misleading zero.
function correlation(xs = [], ys = []) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(4);
}

// Correlate each business metric's history with the availability history of the technical services
// the catalogue says it depends on. Output is explicitly a hypothesis, never a cause.
function correlateWithReliability({ businessHistory = {}, technicalHistory = {} } = {}) {
  const findings = [];
  for (const [metric, def] of Object.entries(BUSINESS_METRICS)) {
    const series = businessHistory[metric];
    if (!Array.isArray(series) || series.length < 3) continue;
    for (const service of def.correlatesWith) {
      const tech = technicalHistory[service];
      if (!Array.isArray(tech) || tech.length < 3) continue;
      const r = correlation(tech, series);
      if (r === null) continue;
      // Expected sign: for a higher-better business metric, availability and the metric should move
      // together. For a lower-better metric (a duration), availability rising should push it down.
      const expected = def.direction === 'higher-better' ? 1 : -1;
      const aligned = Math.sign(r) === expected;
      const strength = Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak';
      findings.push({
        metric, service, r, strength, aligned,
        businessTrend: sre.trend(series).direction, technicalTrend: sre.trend(tech).direction,
        hypothesis: strength === 'weak'
          ? `no useful relationship between ${service} availability and ${def.title.toLowerCase()}`
          : aligned
            ? `${strength} relationship: ${service} reliability moves with ${def.title.toLowerCase()} — investigate whether reliability is the constraint`
            : `${strength} relationship in the UNEXPECTED direction — ${def.title.toLowerCase()} does not respond to ${service} reliability as assumed; the model may be wrong`,
      });
    }
  }
  findings.sort((a, b) => Math.abs(b.r) - Math.abs(a.r) || a.metric.localeCompare(b.metric) || a.service.localeCompare(b.service));
  return {
    findings, actionable: findings.filter((f) => f.strength !== 'weak'),
    note: 'Correlation is a hypothesis for a human to test. This module never claims causation and never triggers an action on its own.',
    causal: false, authorizes: false,
  };
}

// --- The correlation chain (Phase 12, Part 5) ----------------------------------------------------
//
//     Infrastructure → Applications → Business Processes → Mission Outcomes
//
// The chain exists because the four layers are owned by four different groups who each see their
// own layer and none of the others. An infrastructure engineer knows a broker is degraded; nobody
// downstream knows that means evidence is queuing, which means cases stall, which means the
// platform is failing at the thing it exists to do. The links are DECLARED so the trace can be
// followed mechanically — and each link states the mechanism, so a reader can disagree with it.
const CHAIN_LAYERS = ['infrastructure', 'application', 'business', 'mission'];

// Mission outcomes: what the platform exists to achieve, in the Oversight Board's language.
const MISSION_OUTCOMES = {
  'reports-can-be-filed': { title: 'A citizen can file a report anonymously', constitutional: true, board: 'OB' },
  'cases-progress': { title: 'Reported conduct is investigated and reaches an outcome', constitutional: false, board: 'SDB' },
  'evidence-is-admissible': { title: 'Evidence retains an unbroken, admissible chain of custody', constitutional: true, board: 'OB' },
  'decisions-are-accountable': { title: 'Every governance decision is attributable to a named human', constitutional: true, board: 'OB' },
  'oversight-is-informed': { title: 'Oversight can see the true state of the system', constitutional: false, board: 'OB' },
};

// Declared links, layer to layer. `mechanism` is how the influence actually travels — a link with
// no mechanism is a diagram, not a model.
const CHAIN_LINKS = [
  // infrastructure → application
  { from: 'persistence-ind', fromLayer: 'infrastructure', to: 'intake-api', toLayer: 'application', mechanism: 'the intake service cannot durably record a report without its store' },
  { from: 'broker-ind', fromLayer: 'infrastructure', to: 'notification-service', toLayer: 'application', mechanism: 'status notifications are delivered through the broker' },
  { from: 'kms', fromLayer: 'infrastructure', to: 'evidence-store', toLayer: 'application', mechanism: 'evidence is encrypted at rest; no keys, no evidence' },
  { from: 'persistence-exec', fromLayer: 'infrastructure', to: 'case-service', toLayer: 'application', mechanism: 'case state is persisted in the executive zone' },
  { from: 'persistence-jud', fromLayer: 'infrastructure', to: 'governance-ledger', toLayer: 'application', mechanism: 'the decision ledger is persisted in the judiciary zone' },
  // application → business
  { from: 'intake-api', fromLayer: 'application', to: 'case-throughput', toLayer: 'business', mechanism: 'reports that cannot be filed never enter the pipeline' },
  { from: 'case-service', fromLayer: 'application', to: 'investigation-latency', toLayer: 'business', mechanism: 'case transitions are what move a case toward an outcome' },
  { from: 'evidence-store', fromLayer: 'application', to: 'evidence-processing-time', toLayer: 'business', mechanism: 'evidence cannot be admitted while the store is unavailable' },
  { from: 'governance-ledger', fromLayer: 'application', to: 'judicial-workflow-duration', toLayer: 'business', mechanism: 'a decision is not made until it is recorded' },
  { from: 'oversight-api', fromLayer: 'application', to: 'audit-completion-rate', toLayer: 'business', mechanism: 'audits are conducted through the oversight surface' },
  // business → mission
  { from: 'case-throughput', fromLayer: 'business', to: 'cases-progress', toLayer: 'mission', mechanism: 'throughput is the rate at which reported conduct reaches an outcome' },
  { from: 'investigation-latency', fromLayer: 'business', to: 'cases-progress', toLayer: 'mission', mechanism: 'a case that never concludes has not progressed, however active it looks' },
  { from: 'evidence-processing-time', fromLayer: 'business', to: 'evidence-is-admissible', toLayer: 'mission', mechanism: 'evidence left unprocessed decays in relevance even as custody holds' },
  { from: 'judicial-workflow-duration', fromLayer: 'business', to: 'decisions-are-accountable', toLayer: 'mission', mechanism: 'a decision deferred indefinitely is a decision nobody has taken' },
  { from: 'approval-delay', fromLayer: 'business', to: 'decisions-are-accountable', toLayer: 'mission', mechanism: 'delay between asking a human to decide and their deciding' },
  { from: 'audit-completion-rate', fromLayer: 'business', to: 'oversight-is-informed', toLayer: 'mission', mechanism: 'an incomplete audit programme is an assurance claim with no evidence' },
  // Found by validateChain(): this metric was measured and reached nothing. A board that takes too
  // long to review is a board that is not holding the system accountable, so the link is real and
  // was simply missing from the record.
  { from: 'governance-review-time', fromLayer: 'business', to: 'decisions-are-accountable', toLayer: 'mission', mechanism: 'a review that never concludes leaves the decision it was meant to test unmade' },
  { from: 'compliance-rate', fromLayer: 'business', to: 'oversight-is-informed', toLayer: 'mission', mechanism: 'compliance checks are how oversight sees whether practice matches policy' },
  { from: 'policy-violation-rate', fromLayer: 'business', to: 'oversight-is-informed', toLayer: 'mission', mechanism: 'rising violations mean policy and practice have drifted apart' },
];
// The one link that is structural rather than causal: the constitutional path.
const CONSTITUTIONAL_CHAIN = { from: 'intake-api', to: 'reports-can-be-filed', mechanism: 'if intake is unavailable, a citizen cannot file — the platform has failed at its purpose' };

function chainLinks() { return [...CHAIN_LINKS.map((l) => ({ ...l })), { ...CONSTITUTIONAL_CHAIN, fromLayer: 'application', toLayer: 'mission', constitutional: true }]; }
function missionOutcomes() { return Object.entries(MISSION_OUTCOMES).map(([id, m]) => ({ id, ...m })); }

// Trace a technical event forward through the chain to the mission outcomes it reaches. This is
// the question an incident commander actually has: "what does this break, in the language the
// board uses?"
function traceForward(origin, { visited = new Set() } = {}) {
  if (visited.has(origin)) return [];
  visited.add(origin);
  const links = chainLinks().filter((l) => l.from === origin);
  const paths = [];
  for (const l of links) {
    if (l.toLayer === 'mission') paths.push([{ ...l }]);
    else for (const rest of traceForward(l.to, { visited: new Set(visited) })) paths.push([{ ...l }, ...rest]);
  }
  return paths;
}

// The full impact of one or more failed technical components, expressed at every layer.
// Which topology services are infrastructure rather than application. Stated rather than inferred:
// "it has no dependencies" would classify a leaf application service as infrastructure.
const INFRASTRUCTURE_COMPONENTS = new Set(['persistence-ind', 'persistence-exec', 'persistence-jud', 'kms', 'object-store', 'broker-ind', 'broker-exec', 'broker-jud']);

function impactOf({ failed = [] } = {}) {
  const telemetry = require('./telemetry');
  const propagation = telemetry.failurePropagation(failed);
  const paths = [];
  for (const component of propagation.impacted) for (const path of traceForward(component)) paths.push({ origin: component, path });
  const businessAffected = [...new Set(paths.flatMap((p) => p.path.filter((l) => l.toLayer === 'business').map((l) => l.to)))].sort();
  const missionAffected = [...new Set(paths.flatMap((p) => p.path.filter((l) => l.toLayer === 'mission').map((l) => l.to)))].sort();
  const constitutional = missionAffected.filter((m) => MISSION_OUTCOMES[m] && MISSION_OUTCOMES[m].constitutional);
  return {
    failed: [...failed].sort(),
    infrastructure: propagation.impacted.filter((s) => INFRASTRUCTURE_COMPONENTS.has(s)).sort(),
    applications: propagation.impacted.filter((s) => !INFRASTRUCTURE_COMPONENTS.has(s)).sort(),
    degraded: propagation.degraded,
    businessProcesses: businessAffected,
    missionOutcomes: missionAffected.map((id) => ({ id, ...MISSION_OUTCOMES[id] })),
    constitutionalOutcomesAffected: constitutional,
    constitutionalImpact: constitutional.length > 0,
    paths: paths.map((p) => ({ origin: p.origin, chain: p.path.map((l) => `${l.from} → ${l.to}`).join(' → '), mechanisms: p.path.map((l) => l.mechanism) })),
    blastRadius: propagation.blastRadius,
    // Stated in the board's language, because that is the point of the chain.
    boardSummary: constitutional.length
      ? `A constitutional guarantee is affected: ${constitutional.map((c) => MISSION_OUTCOMES[c].title).join('; ')}.`
      : missionAffected.length
        ? `Mission outcomes affected: ${missionAffected.map((m) => MISSION_OUTCOMES[m].title).join('; ')}.`
        : 'No mission outcome is reached by this failure.',
    informationalOnly: true, authorizes: false,
  };
}

// Validate the chain itself: every link must join declared things, every business metric must
// reach a mission outcome, and every mission outcome must be reachable. A chain with an orphan at
// either end is a chain that will silently fail to trace the thing you needed it for.
function validateChain() {
  const telemetry = require('./telemetry');
  const violations = [];
  const known = { infrastructure: new Set(Object.keys(telemetry.TOPOLOGY)), application: new Set(Object.keys(telemetry.TOPOLOGY)), business: new Set(Object.keys(BUSINESS_METRICS)), mission: new Set(Object.keys(MISSION_OUTCOMES)) };
  for (const l of chainLinks()) {
    if (!CHAIN_LAYERS.includes(l.fromLayer) || !CHAIN_LAYERS.includes(l.toLayer)) violations.push(`link ${l.from} → ${l.to}: unknown layer`);
    if (CHAIN_LAYERS.indexOf(l.toLayer) <= CHAIN_LAYERS.indexOf(l.fromLayer)) violations.push(`link ${l.from} → ${l.to}: does not move forward through the chain`);
    if (!known[l.fromLayer] || !known[l.fromLayer].has(l.from)) violations.push(`link ${l.from} → ${l.to}: '${l.from}' is not a declared ${l.fromLayer}`);
    if (!known[l.toLayer] || !known[l.toLayer].has(l.to)) violations.push(`link ${l.from} → ${l.to}: '${l.to}' is not a declared ${l.toLayer}`);
    if (!l.mechanism) violations.push(`link ${l.from} → ${l.to}: no mechanism — a link with no mechanism is a diagram, not a model`);
  }
  // Every business metric must reach the mission, or nobody can say why it is measured.
  for (const metric of Object.keys(BUSINESS_METRICS)) {
    if (!chainLinks().some((l) => l.from === metric && l.toLayer === 'mission')) violations.push(`business metric '${metric}' reaches no mission outcome — why is it measured?`);
  }
  // Every mission outcome must be reachable, or nothing observable tells us about it.
  for (const outcome of Object.keys(MISSION_OUTCOMES)) {
    if (!chainLinks().some((l) => l.to === outcome)) violations.push(`mission outcome '${outcome}' is unreachable — nothing the platform measures says anything about it`);
  }
  return { valid: violations.length === 0, violations, links: chainLinks().length, layers: CHAIN_LAYERS.length, missionOutcomes: Object.keys(MISSION_OUTCOMES).length };
}

// Executive analytics: mission-level health, derived from the business metrics that feed each
// outcome. Every figure traces to measured evidence — an outcome fed only by unmeasured metrics
// reports as unknown, never as healthy.
function executiveAnalytics({ events = [], periods = 1, businessHistory = {} } = {}) {
  const dash = dashboard({ events, periods, businessHistory });
  const byMetric = Object.fromEntries(dash.metrics.map((m) => [m.metric, m]));
  const outcomes = Object.entries(MISSION_OUTCOMES).map(([id, outcome]) => {
    const feeding = chainLinks().filter((l) => l.to === id && l.fromLayer === 'business').map((l) => l.from);
    const measured = feeding.map((f) => byMetric[f]).filter((m) => m && m.status !== 'no-evidence');
    const breached = measured.filter((m) => m.status === 'breached');
    return {
      outcome: id, title: outcome.title, constitutional: outcome.constitutional, board: outcome.board,
      fedBy: feeding, measuredInputs: measured.length, totalInputs: feeding.length,
      status: measured.length === 0 ? 'unknown' : breached.length ? 'at-risk' : 'on-track',
      breachedInputs: breached.map((m) => m.metric),
      evidenceCoverage: feeding.length ? +(measured.length / feeding.length).toFixed(4) : 0,
      reason: measured.length === 0
        ? 'no measured business metric feeds this outcome — its state is unknown, which is not the same as fine'
        : breached.length ? `${breached.map((m) => m.title).join('; ')}` : 'every feeding metric is within objective',
    };
  });
  const atRisk = outcomes.filter((o) => o.status === 'at-risk');
  return {
    layers: CHAIN_LAYERS, missionOutcomes: outcomes,
    atRisk: atRisk.map((o) => o.outcome),
    constitutionalAtRisk: atRisk.filter((o) => o.constitutional).map((o) => o.outcome),
    unknown: outcomes.filter((o) => o.status === 'unknown').map((o) => o.outcome),
    businessDashboard: dash,
    chainValidation: validateChain(),
    derivedFromVerifiedEvidence: true,
    informationalOnly: true, authorizes: false,
    note: 'Mission outcomes derived from measured business metrics through the declared chain. An outcome with no measured input reports as unknown — which is not the same as fine.',
  };
}

// --- Dashboard & report --------------------------------------------------------------------------

function catalogue() { return Object.entries(BUSINESS_METRICS).map(([id, m]) => ({ id, ...m })); }

// Business KPI dashboard: derived values, objective assessment, trend and board routing.
function dashboard({ events = [], periods = 1, businessHistory = {} } = {}) {
  const values = derive(events, { periods });
  const metrics = Object.keys(BUSINESS_METRICS).map((id) => {
    const a = assess(id, values[id]);
    const series = businessHistory[id];
    const t = Array.isArray(series) && series.length >= 2 ? sre.trend(series) : null;
    // "improving" from the trend line means the number is rising; for a lower-better metric that
    // is the wrong way round, so the direction is interpreted against the metric's own polarity.
    const movement = !t ? 'unknown'
      : t.direction === 'flat' ? 'flat'
        : (BUSINESS_METRICS[id].direction === 'higher-better') === (t.direction === 'improving') ? 'improving' : 'worsening';
    return { ...a, trend: t, movement };
  });
  const breached = metrics.filter((m) => m.status === 'breached');
  const missing = metrics.filter((m) => m.status === 'no-evidence');
  return {
    periods, metrics,
    breached: breached.map((m) => m.metric),
    warning: metrics.filter((m) => m.status === 'warn').map((m) => m.metric),
    worsening: metrics.filter((m) => m.movement === 'worsening').map((m) => m.metric),
    noEvidence: missing.map((m) => m.metric),
    evidenceCoverage: +((metrics.length - missing.length) / metrics.length).toFixed(4),
    healthy: breached.length === 0 && missing.length === 0,
    byBoard: metrics.reduce((acc, m) => ((acc[m.board] = acc[m.board] || []).push(m.metric), acc), {}),
    informationalOnly: true, authorizes: false,
    note: 'Business KPIs derived from PII-free platform events. No value is hand-entered; a metric with no evidence reports as no-evidence, never as met.',
  };
}

function report({ events = [], periods = 1, businessHistory = {}, technicalHistory = {} } = {}) {
  const dash = dashboard({ events, periods, businessHistory });
  return {
    catalogue: catalogue(), dashboard: dash,
    dwell: Object.keys(DWELL_METRICS).map((m) => dwellTimes(events, m)),
    correlation: correlateWithReliability({ businessHistory, technicalHistory }),
    chain: { layers: CHAIN_LAYERS, links: chainLinks(), missionOutcomes: missionOutcomes(), validation: validateChain() },
    executiveAnalytics: executiveAnalytics({ events, periods, businessHistory }),
    piiFree: true, informationalOnly: true, authorizes: false,
    note: 'Business observability report. It describes how justice is moving; it decides nothing and identifies no one.',
  };
}

// --- Predictive mission impact analysis (Phase 12, Part 18) ---------------------------------------
//
// The chain above answers an incident commander's question: "what has this outage broken, in the
// board's language?" This section answers a different one, asked BEFORE anything is deployed:
//
//   Technical Event → Business Process → Justice Service → Citizen Impact → Mission Objective
//                                                                              → Strategic Goal
//
// Two layers sit between a business metric and a mission outcome, and they are the two nobody
// writes down. A JUSTICE SERVICE is the thing a citizen actually receives. A CITIZEN IMPACT is what
// happens to a person when they do not receive it — and it is stated in the citizen's words, not in
// the platform's, because "intake-api unavailable" is not an impact on anybody. "A person who
// decided today to report corruption cannot" is.
// Phase 13, Part 3 extends the chain past the citizen in both directions that were missing: what a
// sustained failure does to the INSTITUTION, and what that does to a GOVERNMENT mission outcome.
// The spec's "Service Impact" is the technical layer's service set and "Justice Process" is the
// justice-service layer; those were already here, so they are not duplicated under new names.
const MISSION_IMPACT_LAYERS = ['technical-event', 'business-process', 'justice-service', 'citizen-impact', 'institutional-impact', 'mission-objective', 'strategic-goal', 'government-mission-outcome'];

// The services the state actually delivers through this platform.
const JUSTICE_SERVICES = {
  'anonymous-reporting': { title: 'Report corruption without being identified', delivers: 'A route into the justice system for someone who cannot afford to be known to have used it.', constitutional: true },
  'case-investigation': { title: 'Have a report investigated to an outcome', delivers: 'The state examining reported conduct rather than filing it.', constitutional: false },
  'evidence-custody': { title: 'Have evidence preserved so it stands in court', delivers: 'An unbroken chain of custody, which is what makes evidence usable at all.', constitutional: true },
  'judicial-review': { title: 'Have a decision taken by an accountable authority', delivers: 'A named human answerable for the decision, and a record of it.', constitutional: true },
  'public-accountability': { title: 'See how the justice system is performing', delivers: 'Published, verifiable figures rather than assurances.', constitutional: false },
};

// What a person experiences when a service is not delivered. Severity is declared, because the
// ordering is a judgement about people and should be arguable rather than computed from a weight.
const CITIZEN_IMPACT_SEVERITY = ['severe', 'serious', 'material'];
const CITIZEN_IMPACTS = {
  'cannot-report': { severity: 'severe', experience: 'A person who decided today to report corruption cannot, and may not decide again.', irreversible: true },
  'identity-at-risk': { severity: 'severe', experience: 'A person who reported anonymously can be identified, which is the harm the whole design exists to prevent.', irreversible: true },
  'evidence-unusable': { severity: 'severe', experience: 'Evidence a person risked something to provide cannot be used, so the risk bought nothing.', irreversible: true },
  'case-stalls': { severity: 'serious', experience: 'A report sits without progressing, and the person who filed it is told nothing.', irreversible: false },
  'decision-unattributable': { severity: 'serious', experience: 'A decision affecting a person exists with nobody answerable for it, so it cannot be challenged.', irreversible: false },
  'accountability-invisible': { severity: 'material', experience: 'The public cannot tell whether the system is working, so trust rests on assertion.', irreversible: false },
};

// What a sustained citizen-level failure does to the institution itself. This layer is the one that
// turns an outage into an institutional problem: a citizen harmed once is an incident, and the same
// harm repeating is an institution that cannot discharge its mandate.
const INSTITUTIONAL_IMPACTS = {
  'mandate-undeliverable': { title: 'The institution cannot discharge its statutory mandate', institution: 'Directorate on Corruption and Economic Crime', escalatesTo: 'OB' },
  'evidence-base-unreliable': { title: 'The judiciary cannot rely on the evidence this platform produces', institution: 'Judiciary', escalatesTo: 'OB' },
  'oversight-cannot-report': { title: 'Oversight cannot report the true state of the system to Parliament', institution: 'Oversight Board', escalatesTo: 'OB' },
  'institutional-credibility-lost': { title: 'Public willingness to use the institution falls, and does not recover quickly', institution: 'Whole of government', escalatesTo: 'OB' },
};

// Government-level outcomes the strategic goals serve. The terminal layer: past here the platform
// has nothing further to say, and says so rather than inventing a level of abstraction.
const GOVERNMENT_MISSION_OUTCOMES = {
  'accountable-government': { title: 'Government is accountable for how it exercises power', owner: 'Government of Botswana' },
  'equitable-access-to-justice': { title: 'People can obtain justice regardless of who they are', owner: 'Government of Botswana' },
  'public-confidence-in-the-state': { title: 'People believe state institutions will act on what they are told', owner: 'Government of Botswana' },
};

// National strategic goals the mission objectives serve.
const STRATEGIC_GOALS = {
  'rule-of-law': { title: 'The rule of law applies equally', owner: 'Government of Botswana' },
  'public-trust': { title: 'Public trust in the justice system', owner: 'Government of Botswana' },
  'institutional-integrity': { title: 'Institutional integrity of the justice institutions', owner: 'Government of Botswana' },
};

// The links across the four new hops. As with CHAIN_LINKS, each states its mechanism.
const MISSION_IMPACT_LINKS = [
  // business process → justice service
  // Found by validateMissionChain(): 'anonymous-reporting' — the constitutional service — was
  // reached by no business process at all. The platform measures nothing directly about whether
  // people can report. Throughput is the nearest real signal (a report that cannot be filed never
  // enters the pipeline, which is the mechanism CHAIN_LINKS already declares from intake-api), so
  // the link is added and the weakness is recorded here rather than left implicit: this is a PROXY,
  // and a fall in throughput has several other explanations.
  { from: 'case-throughput', fromLayer: 'business-process', to: 'anonymous-reporting', toLayer: 'justice-service', mechanism: 'a report that cannot be filed never enters the pipeline, so throughput is the only measured signal that bears on reporting being available — a proxy, not a direct measure' },
  { from: 'case-throughput', fromLayer: 'business-process', to: 'case-investigation', toLayer: 'justice-service', mechanism: 'throughput is the rate at which reports become investigations' },
  { from: 'investigation-latency', fromLayer: 'business-process', to: 'case-investigation', toLayer: 'justice-service', mechanism: 'an investigation that does not conclude has not been delivered' },
  { from: 'evidence-processing-time', fromLayer: 'business-process', to: 'evidence-custody', toLayer: 'justice-service', mechanism: 'evidence unprocessed is evidence not yet in custody of record' },
  { from: 'judicial-workflow-duration', fromLayer: 'business-process', to: 'judicial-review', toLayer: 'justice-service', mechanism: 'the review is the service; its duration is its delivery' },
  { from: 'approval-delay', fromLayer: 'business-process', to: 'judicial-review', toLayer: 'justice-service', mechanism: 'a decision awaiting a human has not been taken' },
  { from: 'governance-review-time', fromLayer: 'business-process', to: 'judicial-review', toLayer: 'justice-service', mechanism: 'a review that never concludes leaves the decision it was meant to test unmade' },
  { from: 'audit-completion-rate', fromLayer: 'business-process', to: 'public-accountability', toLayer: 'justice-service', mechanism: 'audit output is what accountability is published from' },
  { from: 'compliance-rate', fromLayer: 'business-process', to: 'public-accountability', toLayer: 'justice-service', mechanism: 'compliance figures are the published measure of practice against policy' },
  { from: 'policy-violation-rate', fromLayer: 'business-process', to: 'public-accountability', toLayer: 'justice-service', mechanism: 'violations are what accountability reporting exists to surface' },
  // justice service → citizen impact
  { from: 'anonymous-reporting', fromLayer: 'justice-service', to: 'cannot-report', toLayer: 'citizen-impact', mechanism: 'the service being unavailable IS the person being unable to report' },
  { from: 'anonymous-reporting', fromLayer: 'justice-service', to: 'identity-at-risk', toLayer: 'citizen-impact', mechanism: 'a degraded anonymity boundary exposes the person the service exists to protect' },
  { from: 'case-investigation', fromLayer: 'justice-service', to: 'case-stalls', toLayer: 'citizen-impact', mechanism: 'an undelivered investigation is a report that sits' },
  { from: 'evidence-custody', fromLayer: 'justice-service', to: 'evidence-unusable', toLayer: 'citizen-impact', mechanism: 'a broken chain of custody makes the evidence inadmissible' },
  { from: 'judicial-review', fromLayer: 'justice-service', to: 'decision-unattributable', toLayer: 'citizen-impact', mechanism: 'without a recorded accountable decision there is nothing to challenge' },
  { from: 'public-accountability', fromLayer: 'justice-service', to: 'accountability-invisible', toLayer: 'citizen-impact', mechanism: 'unpublished figures leave the public with assertions' },
  // citizen impact → institutional impact (Phase 13, Part 3). A citizen harmed once is an incident;
  // the same harm repeating is an institution that cannot discharge its mandate.
  { from: 'cannot-report', fromLayer: 'citizen-impact', to: 'mandate-undeliverable', toLayer: 'institutional-impact', mechanism: 'an anti-corruption body that cannot receive reports has no input to its statutory function' },
  { from: 'cannot-report', fromLayer: 'citizen-impact', to: 'institutional-credibility-lost', toLayer: 'institutional-impact', mechanism: 'someone turned away once does not return, and tells others' },
  { from: 'identity-at-risk', fromLayer: 'citizen-impact', to: 'institutional-credibility-lost', toLayer: 'institutional-impact', mechanism: 'a single identified reporter ends anonymous reporting for everyone who hears about it' },
  { from: 'evidence-unusable', fromLayer: 'citizen-impact', to: 'evidence-base-unreliable', toLayer: 'institutional-impact', mechanism: 'a court that has seen custody fail once discounts the next chain too' },
  { from: 'case-stalls', fromLayer: 'citizen-impact', to: 'mandate-undeliverable', toLayer: 'institutional-impact', mechanism: 'cases that do not conclude are a mandate discharged on paper only' },
  { from: 'decision-unattributable', fromLayer: 'citizen-impact', to: 'evidence-base-unreliable', toLayer: 'institutional-impact', mechanism: 'a decision nobody is answerable for cannot be defended on review' },
  { from: 'accountability-invisible', fromLayer: 'citizen-impact', to: 'oversight-cannot-report', toLayer: 'institutional-impact', mechanism: 'oversight reporting to Parliament rests on published figures it can verify' },
  // institutional impact → mission objective
  { from: 'mandate-undeliverable', fromLayer: 'institutional-impact', to: 'cases-progress', toLayer: 'mission-objective', mechanism: 'the objective is the mandate, stated as an outcome' },
  { from: 'evidence-base-unreliable', fromLayer: 'institutional-impact', to: 'evidence-is-admissible', toLayer: 'mission-objective', mechanism: 'admissibility is what an unreliable evidence base costs' },
  { from: 'oversight-cannot-report', fromLayer: 'institutional-impact', to: 'oversight-is-informed', toLayer: 'mission-objective', mechanism: 'an oversight body that cannot report is not informed in any useful sense' },
  { from: 'institutional-credibility-lost', fromLayer: 'institutional-impact', to: 'reports-can-be-filed', toLayer: 'mission-objective', mechanism: 'a reporting channel people do not trust is one they do not use, whatever its uptime' },
  // citizen impact → mission objective
  { from: 'cannot-report', fromLayer: 'citizen-impact', to: 'reports-can-be-filed', toLayer: 'mission-objective', mechanism: 'the mission objective is precisely that this does not happen' },
  { from: 'identity-at-risk', fromLayer: 'citizen-impact', to: 'reports-can-be-filed', toLayer: 'mission-objective', mechanism: 'reporting is only possible if reporting is safe' },
  { from: 'case-stalls', fromLayer: 'citizen-impact', to: 'cases-progress', toLayer: 'mission-objective', mechanism: 'a stalled case is the negation of the objective' },
  { from: 'evidence-unusable', fromLayer: 'citizen-impact', to: 'evidence-is-admissible', toLayer: 'mission-objective', mechanism: 'admissibility is what the objective names' },
  { from: 'decision-unattributable', fromLayer: 'citizen-impact', to: 'decisions-are-accountable', toLayer: 'mission-objective', mechanism: 'attribution is what accountability means here' },
  { from: 'accountability-invisible', fromLayer: 'citizen-impact', to: 'oversight-is-informed', toLayer: 'mission-objective', mechanism: 'oversight that cannot see is not informed' },
  // mission objective → strategic goal
  { from: 'reports-can-be-filed', fromLayer: 'mission-objective', to: 'public-trust', toLayer: 'strategic-goal', mechanism: 'a reporting route people believe in is what public trust rests on' },
  { from: 'reports-can-be-filed', fromLayer: 'mission-objective', to: 'rule-of-law', toLayer: 'strategic-goal', mechanism: 'conduct nobody can report is conduct outside the law\'s reach' },
  { from: 'cases-progress', fromLayer: 'mission-objective', to: 'rule-of-law', toLayer: 'strategic-goal', mechanism: 'law that is never applied to reported conduct does not rule' },
  { from: 'evidence-is-admissible', fromLayer: 'mission-objective', to: 'rule-of-law', toLayer: 'strategic-goal', mechanism: 'a court that cannot use the evidence cannot apply the law to the facts' },
  { from: 'decisions-are-accountable', fromLayer: 'mission-objective', to: 'institutional-integrity', toLayer: 'strategic-goal', mechanism: 'an institution whose decisions are unattributable has no integrity to point to' },
  { from: 'oversight-is-informed', fromLayer: 'mission-objective', to: 'institutional-integrity', toLayer: 'strategic-goal', mechanism: 'oversight is how integrity is demonstrated rather than claimed' },
  { from: 'oversight-is-informed', fromLayer: 'mission-objective', to: 'public-trust', toLayer: 'strategic-goal', mechanism: 'trust survives bad news that was reported; it does not survive bad news that was hidden' },
  // strategic goal → government mission outcome (Phase 13, Part 3). The terminal hop.
  { from: 'rule-of-law', fromLayer: 'strategic-goal', to: 'equitable-access-to-justice', toLayer: 'government-mission-outcome', mechanism: 'law that applies unevenly is access to justice for some people only' },
  { from: 'rule-of-law', fromLayer: 'strategic-goal', to: 'accountable-government', toLayer: 'government-mission-outcome', mechanism: 'a government not subject to law in practice is not accountable in practice' },
  { from: 'public-trust', fromLayer: 'strategic-goal', to: 'public-confidence-in-the-state', toLayer: 'government-mission-outcome', mechanism: 'confidence in the state is the aggregate of trust in the institutions people actually meet' },
  { from: 'institutional-integrity', fromLayer: 'strategic-goal', to: 'accountable-government', toLayer: 'government-mission-outcome', mechanism: 'accountability is demonstrated institution by institution or not at all' },
  { from: 'institutional-integrity', fromLayer: 'strategic-goal', to: 'public-confidence-in-the-state', toLayer: 'government-mission-outcome', mechanism: 'people judge the state by whether its institutions behave with integrity' },
];

// The one structural link, matching CONSTITUTIONAL_CHAIN at the technical end: intake IS the
// anonymous-reporting service, so its loss is the service's loss, not a metric moving.
// Found while building the coverage check: notification-service, analytics and the brokers mapped
// to no justice service at all, which would have made every forecast involving them report "no
// citizen impact". They do bear on people — somebody who files a report and is told nothing has
// received a worse service — so they are mapped here rather than the check being relaxed.
const SERVICE_DEPENDENCIES = {
  'anonymous-reporting': ['intake-api'],
  'case-investigation': ['case-service', 'notification-service'],
  'evidence-custody': ['evidence-store', 'custody-ledger', 'kms'],
  'judicial-review': ['governance-ledger'],
  'public-accountability': ['oversight-api', 'analytics'],
};

function justiceServices() { return Object.entries(JUSTICE_SERVICES).map(([id, s]) => ({ id, ...s, dependsOn: [...(SERVICE_DEPENDENCIES[id] || [])] })); }
// Every technical component any justice service rests on, directly or transitively.
function mappedComponents() {
  const telemetry = require('./telemetry');
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const spec = telemetry.TOPOLOGY[id] || {};
    // Soft dependencies count for MAPPING even though they do not count for delivery: a component
    // that only degrades a service still has a citizen-impact path, and leaving it unmapped would
    // make its failure read as "no impact" rather than as a degraded service.
    for (const dep of [...(spec.dependsOn || []), ...(spec.degradesOn || [])]) walk(dep);
  };
  for (const list of Object.values(SERVICE_DEPENDENCIES)) for (const c of list) walk(c);
  return seen;
}
function citizenImpacts() { return Object.entries(CITIZEN_IMPACTS).map(([id, c]) => ({ id, ...c })); }
function strategicGoals() { return Object.entries(STRATEGIC_GOALS).map(([id, g]) => ({ id, ...g })); }
function institutionalImpacts() { return Object.entries(INSTITUTIONAL_IMPACTS).map(([id, i]) => ({ id, ...i })); }
function governmentMissionOutcomes() { return Object.entries(GOVERNMENT_MISSION_OUTCOMES).map(([id, g]) => ({ id, ...g })); }
function missionImpactLinks() { return MISSION_IMPACT_LINKS.map((l) => ({ ...l })); }

// Validate the extended chain the same way the operational one is validated: every link joins
// declared things, moves forward, and states a mechanism; nothing is orphaned at either end.
function validateMissionChain() {
  const violations = [];
  const known = {
    'business-process': new Set(Object.keys(BUSINESS_METRICS)),
    'justice-service': new Set(Object.keys(JUSTICE_SERVICES)),
    'citizen-impact': new Set(Object.keys(CITIZEN_IMPACTS)),
    'institutional-impact': new Set(Object.keys(INSTITUTIONAL_IMPACTS)),
    'mission-objective': new Set(Object.keys(MISSION_OUTCOMES)),
    'strategic-goal': new Set(Object.keys(STRATEGIC_GOALS)),
    'government-mission-outcome': new Set(Object.keys(GOVERNMENT_MISSION_OUTCOMES)),
  };
  for (const l of MISSION_IMPACT_LINKS) {
    if (!MISSION_IMPACT_LAYERS.includes(l.fromLayer) || !MISSION_IMPACT_LAYERS.includes(l.toLayer)) violations.push(`link ${l.from} → ${l.to}: unknown layer`);
    else if (MISSION_IMPACT_LAYERS.indexOf(l.toLayer) <= MISSION_IMPACT_LAYERS.indexOf(l.fromLayer)) violations.push(`link ${l.from} → ${l.to}: does not move forward through the chain`);
    if (!known[l.fromLayer] || !known[l.fromLayer].has(l.from)) violations.push(`link ${l.from} → ${l.to}: '${l.from}' is not a declared ${l.fromLayer}`);
    if (!known[l.toLayer] || !known[l.toLayer].has(l.to)) violations.push(`link ${l.from} → ${l.to}: '${l.to}' is not a declared ${l.toLayer}`);
    if (!l.mechanism) violations.push(`link ${l.from} → ${l.to}: no mechanism — a link with no mechanism is a diagram, not a model`);
  }
  // Nothing may be orphaned. A justice service nothing reaches cannot be predicted about; a citizen
  // impact that reaches no mission objective is a harm the platform has no stated position on.
  for (const s of Object.keys(JUSTICE_SERVICES)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.to === s)) violations.push(`justice service '${s}' is reached by no business process — nothing measured says anything about it`);
    if (!MISSION_IMPACT_LINKS.some((l) => l.from === s)) violations.push(`justice service '${s}' reaches no citizen impact — what happens to a person when it is not delivered?`);
    if (!SERVICE_DEPENDENCIES[s] || !SERVICE_DEPENDENCIES[s].length) violations.push(`justice service '${s}' declares no technical dependency — its delivery cannot be predicted from a technical event`);
  }
  for (const c of Object.keys(CITIZEN_IMPACTS)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.from === c && l.toLayer === 'mission-objective')) violations.push(`citizen impact '${c}' reaches no mission objective — the platform has no stated position on this harm`);
    if (!CITIZEN_IMPACT_SEVERITY.includes(CITIZEN_IMPACTS[c].severity)) violations.push(`citizen impact '${c}': unknown severity '${CITIZEN_IMPACTS[c].severity}'`);
    if (!CITIZEN_IMPACTS[c].experience) violations.push(`citizen impact '${c}': no experience stated in the citizen's words`);
  }
  for (const g of Object.keys(STRATEGIC_GOALS)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.to === g)) violations.push(`strategic goal '${g}' is reached by no mission objective — nothing this platform does bears on it`);
    if (!MISSION_IMPACT_LINKS.some((l) => l.from === g && l.toLayer === 'government-mission-outcome')) violations.push(`strategic goal '${g}' serves no government mission outcome`);
  }
  for (const i of Object.keys(INSTITUTIONAL_IMPACTS)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.to === i)) violations.push(`institutional impact '${i}' is reached by no citizen impact — what causes it?`);
    if (!MISSION_IMPACT_LINKS.some((l) => l.from === i)) violations.push(`institutional impact '${i}' reaches no mission objective — the platform has no stated position on it`);
    if (!INSTITUTIONAL_IMPACTS[i].institution) violations.push(`institutional impact '${i}' names no institution`);
  }
  for (const g of Object.keys(GOVERNMENT_MISSION_OUTCOMES)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.to === g)) violations.push(`government mission outcome '${g}' is reached by nothing`);
  }
  for (const o of Object.keys(MISSION_OUTCOMES)) {
    if (!MISSION_IMPACT_LINKS.some((l) => l.from === o && l.toLayer === 'strategic-goal')) violations.push(`mission objective '${o}' serves no strategic goal — why is it a mission objective?`);
  }
  // Phase 14, Part 3: every layer must land in exactly one horizon. A layer added without deciding
  // when its consequences arrive would otherwise default to being reported nowhere, and a
  // consequence reported nowhere is one nobody plans for.
  for (const layer of MISSION_IMPACT_LAYERS) {
    const owning = IMPACT_HORIZON_ORDER.filter((h) => IMPACT_HORIZONS[h].layers.includes(layer));
    if (!owning.length) violations.push(`chain layer '${layer}' is assigned to no impact horizon — nothing says when its consequences arrive`);
    if (owning.length > 1) violations.push(`chain layer '${layer}' is assigned to ${owning.length} horizons: ${owning.join(', ')}`);
  }
  for (const h of IMPACT_HORIZON_ORDER) {
    for (const layer of IMPACT_HORIZONS[h].layers) {
      if (!MISSION_IMPACT_LAYERS.includes(layer)) violations.push(`horizon '${h}' claims layer '${layer}', which is not in the mission chain`);
    }
    if (!IMPACT_HORIZONS[h].whatChangesHere || !IMPACT_HORIZONS[h].ifUnknown) violations.push(`horizon '${h}' does not say what changes there or what an unknown would mean`);
  }
  return { valid: violations.length === 0, violations, links: MISSION_IMPACT_LINKS.length, layers: MISSION_IMPACT_LAYERS.length, horizons: IMPACT_HORIZON_ORDER.length };
}

// Walk the extended chain from any node to the strategic goals it reaches, recording the whole path
// so a reader can disagree with any hop.
function traceToStrategic(origin, { visited = new Set() } = {}) {
  if (visited.has(origin)) return [];
  visited.add(origin);
  const links = MISSION_IMPACT_LINKS.filter((l) => l.from === origin);
  const paths = [];
  for (const l of links) {
    if (l.toLayer === 'government-mission-outcome') paths.push([{ ...l }]);
    else for (const rest of traceToStrategic(l.to, { visited: new Set(visited) })) paths.push([{ ...l }, ...rest]);
  }
  return paths;
}

// THE PART 18 REPORT. Forecast the consequences of a proposed change before it is deployed.
// `failed` are the services the change would take down or degrade; everything else is derived.
function missionImpactForecast({ change = 'unnamed change', failed = [], degraded = [] } = {}) {
  // A component the topology does not know is the sharpest form of "unknown, not safe": something
  // was deployed before it was modelled. It is kept in the failure set so it surfaces as unmapped,
  // but excluded from propagation, which can only reason about what it has a record of.
  const telemetryTopology = require('./telemetry').TOPOLOGY;
  const unmodelled = failed.filter((f) => !telemetryTopology[f]);
  const technical = impactOf({ failed: failed.filter((f) => telemetryTopology[f]) });
  const allDown = new Set([...technical.infrastructure, ...technical.applications, ...failed]);
  const degradedSet = new Set([...(technical.degraded || []), ...degraded]);

  // Which justice services stop being delivered, and which are impaired. A service is undelivered
  // when ANY of the technical components it needs is down — services do not partially exist.
  const services = justiceServices().map((s) => {
    const missing = s.dependsOn.filter((d) => allDown.has(d));
    const impaired = s.dependsOn.filter((d) => degradedSet.has(d) && !allDown.has(d));
    return {
      service: s.id, title: s.title, delivers: s.delivers, constitutional: s.constitutional,
      dependsOn: s.dependsOn, missingComponents: missing, degradedComponents: impaired,
      delivered: missing.length === 0,
      state: missing.length ? 'not-delivered' : impaired.length ? 'impaired' : 'delivered',
    };
  });
  const undelivered = services.filter((s) => !s.delivered);

  // Citizen impacts follow from the undelivered services, through declared links only.
  const impacts = [];
  for (const s of undelivered) {
    for (const l of MISSION_IMPACT_LINKS.filter((x) => x.from === s.service && x.toLayer === 'citizen-impact')) {
      impacts.push({ impact: l.to, ...CITIZEN_IMPACTS[l.to], viaService: s.service, mechanism: l.mechanism });
    }
  }
  const uniqueImpacts = [...new Map(impacts.map((i) => [i.impact, i])).values()].sort((a, b) => CITIZEN_IMPACT_SEVERITY.indexOf(a.severity) - CITIZEN_IMPACT_SEVERITY.indexOf(b.severity) || a.impact.localeCompare(b.impact));

  // Phase 13, Part 3: the chain now continues past the citizen into the institution, and past the
  // strategic goal into the government mission outcome.
  const institutional = [...new Set(uniqueImpacts.flatMap((i) => MISSION_IMPACT_LINKS.filter((l) => l.from === i.impact && l.toLayer === 'institutional-impact').map((l) => l.to)))].sort();
  const objectives = [...new Set([
    ...uniqueImpacts.flatMap((i) => MISSION_IMPACT_LINKS.filter((l) => l.from === i.impact && l.toLayer === 'mission-objective').map((l) => l.to)),
    ...institutional.flatMap((i) => MISSION_IMPACT_LINKS.filter((l) => l.from === i && l.toLayer === 'mission-objective').map((l) => l.to)),
  ])].sort();
  const goals = [...new Set(objectives.flatMap((o) => MISSION_IMPACT_LINKS.filter((l) => l.from === o && l.toLayer === 'strategic-goal').map((l) => l.to)))].sort();
  const governmentOutcomes = [...new Set(goals.flatMap((g) => MISSION_IMPACT_LINKS.filter((l) => l.from === g && l.toLayer === 'government-mission-outcome').map((l) => l.to)))].sort();
  const paths = undelivered.flatMap((s) => traceToStrategic(s.service).map((p) => ({
    service: s.service,
    chain: [s.service, ...p.map((l) => l.to)].join(' → '),
    mechanisms: p.map((l) => l.mechanism),
  })));

  // Aggregate to the WORST impact, not the mean. Averaging harm across people is how a severe,
  // irreversible impact on one person disappears behind five material ones on nobody in particular.
  const worst = uniqueImpacts.length ? uniqueImpacts[0] : null;
  const irreversible = uniqueImpacts.filter((i) => i.irreversible);
  // An undeclared path is UNKNOWN, not safe. A component nobody mapped to a service produces no
  // impact here, and the report must say that rather than reporting "no citizen impact".
  //
  // The mapped set is the TRANSITIVE closure over the operational topology, not the hand-listed
  // components: `intake-api` depends on `persistence-ind`, so a store nobody named directly is
  // still mapped. Listing every transitive component by hand would be a second copy of the topology
  // and would drift; what stays genuinely unmapped is a component outside every service's tree,
  // which is the signal worth surfacing.
  const mapped = mappedComponents();
  const unmapped = [...allDown].filter((c) => !mapped.has(c)).sort();

  return {
    change, failed: [...failed].sort(), degraded: [...degraded].sort(),
    layers: MISSION_IMPACT_LAYERS,
    technicalEvent: { down: [...allDown].sort(), degraded: [...degradedSet].sort(), blastRadius: technical.blastRadius },
    businessProcesses: technical.businessProcesses,
    justiceServices: services,
    undeliveredServices: undelivered.map((s) => s.service),
    citizenImpacts: uniqueImpacts,
    worstCitizenImpact: worst ? { impact: worst.impact, severity: worst.severity, experience: worst.experience } : null,
    irreversibleImpacts: irreversible.map((i) => i.impact),
    institutionalImpacts: institutional.map((id) => ({ id, ...INSTITUTIONAL_IMPACTS[id] })),
    institutionsAffected: [...new Set(institutional.map((id) => INSTITUTIONAL_IMPACTS[id].institution))].sort(),
    missionObjectives: objectives.map((id) => ({ id, ...MISSION_OUTCOMES[id] })),
    strategicGoals: goals.map((id) => ({ id, ...STRATEGIC_GOALS[id] })),
    governmentMissionOutcomes: governmentOutcomes.map((id) => ({ id, ...GOVERNMENT_MISSION_OUTCOMES[id] })),
    constitutionalServicesLost: undelivered.filter((s) => s.constitutional).map((s) => s.service),
    paths,
    unmappedComponents: unmapped, unmodelledComponents: unmodelled.sort(),
    coverage: {
      mappedComponents: [...mapped].sort(),
      complete: unmapped.length === 0,
      caveat: unmapped.length
        ? `${unmapped.length} affected component(s) map to no justice service, so their citizen impact is UNKNOWN rather than absent: ${unmapped.join(', ')}`
        : 'every affected component maps to a declared justice service',
    },
    // The sentence a board reads, in the citizen's language rather than the platform's.
    boardSummary: worst
      ? `${change}: ${worst.experience}${irreversible.length ? ' This is irreversible for the people it happens to.' : ''}`
      : unmapped.length
        ? `${change}: no declared justice service is affected, but ${unmapped.length} affected component(s) are unmapped — the citizen impact is unknown, not nil.`
        : `${change}: no declared justice service is affected.`,
    safeToDeploy: uniqueImpacts.length === 0 && unmapped.length === 0,
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'A forecast of consequences, produced before deployment. It never approves a deployment; an undeclared path is reported as unknown rather than as no impact.',
  };
}

// Mission dependency graph (Phase 13, Part 3): the whole chain as nodes and directed edges, with a
// layer index so a renderer can lay it out and a reader can see which layer a node sits in. Reported
// as data rather than drawn, so it cannot drift from the links the forecast actually traverses.
function missionDependencyGraph() {
  const sets = {
    'business-process': BUSINESS_METRICS,
    'justice-service': JUSTICE_SERVICES,
    'citizen-impact': CITIZEN_IMPACTS,
    'institutional-impact': INSTITUTIONAL_IMPACTS,
    'mission-objective': MISSION_OUTCOMES,
    'strategic-goal': STRATEGIC_GOALS,
    'government-mission-outcome': GOVERNMENT_MISSION_OUTCOMES,
  };
  const nodes = [];
  for (const [layer, set] of Object.entries(sets)) {
    for (const [id, spec] of Object.entries(set)) {
      nodes.push({ id, layer, layerIndex: MISSION_IMPACT_LAYERS.indexOf(layer), title: spec.title || spec.experience || id });
    }
  }
  const edges = MISSION_IMPACT_LINKS.map((l) => ({ from: l.from, to: l.to, fromLayer: l.fromLayer, toLayer: l.toLayer, mechanism: l.mechanism }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A node nothing reaches and that reaches nothing is a node the chain cannot use.
  const isolated = nodes.filter((n) => !edges.some((e) => e.from === n.id || e.to === n.id)).map((n) => n.id);
  return {
    layers: MISSION_IMPACT_LAYERS.map((l, i) => ({ layer: l, index: i, nodes: nodes.filter((n) => n.layer === l).map((n) => n.id) })),
    nodes: nodes.sort((a, b) => a.layerIndex - b.layerIndex || a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    isolated,
    // Every edge moves strictly forward. A backward edge would make the chain a cycle and the
    // forecast non-terminating, so it is a validation failure rather than a curiosity.
    backwardEdges: edges.filter((e) => MISSION_IMPACT_LAYERS.indexOf(e.toLayer) <= MISSION_IMPACT_LAYERS.indexOf(e.fromLayer)).map((e) => `${e.from} → ${e.to}`),
    nodeCount: nodes.length, edgeCount: edges.length,
    unresolvedEndpoints: edges.filter((e) => !byId.has(e.from) || !byId.has(e.to)).map((e) => `${e.from} → ${e.to}`),
    informationalOnly: true, authorizes: false,
  };
}

// --- Temporal mission impact (Phase 14, Part 3) ---------------------------------------------------
//
// The Phase 13 forecast answers "what does this change cost?" as though the whole cost arrived at
// once. It does not. An intake outage stops filings within minutes; the reports that were never filed
// are missing from the caseload for months; the erosion of the belief that reporting is worth doing
// shows up years later, if anybody is still measuring. A board given one figure will act on the
// minutes and discount the years, because the years were never in the number.
//
// So impact is evaluated across five horizons. The layer a consequence sits in determines when it
// manifests — a technical event is immediate by definition, a government mission outcome is not —
// and the mapping is declared here rather than inferred, so adding a layer without deciding when it
// lands fails the chain validation rather than silently landing in "immediate".
//
// THE RULE THAT SHAPES EVERYTHING BELOW: UNKNOWN IMPACT MUST NEVER BECOME "NO IMPACT". A horizon the
// chain could not be traversed to reports `unknown`, and so does a horizon where the chain has impact
// upstream and no declared link forward — because an undeclared path is a gap in the model, not
// evidence of safety. "No declared impact" is reserved for the case where nothing was affected at
// all, and even then it is stated as a limit of what is declared.
const IMPACT_HORIZONS = {
  immediate: {
    within: 'minutes to hours', layers: ['technical-event', 'business-process'],
    whatChangesHere: 'Services stop responding and work stops moving. This is the horizon monitoring already sees.',
    ifUnknown: 'The platform cannot say what is happening right now, which is the one thing operations exists to know.',
  },
  'short-term': {
    within: 'hours to days', layers: ['justice-service', 'citizen-impact'],
    whatChangesHere: 'A justice service stops being delivered and a person experiences that directly.',
    ifUnknown: 'Somebody may be being harmed and nothing in the platform would say so.',
  },
  'medium-term': {
    within: 'weeks to months', layers: ['institutional-impact'],
    whatChangesHere: 'The institution accumulates backlog, loses evidence, or loses the ability to answer for itself.',
    ifUnknown: 'Damage is compounding inside an institution while its dashboards read green.',
  },
  'long-term': {
    within: 'months to years', layers: ['mission-objective', 'strategic-goal'],
    whatChangesHere: 'The objectives the platform exists for stop being achieved, whether or not it is running well.',
    ifUnknown: 'The platform may be operating perfectly and failing at its purpose.',
  },
  'strategic-institutional': {
    within: 'years, and not fully recoverable', layers: ['government-mission-outcome'],
    whatChangesHere: 'Public confidence that reporting corruption is worth the risk. Rebuilt far more slowly than it is lost.',
    ifUnknown: 'The most expensive consequence is the one nothing is measuring.',
  },
};
const IMPACT_HORIZON_ORDER = ['immediate', 'short-term', 'medium-term', 'long-term', 'strategic-institutional'];

function impactHorizons() { return IMPACT_HORIZON_ORDER.map((id) => ({ horizon: id, index: IMPACT_HORIZON_ORDER.indexOf(id), ...IMPACT_HORIZONS[id] })); }

// Which horizon a mission-chain layer manifests in. Declared, not inferred.
function horizonOfLayer(layer) {
  return IMPACT_HORIZON_ORDER.find((h) => IMPACT_HORIZONS[h].layers.includes(layer)) || null;
}

// THE PART 3 REPORT. Time-aware propagation over the same declared links the point-in-time forecast
// traverses, so the two can never disagree about what is reachable.
function temporalMissionImpact({ change = 'unnamed change', failed = [], degraded = [] } = {}) {
  const forecast = missionImpactForecast({ change, failed, degraded });

  // What was reached at each layer, taken from the forecast rather than recomputed.
  const reachedByLayer = {
    'technical-event': forecast.technicalEvent.down,
    'business-process': forecast.businessProcesses || [],
    'justice-service': forecast.undeliveredServices,
    'citizen-impact': forecast.citizenImpacts.map((i) => i.impact),
    'institutional-impact': forecast.institutionalImpacts.map((i) => i.id),
    'mission-objective': forecast.missionObjectives.map((o) => o.id),
    'strategic-goal': forecast.strategicGoals.map((g) => g.id),
    'government-mission-outcome': forecast.governmentMissionOutcomes.map((g) => g.id),
  };
  // A component nobody mapped, or nobody modelled, breaks the chain at its source: everything
  // downstream of it is unknown rather than absent.
  const coverageComplete = forecast.coverage.complete && forecast.unmodelledComponents.length === 0;

  let upstreamImpact = false;
  const horizons = IMPACT_HORIZON_ORDER.map((id) => {
    const spec = IMPACT_HORIZONS[id];
    const reached = spec.layers.flatMap((l) => reachedByLayer[l] || []);
    const hadUpstream = upstreamImpact;
    if (reached.length) upstreamImpact = true;

    let state, reason;
    if (!coverageComplete) {
      state = 'unknown';
      reason = `${forecast.unmappedComponents.length + forecast.unmodelledComponents.length} affected component(s) map to no declared justice service, so the chain cannot be traversed to this horizon. Unknown, not absent.`;
    } else if (reached.length) {
      state = 'impact';
      reason = `${reached.length} declared consequence(s) manifest here: ${reached.join(', ')}`;
    } else if (hadUpstream) {
      state = 'unknown';
      reason = 'the chain carries impact at an earlier horizon and declares no link forward from it — an undeclared path is a gap in the model, not evidence that nothing follows';
    } else {
      state = 'no-declared-impact';
      reason = 'nothing upstream was affected, so nothing reaches this horizon through any declared link';
    }
    return {
      horizon: id, index: IMPACT_HORIZON_ORDER.indexOf(id), within: spec.within, layers: spec.layers,
      whatChangesHere: spec.whatChangesHere, ifUnknown: spec.ifUnknown,
      reached, state,
      // Never rendered as a boolean. `impacted: false` and `unknown` would print identically and mean
      // opposite things.
      impacted: state === 'impact', assessable: state !== 'unknown',
      reason,
    };
  });

  const unknown = horizons.filter((h) => h.state === 'unknown');
  const impacted = horizons.filter((h) => h.state === 'impact');
  const worst = impacted.length ? impacted[impacted.length - 1] : null;
  return {
    change, failed: [...failed].sort(), degraded: [...degraded].sort(),
    horizons, horizonOrder: [...IMPACT_HORIZON_ORDER],
    horizonSpecs: impactHorizons(),
    pointInTime: forecast,
    impactedHorizons: impacted.map((h) => h.horizon),
    unknownHorizons: unknown.map((h) => h.horizon),
    // The furthest horizon impact actually reaches. A change whose consequences stop at the immediate
    // horizon is a different kind of change from one that reaches the strategic one, and a single
    // severity score would have flattened them together.
    furthestImpact: worst ? worst.horizon : null,
    reachesStrategic: horizons[horizons.length - 1].state === 'impact',
    // The timeline a board reads: what arrives when, in the order it arrives.
    timeline: horizons.map((h) => ({
      when: h.within, horizon: h.horizon,
      expect: h.state === 'impact' ? h.whatChangesHere : h.state === 'unknown' ? `UNKNOWN — ${h.ifUnknown}` : 'Nothing reaches this horizon through a declared link.',
      detail: h.reason,
    })),
    complete: unknown.length === 0,
    boardSummary: unknown.length
      ? `${change}: impact is assessable to ${impacted.length ? IMPACT_HORIZONS[impacted[impacted.length - 1].horizon].within : 'no horizon'}; beyond that it is UNKNOWN (${unknown.map((h) => h.horizon).join(', ')}) — which is not the same as nil.`
      : worst
        ? `${change}: consequences reach the ${worst.horizon} horizon (${worst.within}). ${worst.whatChangesHere}`
        : `${change}: no declared consequence at any horizon. That is a statement about what is declared, not a guarantee.`,
    failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Unknown impact is never rendered as no impact. A horizon the chain cannot be traversed to, and a horizon where impact stops with no declared link forward, both report UNKNOWN — because an undeclared path is a gap in the model rather than evidence of safety.',
  };
}

// --- Operational intelligence (Phase 13, Part 18) -------------------------------------------------
//
// The mission chain traces a technical event forward to a citizen. Part 18 asks the operational
// version of the same question, one layer further: what does the state of the infrastructure right
// now imply about business process, mission outcome, citizen experience and GOVERNANCE PERFORMANCE —
// and what should somebody do about it before it becomes an incident?
//
// The rule that keeps this from being a dashboard of green ticks: A LAYER WITH NO MEASUREMENT IS
// REPORTED AS UNMEASURED, and an unmeasured layer breaks the chain rather than being skipped over.
// A correlation drawn across a gap is a correlation between one thing and an assumption.
const OPERATIONAL_LAYERS = ['infrastructure', 'application-behaviour', 'business-process', 'mission-outcome', 'citizen-experience', 'governance-performance'];

function operationalIntelligence({
  infrastructure = null, applicationBehaviour = null, businessMetrics = null,
  missionOutcomes = null, governance = null, now = 0,
} = {}) {
  const layers = [
    { layer: 'infrastructure', measured: infrastructure !== null, state: infrastructure, means: 'Whether the services and stores are healthy.' },
    { layer: 'application-behaviour', measured: applicationBehaviour !== null, state: applicationBehaviour, means: 'Whether the services are doing what they are for, not merely running.' },
    { layer: 'business-process', measured: businessMetrics !== null, state: businessMetrics, means: 'Whether justice is moving: throughput, latency, backlog.' },
    { layer: 'mission-outcome', measured: missionOutcomes !== null, state: missionOutcomes, means: 'Whether the outcomes the platform exists for are being achieved.' },
    { layer: 'citizen-experience', measured: businessMetrics !== null, state: businessMetrics ? { derivedFrom: 'business-process' } : null, means: 'What a person filing a report actually experiences.' },
    { layer: 'governance-performance', measured: governance !== null, state: governance, means: 'Whether the people accountable are acting within their cadences.' },
  ];
  const unmeasured = layers.filter((l) => !l.measured).map((l) => l.layer);

  // Recommendations are derived from what IS measured, and each names the layer it came from and
  // what would falsify it — a recommendation nobody can argue with is an instruction.
  const recommendations = [];
  if (infrastructure && Array.isArray(infrastructure.degraded) && infrastructure.degraded.length) {
    recommendations.push({
      from: 'infrastructure', urgency: 'act-now',
      recommendation: `Restore ${infrastructure.degraded.join(', ')} before the business layer registers it — degradation reaches throughput after the backlog has already grown.`,
      falsifiedBy: 'These services being healthy, or the capability not depending on them.',
    });
  }
  if (businessMetrics && typeof businessMetrics.backlog === 'number' && businessMetrics.backlog > 0) {
    recommendations.push({
      from: 'business-process', urgency: 'this-week',
      recommendation: `A backlog of ${businessMetrics.backlog} means people who filed reports are waiting. Add investigator capacity or triage, and tell them either way.`,
      falsifiedBy: 'The backlog falling without intervention over the next period.',
    });
  }
  if (governance && Array.isArray(governance.overdueReviews) && governance.overdueReviews.length) {
    recommendations.push({
      from: 'governance-performance', urgency: 'this-week',
      recommendation: `${governance.overdueReviews.length} governance review(s) are overdue. An overdue review is a control nobody has confirmed still works.`,
      falsifiedBy: 'The reviews being completed and recorded.',
    });
  }
  if (unmeasured.length) {
    recommendations.push({
      from: 'coverage', urgency: 'act-now',
      recommendation: `Instrument ${unmeasured.join(', ')}. A chain with an unmeasured layer cannot carry a conclusion across it.`,
      falsifiedBy: 'Those layers being measured.',
    });
  }

  return {
    layers, chain: OPERATIONAL_LAYERS,
    measuredLayers: layers.filter((l) => l.measured).length,
    unmeasured,
    // The chain carries a conclusion only if every layer between the ends is measured.
    chainComplete: unmeasured.length === 0,
    correlationValid: unmeasured.length === 0,
    recommendations, recommendationCount: recommendations.length,
    informationalOnly: true, authorizes: false,
    note: unmeasured.length
      ? `The correlation cannot be carried across ${unmeasured.join(', ')}: an unmeasured layer breaks the chain rather than being skipped. A correlation drawn across a gap is a correlation between one thing and an assumption.`
      : 'Every layer is measured, so a conclusion drawn at one end is supported at the other.',
  };
}

module.exports = {
  OPERATIONAL_LAYERS, operationalIntelligence,
  missionDependencyGraph,
  BUSINESS_METRICS, DWELL_METRICS, EVENT_ALIASES, catalogue,
  CHAIN_LAYERS, CHAIN_LINKS, MISSION_OUTCOMES, INFRASTRUCTURE_COMPONENTS, chainLinks, missionOutcomes,
  MISSION_IMPACT_LAYERS, MISSION_IMPACT_LINKS, JUSTICE_SERVICES, CITIZEN_IMPACTS, CITIZEN_IMPACT_SEVERITY,
  STRATEGIC_GOALS, SERVICE_DEPENDENCIES, INSTITUTIONAL_IMPACTS, GOVERNMENT_MISSION_OUTCOMES,
  justiceServices, citizenImpacts, strategicGoals, institutionalImpacts, governmentMissionOutcomes, missionImpactLinks, mappedComponents,
  validateMissionChain, traceToStrategic, missionImpactForecast,
  IMPACT_HORIZONS, IMPACT_HORIZON_ORDER, impactHorizons, horizonOfLayer, temporalMissionImpact,
  traceForward, impactOf, validateChain, executiveAnalytics,
  assertPiiFree, fromEventLog, dwellTimes, derive, assess,
  correlation, correlateWithReliability, dashboard, report,
};
