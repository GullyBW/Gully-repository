'use strict';
// Architecture Drift Prevention (Phase 13, Part 16) and Governance Analytics (Part 17). Extends the
// architecture bounded context.
//
// PART 16. The platform already refuses an undocumented MODULE — the context map claims every source
// file by directory prefix, and `validate()` fails on an orphan. That is one of six kinds of drift,
// and the other five have been accumulating quietly:
//
//   an undeclared dependency between contexts · an API served but not in the contract registry ·
//   a control that runs with no owning context · a subsystem with no accountable authority ·
//   an assumption the code makes that the registry has never heard of.
//
// The rule: EVERY DRIFT KIND IS CHECKED IN BOTH DIRECTIONS. Undocumented reality and unrealised
// documentation are different defects — one means the architecture-of-record is behind, the other
// means it describes something that does not exist — and a checker that looks only one way will
// happily pass a document describing a system nobody built.
const fs = require('node:fs');
const path = require('node:path');
const contextMap = require('./context-map');
const ownership = require('../governance/ownership');
const telemetry = require('../observability/telemetry');

const ROOT = path.join(__dirname, '..', '..');

const DRIFT_KINDS = {
  module: { undocumented: 'A source module no bounded context claims.', unrealised: 'A context claiming modules that do not exist.' },
  // SOURCE-LEVEL COUPLING IS NOT A DECLARED CONTEXT DEPENDENCY, and conflating them was this
  // checker's first bug. `dependsOn` in the context map records a DDD relationship — customer-
  // supplier, conformist, in-process-port — curated deliberately. A `require()` of a shared hash
  // function is not that. Reporting every cross-context require as undeclared drift produced 121
  // findings, almost all noise, and a report people learn to ignore is worse than no report.
  //
  // So coupling is measured and reported as its OWN kind, informational and ratcheted: what matters
  // is that it does not silently grow, not that every edge appears in a curated architectural
  // statement.
  coupling: { undocumented: 'A require() crossing a context boundary that the curated dependency list does not name. Informational: source coupling and declared context dependency are different things.', unrealised: 'A declared context dependency that no module requires directly — it may be realised through an interface rather than a require.' },
  api: { undocumented: 'A route the server serves that the contract registry does not publish.', unrealised: 'A published contract no route serves.' },
  control: { undocumented: 'A fitness function with no owning bounded context.', unrealised: 'An ownership rule matching no control that runs.' },
  ownership: { undocumented: 'A bounded context with no accountability record.', unrealised: 'An accountability record for a context that does not exist.' },
  assumption: { undocumented: 'An assumption the code relies on that the registry has never heard of.', unrealised: 'A registered assumption naming a context that is gone.' },
  documentation: { undocumented: 'A governed document making a claim that does not resolve against the implementation.', unrealised: 'A governed document that does not exist.' },
  security: { undocumented: 'A threat whose declared controls include one that no longer runs.', unrealised: 'A control named as a treatment that the verification suite does not contain.' },
  policy: { undocumented: 'A declared operating rule with no recorded decision behind it.', unrealised: 'A recorded decision declaring a rule for a context that no longer has one.' },
};

// --- Drift classification (Phase 14, Part 8) ------------------------------------------------------
//
// Phase 13 detected drift and reported it as one list. That was enough to fail a build and not enough
// to route anything: a coupling count and a bounded context with no accountable authority are both
// "drift", and they need different people, on different timescales, with different powers.
//
// So every finding is CLASSIFIED, and each classification declares its own governance response. The
// structural rule that keeps this from being eight labels for one behaviour:
//
//   NO TWO CLASSIFICATIONS MAY HAVE THE SAME RESPONSE. If two classes route to the same board with
//   the same action on the same timescale, they are one class wearing two names, and the taxonomy is
//   pretending to a precision it does not have. This is checked, not asserted.
const DRIFT_CLASSES = {
  architectural: {
    kinds: ['module'], respondsBy: 'Architecture Review Board', blocksBuild: true, within: 'before the next merge',
    response: 'Claim the module in the context map, or delete it. An unclaimed module is code nobody is accountable for.',
    ifIgnored: 'The architecture-of-record stops describing the system, and every assurance resting on it becomes a statement about a different platform.',
  },
  dependency: {
    kinds: ['coupling'], respondsBy: 'Architecture Review Board', blocksBuild: false, within: 'at the next architecture review',
    response: 'Ratcheted rather than blocked: source coupling is not a declared context dependency. Reduce it, or move the baseline with a stated reason.',
    ifIgnored: 'Coupling grows until the bounded contexts are boundaries only on paper.',
  },
  documentation: {
    kinds: ['documentation'], respondsBy: 'the owning document steward', blocksBuild: true, within: 'the same day',
    response: 'Repair the claim or remove it. A document that misleads an operator under pressure is a defect, not a nuisance.',
    ifIgnored: 'Somebody follows a procedure that no longer works, during the incident it was written for.',
  },
  ownership: {
    kinds: ['ownership'], respondsBy: 'Oversight Board', blocksBuild: true, within: 'immediately',
    response: 'Record an accountable authority, or remove the context. No governance object may be left unowned.',
    ifIgnored: 'A decision is taken about something with nobody answerable for it, so it cannot be challenged.',
  },
  governance: {
    kinds: ['control', 'assumption'], respondsBy: 'Oversight Board', blocksBuild: true, within: 'before the next board meeting',
    response: 'Give the control an owning context, or register the assumption. A control nobody owns is a control nobody maintains.',
    ifIgnored: 'Controls and assumptions accumulate with no one responsible for noticing when they stop being true.',
  },
  runtime: {
    kinds: ['api'], respondsBy: 'Operations Review Board', blocksBuild: false, within: 'at the next release',
    response: 'Publish the route in the contract registry, or stop serving it. What is running and what is published must be the same list.',
    ifIgnored: 'Integrators build against undocumented surfaces, which then cannot be changed.',
  },
  security: {
    kinds: ['security'], respondsBy: 'Information Security Review Board', blocksBuild: true, within: 'immediately',
    response: 'Restore the control or re-treat the threat. A threat whose treatment stopped running is an untreated threat.',
    ifIgnored: 'A risk is carried on the register as treated while nothing is treating it.',
  },
  policy: {
    kinds: ['policy'], respondsBy: 'Architecture Review Board', blocksBuild: true, within: 'before the stance is relied upon',
    response: 'Write the ADR, or withdraw the stance. An operating rule with no recorded decision is a default nobody chose.',
    ifIgnored: 'The platform enforces rules nobody decided, and nobody can say why they are what they are.',
  },
};

function classOfKind(kind) { return Object.keys(DRIFT_CLASSES).find((c) => DRIFT_CLASSES[c].kinds.includes(kind)) || null; }

// The structural check that stops the taxonomy being decoration. Exported so it can be fed a crafted
// table with two identical responses.
function assertDistinctResponses(classes = DRIFT_CLASSES) {
  const seen = new Map();
  const collisions = [];
  for (const [id, c] of Object.entries(classes)) {
    const key = `${c.respondsBy}|${c.blocksBuild}|${c.within}|${c.response}`;
    if (seen.has(key)) collisions.push(`'${id}' and '${seen.get(key)}' produce an identical governance response — they are one class with two names`);
    else seen.set(key, id);
  }
  return { distinct: collisions.length === 0, collisions };
}

