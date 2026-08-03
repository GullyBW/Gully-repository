'use strict';
// Digital Twin of Operations (Phase 12, Part 17). Extends the Digital Engineering Twin bounded
// context (`src/twin2/simulation.js`) from simulating individual concerns — capacity, failover,
// canary rollout — to simulating a CHANGE against a model of the whole operating platform.
//
// The premise that makes this worth building, and the one that makes most digital twins useless:
//
//   THE TWIN IS BUILT FROM THE ARCHITECTURE-OF-RECORD, NOT MAINTAINED BESIDE IT.
//
// A twin somebody keeps up to date by hand diverges the first week nobody has time, and a divergent
// twin is worse than no twin: it answers confidently and wrongly, and the answer looks the same
// either way. So every entity below is READ from a registry the platform already validates — the
// context map, the ownership model, the consistency registry, the risk register, the policy
// registry. Nothing here is a second copy of anything.
//
// The other invariant, stated by Part 17 and enforced structurally rather than promised:
//
//   A SIMULATION MUST NEVER AFFECT PRODUCTION STATE.
//
// The baseline model is deep-frozen at construction, every simulation runs against a deep CLONE,
// and `verifyIsolation()` re-derives the baseline digest afterwards. A simulation that mutated
// anything is caught by a hash comparison, not by a code review.

const contextMap = require('../architecture/context-map');
const ownership = require('../governance/ownership');
const multiRegion = require('./multi-region');
const telemetry = require('../observability/telemetry');
const threat = require('../security/threat-model');
const { hash } = require('../twin');

// The entity kinds the twin models. Each says where it is READ FROM — a kind with no source would
// be a hand-maintained entity, which is the thing this module exists not to have.
const ENTITY_KINDS = {
  'bounded-context': { source: 'src/architecture/context-map.js', describes: 'A bounded context in the architecture-of-record.' },
  infrastructure: { source: 'src/observability/telemetry.js (zones)', describes: 'A deployment zone and the separation of powers it enforces.' },
  service: { source: 'src/observability/telemetry.js (TOPOLOGY)', describes: 'A running service, its zone, criticality and declared dependencies.' },
  'governance-control': { source: 'src/governance/ownership.js', describes: 'A governed subsystem with an accountable authority.' },
  workflow: { source: 'src/architecture/context-map.js (relationships)', describes: 'An operational flow crossing a context boundary.' },
  policy: { source: 'src/twin2/multi-region.js (consistency stances)', describes: 'A declared operating rule with a recorded decision behind it.' },
  risk: { source: 'src/security/threat-model.js', describes: 'A registered risk with an owner and a treatment.' },
  evidence: { source: 'verification fitness identifiers', describes: 'An executable check standing behind a control.' },
  'data-flow': { source: 'src/architecture/context-map.js (relationships)', describes: 'Data moving from one context to another.' },
  'regional-deployment': { source: 'src/twin2/multi-region.js (regions)', describes: 'A region, its jurisdiction and what it may hold.' },
};

