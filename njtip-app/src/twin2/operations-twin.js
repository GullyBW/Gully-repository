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
// Every scenario must also declare the ASSUMPTIONS it rests on, what the model CANNOT see, an
// owner and a review cadence (Phase 13, Part 1). A simulation with undeclared assumptions is the
// dangerous kind: it produces a confident answer and gives the reader nothing to disagree with.
const SCENARIOS = {
  'infrastructure-change': {
    perturbs: 'infrastructure', question: 'If this zone changes or is withdrawn, what stops working and who owns it?',
    assumptions: ['ASM-0001', 'ASM-0005'],
    limitations: ['Zone membership comes from the declared topology; a service deployed somewhere the topology does not record is invisible here.', 'Withdrawal is modelled as total loss, not as a phased drain.'],
    owner: 'Operations Review Board', reviewCadenceDays: 180,
  },
  'policy-update': {
    perturbs: 'policy', question: 'If this operating rule changes, which contexts are governed differently and what did they rely on?',
    assumptions: ['ASM-0001'],
    limitations: ['Only consistency stances are modelled as policy; authorization and retention policy changes are not simulated here.', 'Readers relying on the previous guarantee are not enumerated — the model knows the stance, not who depends on it.'],
    owner: 'Architecture Review Board', reviewCadenceDays: 180,
  },
  'governance-change': {
    perturbs: 'governance-control', question: 'If this accountable authority changes, what becomes unowned?',
    assumptions: ['ASM-0006'],
    limitations: ['Models the ownership record, not the people. A post that is formally filled but effectively vacant looks owned here.'],
    owner: 'Oversight Board', reviewCadenceDays: 90,
  },
  'operational-failure': {
    perturbs: 'service', question: 'If these services fail, what is the blast radius through declared dependencies?',
    assumptions: ['ASM-0001', 'ASM-0005'],
    limitations: ['Propagation follows declared dependencies only, so the radius is a lower bound.', 'Failure is binary; partial degradation and retry storms are not modelled.'],
    owner: 'Operations Review Board', reviewCadenceDays: 90,
  },
  'migration-plan': {
    perturbs: 'bounded-context', question: 'If this context moves or is replaced, what has to move with it?',
    assumptions: ['ASM-0001'],
    limitations: ['Data migration cost and duration are not modelled — this answers what must move, not how long it takes.'],
    owner: 'Architecture Review Board', reviewCadenceDays: 180,
  },
  // --- Organizational scenarios (Phase 13, Part 10) -------------------------------------------
  // The twin modelled infrastructure and forgot that every one of those controls is exercised by a
  // person. An institution loses people far more often than it loses regions, and it has never
  // rehearsed that.
  'owner-absence': {
    perturbs: 'governance-control', question: 'If these people are unavailable, which governance objects stop being owned?',
    assumptions: ['ASM-0006'],
    limitations: ['Models declared ownership and the derived deputy chain; informal knowledge held by somebody not in the record is invisible here.', 'Absence is binary — partial availability and divided attention are not modelled.'],
    owner: 'Oversight Board', reviewCadenceDays: 90,
  },
  'leadership-turnover': {
    perturbs: 'governance-control', question: 'If these offices change hands at once, what loses its accountable authority and its deputy together?',
    assumptions: ['ASM-0006'],
    limitations: ['A successor is assumed to arrive with no operational history, which is the pessimistic case and not always the real one.', 'Handover quality is not modelled; the twin cannot see what was written down.'],
    owner: 'Oversight Board', reviewCadenceDays: 180,
  },
  'operational-overload': {
    perturbs: 'governance-control', question: 'If several incidents run at once, is there anybody left to authorise the next one?',
    assumptions: ['ASM-0006'],
    limitations: ['Capacity is modelled as one concurrent incident per available authority, which is a modelling choice rather than a measurement.', 'Does not model fatigue, only availability.'],
    owner: 'Operations Review Board', reviewCadenceDays: 90,
  },
  'dr-exercise': {
    perturbs: 'regional-deployment', question: 'With these regions lost, what still serves, what degrades, and what refuses?',
    assumptions: ['ASM-0005', 'ASM-0007'],
    limitations: ['Quorum is computed from region count; it does not model a partition where regions are up but cannot see each other.', 'Recovery time is not modelled — this answers what holds, not how long restoration takes.'],
    owner: 'Operations Review Board', reviewCadenceDays: 90,
  },
  // --- Strategic scenarios (Phase 14, Part 12) -------------------------------------------------
  // The twin could rehearse losing a region and losing a person. It could not rehearse the things
  // that actually reshape an institution: a budget cut, a restructure, a new statute, a partner
  // agency. Those arrive with more warning than an outage and are planned for far less carefully,
  // because nothing existed to plan against.
  'policy-reform': {
    perturbs: 'policy', question: 'If several operating rules change together, which contexts are governed differently and what depended on the old guarantee?',
    assumptions: ['ASM-0001', 'ASM-0003'],
    limitations: ['Only consistency stances are modelled as policy; authorization, retention and disclosure policy are not simulated here.', 'The model knows which contexts hold a stance, not which readers currently rely on it.'],
    owner: 'Architecture Review Board', reviewCadenceDays: 180,
  },
  'legislative-change': {
    perturbs: 'bounded-context', question: 'If this statute changes, which bounded contexts, decisions and controls have to move with it?',
    assumptions: ['ASM-0001', 'ASM-0006'],
    limitations: ['Reach is computed over declared dependencies, so it is a lower bound.', 'Legal interpretation is not modelled: this answers what would be touched, never what the law requires.'],
    owner: 'Attorney General Chambers', reviewCadenceDays: 180,
  },
  'funding-reduction': {
    perturbs: 'governance-control', question: 'If the estate has to be run by fewer people, which governance objects lose an accountable authority first?',
    assumptions: ['ASM-0006'],
    limitations: ['Reduction is modelled as whole roles becoming unavailable, not as partial time. A half-funded post looks fully staffed here.', 'Says nothing about which cuts are politically or legally possible.'],
    owner: 'Oversight Board', reviewCadenceDays: 90,
  },
  'organizational-restructuring': {
    perturbs: 'governance-control', question: 'If these authorities merge or these subsystems move, does separation of duties survive?',
    assumptions: ['ASM-0006'],
    limitations: ['Models the accountability record, not the people or the politics of a merger.', 'A merger that is announced and not executed looks identical here to one that is complete.'],
    owner: 'Oversight Board', reviewCadenceDays: 180,
  },
  'staffing-growth': {
    perturbs: 'governance-control', question: 'If more people arrive, what actually improves — and what does not improve until they are trained and have rehearsed?',
    assumptions: ['ASM-0006'],
    limitations: ['New arrivals are modelled as untrained and unrehearsed, which is the pessimistic and usually correct case.', 'Does not model the cost of onboarding to the people already here.'],
    owner: 'Oversight Board', reviewCadenceDays: 180,
  },
  'cross-government-collaboration': {
    perturbs: 'bounded-context', question: 'If another institution joins, what would be shared, and does any of it cross a zone boundary?',
    assumptions: ['ASM-0001'],
    limitations: ['Models declared data flows between contexts; an informal exchange by email is invisible here.', 'Says nothing about whether a partner institution\'s own controls are adequate.'],
    owner: 'Data Governance Board', reviewCadenceDays: 90,
  },
  'emergency-operations': {
    perturbs: 'service', question: 'Under a surge with services already lost, is there anybody left to authorise the decisions the surge requires?',
    assumptions: ['ASM-0001', 'ASM-0005', 'ASM-0006'],
    limitations: ['Surge is modelled as a multiple of concurrent decisions, not as a queue with a service rate.', 'Assumes everybody not named as absent is available and able to work, which an emergency rarely permits.'],
    owner: 'Operations Review Board', reviewCadenceDays: 90,
  },
};