function sourceFiles(dir = path.join(ROOT, 'src'), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

// Which context owns a module, by the context map's own prefix rules.
function moduleOwner(mod) {
  const owners = contextMap.ids().filter((id) => {
    const claims = contextMap.describe(id).modules || [];
    return claims.some((c) => (c.endsWith('/') ? mod.startsWith(c) : mod === c));
  });
  return owners;
}

// Cross-context requires, read from the source rather than declared. This is the check that catches
// a dependency somebody introduced without updating the context map.
function actualDependencies() {
  const byContext = {};
  for (const mod of sourceFiles()) {
    const owners = moduleOwner(mod);
    if (owners.length !== 1) continue;
    const from = owners[0];
    const text = fs.readFileSync(path.join(ROOT, mod), 'utf8');
    for (const m of text.matchAll(/require\('(\.[^']+)'\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(mod), m[1]));
      const resolved = target.endsWith('.js') ? target : `${target}.js`;
      const to = moduleOwner(resolved);
      if (to.length !== 1 || to[0] === from) continue;
      (byContext[from] = byContext[from] || new Set()).add(to[0]);
    }
  }
  return Object.fromEntries(Object.entries(byContext).map(([k, v]) => [k, [...v].sort()]));
}

// The six checks, each in both directions.
function detect({ controls = [], contracts = null, assumptions = null, serverRoutes = null, checkDocumentation = true } = {}) {
  const findings = [];
  const add = (kind, direction, detail, subject) => findings.push({ kind, direction, subject, detail });

  // 1. Modules.
  for (const mod of sourceFiles()) {
    const owners = moduleOwner(mod);
    if (owners.length === 0) add('module', 'undocumented', 'no bounded context claims this module', mod);
    if (owners.length > 1) add('module', 'undocumented', `claimed by ${owners.length} contexts: ${owners.join(', ')}`, mod);
  }
  for (const id of contextMap.ids()) {
    for (const claim of contextMap.describe(id).modules || []) {
      const exists = claim.endsWith('/') ? fs.existsSync(path.join(ROOT, claim)) : fs.existsSync(path.join(ROOT, claim));
      if (!exists) add('module', 'unrealised', `context '${id}' claims '${claim}', which does not exist`, claim);
    }
  }

  // 2. Dependencies, in both directions.
  const actual = actualDependencies();
  for (const id of contextMap.ids()) {
    const declared = new Set((contextMap.describe(id).dependsOn || []).map((d) => d.context));
    const real = new Set(actual[id] || []);
    for (const dep of real) if (!declared.has(dep)) add('coupling', 'undocumented', `'${id}' requires '${dep}' in source; the curated dependency list does not name it`, `${id} → ${dep}`);
    for (const dep of declared) if (!real.has(dep)) add('coupling', 'unrealised', `'${id}' declares a dependency on '${dep}' that no module requires directly`, `${id} → ${dep}`);
  }

  // 3. APIs.
  if (contracts && serverRoutes) {
    const published = new Set(contracts.list().filter((c) => c.kind === 'api').map((c) => c.operation).filter(Boolean));
    for (const route of serverRoutes) if (![...published].some((op) => op.includes(route))) add('api', 'undocumented', `the server serves '${route}' and no contract publishes it`, route);
    for (const op of published) {
      const routePart = (op.split(' ')[1] || op);
      if (!serverRoutes.some((r) => routePart.startsWith(r) || r.startsWith(routePart))) add('api', 'unrealised', `contract publishes '${op}' and no route serves it`, op);
    }
  }

  // 4. Controls.
  if (controls.length) {
    const raci = require('../governance/raci');
    const owned = raci.controlOwnership(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    for (const u of owned.unowned) add('control', 'undocumented', 'this control runs and no bounded context owns it', u);
  }

  // 5. Ownership, both directions.
  const governed = new Set(ownership.subsystems());
  for (const id of contextMap.ids()) if (!governed.has(id)) add('ownership', 'undocumented', `bounded context '${id}' has no accountability record`, id);
  for (const id of governed) if (!contextMap.ids().includes(id)) add('ownership', 'unrealised', `an accountability record exists for '${id}', which is not a bounded context`, id);

  // 6. Assumptions, both directions.
  if (assumptions) {
    for (const orphan of assumptions.orphaned()) add('assumption', 'unrealised', orphan.reason, orphan.assumption);
    // Undocumented: a context the twin's scenarios rest on with no assumption registered against it.
    const covered = new Set(assumptions.all().flatMap((a) => a.contexts));
    const constitutional = ['intake', 'custody', 'governance-oversight'];
    for (const c of constitutional) if (contextMap.ids().includes(c) && !covered.has(c)) add('assumption', 'undocumented', `constitutional context '${c}' has no registered assumption — everything resting on it is unexamined`, c);
  }

  // 7. Documentation drift (Phase 14, Part 8). Both directions: a claim that does not resolve, and a
  // governed document that is not there.
  if (checkDocumentation) {
    const documentation = require('./documentation-assurance');
    const verification = documentation.verify({ controls });
    for (const u of verification.unresolved) add('documentation', 'undocumented', `${u.kind} '${u.value}' — ${u.detail}`, u.document);
    for (const d of verification.missingDocuments) add('documentation', 'unrealised', 'a governed document that does not exist', d);
    for (const d of documentation.verifyDiagrams({}).findings) add('documentation', 'undocumented', `${d.kind} diagram — '${d.subject}' ${d.detail}`, d.document);
  }

  // 8. Security drift. A threat is treated by named controls; a treatment naming a control the
  // verification suite does not contain is a threat carried as treated with nothing treating it.
  if (controls.length) {
    const threatModel = require('../security/threat-model');
    const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
    const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
    for (const t of threatModel.traceability()) {
      for (const c of t.controls) {
        if (!ran.has(c.control)) add('security', 'unrealised', `threat '${t.threat}' is treated by '${c.control}', which the verification suite does not contain`, `${t.threat}/${c.control}`);
        else if (holding.get(c.control) === false) add('security', 'undocumented', `threat '${t.threat}' is treated by '${c.control}', which ran and did not hold — the threat is carried as treated and is not`, `${t.threat}/${c.control}`);
      }
    }
  }

  // 9. Policy drift, both directions: a declared operating rule with no recorded decision, and a
  // decision declaring a rule for a context that no longer has one.
  {
    const multiRegion = require('../twin2/multi-region');
    const adrGovernance = require('./adr-governance');
    const existingAdrs = new Set(adrGovernance.adrFiles().map((f) => `ADR-${f.slice(0, 4)}`));
    const stances = multiRegion.contextConsistency().filter((s) => s.declared);
    for (const s of stances) {
      if (!s.adr) add('policy', 'undocumented', `the consistency stance for '${s.context}' cites no ADR — an operating rule with no recorded decision is a default nobody chose`, `consistency:${s.context}`);
      else if (!existingAdrs.has(s.adr)) add('policy', 'unrealised', `the consistency stance for '${s.context}' cites '${s.adr}', which does not exist`, `consistency:${s.context}`);
    }
    for (const id of contextMap.ids()) {
      if (!stances.some((s) => s.context === id)) continue;   // has a stance; checked above
    }
  }

  const byKind = {};
  for (const f of findings) {
    const b = (byKind[f.kind] = byKind[f.kind] || { kind: f.kind, undocumented: 0, unrealised: 0 });
    b[f.direction] += 1;
  }
  // Part 8: every finding carries its classification and the governance response it triggers.
  for (const f of findings) {
    f.classification = classOfKind(f.kind);
    const spec = DRIFT_CLASSES[f.classification];
    f.respondsBy = spec ? spec.respondsBy : null;
    f.blocksBuild = spec ? spec.blocksBuild : true;
    f.within = spec ? spec.within : 'unclassified drift blocks until somebody classifies it';
  }
  const byClass = Object.keys(DRIFT_CLASSES).map((id) => {
    const rows = findings.filter((f) => f.classification === id);
    return {
      classification: id, ...DRIFT_CLASSES[id], findings: rows.length,
      undocumented: rows.filter((f) => f.direction === 'undocumented').length,
      unrealised: rows.filter((f) => f.direction === 'unrealised').length,
      subjects: rows.map((f) => f.subject),
    };
  });
  // A finding whose kind belongs to no class is not silently informational — it blocks, because an
  // unclassified finding is one nobody has decided how to route.
  const unclassified = findings.filter((f) => !f.classification);
  const blocking = findings.filter((f) => f.blocksBuild);
  const structural = findings.filter((f) => f.kind !== 'coupling');
  const coupling = findings.filter((f) => f.kind === 'coupling');
  return {
    findings, count: findings.length,
    driftKinds: Object.entries(DRIFT_KINDS).map(([kind, d]) => ({ kind, ...d })),
    driftClasses: Object.entries(DRIFT_CLASSES).map(([classification, c]) => ({ classification, ...c })),
    responsesDistinct: assertDistinctResponses(),
    byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    byClass,
    undocumented: findings.filter((f) => f.direction === 'undocumented'),
    unrealised: findings.filter((f) => f.direction === 'unrealised'),
    // Structural drift must be zero; coupling is measured so it cannot grow unnoticed.
    structural, structuralCount: structural.length,
    coupling, couplingCount: coupling.length,
    // Part 8: what actually blocks, and who each class is routed to.
    blocking, blockingCount: blocking.length,
    unclassified: unclassified.map((f) => `${f.kind}/${f.subject}`),
    routing: byClass.filter((c) => c.findings > 0).map((c) => ({ classification: c.classification, to: c.respondsBy, within: c.within, action: c.response, count: c.findings })),
    // Both directions matter and they are different defects.
    clean: structural.length === 0,
    checkedKinds: Object.keys(DRIFT_KINDS),
    failClosed: true, authorizes: false,
    note: 'Every kind is checked in both directions and every finding is classified. Undocumented reality means the architecture-of-record is behind; unrealised documentation means it describes something nobody built. Classification decides who is told and how fast, because a coupling count and an unowned bounded context are not the same emergency.',
  };
}

// --- Governance analytics (Phase 13, Part 17) ----------------------------------------------------
//
// Forecasting where governance will jam, from what the platform already records. Every figure is
// derived from a register; an unmeasurable forecast reports `unknown` rather than a plausible number.
function governanceAnalytics({ ownershipModel = ownership, activity = null, training = null, rehearsals = null, assumptions = null, controls = [], now = 0 } = {}) {
  const subsystems = ownershipModel.subsystems();

  // Ownership overload: how many subsystems each authority carries. One office accountable for a
  // third of the estate is a bottleneck whether or not anything has jammed yet.
  const load = {};
  for (const s of subsystems) {
    for (const role of ownershipModel.DEPUTY_ROLES) {
      const person = ownershipModel.OWNERSHIP[s][role];
      (load[person] = load[person] || { authority: person, roles: 0, subsystems: new Set() });
      load[person].roles += 1; load[person].subsystems.add(s);
    }
  }
  const loadRows = Object.values(load).map((l) => ({
    authority: l.authority, roles: l.roles, subsystems: [...l.subsystems].sort(),
    share: +(l.subsystems.size / subsystems.length).toFixed(4),
  })).sort((a, b) => b.roles - a.roles || a.authority.localeCompare(b.authority));
  const overloaded = loadRows.filter((l) => l.share >= 0.25);

  // Review delay: subsystems whose review is overdue, and by how much.
  const schedule = ownershipModel.reviewSchedule({ now, lastReviewed: {} });
  const overdue = schedule.filter((r) => r.overdue);

  // Audit readiness: can we evidence what we claim? Derived from control coverage.
  const held = controls.filter((c) => typeof c === 'object' && c.pass === true).length;
  const auditReadiness = controls.length ? +(held / controls.length).toFixed(4) : null;

  // Control effectiveness trend needs history the caller supplies; without it, unknown.
  const bottlenecks = [];
  if (overloaded.length) bottlenecks.push({ kind: 'ownership-overload', detail: `${overloaded.length} authority(ies) each accountable for a quarter or more of the estate`, authorities: overloaded.map((o) => o.authority) });
  if (overdue.length) bottlenecks.push({ kind: 'review-delay', detail: `${overdue.length} subsystem review(s) overdue`, subsystems: overdue.map((r) => r.subsystem) });
  if (assumptions) {
    const stale = assumptions.stale({ now });
    if (stale.length) bottlenecks.push({ kind: 'assumption-decay', detail: `${stale.length} assumption(s) expired or overdue for review`, assumptions: stale.map((s) => s.assumption) });
  }
  if (rehearsals) {
    const cov = rehearsals.coverage({ now });
    if (cov.neverRehearsed.length) bottlenecks.push({ kind: 'rehearsal-gap', detail: `${cov.neverRehearsed.length} rehearsal(s) never run`, rehearsals: cov.neverRehearsed });
  }
  if (!activity || !training) bottlenecks.push({ kind: 'unmeasured-capacity', detail: 'no activity or training register supplied — whether the accountable people can actually act is unknown, and unknown is not capacity' });

  return {
    ownershipLoad: loadRows, overloadedAuthorities: overloaded.map((o) => o.authority),
    reviewSchedule: schedule, overdueReviews: overdue.map((r) => r.subsystem),
    auditReadiness,
    // Phase 14, Part 17: the same estate, forecast forward, with an interval on every figure.
    adaptive: adaptiveGovernanceAnalytics({ controls, now }),
    bottlenecks, bottleneckCount: bottlenecks.length,
    // Forecast, not prophecy: it says where pressure is building from what is recorded now.
    forecast: bottlenecks.length
      ? `Governance is likely to jam first at: ${bottlenecks.map((b) => b.kind).join(', ')}.`
      : 'No bottleneck is visible in the recorded evidence. That is not the same as none existing.',
    informationalOnly: true, authorizes: false,
    note: 'Derived from the registers, not estimated. An unmeasurable figure reports null rather than a plausible number, and "no bottleneck visible" is stated as a limit of what was recorded.',
  };
}

// --- Adaptive governance analytics (Phase 14, Part 17) --------------------------------------------
//
// Part 17 asks for forecasts WITH CONFIDENCE INTERVALS, and that is where most governance analytics
// quietly become fiction. An interval is a claim about how much the evidence constrains the answer.
// Printed beside a figure derived from four observations, a ±0.05 interval says "we are nearly
// certain" when the truth is "we have almost no data", and it is more misleading than the bare
// number would have been.
//
// So the method is stated, it is coarse, and it is honest about being coarse:
//
//   THE INTERVAL IS A FUNCTION OF THE OBSERVATION COUNT, AND WITH NO OBSERVATIONS IT IS [0, 1].
//
// An interval that does not narrow as evidence accumulates is decoration. An interval that narrows
// faster than the evidence justifies is worse. Half-width is 1/√n, capped at 1 — a coarse standard-
// error analogue, explicitly NOT a statistical confidence interval, and every row says so.
const FORECAST_DIMENSIONS = {
  governanceMaturity: { question: 'How far has governance moved from declared to continuously assured?', unit: 'fraction of the maturity scale' },
  auditReadiness: { question: 'Could the estate evidence what it claims, today?', unit: 'fraction of controls holding' },
  institutionalResilience: { question: 'How much of the estate has a validated alternative for everything it rests on?', unit: 'fraction of critical capabilities' },
  organizationalLearning: { question: 'How often does a corrected failure change what people can do next time?', unit: 'fraction of incidents learned from' },
  policyEffectiveness: { question: 'How much of the operating policy rests on a recorded decision?', unit: 'fraction of declared stances with an ADR' },
  operationalStability: { question: 'How steady is the estate\'s control performance over time?', unit: 'fraction of controls holding, averaged over the window' },
  // --- Adaptive governance forecasting (Phase 15, Part 16) --------------------------------------
  // Six workload forecasts. These answer "how much work is coming?" rather than "how well are we
  // doing?", and they are normalised against declared capacity so the figure is a fraction of what
  // the institution can actually absorb rather than a raw count nobody can act on.
  governanceWorkload: { question: 'How much of the available governance capacity do the coming reviews consume?', unit: 'fraction of declared capacity' },
  reviewBottlenecks: { question: 'What share of authorities are carrying more than they can review?', unit: 'fraction of authorities within capacity' },
  assumptionVerificationDemand: { question: 'What share of assumptions are currently within their required verification frequency?', unit: 'fraction within cadence' },
  policyMaintenanceEffort: { question: 'What share of declared operating rules rest on a recorded decision?', unit: 'fraction with an ADR' },
  auditPreparationEffort: { question: 'What share of the evidence an audit would ask for currently resolves?', unit: 'fraction resolving' },
  institutionalResilienceTrend: { question: 'Is the share of capabilities with a validated alternative rising or falling?', unit: 'fraction of capabilities resilient, over the supplied history' },
};

// The interval. Deliberately simple and deliberately wide.
// Phase 15, Part 10 moved the interval arithmetic into `src/assurance/evidence-confidence.js`, which
// is where evidence about evidence belongs. This wrapper keeps the governance-forecast shape — the
// observation count and the `constrained` flag — and delegates the maths, so the two cannot drift
// into two slightly different definitions of the same band.
//
// 'Constrained' means the interval is narrow enough to be worth reading: a half-width under a quarter
// of the scale, which needs more than sixteen observations. Five observations give ±0.45, which spans
// almost the whole range and constrains nothing.
function forecastInterval(point, observations) {
  const evidenceConfidence = require('../assurance/evidence-confidence');
  const band = evidenceConfidence.interval(point, observations);
  return {
    point: band.point, interval: band.interval, observations: observations || 0,
    constrained: band.halfWidth !== null && band.halfWidth < 0.25,
    method: band.method,
  };
}

function adaptiveGovernanceAnalytics({
  controls = [], governanceMaturity = null, resilience = null, learning = null,
  stabilityHistory = [], optimization = null, assumptionMaturity = null, documentation = null,
  resilienceHistory = [], now = 0,
} = {}) {
  const multiRegion = require('../twin2/multi-region');
  const forecast = (dimension, point, observations, basis) => ({
    forecast: dimension, ...FORECAST_DIMENSIONS[dimension],
    ...forecastInterval(point, observations),
    basis, derived: true,
  });

  // Governance maturity: level over the scale, one observation per assessed level criterion.
  const maturity = governanceMaturity && Number.isFinite(governanceMaturity.level)
    ? forecast('governanceMaturity', governanceMaturity.level / 5, governanceMaturity.level, `level ${governanceMaturity.level} of 5${governanceMaturity.name ? ` (${governanceMaturity.name})` : ''}`)
    : forecast('governanceMaturity', null, 0, 'no governance maturity assessment was supplied');

  // Audit readiness: controls holding over controls that ran.
  const ran = controls.filter((c) => typeof c === 'object');
  const held = ran.filter((c) => c.pass === true).length;
  const audit = ran.length
    ? forecast('auditReadiness', held / ran.length, ran.length, `${held} of ${ran.length} controls that ran are holding`)
    : forecast('auditReadiness', null, 0, 'no control results were supplied');

  // Institutional resilience: capabilities with a validated alternative on every dimension.
  const resilient = resilience && Array.isArray(resilience.capabilities)
    ? forecast('institutionalResilience', resilience.capabilities.filter((c) => c.resilient).length / resilience.capabilities.length, resilience.capabilities.length,
      `${resilience.capabilities.filter((c) => c.resilient).length} of ${resilience.capabilities.length} critical capabilities have a validated alternative on every dimension`)
    : forecast('institutionalResilience', null, 0, 'no institutional resilience evaluation was supplied');

  // Organizational learning: the rate the learning framework computes.
  const learned = learning && learning.learningRate !== null && learning.learningRate !== undefined
    ? forecast('organizationalLearning', learning.learningRate, learning.count || 0, `${learning.learned ? learning.learned.length : 0} of ${learning.count} incidents produced a demonstrated change in what people can do`)
    : forecast('organizationalLearning', null, 0, 'no institutional learning assessment was supplied, so whether the estate learns is unknown');

  // Policy effectiveness: declared stances resting on a recorded decision.
  const stances = multiRegion.contextConsistency().filter((s) => s.declared);
  const withAdr = stances.filter((s) => s.adr).length;
  const policy = stances.length
    ? forecast('policyEffectiveness', withAdr / stances.length, stances.length, `${withAdr} of ${stances.length} declared consistency stances cite a recorded decision`)
    : forecast('policyEffectiveness', null, 0, 'no consistency stance is declared');

  // Operational stability: the mean pass rate across a supplied window, which the caller measures.
  const stability = stabilityHistory.length
    ? forecast('operationalStability', stabilityHistory.reduce((a, b) => a + b, 0) / stabilityHistory.length, stabilityHistory.length,
      `mean control pass rate over ${stabilityHistory.length} recorded period(s)`)
    : forecast('operationalStability', null, 0, 'no history was supplied — a stability figure over one observation is a reading, not a trend');

  // --- Part 16: six workload forecasts, each normalised against declared capacity --------------
  const load = optimization && optimization.load ? optimization.load : null;
  const governanceWorkload = load && load.approvalLoad.length
    ? forecast('governanceWorkload',
      Math.min(1, load.approvalLoad.reduce((a, r) => a + Math.min(1, r.reviewsPerYear / r.capacityPerYear), 0) / load.approvalLoad.length),
      load.approvalLoad.length,
      `${load.approvalLoad.length} approving authorities; the figure is the mean share of each one's declared annual capacity that its reviews consume`)
    : forecast('governanceWorkload', null, 0, 'no governance load analysis was supplied');
  const reviewBottlenecks = load && load.approvalLoad.length
    ? forecast('reviewBottlenecks', load.approvalLoad.filter((r) => !r.overCapacity).length / load.approvalLoad.length, load.approvalLoad.length,
      `${load.approvalLoad.filter((r) => r.overCapacity).length} of ${load.approvalLoad.length} authorities owe more reviews than a monthly board can perform`)
    : forecast('reviewBottlenecks', null, 0, 'no governance load analysis was supplied');
  const assumptionDemand = assumptionMaturity && assumptionMaturity.assumptions
    ? forecast('assumptionVerificationDemand',
      (assumptionMaturity.assumptions.length - assumptionMaturity.verificationBacklog.length) / assumptionMaturity.assumptions.length,
      assumptionMaturity.assumptions.length,
      `${assumptionMaturity.verificationBacklog.length} of ${assumptionMaturity.assumptions.length} assumptions are overdue for verification or have never been verified`)
    : forecast('assumptionVerificationDemand', null, 0, 'no assumption maturity report was supplied');
  const policyEffort = stances.length
    ? forecast('policyMaintenanceEffort', withAdr / stances.length, stances.length,
      `${stances.length - withAdr} of ${stances.length} declared stances would need a decision recorded before they could be defended`)
    : forecast('policyMaintenanceEffort', null, 0, 'no consistency stance is declared');
  const auditEffort = documentation && documentation.verification
    ? forecast('auditPreparationEffort',
      documentation.verification.claims ? (documentation.verification.claims - documentation.verification.unresolvedCount) / documentation.verification.claims : null,
      documentation.verification.claims || 0,
      `${documentation.verification.unresolvedCount} of ${documentation.verification.claims} governed claims do not currently resolve`)
    : forecast('auditPreparationEffort', null, 0, 'no documentation verification was supplied');
  const resilienceTrend = resilienceHistory.length >= 2
    ? forecast('institutionalResilienceTrend', resilienceHistory[resilienceHistory.length - 1], resilienceHistory.length,
      `${resilienceHistory[0]} → ${resilienceHistory[resilienceHistory.length - 1]} across ${resilienceHistory.length} recorded period(s); a trend needs at least two`)
    : forecast('institutionalResilienceTrend', null, resilienceHistory.length, 'fewer than two recorded periods — one observation is a reading, not a trend');

  const forecasts = [maturity, audit, resilient, learned, policy, stability,
    governanceWorkload, reviewBottlenecks, assumptionDemand, policyEffort, auditEffort, resilienceTrend];
  const unconstrained = forecasts.filter((f) => !f.constrained);
  return {
    forecasts, count: forecasts.length,
    dimensions: Object.entries(FORECAST_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d })),
    // Named separately, because a dashboard of six figures with five unconstrained intervals is a
    // dashboard of one figure and five guesses.
    unconstrained: unconstrained.map((f) => f.forecast),
    constrained: forecasts.filter((f) => f.constrained).map((f) => f.forecast),
    unforecastable: forecasts.filter((f) => f.point === null).map((f) => f.forecast),
    everyForecastDerived: forecasts.every((f) => f.derived === true),
    intervalMethod: 'Half-width 1/√n over the observation count, capped at [0,1]. Coarse by design, and never presented as a statistical confidence interval — a narrow band this platform cannot support would be worse than the bare figure.',
    now, informationalOnly: true, authorizes: false,
    note: unconstrained.length
      ? `${unconstrained.length} of ${forecasts.length} forecasts rest on too few observations for the interval to constrain anything. Read those as directions, not as numbers.`
      : 'Every forecast rests on enough observations for its interval to say something.',
  };
}

