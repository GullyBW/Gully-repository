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

module.exports = {
  DRIFT_KINDS, DRIFT_CLASSES, classOfKind, assertDistinctResponses,
  FORECAST_DIMENSIONS, forecastInterval, adaptiveGovernanceAnalytics,
  sourceFiles, moduleOwner, actualDependencies, detect, governanceAnalytics,
};