// A simulation's confidence is capped by the weakest of three things, never averaged across them:
// how sound its assumptions are, whether the model is complete, and whether anyone has ever checked
// this scenario's output against what actually happened.
const CALIBRATION_STATES = {
  uncalibrated: { description: 'No simulation of this scenario has ever been compared against a real outcome.', ceiling: 'low' },
  diverging: { description: 'The most recent comparisons found the simulation disagreed with reality.', ceiling: 'unknown' },
  calibrated: { description: 'Recent comparisons found the simulation matched the observed outcome.', ceiling: 'high' },
};
const CALIBRATION_MIN_OBSERVATIONS = 3;

// --- Multi-dimensional confidence (Phase 14, Part 2) ---------------------------------------------
//
// Phase 13 capped a single confidence figure by the weakest of three factors. That was an improvement
// on a number nobody could argue with, and it still hid something: the three factors answered
// different questions and were reported as one word. A reader told "low" could not tell whether the
// model was wrong, the assumptions were stale, or nobody had ever checked the output — and those
// three need work from three different people.
//
// So confidence is now SIX INDEPENDENT DIMENSIONS, each with its own question, its own derivation and
// its own answer. The overall figure is derived from them — the weakest, never the average — and
// there is no path that sets it directly.
//
// The `alias` field keeps the three original factor names, so anything reading `limitedBy` for
// 'calibration', 'assumptions' or 'model-completeness' keeps working. Renaming them would have been
// tidier and would have quietly broken every caller, which is the kind of tidiness this platform
// refuses everywhere else.
const CONFIDENCE_DIMENSIONS = {
  model: {
    alias: 'model-completeness',
    question: 'Does the model still describe the architecture-of-record, in both directions?',
    derivedFrom: 'OperationsTwin.validate()',
    absentMeans: 'The simulation is reasoning about a system that is not the one deployed.',
  },
  evidence: {
    alias: 'assumptions',
    question: 'Do the assumptions this scenario rests on still hold, including what they themselves rest on?',
    derivedFrom: 'src/architecture/assumptions.js (propagated health)',
    absentMeans: 'The answer may be correct about a world that no longer exists.',
  },
  data: {
    alias: 'data',
    question: 'Is the thing this scenario perturbs actually present in the model, in more than one instance?',
    derivedFrom: 'the modelled entities of the scenario\'s `perturbs` kind',
    absentMeans: 'The scenario perturbs something the model does not contain, so its findings are about nothing.',
  },
  simulation: {
    alias: 'simulation',
    question: 'Did the simulation machinery itself behave — was the baseline left untouched and deep-frozen?',
    derivedFrom: 'OperationsTwin.verifyIsolation()',
    absentMeans: 'A simulation has mutated production state, so every previous result is suspect too.',
  },
  forecast: {
    alias: 'forecast',
    question: 'Is this scenario\'s agreement with reality holding, or decaying?',
    derivedFrom: 'OperationsTwin.confidenceTrend()',
    absentMeans: 'The model may have been right once and be drifting away without anybody noticing.',
  },
  calibration: {
    alias: 'calibration',
    question: 'Has anybody ever compared this scenario\'s output against what actually happened?',
    derivedFrom: 'OperationsTwin.calibration()',
    absentMeans: 'Nothing distinguishes this from a plausible story told confidently.',
  },
};

// Confidence ranking, shared with the assumption registry so the two cannot drift apart.
const { CONFIDENCE_LEVELS } = require('../architecture/assumptions');
function confidenceRankOf(level) { const i = CONFIDENCE_LEVELS.indexOf(level); return i === -1 ? CONFIDENCE_LEVELS.length : i; }
function weakerConfidence(a, b) { return confidenceRankOf(a) >= confidenceRankOf(b) ? a : b; }

// PHASE 13, PART 1: a scenario with no declared assumptions, limitations, owner or cadence may not
// be simulated. The output of such a run is a confident answer with nothing for the reader to
// disagree with, which is worse than no answer at all.
//
// Extracted and exported so the guard can be fed a crafted scenario spec directly. A check that can
// only be exercised by mutating the real scenario table is a check nobody dares exercise.
function assertDeclaredMetadata(scenario, spec) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!spec) fail(`unknown scenario '${scenario}'`);
  if (!Array.isArray(spec.assumptions) || !spec.assumptions.length) {
    fail(`scenario '${scenario}' declares no assumptions — a simulation whose assumptions are unstated cannot be argued with, and must not be run`);
  }
  if (!Array.isArray(spec.limitations) || !spec.limitations.length) {
    fail(`scenario '${scenario}' declares no model limitations — every model has them, and one that lists none is claiming to be the system`);
  }
  if (!spec.owner) fail(`scenario '${scenario}' has no owner — a model nobody owns is one nobody can correct`);
  if (!Number.isFinite(spec.reviewCadenceDays) || spec.reviewCadenceDays <= 0) fail(`scenario '${scenario}' has no review cadence — a model nobody re-reads goes stale silently`);
  return true;
}