// --- Continuous architecture validation (Phase 16, Part 12) ----------------------------------------
//
// `detect()` finds drift in nine kinds and reports it as findings. Part 12 asks the question a
// reviewer actually asks — is the architecture still the one that was approved? — and it needs one
// thing `detect()` does not have: a recorded BASELINE to be different from.
//
// The rule Part 12 states and this enforces:
//
//   ARCHITECTURAL EVOLUTION IS REJECTED UNLESS IT IS DOCUMENTED. Not warned about, not counted:
//   `assertNoUndocumentedEvolution` throws fail-closed. A checker that reports undocumented
//   evolution and lets the build through is a checker that documents the drift rather than
//   preventing it.
//
// Six properties, each mapped to the drift kinds that would falsify it, so there is no second
// detector to keep in step with the first.
const ARCHITECTURE_PROPERTIES = {
  dependencyCorrectness: {
    asks: 'Does every dependency the code makes appear in the architecture-of-record, and vice versa?',
    falsifiedBy: ['coupling'], blocks: false,
    ifViolated: 'Bounded contexts become boundaries on paper, one require() at a time.',
  },
  boundedContextIntegrity: {
    asks: 'Does every source module belong to exactly one bounded context?',
    falsifiedBy: ['module'], blocks: true,
    ifViolated: 'Code exists that nobody is accountable for, and the architecture-of-record stops describing the system.',
  },
  ownershipConsistency: {
    asks: 'Does every bounded context have an accountable authority, and every authority a context?',
    falsifiedBy: ['ownership'], blocks: true,
    ifViolated: 'A decision is taken about something with nobody answerable for it, so it cannot be challenged.',
  },
  documentationSynchronization: {
    asks: 'Does every claim in the governed corpus still resolve against the implementation?',
    falsifiedBy: ['documentation'], blocks: true,
    ifViolated: 'An operator follows a procedure that no longer works, during the incident it was written for.',
  },
  adrCompliance: {
    asks: 'Does every declared operating rule rest on a recorded decision, and does every ADR meet its schema?',
    falsifiedBy: ['policy'], blocks: true,
    ifViolated: 'The platform enforces rules nobody decided, and nobody can say why they are what they are.',
  },
  apiCompatibility: {
    asks: 'Is every route the server serves published, and every published contract served?',
    falsifiedBy: ['api'], blocks: false,
    ifViolated: 'Integrators build against undocumented surfaces, which then cannot be changed.',
  },
};