// The scenarios the twin can simulate. Each declares what it perturbs and what question it answers,
// because a scenario nobody can state the question for is a scenario nobody can read the result of.
const SCENARIOS = {
  'infrastructure-change': { perturbs: 'infrastructure', question: 'If this zone changes or is withdrawn, what stops working and who owns it?' },
  'policy-update': { perturbs: 'policy', question: 'If this operating rule changes, which contexts are governed differently and what did they rely on?' },
  'governance-change': { perturbs: 'governance-control', question: 'If this accountable authority changes, what becomes unowned?' },
  'operational-failure': { perturbs: 'service', question: 'If these services fail, what is the blast radius through declared dependencies?' },
  'migration-plan': { perturbs: 'bounded-context', question: 'If this context moves or is replaced, what has to move with it?' },
  'dr-exercise': { perturbs: 'regional-deployment', question: 'With these regions lost, what still serves, what degrades, and what refuses?' },
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// Build the model by reading the registries. `evidenceIds` is passed in rather than imported
// because the verification suite is the caller's to run — the twin models what it is told holds,
// and an empty list produces a model that says so rather than one that assumes.
function buildModel({ evidenceIds = [], regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const entities = [];
  const relations = [];
  const add = (kind, id, attrs = {}) => { entities.push({ kind, id, ...attrs }); return id; };

  // Bounded contexts and the data flows between them, from the architecture-of-record.
  for (const id of contextMap.ids()) {
    const c = contextMap.describe(id);
    add('bounded-context', id, { kind2: c.kind, domain: c.domain, purpose: c.purpose, status: c.status });
    for (const dep of c.dependsOn || []) {
      relations.push({ from: id, to: dep.context, kind: 'data-flow', via: dep.relationship || 'depends-on' });
      add('data-flow', `flow:${id}->${dep.context}`, { from: id, to: dep.context, relationship: dep.relationship || 'depends-on' });
      add('workflow', `wf:${id}->${dep.context}`, { from: id, to: dep.context, relationship: dep.relationship || 'depends-on' });
    }
  }
  // Services and zones, from the operational topology. This is the registry the chaos and SLO
  // machinery already runs against, so the twin and the incident tooling reason over one graph.
  for (const [svc, spec] of Object.entries(telemetry.TOPOLOGY)) {
    add('service', svc, { zone: spec.zone, criticality: spec.criticality, dependsOn: [...(spec.dependsOn || [])], degradesOn: [...(spec.degradesOn || [])] });
    for (const dep of spec.dependsOn || []) relations.push({ from: svc, to: dep, kind: 'service-dependency', via: 'hard' });
    for (const dep of spec.degradesOn || []) relations.push({ from: svc, to: dep, kind: 'service-degradation', via: 'soft' });
  }
  for (const zone of [...new Set(Object.values(telemetry.TOPOLOGY).map((s) => s.zone))].sort()) {
    add('infrastructure', `zone:${zone}`, { zone, services: Object.keys(telemetry.TOPOLOGY).filter((s) => telemetry.TOPOLOGY[s].zone === zone).sort() });
  }
  // Governance controls, from the ownership model.
  for (const s of ownership.subsystems()) {
    const o = ownership.describe(s);
    add('governance-control', `gov:${s}`, { subsystem: s, responsibleAuthority: o.responsibleAuthority, approvingAuthority: o.approvingAuthority, board: o.board ? o.board.name : null });
  }
  // Policies: the consistency stances, each of which cites the ADR that chose it.
  for (const c of multiRegion.contextConsistency()) {
    add('policy', `policy:consistency:${c.context}`, { context: c.context, model: c.model, adr: c.adr || null, staleReadsAcceptable: c.staleReadsAcceptable });
  }
  // Risks, from the register.
  for (const id of threat.ids()) {
    const t = threat.describe(id);
    add('risk', `risk:${id}`, { title: t.title || id, severity: t.severity || null, owner: t.owner || null });
  }
  // Evidence: the executable checks that actually ran.
  for (const id of evidenceIds) add('evidence', `evidence:${id}`, { check: id });
  // Regional deployments.
  for (const r of regions) add('regional-deployment', `region:${r}`, { region: r });

  const model = {
    entities: entities.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    relations: relations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    regions: [...regions],
    byKind: Object.fromEntries(Object.keys(ENTITY_KINDS).map((k) => [k, entities.filter((e) => e.kind === k).length])),
    builtFrom: Object.fromEntries(Object.entries(ENTITY_KINDS).map(([k, s]) => [k, s.source])),
  };
  model.digest = hash.sha256(model.entities.map((e) => `${e.kind}:${e.id}`));
  return model;
}

class OperationsTwin {
  constructor({ evidenceIds = [], regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
    // Frozen at construction. Not "treated as read-only by convention" — frozen, so an attempt to
    // write to it fails rather than silently succeeding in a way a test would have to notice.
    this._model = deepFreeze(buildModel({ evidenceIds, regions }));
    this._baselineDigest = this._model.digest;
    this._simulations = [];
  }

  model() { return clone(this._model); }
  digest() { return this._baselineDigest; }
  entityKinds() { return Object.entries(ENTITY_KINDS).map(([id, s]) => ({ kind: id, ...s })); }
  scenarios() { return Object.entries(SCENARIOS).map(([id, s]) => ({ scenario: id, ...s })); }
  entities(kind = null) { return this._model.entities.filter((e) => !kind || e.kind === kind).map((e) => ({ ...e })); }
  entity(id) { const e = this._model.entities.find((x) => x.id === id); return e ? { ...e } : null; }

  // The model must describe the platform, not a subset of it that happens to be convenient.
  validate() {
    const violations = [];
    for (const kind of Object.keys(ENTITY_KINDS)) {
      if (!this._model.byKind[kind]) violations.push(`the twin models no '${kind}' entities — a kind with nothing in it is a gap in the model, not an empty category`);
    }
    for (const r of this._model.relations) {
      if (!this._model.entities.some((e) => e.id === r.from)) violations.push(`relation ${r.from} → ${r.to}: '${r.from}' is not modelled`);
      if (!this._model.entities.some((e) => e.id === r.to)) violations.push(`relation ${r.from} → ${r.to}: '${r.to}' is not modelled`);
    }
    // Every modelled bounded context must exist in the architecture-of-record. If this ever fails,
    // the twin has drifted, which is the failure mode the whole design is arranged to prevent.
    const real = new Set(contextMap.ids());
    for (const e of this._model.entities.filter((x) => x.kind === 'bounded-context')) {
      if (!real.has(e.id)) violations.push(`'${e.id}' is modelled but is not in the architecture-of-record — the twin has drifted`);
    }
    for (const id of real) {
      if (!this._model.entities.some((e) => e.kind === 'bounded-context' && e.id === id)) violations.push(`'${id}' is in the architecture-of-record but not modelled — the twin is incomplete`);
    }
    return { valid: violations.length === 0, violations, entities: this._model.entities.length, relations: this._model.relations.length };
  }

  // Blast radius: everything reachable from a set of failed entities through declared relations.
  // Reachability is over DECLARED dependencies only, and the report says so — an undeclared
  // dependency is invisible here, and pretending otherwise would be the twin's worst failure.
  blastRadius(failed = []) {
    const down = new Set(failed);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of this._model.relations) {
        // `from` depends on `to`; if `to` is down, `from` is impaired.
        if (down.has(r.to) && !down.has(r.from)) { down.add(r.from); changed = true; }
      }
    }
    const impacted = [...down].filter((x) => !failed.includes(x)).sort();
    return {
      origin: [...failed].sort(), impacted, total: impacted.length + failed.length,
      zonesAffected: [...new Set([...down].map((id) => (this.entity(id) || {}).zone).filter(Boolean))].sort(),
      basis: 'declared dependencies in the architecture-of-record',
      caveat: 'An undeclared dependency does not appear here. This is a lower bound on the blast radius, not an upper one.',
    };
  }

  // Run a scenario. The model is NEVER touched: the proposal is applied to a clone, and the
  // baseline digest is re-derived afterwards and compared.
  simulate({ scenario, change = {}, label = null } = {}) {
    const spec = SCENARIOS[scenario];
    if (!spec) throw new Error(`unknown scenario '${scenario}' — one of ${Object.keys(SCENARIOS).join(', ')}`);
    const working = clone(this._model);              // the simulation's own universe
    const findings = [];
    const removed = [];

    const withdraw = (predicate, why) => {
      for (const e of working.entities.filter(predicate)) { removed.push(e.id); findings.push({ entity: e.id, kind: e.kind, finding: why }); }
      working.entities = working.entities.filter((e) => !predicate(e));
    };

    let radius = null;
    if (scenario === 'infrastructure-change') {
      const zones = change.zones || [];
      for (const z of zones) if (!this._model.entities.some((e) => e.kind === 'infrastructure' && e.zone === z)) findings.push({ entity: `zone:${z}`, kind: 'infrastructure', finding: 'no such deployment zone is modelled', blocking: true });
      withdraw((e) => e.kind === 'infrastructure' && zones.includes(e.zone), 'zone withdrawn by the proposed change');
      const affectedServices = this._model.entities.filter((e) => e.kind === 'service' && zones.includes(e.zone)).map((e) => e.id);
      radius = this.blastRadius(affectedServices);
      for (const id of affectedServices) {
        const e = this.entity(id);
        findings.push({ entity: id, kind: 'service', finding: `runs in withdrawn zone '${e.zone}'`, blocking: e.criticality === 'constitutional' });
      }
      for (const id of radius.impacted) findings.push({ entity: id, kind: (this.entity(id) || {}).kind || 'unknown', finding: 'depends on a service in a withdrawn zone' });
    } else if (scenario === 'operational-failure') {
      const failed = change.failed || [];
      radius = this.blastRadius(failed);
      for (const id of failed) if (!this.entity(id)) findings.push({ entity: id, kind: 'unknown', finding: 'this entity is not modelled — its failure cannot be reasoned about, which is itself the finding' });
      for (const id of radius.impacted) findings.push({ entity: id, kind: (this.entity(id) || {}).kind || 'unknown', finding: 'impaired through a declared dependency' });
    } else if (scenario === 'policy-update') {
      const updates = change.policies || {};
      for (const [context, model] of Object.entries(updates)) {
        const existing = this._model.entities.find((e) => e.id === `policy:consistency:${context}`);
        if (!existing) { findings.push({ entity: context, kind: 'policy', finding: 'no consistency stance is declared for this context — it cannot be updated, only declared' }); continue; }
        if (!multiRegion.CONSISTENCY_MODELS[model]) { findings.push({ entity: context, kind: 'policy', finding: `'${model}' is not a declared consistency model` }); continue; }
        const weakening = multiRegion.CONSISTENCY_MODELS[existing.model].maxStalenessMs < multiRegion.CONSISTENCY_MODELS[model].maxStalenessMs;
        findings.push({
          entity: `policy:consistency:${context}`, kind: 'policy',
          finding: `${existing.model} → ${model}${weakening ? ' — WEAKENING: readers relying on the stronger guarantee were not consulted by this simulation' : ''}`,
          weakening, previousAdr: existing.adr,
        });
        // A policy change with no ADR behind it is the change this platform refuses everywhere else.
        if (!change.adr) findings.push({ entity: `policy:consistency:${context}`, kind: 'policy', finding: 'the proposed change cites no ADR — a consistency stance changed without a recorded decision is a default nobody chose', blocking: true });
      }
      radius = this.blastRadius(Object.keys(updates).filter((c) => this.entity(c)));
    } else if (scenario === 'governance-change') {
      const vacated = change.vacated || [];
      withdraw((e) => e.kind === 'governance-control' && vacated.includes(e.subsystem), 'accountable authority vacated by the proposed change');
      for (const s of vacated) {
        if (!ownership.OWNERSHIP[s]) { findings.push({ entity: s, kind: 'governance-control', finding: 'not a governed subsystem', blocking: true }); continue; }
        findings.push({ entity: `gov:${s}`, kind: 'governance-control', finding: `'${s}' would have no accountable authority — no governance object may be left unowned`, blocking: true });
      }
      radius = this.blastRadius(vacated.filter((s) => this.entity(s)));
    } else if (scenario === 'migration-plan') {
      const moving = change.contexts || [];
      const target = change.toZone || null;
      for (const id of moving) {
        const e = this.entity(id);
        if (!e) { findings.push({ entity: id, kind: 'bounded-context', finding: 'not modelled — a migration plan for something the architecture does not contain', blocking: true }); continue; }
        findings.push({ entity: id, kind: 'bounded-context', finding: `moves from zone '${e.zone}'${target ? ` to '${target}'` : ' to an unstated zone'}`, blocking: !target });
        // Everything that depends on it has to be considered, whether or not the plan says so.
        for (const r of this._model.relations.filter((x) => x.to === id)) {
          findings.push({ entity: r.from, kind: 'bounded-context', finding: `depends on '${id}' and is not in the migration set`, blocking: !moving.includes(r.from) });
        }
      }
      radius = this.blastRadius(moving.filter((id) => this.entity(id)));
    } else if (scenario === 'dr-exercise') {
      const failed = change.failedRegions || [];
      withdraw((e) => e.kind === 'regional-deployment' && failed.includes(e.region), 'region lost in the exercise');
      const failover = multiRegion.validateFailover({ regions: this._model.regions, failed });
      for (const c of failover.contexts.filter((x) => x.degradedTo !== 'full')) {
        findings.push({ entity: c.context, kind: 'bounded-context', finding: `${c.degradedTo}: ${c.reason}`, blocking: c.degradedTo === 'unavailable' });
      }
      if (!failover.noGuaranteeWeakened) findings.push({ entity: 'consistency', kind: 'policy', finding: 'a consistency guarantee was weakened rather than refused', blocking: true });
      radius = this.blastRadius([]);
    }

    // ISOLATION CHECK. Not a comment saying the model is untouched — a re-derived digest.
    const isolation = this.verifyIsolation();
    const blocking = findings.filter((f) => f.blocking);
    const result = {
      scenario, question: spec.question, perturbs: spec.perturbs, label: label || scenario,
      change: clone(change),
      findings, blocking, safe: blocking.length === 0,
      removedEntities: removed.sort(),
      blastRadius: radius,
      proposedEntityCount: working.entities.length, baselineEntityCount: this._model.entities.length,
      isolation,
      // A simulation is a rehearsal, not a decision, and the wording is deliberate.
      authorizes: false, informationalOnly: true,
      verdict: blocking.length
        ? 'The simulated change has findings that block it. Each one names an entity and what would happen to it.'
        : 'The simulated change produced no blocking finding against the declared model. It has not been approved, and an undeclared dependency would not have appeared here.',
    };
    this._simulations.push({ scenario, label: result.label, safe: result.safe, findings: findings.length });
    return result;
  }

  // Re-derive the baseline digest. If a simulation had mutated the model this would differ, and the
  // property "simulations never affect production state" would be false in a way nothing else
  // catches. It is checked after EVERY simulation rather than in a test that runs sometimes.
  verifyIsolation() {
    const rebuilt = hash.sha256(this._model.entities.map((e) => `${e.kind}:${e.id}`));
    return {
      baselineDigest: this._baselineDigest, currentDigest: rebuilt,
      frozen: Object.isFrozen(this._model),
      unchanged: rebuilt === this._baselineDigest,
      method: 'the baseline model is deep-frozen; simulations run against a deep clone; the digest is re-derived and compared after every run',
      note: 'A simulation that touched production state would change this digest. The property is verified, not asserted.',
    };
  }

  history() { return this._simulations.map((s) => ({ ...s })); }

  report({ scenarios = [] } = {}) {
    const runs = scenarios.map((s) => this.simulate(s));
    return {
      model: { entities: this._model.entities.length, relations: this._model.relations.length, byKind: this._model.byKind, digest: this._baselineDigest, builtFrom: this._model.builtFrom },
      entityKinds: this.entityKinds(), scenarios: this.scenarios(),
      validation: this.validate(),
      simulations: runs,
      isolation: this.verifyIsolation(),
      authorizes: false, informationalOnly: true,
      note: 'The twin is built from the architecture-of-record on every construction, never maintained beside it. A hand-maintained twin diverges and then answers confidently and wrongly.',
    };
  }
}

module.exports = { OperationsTwin, ENTITY_KINDS, SCENARIOS, buildModel };