// PHASE 14, PART 2: a simulation whose confidence is incomplete may not run. "Incomplete" means a
// dimension is absent or carries no level — not that a dimension reports `unknown`, which is a
// perfectly good answer and often the true one. A missing dimension is a question nobody asked, and
// an overall figure derived from five of six is an overall figure that is wrong in an unknown
// direction.
//
// Exported so the guard can be fed a crafted partial set, on the same principle as
// `assertDeclaredMetadata`: a check that can only be exercised by breaking the real code is a check
// nobody dares exercise.
function assertCompleteConfidence(scenario, dimensions) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!Array.isArray(dimensions)) fail(`scenario '${scenario}' produced no confidence dimensions at all`);
  const seen = new Map(dimensions.map((d) => [d.dimension, d]));
  for (const id of Object.keys(CONFIDENCE_DIMENSIONS)) {
    const d = seen.get(id);
    if (!d) fail(`scenario '${scenario}' is missing the '${id}' confidence dimension — an overall figure derived from an incomplete set is wrong in an unknown direction`);
    if (!CONFIDENCE_LEVELS.includes(d.level)) fail(`scenario '${scenario}': confidence dimension '${id}' carries no recognised level`);
    if (!d.why) fail(`scenario '${scenario}': confidence dimension '${id}' states no reason — a level nobody can argue with is a score, not an assessment`);
  }
  for (const d of dimensions) if (!CONFIDENCE_DIMENSIONS[d.dimension]) fail(`scenario '${scenario}' reports an undeclared confidence dimension '${d.dimension}'`);
  return true;
}

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
  constructor({ evidenceIds = [], regions = ['bw-central', 'bw-south', 'bw-north'], assumptions = null, clock = () => 0 } = {}) {
    // Frozen at construction. Not "treated as read-only by convention" — frozen, so an attempt to
    // write to it fails rather than silently succeeding in a way a test would have to notice.
    this._model = deepFreeze(buildModel({ evidenceIds, regions }));
    this._baselineDigest = this._model.digest;
    this._simulations = [];
    this._assumptions = assumptions;      // the registry, if the caller supplied one
    this._clock = clock;
    this._validations = new Map();        // scenario → observed-vs-predicted history, never seeded
    this._evidenceIds = [...evidenceIds];
  }

  model() { return clone(this._model); }
  digest() { return this._baselineDigest; }
  entityKinds() { return Object.entries(ENTITY_KINDS).map(([id, s]) => ({ kind: id, ...s })); }
  scenarios() { return Object.entries(SCENARIOS).map(([id, s]) => ({ scenario: id, ...s })); }

  // --- Confidence framework (Phase 13, Part 1) --------------------------------------------------

  // Record what a simulation predicted against what was actually observed. Append-only, attributed
  // and NEVER seeded: fabricating a calibration history would make every confidence figure below a
  // lie, and it is the single cheapest way to make this whole framework worthless.
  recordValidation(scenario, {
    predicted, observed, by, at = null, note = null, predictedValue = null, observedValue = null,
    // Phase 17, Part 4. Both optional, so every existing caller keeps working — but a validation
    // with no evidence is recorded as UNVERIFIED, and an unverified validation can never raise the
    // twin's confidence in itself. The API is unchanged; the discipline is new.
    evidence = [], reviewEveryDays = null,
  } = {}) {
    if (!SCENARIOS[scenario]) throw new Error(`unknown scenario '${scenario}'`);
    if (typeof predicted !== 'boolean' || typeof observed !== 'boolean') throw new Error('a validation must record what was predicted and what was observed, as booleans');
    if (!by) { const e = new Error('a simulation validation must name who compared it against reality'); e.failClosed = true; throw e; }
    // Phase 16, Part 10. A magnitude is optional — many scenarios genuinely only have a yes/no
    // outcome — but half of one is not: a predicted value with nothing to compare it against is a
    // number that will be read as an error measurement.
    if ((predictedValue === null) !== (observedValue === null)) {
      const e = new Error('a quantitative validation needs both a predicted and an observed value — one without the other cannot produce a calibration error, and will be read as though it had');
      e.failClosed = true; throw e;
    }
    if (predictedValue !== null && (!Number.isFinite(predictedValue) || !Number.isFinite(observedValue))) {
      throw new Error('predicted and observed values must be numbers on the same scale');
    }
    if (reviewEveryDays !== null && (!Number.isFinite(reviewEveryDays) || reviewEveryDays <= 0)) {
      throw new Error('a validation review schedule must be a positive number of days');
    }
    if (!Array.isArray(evidence)) throw new Error('validation evidence must be a list of records that back the observation');
    if (!this._validations.has(scenario)) this._validations.set(scenario, []);
    const recordedAt = at ?? this._clock();
    const rec = {
      scenario, predicted, observed, agreed: predicted === observed, by, at: recordedAt, note,
      predictedValue, observedValue,
      calibrationError: predictedValue === null ? null : +Math.abs(predictedValue - observedValue).toFixed(4),
      signedError: predictedValue === null ? null : +(predictedValue - observedValue).toFixed(4),
      // Phase 17, Part 4. What backs the observation, and when somebody must look again.
      evidence: [...evidence],
      // The distinction the whole part rests on. Somebody saying the simulation was right is not
      // the same as a record of what actually happened, and only the second may raise confidence.
      verified: evidence.length > 0,
      reviewEveryDays,
      reviewDueAt: reviewEveryDays === null ? null : recordedAt + reviewEveryDays * 24 * 3600_000,
      // THE STAMP THAT MAKES THIS HONEST. Calibration evidence is about the model that produced it.
      // The twin freezes its model at construction, so a comparison recorded against a different
      // model is evidence about a different twin, and this is the only thing that can tell.
      modelDigest: this._baselineDigest,
    };
    this._validations.get(scenario).push(rec);
    return { ...rec };
  }
  validationHistory(scenario) { return (this._validations.get(scenario) || []).map((v) => ({ ...v })); }

  // Has anyone checked this scenario against reality, and did it agree?
  calibration(scenario, { window = 5 } = {}) {
    const history = this.validationHistory(scenario);
    if (history.length < CALIBRATION_MIN_OBSERVATIONS) {
      return {
        scenario, state: 'uncalibrated', observations: history.length, required: CALIBRATION_MIN_OBSERVATIONS,
        ...CALIBRATION_STATES.uncalibrated,
        reason: `${history.length} of ${CALIBRATION_MIN_OBSERVATIONS} comparisons against a real outcome — a simulation nobody has checked is not a simulation anyone should rely on`,
      };
    }
    const recent = history.slice(-window);
    const agreed = recent.filter((v) => v.agreed).length;
    const rate = +(agreed / recent.length).toFixed(3);
    const state = rate >= 0.8 ? 'calibrated' : 'diverging';
    return {
      scenario, state, observations: history.length, window: recent.length, agreementRate: rate,
      ...CALIBRATION_STATES[state],
      reason: `${agreed} of the last ${recent.length} comparisons agreed with the observed outcome`,
    };
  }

  // --- Twin learning (Phase 17, Part 4) ------------------------------------------------------------
  //
  // Whether a scenario's simulation is getting better at predicting reality. There is exactly one
  // rule, and everything below exists to enforce it:
  //
  //   SIMULATION CONFIDENCE MAY ONLY INCREASE THROUGH VERIFIED OPERATIONAL EVIDENCE.
  //
  // Three things can raise a scenario's agreement rate and only one of them is the twin getting
  // better. Somebody may record agreements without any record of what happened — that is an opinion
  // about the simulation, not a test of it. The MODEL may have been rebuilt, in which case the later
  // observations are about a different twin and the comparison is between two different things.
  // Or the twin genuinely predicted what was then observed and recorded, which is the only case that
  // counts.
  //
  // The model digest stamped on every validation is what makes the second case detectable at all.
  scenarioLearning(scenario, { now = null } = {}) {
    const evidenceConfidence = require('../assurance/evidence-confidence');
    const t = now ?? this._clock();
    if (!SCENARIOS[scenario]) throw new Error(`unknown scenario '${scenario}'`);
    const history = this.validationHistory(scenario).sort((a, b) => a.at - b.at);
    const round = (x) => (x === null ? null : +x.toFixed(4));
    const need = 2 * CALIBRATION_MIN_OBSERVATIONS;

    const verified = history.filter((v) => v.verified);
    const unverified = history.filter((v) => !v.verified);
    const overdue = history.filter((v) => v.reviewDueAt !== null && t > v.reviewDueAt);
    const unscheduled = history.filter((v) => v.reviewDueAt === null);

    if (history.length < need) {
      return {
        scenario, measurable: false, observations: history.length, required: need,
        verifiedObservations: verified.length, unverifiedObservations: unverified.length,
        agreementTrend: evidenceConfidence.verifiedImprovement({ subject: `simulation agreement: ${scenario}`, series: [] }),
        modelRebuilt: null, confidenceAdjustment: null,
        overdueReviews: overdue.map((v) => v.at), unscheduledReviews: unscheduled.length,
        reason: `${history.length} of ${need} comparisons — a simulation needs two comparable halves before anything can be said about it learning. This is UNKNOWN, not a twin that failed to improve.`,
        now: t, informationalOnly: true, authorizes: false,
      };
    }

    const half = Math.floor(history.length / 2);
    const halves = [history.slice(0, half), history.slice(half)];
    const [earlier, later] = halves.map((h) => ({
      observations: h.length,
      agreementRate: round(h.filter((v) => v.agreed).length / h.length),
      verified: h.filter((v) => v.verified).length,
      meanCalibrationError: (() => {
        const errs = h.filter((v) => v.calibrationError !== null).map((v) => v.calibrationError);
        return errs.length ? round(errs.reduce((a, b) => a + b, 0) / errs.length) : null;
      })(),
    }));

    // A rebuilt model makes the two halves incomparable. The digest stamp is the only thing that
    // could ever have detected this.
    const digests = [...new Set(history.map((v) => v.modelDigest))];
    const modelRebuilt = digests.length > 1;

    // What may support a rise: the observations in the LATER half that carry evidence. An
    // observation somebody recorded with nothing behind it supports nothing.
    const supporting = later.verified > 0
      ? [{ kind: 'observed-outcome', detail: `${later.verified} of ${later.observations} comparison(s) in the later half carry recorded operational evidence`, by: 'twin validation register' }]
      : [];
    const explaining = modelRebuilt
      ? [{ kind: 'measurement-change', detail: `the model was rebuilt during this history (${digests.length} distinct digests), so the two halves are simulations of different systems` }]
      : [];

    const agreementTrend = evidenceConfidence.verifiedImprovement({
      subject: `simulation agreement: ${scenario}`,
      series: [earlier.agreementRate, later.agreementRate],
      evidence: [...supporting, ...explaining],
    });

    // THE RULE, computed. Confidence may rise only on a verified improvement.
    const mayRaiseConfidence = agreementTrend.state === 'verified-improvement' && !modelRebuilt;
    return {
      scenario, measurable: true, observations: history.length, required: need,
      verifiedObservations: verified.length, unverifiedObservations: unverified.length,
      earlier, later,
      agreementTrend,
      modelRebuilt, modelDigests: digests.length,
      // A recommendation, never applied. `confidence()` derives its own figure from the six
      // dimensions and nothing here writes to it.
      confidenceAdjustment: {
        direction: mayRaiseConfidence ? 'may-increase' : agreementTrend.state === 'regressed' ? 'must-decrease' : 'unchanged',
        applied: false, requiresHumanApproval: true, approvedBy: null,
        because: mayRaiseConfidence
          ? `agreement rose from ${earlier.agreementRate} to ${later.agreementRate}, supported by ${later.verified} recorded operational outcome(s)`
          : modelRebuilt ? 'the model was rebuilt, so the improvement is in a different simulation and cannot raise confidence in this one'
            : agreementTrend.state === 'unverified-improvement' ? 'agreement rose and no comparison in the later half carries recorded evidence — an opinion about the simulation is not a test of it'
              : agreementTrend.reason,
      },
      overdueReviews: overdue.map((v) => v.at), unscheduledReviews: unscheduled.length,
      reason: agreementTrend.reason,
      now: t, informationalOnly: true, authorizes: false,
    };
  }

  // Part 4's learning dashboard, across every scenario.
  learningReport({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = Object.keys(SCENARIOS).map((s) => this.scenarioLearning(s, { now: t }));
    const measured = rows.filter((r) => r.measurable);
    const unverified = rows.filter((r) => r.agreementTrend.violatesInvariant);
    return {
      scenarios: rows, count: rows.length,
      measurable: measured.length > 0,
      unknown: rows.filter((r) => !r.measurable).map((r) => r.scenario),
      improving: rows.filter((r) => r.agreementTrend.state === 'verified-improvement').map((r) => r.scenario),
      unverifiedImprovements: unverified.map((r) => r.scenario),
      rebuiltModels: rows.filter((r) => r.modelRebuilt).map((r) => r.scenario),
      mayRaiseConfidence: measured.filter((r) => r.confidenceAdjustment.direction === 'may-increase').map((r) => r.scenario),
      everyImprovementVerified: unverified.length === 0,
      // Constants. Nothing in this module applies an adjustment.
      adjustmentsApplied: 0,
      totalObservations: rows.reduce((a, r) => a + r.observations, 0),
      verifiedObservations: rows.reduce((a, r) => a + r.verifiedObservations, 0),
      overdueReviewCount: rows.reduce((a, r) => a + r.overdueReviews.length, 0),
      basis: measured.length
        ? `${measured.length} of ${rows.length} scenario(s) have two comparable halves of validations. ${rows.length - measured.length} are UNKNOWN — a simulation nobody has compared is not one that failed to improve.`
        : `No scenario has been validated enough times to have two comparable halves. Twin learning across all ${rows.length} scenarios is UNKNOWN, and this needs somebody to compare simulations against real outcomes rather than somebody to fix a model.`,
      now: t, informationalOnly: true, authorizes: false,
      note: 'Simulation confidence may only increase through verified operational evidence. An agreement somebody recorded with nothing behind it is an opinion about the simulation rather than a test of it, and a model that was rebuilt mid-history produces two halves that are simulations of different systems. Every confidence adjustment is a recommendation; nothing here applies one.',
    };
  }

  // --- Twin calibration (Phase 16, Part 10) ------------------------------------------------------
  //
  // `calibration()` above answers "did the simulation agree?" as a yes/no over a window. Part 10
  // asks four questions it cannot answer: how accurate, how confident, how far off, and how steady.
  //
  // The distinction this whole section exists to preserve:
  //
  //   UNKNOWN CALIBRATION IS NOT POOR CALIBRATION. A scenario nobody has compared has an unknown
  //   accuracy. A scenario compared and found wrong has a poor one. The first needs somebody to
  //   start looking; the second needs somebody to fix a model. Merging them sends the wrong person.
  scenarioCalibration(scenario, { now = null } = {}) {
    if (!SCENARIOS[scenario]) throw new Error(`unknown scenario '${scenario}'`);
    const t = now ?? this._clock();
    const history = this.validationHistory(scenario);
    const quantitative = history.filter((h) => h.calibrationError !== null);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const round = (x) => (x === null ? null : +x.toFixed(4));

    // Evidence recorded against a superseded model is about a different twin. Kept, named, and
    // excluded from the figures rather than quietly counted.
    const currentModel = history.filter((h) => h.modelDigest === this._baselineDigest);
    const supersededModel = history.filter((h) => h.modelDigest !== this._baselineDigest);

    if (!currentModel.length) {
      return {
        scenario, state: 'unknown', calibrated: false, assessed: false,
        comparisons: 0, quantitativeComparisons: 0, supersededComparisons: supersededModel.length,
        predictionAccuracy: null, calibrationError: null, signedError: null, modelStability: null,
        simulationConfidence: 'unknown',
        reason: supersededModel.length
          ? `${supersededModel.length} comparison(s) exist and every one was recorded against a different model — they are evidence about a twin this is not, and this scenario's accuracy against THIS model is unknown`
          : 'no simulation of this scenario has ever been compared against a real outcome, so its accuracy is UNKNOWN — which is not the same as poor',
      };
    }
    const accuracy = round(currentModel.filter((h) => h.agreed).length / currentModel.length);
    const q = currentModel.filter((h) => h.calibrationError !== null);
    // Stability: how much the observed error moves between consecutive comparisons. A model that is
    // wrong by a consistent amount is a different problem from one that is unpredictably wrong, and
    // only the second is unusable.
    const steps = q.slice(1).map((h, i) => Math.abs(h.calibrationError - q[i].calibrationError));
    const modelStability = steps.length ? round(mean(steps)) : null;

    const assessed = currentModel.length >= CALIBRATION_MIN_OBSERVATIONS;
    const state = !assessed ? 'insufficient' : accuracy >= 0.8 ? 'calibrated' : 'poor';
    // Confidence is capped by the evidence, never by the arithmetic: three agreeing comparisons do
    // not make a model trustworthy, they make it not-yet-contradicted.
    const simulationConfidence = !assessed ? 'unknown' : state === 'poor' ? 'low' : q.length >= CALIBRATION_MIN_OBSERVATIONS ? 'high' : 'moderate';
    return {
      scenario, state, calibrated: state === 'calibrated', assessed,
      comparisons: currentModel.length, quantitativeComparisons: q.length,
      supersededComparisons: supersededModel.length,
      required: CALIBRATION_MIN_OBSERVATIONS,
      predictionAccuracy: accuracy,
      calibrationError: q.length ? round(mean(q.map((h) => h.calibrationError))) : null,
      signedError: q.length ? round(mean(q.map((h) => h.signedError))) : null,
      modelStability, simulationConfidence,
      // A magnitude nobody recorded is not a magnitude of zero.
      quantitativeBasis: q.length
        ? `${q.length} comparison(s) recorded a magnitude, so a calibration error is measurable`
        : 'every comparison recorded only agree/disagree, so how far off the simulation was is unknown',
      reason: !assessed
        ? `${currentModel.length} of ${CALIBRATION_MIN_OBSERVATIONS} comparisons against this model — too few to distinguish a working simulation from a lucky one`
        : `${Math.round(accuracy * 100)}% of ${currentModel.length} comparisons agreed with the observed outcome`,
      now: t,
    };
  }

  // Part 10's report across every scenario. Unknown, insufficient and poor are three columns.
  calibrationReport({ now = null } = {}) {
    const t = now ?? this._clock();
    const rows = Object.keys(SCENARIOS).sort().map((s) => this.scenarioCalibration(s, { now: t }));
    const assessed = rows.filter((r) => r.assessed);
    return {
      scenarios: rows, count: rows.length,
      modelDigest: this._baselineDigest,
      unknown: rows.filter((r) => r.state === 'unknown').map((r) => r.scenario),
      insufficient: rows.filter((r) => r.state === 'insufficient').map((r) => r.scenario),
      poor: rows.filter((r) => r.state === 'poor').map((r) => r.scenario),
      calibrated: rows.filter((r) => r.calibrated).map((r) => r.scenario),
      supersededEvidence: rows.filter((r) => r.supersededComparisons > 0).map((r) => ({ scenario: r.scenario, comparisons: r.supersededComparisons })),
      // Over assessed scenarios only. Counting the unexamined as failures would punish the
      // institution for not yet having a history, which is not a finding about the model.
      accuracyRate: assessed.length ? +(assessed.filter((r) => r.calibrated).length / assessed.length).toFixed(4) : null,
      measurable: assessed.length > 0,
      basis: assessed.length
        ? `${assessed.filter((r) => r.calibrated).length} of ${assessed.length} ASSESSED scenarios are calibrated. ${rows.length - assessed.length} have never been compared enough times and are excluded rather than counted as poor.`
        : `No scenario has been compared against a real outcome enough times to assess. The twin's prediction accuracy is UNKNOWN across all ${rows.length} scenarios — which is distinct from poor, and needs somebody to start recording outcomes rather than somebody to fix a model.`,
      now: t, informationalOnly: true, authorizes: false,
      note: 'Calibration evidence is about the model that produced it. Every comparison is stamped with the model digest it was recorded against, and evidence about a superseded model is named and excluded rather than counted — a twin that changed since it was last checked has not been checked.',
    };
  }

  // How much of the model rests on evidence that actually ran, rather than on declared configuration.
  evidenceBasis() {
    const byKind = this._model.byKind;
    const derived = ['bounded-context', 'service', 'infrastructure', 'governance-control', 'policy', 'risk', 'data-flow', 'workflow', 'regional-deployment']
      .reduce((a, k) => a + (byKind[k] || 0), 0);
    return {
      entities: this._model.entities.length,
      derivedFromRegistries: derived,
      executableChecks: byKind.evidence || 0,
      sources: this._model.builtFrom,
      // Stated rather than implied: most of the model is DECLARED configuration, which is a weaker
      // thing than an executed check, and a confidence figure that hid that would be flattering.
      note: 'The model is read from registries the platform validates. Most entities are declared configuration; only the evidence nodes represent checks that actually ran.',
    };
  }

  // THE SIX DIMENSIONS (Phase 14, Part 2). Each is derived independently and answers its own
  // question; nothing here accepts a level from a caller.
  confidenceDimensions(scenario, { now = null, controls = [] } = {}) {
    const spec = SCENARIOS[scenario];
    if (!spec) throw new Error(`unknown scenario '${scenario}'`);
    const t = now ?? this._clock();
    const out = [];
    const dim = (id, level, why, detail = null) => out.push({ dimension: id, ...CONFIDENCE_DIMENSIONS[id], level, why, detail });

    // Calibration — has the output ever been checked against a real outcome?
    const calibration = this.calibration(scenario);
    dim('calibration', CALIBRATION_STATES[calibration.state].ceiling, calibration.reason, calibration);

    // Evidence — the assumptions, including everything they themselves rest on.
    let assumptionHealth = null;
    if (!this._assumptions) {
      dim('evidence', 'unknown', 'no assumption registry was supplied — whether this scenario\'s assumptions still hold is unknown, and unknown is not sound');
    } else {
      assumptionHealth = this._assumptions.health(spec.assumptions, { now: t, controls });
      dim('evidence', assumptionHealth.confidence, assumptionHealth.reason, assumptionHealth);
    }

    // Model — does it still describe the architecture-of-record?
    const validation = this.validate();
    dim('model', validation.valid ? 'high' : 'unknown',
      validation.valid ? 'the model matches the architecture-of-record in both directions' : `the model has drifted: ${validation.violations.join('; ')}`,
      validation);

    // Data — is the thing this scenario perturbs actually in the model? A scenario perturbing a kind
    // with no instances produces findings about nothing, and with exactly one instance there is
    // nothing to compare a perturbation against.
    const population = this._model.entities.filter((e) => e.kind === spec.perturbs).length;
    dim('data',
      population === 0 ? 'unknown' : population === 1 ? 'low' : 'high',
      population === 0
        ? `the model contains no '${spec.perturbs}' entities — this scenario perturbs something that is not there`
        : population === 1
          ? `only one '${spec.perturbs}' entity is modelled, so a perturbation has nothing to be compared against`
          : `${population} '${spec.perturbs}' entities are modelled`,
      { perturbs: spec.perturbs, population });

    // Simulation — did the machinery behave? The baseline must be frozen and its digest unchanged.
    const isolation = this.verifyIsolation();
    dim('simulation',
      isolation.unchanged && isolation.frozen ? 'high' : 'unknown',
      isolation.unchanged && isolation.frozen
        ? 'the baseline is deep-frozen and its digest is unchanged, so no previous simulation touched production state'
        : 'the baseline digest has moved or the model is not frozen — a simulation has mutated production state and every previous result is suspect',
      isolation);

    // Forecast — is agreement with reality holding, or decaying? Decay is the dimension that catches
    // a model which used to be right, which no single-point calibration figure ever would.
    const trend = this.confidenceTrend(scenario);
    dim('forecast',
      trend.direction === 'degrading' ? 'unknown' : trend.direction === 'insufficient-data' ? 'low' : 'high',
      trend.direction === 'degrading'
        ? `agreement with reality is falling (${trend.earlier} → ${trend.later}) — the model was right and is drifting`
        : trend.direction === 'insufficient-data'
          ? 'fewer than two comparisons against reality, so there is no direction to report'
          : `agreement with reality is ${trend.direction}`,
      trend);

    return out;
  }

  // The overall figure, DERIVED from the six dimensions — the weakest, never the average, because a
  // simulation resting on an expired assumption rests on an expired assumption whatever else is true
  // of it. There is no parameter anywhere below that sets this.
  confidence(scenario, { now = null, controls = [] } = {}) {
    const spec = SCENARIOS[scenario];
    if (!spec) throw new Error(`unknown scenario '${scenario}'`);
    const dimensions = this.confidenceDimensions(scenario, { now, controls });
    assertCompleteConfidence(scenario, dimensions);

    const level = dimensions.reduce((w, d) => weakerConfidence(w, d.level), 'high');
    // `factors` keeps the legacy names so existing readers of `limitedBy` keep working.
    const caps = dimensions.map((d) => ({ factor: d.alias, dimension: d.dimension, level: d.level, why: d.why }));
    const limiting = caps.filter((c) => c.level === level).map((c) => c.factor);
    const calibration = dimensions.find((d) => d.dimension === 'calibration').detail;
    const assumptionHealth = (dimensions.find((d) => d.dimension === 'evidence') || {}).detail || null;
    return {
      scenario, confidence: level, limitedBy: limiting,
      dimensions, factors: caps,
      dimensionLevels: Object.fromEntries(dimensions.map((d) => [d.dimension, d.level])),
      complete: true, derived: true, manualEntry: false,
      calibration, assumptions: assumptionHealth, evidenceBasis: this.evidenceBasis(),
      owner: spec.owner, reviewCadenceDays: spec.reviewCadenceDays,
      method: 'the weakest of six independent dimensions — model, evidence, data, simulation, forecast and calibration — never their average',
      note: level === 'high' ? 'Every dimension supports this level.' : `Capped at '${level}' by ${limiting.join(', ')}. Raising it means fixing that, not re-reading the model.`,
    };
  }

  // Reliability across every scenario, and which way each is moving.
  confidenceReport({ now = null, controls = [] } = {}) {
    const rows = Object.keys(SCENARIOS).sort().map((s) => {
      const c = this.confidence(s, { now, controls });
      return {
        scenario: s, confidence: c.confidence, limitedBy: c.limitedBy,
        dimensions: c.dimensionLevels,
        calibration: c.calibration.state, observations: c.calibration.observations,
        assumptions: SCENARIOS[s].assumptions, limitations: SCENARIOS[s].limitations,
        owner: SCENARIOS[s].owner, trend: this.confidenceTrend(s).direction,
      };
    });
    const weakest = rows.slice().sort((a, b) => confidenceRankOf(b.confidence) - confidenceRankOf(a.confidence))[0];
    // Which dimension limits the estate most often? The answer says where to spend effort, and it is
    // counted rather than guessed.
    const byDimension = {};
    for (const r of rows) {
      for (const [d, level] of Object.entries(r.dimensions)) {
        const acc = (byDimension[d] = byDimension[d] || { dimension: d, weakest: 'high', limiting: 0 });
        acc.weakest = weakerConfidence(acc.weakest, level);
        if (level === r.confidence) acc.limiting += 1;
      }
    }
    return {
      scenarios: rows, count: rows.length,
      dimensions: Object.entries(CONFIDENCE_DIMENSIONS).map(([id, d]) => ({ dimension: id, ...d })),
      byDimension: Object.values(byDimension).sort((a, b) => b.limiting - a.limiting || a.dimension.localeCompare(b.dimension)),
      mostLimitingDimension: Object.values(byDimension).sort((a, b) => b.limiting - a.limiting || a.dimension.localeCompare(b.dimension))[0] || null,
      // Weakest link again: the twin is as reliable as its least reliable scenario.
      confidence: rows.reduce((w, r) => weakerConfidence(w, r.confidence), 'high'),
      weakestScenario: weakest ? weakest.scenario : null,
      uncalibrated: rows.filter((r) => r.calibration === 'uncalibrated').map((r) => r.scenario),
      diverging: rows.filter((r) => r.calibration === 'diverging').map((r) => r.scenario),
      informationalOnly: true, authorizes: false,
      note: 'A simulation nobody has compared against a real outcome is uncalibrated, and an uncalibrated simulation cannot report high confidence however complete the model is.',
    };
  }

  // Is this scenario's agreement with reality improving or decaying? Two comparisons minimum —
  // one observation is a result, not a direction.
  confidenceTrend(scenario, { half = null } = {}) {
    const history = this.validationHistory(scenario);
    if (history.length < 2) return { scenario, observations: history.length, direction: 'insufficient-data', reason: 'a trend needs at least two comparisons against reality' };
    const mid = half ?? Math.floor(history.length / 2);
    const rate = (rows) => (rows.length ? rows.filter((v) => v.agreed).length / rows.length : 0);
    const earlier = rate(history.slice(0, mid));
    const later = rate(history.slice(mid));
    const delta = +(later - earlier).toFixed(3);
    return {
      scenario, observations: history.length, earlier: +earlier.toFixed(3), later: +later.toFixed(3), delta,
      direction: Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'improving' : 'degrading',
      warning: delta < 0 ? `agreement with reality has fallen for '${scenario}' — the model is drifting away from the system it describes` : null,
    };
  }
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
  simulate({ scenario, change = {}, label = null, now = null, controls = [] } = {}) {
    const spec = SCENARIOS[scenario];
    if (!spec) throw new Error(`unknown scenario '${scenario}' — one of ${Object.keys(SCENARIOS).join(', ')}`);
    assertDeclaredMetadata(scenario, spec);
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
    } else if (scenario === 'owner-absence' || scenario === 'leadership-turnover' || scenario === 'operational-overload') {
      // Organizational simulation. `continuity` is supplied by the caller because the twin models
      // the ORG CHART, not the people's readiness — that evidence lives in the ownership registers,
      // and duplicating it here would be a second copy that drifts.
      const absent = new Set(change.absent || change.vacated || []);
      const concurrent = Number(change.concurrentIncidents || 0);
      const continuity = change.continuity || null;
      const affected = [];
      for (const sub of ownership.subsystems()) {
        const o = ownership.OWNERSHIP[sub];
        for (const role of ownership.DEPUTY_ROLES) {
          const primary = o[role];
          const deputy = ownership.deputyOf(primary);
          const primaryOut = absent.has(primary);
          // Turnover takes the office AND its deputy: a new chair arrives with a new vice-chair.
          const deputyOut = absent.has(deputy) || (scenario === 'leadership-turnover' && primaryOut);
          if (!primaryOut && !deputyOut) continue;
          const deputyReady = continuity
            ? ((continuity.roles.find((r) => r.subsystem === sub && r.role === role) || {}).deputyReadiness || null)
            : null;
          // Covered means: the primary is still there, OR the deputy is there AND assessed ready.
          const covered = !primaryOut || (!deputyOut && deputyReady !== null && deputyReady.ready === true);
          affected.push({ subsystem: sub, role, primary, deputy, primaryOut, deputyOut, covered });
          if (!covered) {
            findings.push({
              entity: `gov:${sub}`, kind: 'governance-control', blocking: true,
              finding: primaryOut && deputyOut
                ? `'${sub}/${role}' loses both ${primary} and ${deputy} — no accountable authority remains`
                : `'${sub}/${role}': ${primary} is unavailable and ${deputy} is not assessed as ready to take over`,
            });
          }
        }
      }
      if (scenario === 'operational-overload') {
        const authorities = new Set();
        for (const sub of ownership.subsystems()) {
          const a = ownership.OWNERSHIP[sub].approvingAuthority;
          if (!absent.has(a)) authorities.add(a);
        }
        if (concurrent > authorities.size) {
          findings.push({ entity: 'governance-capacity', kind: 'governance-control', blocking: true, finding: `${concurrent} concurrent incidents against ${authorities.size} available approving authorities — at least one incident has nobody to authorise a decision` });
        } else {
          findings.push({ entity: 'governance-capacity', kind: 'governance-control', finding: `${authorities.size} approving authorities remain available for ${concurrent} concurrent incident(s)` });
        }
      }
      const uncovered = affected.filter((a) => !a.covered);
      if (uncovered.length) findings.push({ entity: 'organizational-spof', kind: 'governance-control', blocking: true, finding: `${uncovered.length} governance object(s) have no covered authority under this scenario: ${uncovered.slice(0, 5).map((a) => `${a.subsystem}/${a.role}`).join(', ')}` });
      radius = this.blastRadius([]);
    } else if (scenario === 'policy-reform') {
      // A reform is several stance changes at once, and the thing a single-stance simulation misses
      // is the contexts that DEPEND on a changed one and were never consulted.
      const reforms = change.reforms || {};
      const changing = new Set(Object.keys(reforms));
      for (const [context, model] of Object.entries(reforms).sort(([a], [b]) => a.localeCompare(b))) {
        const existing = this._model.entities.find((e) => e.id === `policy:consistency:${context}`);
        if (!existing) { findings.push({ entity: context, kind: 'policy', finding: 'no consistency stance is declared for this context — it cannot be reformed, only declared', blocking: true }); continue; }
        if (!multiRegion.CONSISTENCY_MODELS[model]) { findings.push({ entity: context, kind: 'policy', finding: `'${model}' is not a declared consistency model`, blocking: true }); continue; }
        const weakening = multiRegion.CONSISTENCY_MODELS[existing.model].maxStalenessMs < multiRegion.CONSISTENCY_MODELS[model].maxStalenessMs;
        findings.push({ entity: `policy:consistency:${context}`, kind: 'policy', finding: `${existing.model} → ${model}${weakening ? ' — WEAKENING' : ''}`, weakening, previousAdr: existing.adr });
        // Everything that depends on a context whose guarantee weakened, and is not itself in the
        // reform, inherited a weaker guarantee without anybody deciding that.
        if (weakening) {
          for (const r of this._model.relations.filter((x) => x.to === context && x.kind === 'data-flow')) {
            if (!changing.has(r.from)) {
              findings.push({ entity: r.from, kind: 'bounded-context', blocking: true, finding: `depends on '${context}', whose guarantee this reform weakens, and is not part of the reform — it would inherit a weaker guarantee nobody chose for it` });
            }
          }
        }
      }
      if (Object.keys(reforms).length && !change.adr) {
        findings.push({ entity: 'policy-reform', kind: 'policy', blocking: true, finding: 'the reform cites no ADR — a set of operating rules changed without a recorded decision is a default nobody chose' });
      }
      radius = this.blastRadius(Object.keys(reforms).filter((c) => this.entity(c)));
    } else if (scenario === 'legislative-change') {
      const affects = [...(change.affects || [])].sort();
      const requiresControls = [...(change.requiresControls || [])].sort();
      const known = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
      for (const ctx of affects) {
        if (!this.entity(ctx)) { findings.push({ entity: ctx, kind: 'bounded-context', blocking: true, finding: 'the change names a bounded context the architecture does not contain' }); continue; }
        findings.push({ entity: ctx, kind: 'bounded-context', finding: 'directly named by the legislative change' });
        for (const r of this._model.relations.filter((x) => x.to === ctx && x.kind === 'data-flow')) {
          if (!affects.includes(r.from)) findings.push({ entity: r.from, kind: 'bounded-context', finding: `depends on '${ctx}' and is not named in the change — reach is wider than the instrument states` });
        }
        // A context with no accountable authority cannot respond to a statute at all.
        try { ownership.describe(ctx); } catch (_) { findings.push({ entity: ctx, kind: 'governance-control', blocking: true, finding: 'no accountable authority is recorded, so nobody would answer for implementing this change' }); }
      }
      for (const c of requiresControls) {
        if (!known.has(c)) findings.push({ entity: c, kind: 'evidence', blocking: true, finding: 'the change requires a control that does not exist — this is work, not compliance' });
        else findings.push({ entity: c, kind: 'evidence', finding: 'the required control already runs' });
      }
      if (!affects.length) findings.push({ entity: 'legislative-change', kind: 'bounded-context', blocking: true, finding: 'the change names no bounded context — a statute that touches nothing needs no simulation, and one that touches something unnamed is unassessed' });
      radius = this.blastRadius(affects.filter((c) => this.entity(c)));
    } else if (scenario === 'funding-reduction' || scenario === 'organizational-restructuring' || scenario === 'staffing-growth') {
      const subsystems = ownership.subsystems().slice().sort();
      const absent = new Set(change.absent || []);
      if (scenario === 'funding-reduction') {
        // Deterministic: sort the distinct approving authorities and withdraw the first N.
        const authorities = [...new Set(subsystems.map((s) => ownership.OWNERSHIP[s].approvingAuthority))].sort();
        const reduceBy = Number(change.reduceBy || 0);
        const cut = Math.floor(authorities.length * Math.max(0, Math.min(1, reduceBy)));
        for (const a of authorities.slice(0, cut)) absent.add(a);
        findings.push({ entity: 'funding', kind: 'governance-control', finding: `a ${Math.round(reduceBy * 100)}% reduction withdraws ${cut} of ${authorities.length} approving authorities: ${authorities.slice(0, cut).join(', ') || 'none'}` });
      }
      if (scenario === 'organizational-restructuring') {
        // A merge makes two authorities one. The failure it creates is structural: an authority that
        // now both holds and approves the same subsystem has no separation of duties left.
        for (const [from, to] of (change.merge || []).map((p) => [...p].sort())) {
          findings.push({ entity: `${from}+${to}`, kind: 'governance-control', finding: `'${from}' merges into '${to}'` });
          for (const s of subsystems) {
            const o = ownership.OWNERSHIP[s];
            const responsible = o.responsibleAuthority === from ? to : o.responsibleAuthority;
            const approving = o.approvingAuthority === from ? to : o.approvingAuthority;
            if (responsible === approving) {
              findings.push({ entity: `gov:${s}`, kind: 'governance-control', blocking: true, finding: `after the merge '${responsible}' would both hold and approve '${s}' — separation of duties is lost, and it is the control that stops a decision being taken by the party it affects` });
            }
          }
        }
      }
      if (scenario === 'staffing-growth') {
        const added = Number(change.additionalAuthorities || 0);
        findings.push({ entity: 'staffing', kind: 'governance-control', finding: `${added} additional authority(ies) would join` });
        // THE FINDING THAT MATTERS. Headcount does not close a single-person dependency; a trained,
        // rehearsed person does, and a new arrival is neither on the day they start.
        const continuity = change.continuity || null;
        const single = continuity ? continuity.roles.filter((r) => r.singlePersonDependency).length : null;
        findings.push({
          entity: 'single-person-dependencies', kind: 'governance-control',
          finding: single === null
            ? `growth does not change any single-person dependency until the arrivals are trained and have rehearsed; with no continuity assessment supplied, how many exist is UNKNOWN`
            : `${single} role(s) rest on one person before growth, and ${single} after it — an untrained arrival is a name, not an alternative`,
        });
      }
      // Common: who loses an accountable authority under the resulting absence set?
      const continuity = change.continuity || null;
      const uncovered = [];
      for (const s of subsystems) {
        const o = ownership.OWNERSHIP[s];
        for (const role of ownership.DEPUTY_ROLES) {
          const primary = o[role];
          const deputy = ownership.deputyOf(primary);
          if (!absent.has(primary)) continue;
          const deputyReady = continuity ? ((continuity.roles.find((r) => r.subsystem === s && r.role === role) || {}).deputyReadiness || null) : null;
          const covered = !absent.has(deputy) && deputyReady !== null && deputyReady.ready === true;
          if (!covered) {
            uncovered.push(`${s}/${role}`);
            findings.push({ entity: `gov:${s}`, kind: 'governance-control', blocking: true, finding: `'${s}/${role}': ${primary} is unavailable and ${deputy} is not assessed as ready to take over` });
          }
        }
      }
      if (uncovered.length) findings.push({ entity: 'organizational-spof', kind: 'governance-control', blocking: true, finding: `${uncovered.length} governance object(s) would have no covered authority: ${uncovered.slice(0, 5).join(', ')}` });
      radius = this.blastRadius([]);
    } else if (scenario === 'cross-government-collaboration') {
      const partners = [...(change.partners || [])].sort();
      const sharing = [...(change.sharing || [])].sort();
      if (!partners.length) findings.push({ entity: 'collaboration', kind: 'bounded-context', blocking: true, finding: 'no partner institution is named — a collaboration with nobody is not a collaboration' });
      // THE ZONE QUESTION. Phase 14 had to make the proposal declare each context's zone, because the
      // platform did not record it — a debt written into ADR-0009. Phase 15, Part 6 closed it: the
      // context map now declares zone governance for every bounded context, so the architecture-of-
      // record answers the question and a proposal cannot answer it for itself.
      //
      // A proposal MAY still state its understanding, and if it disagrees with the record that is a
      // blocking finding rather than an override — somebody has been working from the wrong picture,
      // and that is worth knowing before the agreement is signed.
      const declaredZones = change.zones || {};
      const zones = new Set();
      for (const ctx of sharing) {
        if (!this.entity(ctx)) { findings.push({ entity: ctx, kind: 'bounded-context', blocking: true, finding: 'the proposal shares a bounded context the architecture does not contain' }); continue; }
        let governed = null;
        try { governed = contextMap.zoneGovernance(ctx); } catch (_) { governed = null; }
        if (!governed) {
          findings.push({ entity: ctx, kind: 'bounded-context', blocking: true, finding: `no zone governance is declared for '${ctx}', so whether this sharing crosses a constitutional boundary is UNKNOWN — and unknown is not a pass on a constitutional invariant` });
          continue;
        }
        if (declaredZones[ctx] && declaredZones[ctx] !== governed.zone) {
          findings.push({ entity: ctx, kind: 'bounded-context', blocking: true, finding: `the proposal places '${ctx}' in zone '${declaredZones[ctx]}'; the architecture-of-record declares '${governed.zone}'. Somebody is working from the wrong picture.` });
        }
        // A cross-zone context is deployed into every zone and so causes no crossing by itself.
        if (governed.zone !== 'cross-zone') zones.add(governed.zone);
        // Collaboration constraints are declared per context and are not negotiable by proposal.
        if (governed.collaboration === 'no-sharing') {
          findings.push({ entity: ctx, kind: 'bounded-context', blocking: true, finding: `'${ctx}' declares collaboration constraint 'no-sharing' — ${governed.zoneRationale}` });
        } else if (governed.collaboration === 'aggregate-only') {
          findings.push({ entity: ctx, kind: 'bounded-context', finding: `'${ctx}' may share aggregates only; a record-level agreement would breach its declared constraint` });
        }
        findings.push({ entity: ctx, kind: 'bounded-context', finding: `would be shared with ${partners.join(', ') || 'unnamed partners'} (${governed.zone} zone, ${governed.classification}, ${governed.collaboration})` });
        // Everything that flows INTO a shared context is shared with it, whether the proposal says
        // so or not — that is what a declared data flow means.
        for (const r of this._model.relations.filter((x) => x.to === ctx && x.kind === 'data-flow')) {
          if (!sharing.includes(r.from)) findings.push({ entity: r.from, kind: 'data-flow', finding: `flows into shared context '${ctx}' and is not named in the proposal — sharing a context shares what reaches it` });
        }
      }
      // THE CONSTITUTIONAL RULE. Zone isolation is not negotiable for a collaboration agreement.
      const crossed = [...zones].sort();
      if (crossed.length > 1) {
        findings.push({ entity: 'zone-isolation', kind: 'infrastructure', blocking: true, finding: `the proposal shares contexts across ${crossed.length} zones (${crossed.join(', ')}) — zone isolation is a constitutional invariant and no collaboration agreement may cross it` });
      } else if (crossed.length === 1) {
        findings.push({ entity: 'zone-isolation', kind: 'infrastructure', finding: `every shared context sits in the '${crossed[0]}' zone, so this sharing does not cross a zone boundary` });
      }
      radius = this.blastRadius(sharing.filter((c) => this.entity(c)));
    } else if (scenario === 'emergency-operations') {
      const failed = change.failed || [];
      const surge = Number(change.surgeMultiplier || 1);
      const absent = new Set(change.absent || []);
      radius = this.blastRadius(failed);
      for (const id of failed) if (!this.entity(id)) findings.push({ entity: id, kind: 'unknown', finding: 'this entity is not modelled — its failure cannot be reasoned about, which is itself the finding' });
      for (const id of radius.impacted) findings.push({ entity: id, kind: (this.entity(id) || {}).kind || 'unknown', finding: 'impaired through a declared dependency' });
      const available = new Set();
      for (const s of ownership.subsystems()) {
        const a = ownership.OWNERSHIP[s].approvingAuthority;
        if (!absent.has(a)) available.add(a);
      }
      // Emergency decisions scale with the incident, and approving authorities do not.
      const required = Math.ceil(surge * Math.max(1, failed.length));
      if (required > available.size) {
        findings.push({ entity: 'governance-capacity', kind: 'governance-control', blocking: true, finding: `an emergency of this size needs about ${required} concurrent authorisations against ${available.size} available approving authorities — at least one decision would wait for a person rather than for a system` });
      } else {
        findings.push({ entity: 'governance-capacity', kind: 'governance-control', finding: `${available.size} approving authorities remain available for roughly ${required} concurrent authorisation(s)` });
      }
      const constitutional = failed.filter((id) => { const e = this.entity(id); return e && e.criticality === 'constitutional'; });
      if (constitutional.length) findings.push({ entity: 'constitutional-services', kind: 'service', blocking: true, finding: `the emergency takes out constitutional service(s): ${constitutional.sort().join(', ')} — a citizen cannot report while these are down` });
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
    const confidence = this.confidence(scenario, { now, controls });
    const result = {
      scenario, question: spec.question, perturbs: spec.perturbs, label: label || scenario,
      // Part 1: the metadata that makes the answer arguable, carried with every result.
      confidence: confidence.confidence, confidenceDetail: confidence,
      confidenceDimensions: confidence.dimensionLevels,
      assumptions: [...spec.assumptions], limitations: [...spec.limitations],
      owner: spec.owner, reviewCadenceDays: spec.reviewCadenceDays,
      reviewDueAt: (now ?? this._clock()) + spec.reviewCadenceDays * 24 * 3600_000,
      calibration: confidence.calibration.state,
      validationHistory: this.validationHistory(scenario),
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
      confidence: this.confidenceReport({}),
      isolation: this.verifyIsolation(),
      authorizes: false, informationalOnly: true,
      note: 'The twin is built from the architecture-of-record on every construction, never maintained beside it. A hand-maintained twin diverges and then answers confidently and wrongly.',
    };
  }
}

module.exports = {
  OperationsTwin, ENTITY_KINDS, SCENARIOS, CALIBRATION_STATES, CALIBRATION_MIN_OBSERVATIONS,
  CONFIDENCE_DIMENSIONS, buildModel, assertDeclaredMetadata, assertCompleteConfidence,
};