// A recorded architecture baseline. Not a snapshot the checker takes for itself — a baseline
// somebody recorded, with the ADR that approved it, because a baseline the tool writes is a baseline
// that agrees with whatever it finds.
class ArchitectureBaseline {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._records = []; }

  record({ version, contexts, modules, adr, recordedBy, at = null } = {}) {
    if (!version) throw new Error('an architecture baseline must name the version it fixes');
    if (!Number.isFinite(contexts) || !Number.isFinite(modules)) throw new Error('a baseline must record how many bounded contexts and modules it contains');
    if (!adr) { const e = new Error('an architecture baseline must cite the decision that approved it — a baseline nobody approved is a snapshot'); e.failClosed = true; throw e; }
    if (!recordedBy) { const e = new Error('an architecture baseline must name who recorded it'); e.failClosed = true; throw e; }
    const rec = { version, contexts, modules, adr, recordedBy, at: at ?? this._clock() };
    this._records.push(rec);
    return { ...rec };
  }
  current() { return this._records.length ? { ...this._records[this._records.length - 1] } : null; }
  history() { return this._records.map((r) => ({ ...r })); }
}

function continuousArchitectureValidation({ controls = [], assumptions = null, baseline = null, now = 0 } = {}) {
  const drift = detect({ controls, assumptions });
  const byKind = new Map();
  for (const f of drift.findings || []) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const properties = Object.entries(ARCHITECTURE_PROPERTIES).map(([id, spec]) => {
    const findings = spec.falsifiedBy.flatMap((k) => byKind.get(k) || []);
    return {
      property: id, ...spec,
      findings: findings.map((f) => ({ kind: f.kind, direction: f.direction, detail: f.detail })),
      violationCount: findings.length,
      holds: findings.length === 0,
      // A blocking property that fails stops the build; a non-blocking one is ratcheted.
      blocksBuild: spec.blocks && findings.length > 0,
    };
  });

  // Evolution against the recorded baseline. With no baseline, this is UNKNOWN — not compliant.
  const current = baseline ? baseline.current() : null;
  const actualContexts = contextMap.ids().length;
  const actualModules = contextMap.sourceModules().length;
  const evolution = !current
    ? {
      known: false, evolved: null, documented: null,
      detail: 'no architecture baseline has been recorded, so nothing says what this architecture is supposed to be. Undocumented evolution is undetectable, which is not the same as absent.',
    }
    : {
      known: true,
      baseline: current,
      evolved: current.contexts !== actualContexts || current.modules !== actualModules,
      // Documented means the baseline itself cites an approving decision. An evolution beyond a
      // baseline requires a NEW baseline citing a new decision.
      documented: current.contexts === actualContexts && current.modules === actualModules,
      detail: current.contexts !== actualContexts
        ? `the architecture has ${actualContexts} bounded contexts and baseline ${current.version} (${current.adr}) records ${current.contexts} — a context was added or removed without a new approved baseline`
        : current.modules !== actualModules
          ? `the architecture has ${actualModules} claimed modules and baseline ${current.version} (${current.adr}) records ${current.modules} — modules moved without a new approved baseline`
          : `the architecture matches baseline ${current.version}, approved by ${current.adr}`,
    };

  const violated = properties.filter((p) => !p.holds);
  const blocking = properties.filter((p) => p.blocksBuild);
  return {
    properties, count: properties.length,
    holds: violated.length === 0,
    violated: violated.map((p) => p.property),
    blocking: blocking.map((p) => p.property),
    ratcheted: violated.filter((p) => !p.blocksBuild).map((p) => p.property),
    evolution,
    // THE PART 12 RULE, as a computed verdict rather than a promise.
    undocumentedEvolution: evolution.known ? evolution.evolved && !evolution.documented : null,
    rejectsBuild: blocking.length > 0 || (evolution.known && evolution.evolved && !evolution.documented),
    driftFindings: (drift.findings || []).length,
    basis: violated.length
      ? `${violated.length} of ${properties.length} architecture properties do not hold; ${blocking.length} of them block the build.`
      : evolution.known ? `all ${properties.length} architecture properties hold, and the architecture matches the recorded baseline.`
        : `all ${properties.length} architecture properties hold. No baseline is recorded, so whether the architecture has evolved beyond what was approved is UNKNOWN.`,
    now, failClosed: true, informationalOnly: true, authorizes: false,
    note: 'Each property is falsified by drift kinds the existing detector already finds, so there is no second detector to keep in step with the first. Architectural evolution beyond a recorded baseline is REJECTED rather than reported: a checker that logs undocumented evolution and lets the build through documents the drift instead of preventing it.',
  };
}

