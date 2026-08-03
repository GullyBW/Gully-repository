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

module.exports = {
  BUSINESS_METRICS, DWELL_METRICS, EVENT_ALIASES, catalogue,
  CHAIN_LAYERS, CHAIN_LINKS, MISSION_OUTCOMES, INFRASTRUCTURE_COMPONENTS, chainLinks, missionOutcomes,
  traceForward, impactOf, validateChain, executiveAnalytics,
  assertPiiFree, fromEventLog, dwellTimes, derive, assess,
  correlation, correlateWithReliability, dashboard, report,
};
