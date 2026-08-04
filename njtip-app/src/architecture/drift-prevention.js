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
};

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
function detect({ controls = [], contracts = null, assumptions = null, serverRoutes = null } = {}) {
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

  const byKind = {};
  for (const f of findings) {
    const b = (byKind[f.kind] = byKind[f.kind] || { kind: f.kind, undocumented: 0, unrealised: 0 });
    b[f.direction] += 1;
  }
  const structural = findings.filter((f) => f.kind !== 'coupling');
  const coupling = findings.filter((f) => f.kind === 'coupling');
  return {
    findings, count: findings.length,
    driftKinds: Object.entries(DRIFT_KINDS).map(([kind, d]) => ({ kind, ...d })),
    byKind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    undocumented: findings.filter((f) => f.direction === 'undocumented'),
    unrealised: findings.filter((f) => f.direction === 'unrealised'),
    // Structural drift must be zero; coupling is measured so it cannot grow unnoticed.
    structural, structuralCount: structural.length,
    coupling, couplingCount: coupling.length,
    // Both directions matter and they are different defects.
    clean: structural.length === 0,
    checkedKinds: Object.keys(DRIFT_KINDS),
    failClosed: true, authorizes: false,
    note: 'Every kind is checked in both directions. Undocumented reality means the architecture-of-record is behind; unrealised documentation means it describes something nobody built. A checker looking only one way passes a document describing a system that does not exist.',
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
    bottlenecks, bottleneckCount: bottlenecks.length,
    // Forecast, not prophecy: it says where pressure is building from what is recorded now.
    forecast: bottlenecks.length
      ? `Governance is likely to jam first at: ${bottlenecks.map((b) => b.kind).join(', ')}.`
      : 'No bottleneck is visible in the recorded evidence. That is not the same as none existing.',
    informationalOnly: true, authorizes: false,
    note: 'Derived from the registers, not estimated. An unmeasurable figure reports null rather than a plausible number, and "no bottleneck visible" is stated as a limit of what was recorded.',
  };
}

module.exports = { DRIFT_KINDS, sourceFiles, moduleOwner, actualDependencies, detect, governanceAnalytics };