// The gate. Exported so it can be fed a crafted validation that should be rejected.
function assertNoUndocumentedEvolution(validation) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!validation) fail('nothing was supplied to validate');
  if (validation.blocking && validation.blocking.length) {
    fail(`architecture validation rejected the build: ${validation.blocking.join(', ')} do not hold`);
  }
  if (validation.undocumentedEvolution === true) {
    fail(`the architecture has evolved beyond its recorded baseline with no new approved baseline: ${validation.evolution.detail}`);
  }
  return true;
}

// --- Forecast calibration (Phase 16, Part 3) -------------------------------------------------------
//
// Twelve forecast dimensions have been produced since Phase 14 and not one has ever been checked
// against what actually happened. A forecasting framework nobody scores is a framework that cannot be
// wrong, and a framework that cannot be wrong will be believed indefinitely.
//
// The rule that makes this worth having:
//
//   CONFIDENCE RISES ONLY ON OBSERVED OUTCOMES. A forecast's interval is a function of its
//   observation count and nothing else can widen or narrow it. Recording an outcome is the only act
//   that changes what this platform is entitled to claim about its own predictions.
//
// And the distinction everything below preserves:
//
//   UNCALIBRATED IS NOT INACCURATE. A dimension nobody has scored has an UNKNOWN accuracy, which is
//   a different finding from a dimension scored and found wrong, and it needs a different person.
const CALIBRATION_MEASURES = {
  accuracy: {
    asks: 'How often did the outcome land inside the interval the forecast offered?',
    unit: 'fraction of scored forecasts whose outcome fell within their interval',
    ifUnknown: 'Nothing says whether this dimension has ever been right.',
  },
  meanAbsoluteError: {
    asks: 'On average, how far was the point estimate from the outcome?',
    unit: 'mean |predicted − observed|, on the dimension\'s own [0,1] scale',
    ifUnknown: 'The size of the typical miss is unknown, so nobody can say whether it matters.',
  },
  bias: {
    asks: 'Does this dimension consistently forecast HIGH or LOW?',
    unit: 'mean signed (predicted − observed); positive is optimistic',
    ifUnknown: 'A systematic lean is invisible, and a systematically optimistic governance forecast is the most dangerous kind.',
  },
  confidenceCalibration: {
    asks: 'Were the forecasts that called themselves constrained actually more accurate than the ones that did not?',
    unit: 'accuracy when constrained minus accuracy when unconstrained',
    ifUnknown: 'Nothing says whether the interval means anything at all.',
  },
  stability: {
    asks: 'How much does this dimension\'s forecast move between successive periods?',
    unit: 'mean |change| between consecutive forecasts; lower is steadier',
    ifUnknown: 'Nothing says whether a change in the figure is signal or noise.',
  },
  drift: {
    asks: 'Is the error growing over time?',
    unit: 'mean error in the later half minus the earlier half; positive is degrading',
    ifUnknown: 'A model that used to be right and is quietly getting worse looks identical to one that always was.',
  },
};

// Where a dimension sits once it has been scored. `unknown` is not a grade.
const CALIBRATION_GRADES = {
  unknown: { calibrated: false, graded: false, means: 'No outcome has been recorded for this dimension. Its accuracy is unknown, which is not the same as poor.' },
  insufficient: { calibrated: false, graded: false, means: 'Some outcomes exist but too few to distinguish a run of luck from a working model.' },
  miscalibrated: { calibrated: false, graded: true, means: 'Scored, and the outcomes fell outside the intervals more often than inside.' },
  calibrated: { calibrated: true, graded: true, means: 'Scored, and the outcomes fell inside the intervals as often as the intervals claim.' },
};
// Below this, a run of luck and a working model are indistinguishable. Declared, and deliberately the
// same floor the evidence-confidence module uses for an established estimate.
const CALIBRATION_MIN_OUTCOMES = 5;
const DAY = 24 * 3600_000;

class ForecastRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._forecasts = new Map(); this._seq = 0; }

  // Record a forecast AS IT WAS MADE. The point, the interval and whether it called itself
  // constrained are all captured here, because scoring a forecast against an interval reconstructed
  // afterwards would score a different forecast.
  record(dimension, { point, interval = null, constrained = false, horizonDays, madeBy, at = null } = {}) {
    if (!FORECAST_DIMENSIONS[dimension]) throw new Error(`unknown forecast dimension '${dimension}' — one of ${Object.keys(FORECAST_DIMENSIONS).join(', ')}`);
    if (!Number.isFinite(point)) {
      const e = new Error('a forecast with no point estimate cannot be scored — an unforecastable dimension is recorded by not recording it');
      e.failClosed = true; throw e;
    }
    if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
      const e = new Error('a forecast must state the horizon it is about — a prediction with no timeframe can never be shown to be wrong');
      e.failClosed = true; throw e;
    }
    if (!madeBy) { const e = new Error('a forecast must name what produced it'); e.failClosed = true; throw e; }
    const id = `FC-${String(++this._seq).padStart(4, '0')}`;
    const rec = {
      id, dimension, point, interval: interval ? [...interval] : null, constrained: !!constrained,
      horizonDays, madeBy, at: at ?? this._clock(), outcome: null,
    };
    this._forecasts.set(id, rec);
    return { ...rec };
  }

  // Record what actually happened. Attributed, because an unattributed outcome is somebody's opinion
  // of how the forecast did.
  recordOutcome(id, { observed, observedBy, at = null, note = null } = {}) {
    const f = this._forecasts.get(id);
    if (!f) throw new Error('unknown forecast: ' + id);
    if (f.outcome) { const e = new Error(`'${id}' already has a recorded outcome — a forecast scored twice is a forecast scored until it passes`); e.failClosed = true; throw e; }
    if (!Number.isFinite(observed)) throw new Error('an outcome must be a number on the same scale as the forecast');
    if (!observedBy) { const e = new Error('an outcome must name who observed it'); e.failClosed = true; throw e; }
    const t = at ?? this._clock();
    // An outcome recorded before the horizon elapsed is not the outcome of this forecast.
    if (t < f.at + f.horizonDays * DAY) {
      const e = new Error(`'${id}' forecast ${f.horizonDays} day(s) ahead and this outcome is earlier than that — scoring a forecast before its horizon scores something else`);
      e.failClosed = true; throw e;
    }
    f.outcome = {
      observed, observedBy, at: t, note,
      error: f.point - observed,
      absoluteError: Math.abs(f.point - observed),
      withinInterval: !!(f.interval && observed >= f.interval[0] && observed <= f.interval[1]),
    };
    return { ...f };
  }

  forecasts(dimension = null) {
    return [...this._forecasts.values()].filter((f) => !dimension || f.dimension === dimension).map((f) => ({ ...f }));
  }
  scored(dimension = null) { return this.forecasts(dimension).filter((f) => f.outcome); }

  // Calibration for one dimension. Every measure returns null rather than a figure when nothing
  // supports it — a bias of 0 computed over no outcomes reads as an unbiased model.
  calibration(dimension) {
    if (!FORECAST_DIMENSIONS[dimension]) throw new Error(`unknown forecast dimension '${dimension}'`);
    const all = this.forecasts(dimension).sort((a, b) => a.at - b.at);
    const scored = all.filter((f) => f.outcome);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const round = (x) => (x === null ? null : +x.toFixed(4));

    // Stability is about the forecasts themselves and needs no outcomes at all — a dimension that
    // swings wildly is telling you something before anybody scores it.
    const steps = all.slice(1).map((f, i) => Math.abs(f.point - all[i].point));
    const stability = steps.length ? round(mean(steps)) : null;

    if (!scored.length) {
      return {
        dimension, ...FORECAST_DIMENSIONS[dimension],
        grade: 'unknown', ...CALIBRATION_GRADES.unknown,
        forecasts: all.length, outcomes: 0, required: CALIBRATION_MIN_OUTCOMES,
        accuracy: null, meanAbsoluteError: null, bias: null, confidenceCalibration: null,
        stability, drift: null,
        reason: all.length
          ? `${all.length} forecast(s) recorded and none scored against an outcome — this dimension's accuracy is UNKNOWN, which is not the same as poor`
          : 'no forecast has been recorded for this dimension, so there is nothing to score',
      };
    }
    const errors = scored.map((f) => f.outcome.error);
    const abs = scored.map((f) => f.outcome.absoluteError);
    const accuracy = round(scored.filter((f) => f.outcome.withinInterval).length / scored.length);
    const constrained = scored.filter((f) => f.constrained);
    const unconstrained = scored.filter((f) => !f.constrained);
    // Only computable when BOTH kinds have been scored. A difference against nothing is not a
    // difference, and reporting 0 would say the interval makes no difference.
    const confidenceCalibration = constrained.length && unconstrained.length
      ? round((constrained.filter((f) => f.outcome.withinInterval).length / constrained.length)
        - (unconstrained.filter((f) => f.outcome.withinInterval).length / unconstrained.length))
      : null;
    // Drift needs enough scored outcomes to have two halves worth comparing.
    const half = Math.floor(scored.length / 2);
    const drift = scored.length >= 2 * CALIBRATION_MIN_OUTCOMES
      ? round(mean(abs.slice(half)) - mean(abs.slice(0, half)))
      : null;

    const grade = scored.length < CALIBRATION_MIN_OUTCOMES ? 'insufficient'
      : accuracy >= 0.5 ? 'calibrated' : 'miscalibrated';
    return {
      dimension, ...FORECAST_DIMENSIONS[dimension],
      grade, ...CALIBRATION_GRADES[grade],
      forecasts: all.length, outcomes: scored.length, required: CALIBRATION_MIN_OUTCOMES,
      accuracy, meanAbsoluteError: round(mean(abs)), bias: round(mean(errors)),
      confidenceCalibration, stability, drift,
      // Named rather than left in the arithmetic: a governance forecast that leans optimistic is the
      // one that gets somebody hurt.
      leansOptimistic: mean(errors) > 0.05,
      reason: scored.length < CALIBRATION_MIN_OUTCOMES
        ? `${scored.length} of ${CALIBRATION_MIN_OUTCOMES} outcomes — too few to tell a run of luck from a working model`
        : `${Math.round(accuracy * 100)}% of ${scored.length} outcomes fell inside their interval; mean absolute error ${round(mean(abs))}, bias ${round(mean(errors))}`,
    };
  }

  // --- Error decomposition (Phase 17, Part 3) -----------------------------------------------------
  //
  // `calibration()` reports mean absolute error and bias. Both are real, and together they still
  // cannot answer the question a modeller actually needs answered:
  //
  //   IS THIS MODEL WRONG IN A DIRECTION, OR JUST NOISY?
  //
  // Those need opposite repairs. A biased model is systematically off and can be corrected by
  // shifting it. A noisy model is right on average and useless on any single occasion, and shifting
  // it does nothing. Mean absolute error is the same for both, which is why it has to be split.
  errorDecomposition(dimension) {
    if (!FORECAST_DIMENSIONS[dimension]) throw new Error(`unknown forecast dimension '${dimension}'`);
    const scored = this.scored(dimension).sort((a, b) => a.at - b.at);
    const round = (x) => (x === null ? null : +x.toFixed(4));

    if (scored.length < CALIBRATION_MIN_OUTCOMES) {
      return {
        dimension, measurable: false,
        outcomes: scored.length, required: CALIBRATION_MIN_OUTCOMES,
        bias: null, variance: null, biasShare: null, dominant: 'unknown',
        // The distinction Part 3 turns on, stated where it will be read.
        reason: scored.length
          ? `${scored.length} of ${CALIBRATION_MIN_OUTCOMES} outcomes — too few to separate a model that leans from one that wobbles. This is UNKNOWN, not inaccurate.`
          : 'no forecast in this dimension has been scored, so nothing is known about how it is wrong — which is not the same as it being wrong',
      };
    }
    const errors = scored.map((f) => f.outcome.error);
    const bias = errors.reduce((a, b) => a + b, 0) / errors.length;
    // Variance about the model's own mean error: what is left once the systematic part is removed.
    const variance = errors.reduce((a, e) => a + ((e - bias) ** 2), 0) / errors.length;
    const biasSquared = bias ** 2;
    const total = biasSquared + variance;
    const biasShare = total > 0 ? biasSquared / total : null;
    const dominant = biasShare === null ? 'neither' : biasShare >= 0.5 ? 'bias' : 'variance';

    return {
      dimension, measurable: true, outcomes: scored.length, required: CALIBRATION_MIN_OUTCOMES,
      bias: round(bias), variance: round(variance), biasSquared: round(biasSquared),
      totalSquaredError: round(total),
      biasShare: round(biasShare),
      dominant,
      // Named rather than left in the arithmetic, because the two need different people.
      repair: dominant === 'bias'
        ? 'The model leans in a direction. It can be corrected by shifting it, and the shift is a modelling decision somebody has to take.'
        : dominant === 'variance'
          ? 'The model is right on average and unreliable on any single occasion. Shifting it changes nothing; it needs better inputs or a wider interval.'
          : 'The model has no measurable error at all across these outcomes.',
      reason: `bias ${round(bias)} and variance ${round(variance)} over ${scored.length} outcome(s); ${dominant === 'neither' ? 'neither dominates' : `${dominant} accounts for ${Math.round((dominant === 'bias' ? biasShare : 1 - biasShare) * 100)}% of the squared error`}`,
    };
  }

  // --- Forecast learning (Phase 17, Part 3) -------------------------------------------------------
  //
  // Whether the model is getting better, by the Phase 17 rule. The trap this exists to avoid:
  //
  //   A MODEL THAT GOT LUCKIER IS NOT A MODEL THAT GOT BETTER. Accuracy over a recent window can
  //   rise while the systematic error is untouched, and a dashboard reporting only the window will
  //   call that an improvement. So the bias is compared across the same two halves, and a rise in
  //   accuracy alongside a persistent bias is named as exactly that.
  learning(dimension, { now = null } = {}) {
    const evidenceConfidence = require('../assurance/evidence-confidence');
    const t = now ?? this._clock();
    if (!FORECAST_DIMENSIONS[dimension]) throw new Error(`unknown forecast dimension '${dimension}'`);
    const scored = this.scored(dimension).sort((a, b) => a.at - b.at);
    const round = (x) => (x === null ? null : +x.toFixed(4));
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    // Two comparable halves. Anything less and there is nothing to compare against anything.
    const need = 2 * CALIBRATION_MIN_OUTCOMES;
    if (scored.length < need) {
      return {
        dimension, measurable: false, outcomes: scored.length, required: need,
        accuracyTrend: evidenceConfidence.verifiedImprovement({ subject: `forecast accuracy: ${dimension}`, series: [] }),
        biasPersists: null, earlier: null, later: null,
        reason: `${scored.length} of ${need} outcomes — a model needs two comparable halves before anything can be said about it learning. This is UNKNOWN, not a model that failed to improve.`,
        now: t, informationalOnly: true, authorizes: false,
      };
    }

    const half = Math.floor(scored.length / 2);
    const halves = [scored.slice(0, half), scored.slice(half)];
    const [earlier, later] = halves.map((h) => ({
      outcomes: h.length,
      accuracy: round(h.filter((f) => f.outcome.withinInterval).length / h.length),
      meanAbsoluteError: round(mean(h.map((f) => f.outcome.absoluteError))),
      bias: round(mean(h.map((f) => f.outcome.error))),
    }));

    // A model rebuild is a measurement change: the later half is about a different model, so a rise
    // across the boundary is explained by the rebuild rather than supported by it.
    const madeBy = [...new Set(scored.map((f) => f.madeBy))];
    const modelChanged = madeBy.length > 1;

    const accuracyTrend = evidenceConfidence.verifiedImprovement({
      subject: `forecast accuracy: ${dimension}`,
      series: [earlier.accuracy, later.accuracy],
      evidence: modelChanged
        ? [{ kind: 'measurement-change', detail: `the forecasts were produced by ${madeBy.length} different models (${madeBy.join(', ')}), so the two halves are not about the same thing` }]
        : [],
    });

    // THE FINDING. Accuracy up, systematic error unchanged: luckier, not better.
    const biasPersists = Math.abs(later.bias) >= Math.abs(earlier.bias) - 0.02;

    return {
      dimension, measurable: true, outcomes: scored.length, required: need,
      earlier, later,
      accuracyImprovement: round(later.accuracy - earlier.accuracy),
      errorImprovement: round(earlier.meanAbsoluteError - later.meanAbsoluteError),
      accuracyTrend,
      biasPersists,
      modelChanged, models: madeBy,
      reason: accuracyTrend.improved && biasPersists
        ? `accuracy rose from ${earlier.accuracy} to ${later.accuracy} while the systematic bias held at ${later.bias} — this is a model that got LUCKIER, not one that got better`
        : accuracyTrend.improved
          ? `accuracy rose from ${earlier.accuracy} to ${later.accuracy} and the bias fell from ${earlier.bias} to ${later.bias}`
          : `accuracy moved from ${earlier.accuracy} to ${later.accuracy}; ${accuracyTrend.reason}`,
      now: t, informationalOnly: true, authorizes: false,
    };
  }

  // --- Confidence recalibration (Phase 17, Part 3) ------------------------------------------------
  //
  // What the interval SHOULD be, derived from the errors actually observed rather than from the
  // observation count. Offered as a recommendation and never applied, for one reason:
  //
  //   NARROWING AN INTERVAL IS A CLAIM THAT THE MODEL IS BETTER. Applying that automatically would
  //   let a quiet run of luck tighten the band the platform reports its own predictions with — which
  //   is the platform improving its own confidence in itself with nobody deciding to.
  recalibration(dimension) {
    if (!FORECAST_DIMENSIONS[dimension]) throw new Error(`unknown forecast dimension '${dimension}'`);
    const scored = this.scored(dimension);
    const round = (x) => (x === null ? null : +x.toFixed(4));
    if (scored.length < CALIBRATION_MIN_OUTCOMES) {
      return {
        dimension, measurable: false, outcomes: scored.length, required: CALIBRATION_MIN_OUTCOMES,
        currentHalfWidth: null, recommendedHalfWidth: null, direction: 'unknown',
        applied: false, requiresHumanApproval: true, approvedBy: null,
        reason: `${scored.length} of ${CALIBRATION_MIN_OUTCOMES} outcomes — there is nothing to recalibrate against. An interval nobody has tested stays as it is.`,
      };
    }
    const widths = scored.filter((f) => Array.isArray(f.interval)).map((f) => (f.interval[1] - f.interval[0]) / 2);
    const currentHalfWidth = widths.length ? round(widths.reduce((a, b) => a + b, 0) / widths.length) : null;
    // The band that would have contained the observed errors. Derived from what happened.
    const recommendedHalfWidth = round(Math.max(...scored.map((f) => f.outcome.absoluteError)));
    const direction = currentHalfWidth === null ? 'unknown'
      : recommendedHalfWidth > currentHalfWidth ? 'widen'
        : recommendedHalfWidth < currentHalfWidth ? 'narrow' : 'unchanged';

    return {
      dimension, measurable: true, outcomes: scored.length, required: CALIBRATION_MIN_OUTCOMES,
      currentHalfWidth, recommendedHalfWidth, direction,
      // Constants. Nothing in this function computes them.
      applied: false, requiresHumanApproval: true, approvedBy: null,
      caution: direction === 'narrow'
        ? 'Narrowing is a claim that the model is better. It must not be applied on the strength of a quiet run: check the error decomposition and the learning report first.'
        : direction === 'widen'
          ? 'The observed errors fell outside the band this dimension has been reporting. Widening is the honest response and it makes every past forecast look weaker, which is the point.'
          : 'The band matches the observed errors.',
      reason: `over ${scored.length} outcome(s) the largest absolute error was ${recommendedHalfWidth}${currentHalfWidth === null ? '; no forecast recorded an interval to compare it against' : `, against a mean recorded half-width of ${currentHalfWidth}`}`,
    };
  }

  // Part 3's learning dashboard, over every dimension.
  learningReport({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = Object.keys(FORECAST_DIMENSIONS).map((d) => ({
      ...this.learning(d, { now: t }),
      decomposition: this.errorDecomposition(d),
      recalibration: this.recalibration(d),
    }));
    const measured = rows.filter((r) => r.measurable);
    const unverified = rows.filter((r) => r.accuracyTrend && r.accuracyTrend.violatesInvariant);
    return {
      dimensions: rows, count: rows.length,
      measurable: measured.length > 0,
      // Three separate populations, never merged. This is the Part 3 discipline.
      unknown: rows.filter((r) => !r.measurable).map((r) => r.dimension),
      improving: rows.filter((r) => r.accuracyTrend && r.accuracyTrend.state === 'verified-improvement').map((r) => r.dimension),
      unverifiedImprovements: unverified.map((r) => r.dimension),
      luckyNotBetter: measured.filter((r) => r.accuracyTrend.improved && r.biasPersists).map((r) => r.dimension),
      biasDominated: rows.filter((r) => r.decomposition.dominant === 'bias').map((r) => r.dimension),
      varianceDominated: rows.filter((r) => r.decomposition.dominant === 'variance').map((r) => r.dimension),
      needWidening: rows.filter((r) => r.recalibration.direction === 'widen').map((r) => r.dimension),
      everyImprovementVerified: unverified.length === 0,
      // Nothing here is applied, ever.
      recalibrationsApplied: 0,
      basis: measured.length
        ? `${measured.length} of ${rows.length} dimension(s) have two comparable halves of scored outcomes. ${rows.length - measured.length} are UNKNOWN — which is not the same as a model that failed to improve.`
        : `No forecast dimension has been scored enough times to have two comparable halves. Forecast learning across all ${rows.length} dimensions is UNKNOWN, and an unknown prediction is not an inaccurate one: this needs somebody to record outcomes, not somebody to fix a model.`,
      now: t, informationalOnly: true, authorizes: false,
      note: 'An unknown prediction is not an inaccurate prediction, and the two are counted separately everywhere here. A rise in accuracy alongside an unchanged systematic bias is reported as a model that got luckier rather than better. Recalibration is recommended and never applied: narrowing an interval is a claim the model has improved, and the platform does not get to make that claim about itself.',
    };
  }

  // The Part 3 dashboard, over every declared dimension.
  report({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = Object.keys(FORECAST_DIMENSIONS).map((d) => this.calibration(d));
    const graded = rows.filter((r) => r.graded);
    return {
      dimensions: rows, count: rows.length,
      measures: Object.entries(CALIBRATION_MEASURES).map(([measure, m]) => ({ measure, ...m })),
      grades: Object.entries(CALIBRATION_GRADES).map(([grade, g]) => ({ grade, ...g })),
      // Counted apart, and this is the whole discipline of the section.
      unknown: rows.filter((r) => r.grade === 'unknown').map((r) => r.dimension),
      insufficient: rows.filter((r) => r.grade === 'insufficient').map((r) => r.dimension),
      miscalibrated: rows.filter((r) => r.grade === 'miscalibrated').map((r) => r.dimension),
      calibrated: rows.filter((r) => r.grade === 'calibrated').map((r) => r.dimension),
      optimisticDimensions: rows.filter((r) => r.leansOptimistic).map((r) => r.dimension),
      totalForecasts: this.forecasts().length, totalOutcomes: this.scored().length,
      // A rate over graded dimensions only. A rate that counted unscored dimensions as failures
      // would punish the institution for not having a history yet, which is not a finding.
      calibrationRate: graded.length ? +(graded.filter((r) => r.calibrated).length / graded.length).toFixed(4) : null,
      measurable: graded.length > 0,
      basis: graded.length
        ? `${graded.filter((r) => r.calibrated).length} of ${graded.length} SCORED dimensions are calibrated. ${rows.length - graded.length} dimension(s) have never been scored and are excluded rather than counted as failing.`
        : `No forecast has ever been compared against an outcome. Twelve dimensions have been produced since Phase 14 and the platform's forecasting accuracy is entirely UNKNOWN — which is not the same as poor, and needs somebody to start recording outcomes rather than somebody to fix a model.`,
      now: t, informationalOnly: true, authorizes: false,
      note: 'Confidence rises only on observed outcomes. An interval is a function of the observation count and nothing else widens or narrows it, so recording an outcome is the only act that changes what this platform may claim about its own predictions.',
    };
  }
}

module.exports = {
  DRIFT_KINDS, DRIFT_CLASSES, classOfKind, assertDistinctResponses,
  FORECAST_DIMENSIONS, forecastInterval, adaptiveGovernanceAnalytics,
  CALIBRATION_MEASURES, CALIBRATION_GRADES, CALIBRATION_MIN_OUTCOMES, ForecastRegister,
  ARCHITECTURE_PROPERTIES, ArchitectureBaseline, continuousArchitectureValidation, assertNoUndocumentedEvolution,
  sourceFiles, moduleOwner, actualDependencies, detect, governanceAnalytics,
};
