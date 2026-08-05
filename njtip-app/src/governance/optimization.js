'use strict';
// Governance Optimization (Phase 14, Part 13) and Resource & Capacity Planning (Part 14). Extends the
// governance-oversight bounded context; the context map claims `src/governance/` by prefix, so this
// module is owned the moment it exists.
//
// Both halves of this file are dangerous in the same way, and it is worth naming before any code.
//
// A GOVERNANCE OPTIMIZER IS AN AUTOMATED ARGUMENT FOR REMOVING CONTROLS. Every genuine finding it
// makes — this board approves too much, these two review steps look identical, this authority is a
// bottleneck — has an obvious remedy that is also the fastest way to dismantle the separation of
// duties the whole platform rests on. "The Oversight Board is a bottleneck" is true. "So let the
// operational owner approve their own work" follows from it and is catastrophic.
//
// So the module is built around one rule, checked structurally rather than promised:
//
//   NO RECOMMENDATION MAY REMOVE AN APPROVAL, MERGE A RESPONSIBLE AUTHORITY WITH ITS APPROVER, OR
//   REDUCE THE NUMBER OF DISTINCT AUTHORITIES INVOLVED IN A DECISION.
//
// Every recommendation declares which governance property it preserves, and `assertPreservesIntegrity`
// refuses any that cannot name one. A recommendation that fails the check is not emitted with a
// warning — it is refused.
//
// A CAPACITY FORECAST IS AN AUTOMATED ARGUMENT FOR A BUDGET. The second rule follows:
//
//   A FORECAST THE EVIDENCE CANNOT SUPPORT RETURNS null, NOT A PLAUSIBLE NUMBER.
//
// Every forecast carries its basis and the count of observations behind it. Where there are none, it
// says so, because a made-up number in a capacity plan is indistinguishable from a real one and
// survives far longer.
const ownership = require('./ownership');
const raci = require('./raci');
const contextMap = require('../architecture/context-map');
const multiRegion = require('../twin2/multi-region');

const DAY = 24 * 3600_000;
const YEAR_DAYS = 365;

// --- Part 13: governance optimization -------------------------------------------------------------

// What the optimizer looks for. Each states the signal, and — more importantly — the WRONG remedy,
// because for every one of these the obvious fix is the one that removes a control.
const OPTIMIZATION_TARGETS = {
  'approval-bottleneck': {
    signal: 'One authority is the approver for a large share of the estate.',
    rightRemedy: 'Delegate approval to a second authority of equal standing, or split the portfolio. The number of distinct authorities in each decision does not fall.',
    wrongRemedy: 'Let the responsible authority approve its own work. This removes the only structural control against a decision being taken by the party it affects.',
  },
  'review-workload': {
    signal: 'An authority owes more reviews per year than a body meeting on its cadence can perform.',
    rightRemedy: 'Lengthen the cadence deliberately, with a recorded decision, or add reviewing capacity.',
    wrongRemedy: 'Stop reviewing the things that are usually fine. Those are the ones nobody would notice becoming un-fine.',
  },
  'committee-utilisation': {
    signal: 'A board governs very few subsystems, or a great many.',
    rightRemedy: 'Rebalance which board governs what, keeping every subsystem governed by exactly one.',
    wrongRemedy: 'Dissolve the small board and fold its subsystems into a larger one. A board that governs everything scrutinises nothing.',
  },
  'governance-delay': {
    signal: 'Reviews are overdue.',
    rightRemedy: 'Complete them, or record why the cadence is wrong.',
    wrongRemedy: 'Mark them complete. An overdue review is a control nobody has confirmed still works; a falsely completed one is worse.',
  },
  'policy-conflict': {
    signal: 'Two contexts that exchange data hold consistency stances that cannot both be honoured.',
    rightRemedy: 'Strengthen the weaker stance, or record in an ADR that the dependent context accepts the weaker guarantee.',
    wrongRemedy: 'Weaken the stronger stance to match. That silently downgrades a guarantee somebody chose deliberately.',
  },
  'duplicated-activity': {
    signal: 'The same authority performs the same governance activity identically across many subsystems.',
    rightRemedy: 'Run it once across the portfolio, with the same authority and the same evidence for each subsystem.',
    wrongRemedy: 'Perform it once and record it against all of them. The evidence would then attest to work that was not done for most of them.',
  },
};

// The properties a recommendation must not damage. Checked against every recommendation before it is
// emitted, so an optimizer that learns a new trick still cannot produce one that dismantles these.
const GOVERNANCE_INTEGRITY = {
  separationOfDuties: 'The responsible authority is never also the approving authority.',
  namedAccountability: 'Every governance object has exactly one accountable authority.',
  escalationTerminates: 'Every escalation path ends at a recognised board.',
  humanAuthorization: 'Every governance activity is decided by a named human.',
  evidencePerSubject: 'Evidence attests to work actually done for the subject it names.',
};

// --- Recommendation classification (Phase 15, Part 11) --------------------------------------------
//
// Phase 14 refused any recommendation that would remove a control. Part 11 asks for the positive
// half: what KIND of change is being proposed, so a reader can tell at a glance whether they are
// being asked to add rigour or take it away.
//
// The five classes are deliberately ordered by how much scrutiny each deserves. `strengthen` and
// `monitor` add; `automate` and `clarify` change the form without changing the substance; `simplify`
// is the one that removes, and it is the one every governance optimizer eventually reaches for.
const RECOMMENDATION_CLASSES = {
  strengthen: { adds: true, removes: false, scrutiny: 'low', means: 'Add rigour: another authority, another check, a shorter cadence.', watchFor: 'Governance that grows without ever being pruned becomes theatre by accumulation.' },
  monitor: { adds: true, removes: false, scrutiny: 'low', means: 'Measure something that is currently unmeasured. Adds visibility rather than obligation.', watchFor: 'Measuring instead of acting.' },
  automate: { adds: false, removes: false, scrutiny: 'medium', means: 'Do the same thing mechanically. The obligation is unchanged; the effort falls.', watchFor: 'Automating a judgement. A decision a machine makes is a decision nobody is accountable for.' },
  clarify: { adds: false, removes: false, scrutiny: 'medium', means: 'Say the same thing better: a rationale, a named authority, an explicit scope.', watchFor: 'Rewording a gap until it reads like a control.' },
  simplify: { adds: false, removes: true, scrutiny: 'high', means: 'Do less of something. The only class that removes, and therefore the only one that can weaken governance.', watchFor: 'Every finding this optimizer makes has a simplification that would close it by removing the control that found it.' },
};

// The controls that may never be simplified away, whatever the efficiency argument. Each names the
// failure it prevents, because "mandatory" with no reason attached is an assertion.
const MANDATORY_CONTROLS = {
  'separation-of-duties': { prevents: 'A decision taken by the party it affects.', basis: 'Structural in the ownership model since Stabilization Part 14.' },
  'human-authorization': { prevents: 'A governance, legal or operational decision taken by a machine.', basis: 'The invariant every phase of this platform has preserved.' },
  'named-accountability': { prevents: 'A decision nobody can be asked about, and therefore one that cannot be challenged.', basis: 'No governance object may be left unowned.' },
  'zone-isolation': { prevents: 'One constitutional zone observing another.', basis: 'The platform\'s oldest invariant, and the reason anonymous reporting is credible.' },
  'attribution': { prevents: 'An act with no recorded actor, which is indistinguishable from one that did not happen.', basis: 'Every register in this platform refuses an unattributed record.' },
  'independent-verification': { prevents: 'Self-assessment being recorded as assurance.', basis: 'The distinction between `compliant` and `verified`, and between A2 and A3.' },
  'fail-closed': { prevents: 'An unknown being served as a pass.', basis: 'Continuous assurance has been fail-closed since Phase 10.' },
};

// A `simplify` recommendation that touches a mandatory control is REFUSED. Exported so the guard can
// be fed a crafted recommendation that tries it.
function assertNoMandatoryRemoval(recommendation) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!recommendation || !recommendation.class) fail('a recommendation must be classified — an unclassified proposal hides whether it adds rigour or removes it');
  if (!RECOMMENDATION_CLASSES[recommendation.class]) fail(`unknown recommendation class '${recommendation.class}' — one of ${Object.keys(RECOMMENDATION_CLASSES).join(', ')}`);
  const touched = recommendation.touchesMandatory || [];
  for (const c of touched) if (!MANDATORY_CONTROLS[c]) fail(`unknown mandatory control '${c}'`);
  if (RECOMMENDATION_CLASSES[recommendation.class].removes && touched.length) {
    fail(`this recommendation would simplify away mandatory control(s): ${touched.join(', ')} — ${MANDATORY_CONTROLS[touched[0]].prevents} No efficiency argument removes a mandatory control automatically; that is a decision a named human takes with an ADR.`);
  }
  return true;
}

// A recommendation is refused unless it names a property it preserves and does none of the things
// that would break one. Exported so the guard can be fed a crafted recommendation.
function assertPreservesIntegrity(recommendation) {
  const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
  if (!recommendation || !recommendation.recommendation) fail('a recommendation must say what to do');
  if (!recommendation.preserves || !recommendation.preserves.length) {
    fail('a governance optimization must name the integrity properties it preserves — an optimization that cannot say what it protects is a proposal to remove a control');
  }
  for (const p of recommendation.preserves) {
    if (!GOVERNANCE_INTEGRITY[p]) fail(`unknown governance integrity property '${p}'`);
  }
  if (recommendation.reducesDistinctAuthorities === true) {
    fail('this recommendation reduces the number of distinct authorities involved in a decision, which is the one thing no optimization may do');
  }
  if (recommendation.removesApproval === true) fail('this recommendation removes an approval step');
  if (recommendation.mergesResponsibleAndApprover === true) fail('this recommendation would let an authority approve its own work');
  return true;
}

function recommend(spec) {
  const rec = {
    reducesDistinctAuthorities: false, removesApproval: false, mergesResponsibleAndApprover: false,
    touchesMandatory: [],
    ...spec,
    recommendationOnly: true, authorizes: false,
  };
  assertPreservesIntegrity(rec);
  // Phase 15, Part 11: and it must be classified, and a simplification may not touch a mandatory
  // control. Both guards run before anything is emitted.
  assertNoMandatoryRemoval(rec);
  rec.classification = { class: rec.class, ...RECOMMENDATION_CLASSES[rec.class] };
  return rec;
}

// Approval load, review workload and committee utilisation, all read from the ownership model.
function governanceLoad({ now = 0, lastReviewed = {} } = {}) {
  const subsystems = ownership.subsystems();
  const approvals = {};
  const responsibilities = {};
  for (const s of subsystems) {
    const o = ownership.OWNERSHIP[s];
    (approvals[o.approvingAuthority] = approvals[o.approvingAuthority] || []).push(s);
    (responsibilities[o.responsibleAuthority] = responsibilities[o.responsibleAuthority] || []).push(s);
  }
  const schedule = ownership.reviewSchedule({ now, lastReviewed });
  // Reviews owed per year, from the declared cadence of each subsystem an authority approves.
  const workload = Object.entries(approvals).map(([authority, subs]) => {
    const perYear = subs.reduce((a, s) => {
      const row = schedule.find((r) => r.subsystem === s);
      return a + (row && row.cadenceDays ? YEAR_DAYS / row.cadenceDays : 0);
    }, 0);
    return {
      authority, subsystems: subs.slice().sort(), approves: subs.length,
      share: +(subs.length / subsystems.length).toFixed(4),
      reviewsPerYear: +perYear.toFixed(2),
      // A body meeting monthly can conduct roughly twelve substantive reviews a year. Declared, not
      // measured, and named as declared.
      capacityPerYear: 12, capacityBasis: 'declared: a board meeting monthly can conduct roughly twelve substantive reviews a year',
      overCapacity: perYear > 12,
    };
  }).sort((a, b) => b.reviewsPerYear - a.reviewsPerYear || a.authority.localeCompare(b.authority));

  const boards = ownership.boards().map((b) => ({
    board: b.id, name: b.name, governs: b.subsystems.length,
    share: +(b.subsystems.length / subsystems.length).toFixed(4),
    subsystems: b.subsystems.slice().sort(),
  })).sort((a, b) => b.governs - a.governs || a.board.localeCompare(b.board));

  return { subsystems: subsystems.length, approvalLoad: workload, boards, schedule, overdue: schedule.filter((r) => r.overdue) };
}

// Two contexts that exchange data, whose consistency stances cannot both be honoured: a context
// declaring a strong guarantee that depends on one declaring a weaker one inherits the weaker one in
// practice, whatever its own stance says.
function policyConflicts() {
  const stances = new Map(multiRegion.contextConsistency().filter((s) => s.declared).map((s) => [s.context, s]));
  const conflicts = [];
  for (const id of contextMap.ids()) {
    const mine = stances.get(id);
    if (!mine) continue;
    for (const dep of contextMap.describe(id).dependsOn || []) {
      const theirs = stances.get(dep.context);
      if (!theirs) continue;
      // Staleness is the comparable quantity: a context promising 0ms staleness that depends on one
      // permitting 60s cannot honour its own promise through that path.
      if (mine.maxStalenessMs < theirs.maxStalenessMs) {
        conflicts.push({
          from: id, to: dep.context, relationship: dep.relationship || 'depends-on',
          declares: mine.model, dependsOnStance: theirs.model,
          detail: `'${id}' declares '${mine.model}' (staleness ${mine.maxStalenessMs}ms) and depends on '${dep.context}', which declares '${theirs.model}' (staleness ${theirs.maxStalenessMs}ms) — the stronger guarantee cannot be honoured through that path`,
          adrs: [mine.adr, theirs.adr].filter(Boolean),
        });
      }
    }
  }
  return conflicts.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// The same authority performing the same governance activity identically across many subsystems.
// Read from the RACI matrix, so it reflects what is actually recorded rather than an impression.
function duplicatedActivities({ threshold = 4 } = {}) {
  const groups = new Map();
  for (const m of raci.matrix()) {
    for (const row of m.rows) {
      const key = `${row.activity}|${row.accountable}|${row.responsible}`;
      if (!groups.has(key)) groups.set(key, { activity: row.activity, accountable: row.accountable, responsible: row.responsible, subsystems: [] });
      groups.get(key).subsystems.push(m.subsystem);
    }
  }
  return [...groups.values()]
    .filter((g) => g.subsystems.length >= threshold)
    .map((g) => ({ ...g, subsystems: g.subsystems.sort(), count: g.subsystems.length }))
    .sort((a, b) => b.count - a.count || a.activity.localeCompare(b.activity) || a.accountable.localeCompare(b.accountable));
}

function governanceOptimization({ now = 0, lastReviewed = {}, threshold = 4 } = {}) {
  const load = governanceLoad({ now, lastReviewed });
  const conflicts = policyConflicts();
  const duplicated = duplicatedActivities({ threshold });
  const findings = [];
  const recommendations = [];

  const bottlenecks = load.approvalLoad.filter((a) => a.share >= 0.25);
  for (const b of bottlenecks) {
    findings.push({ target: 'approval-bottleneck', subject: b.authority, detail: `approves ${b.approves} of ${load.subsystems} subsystems (${Math.round(b.share * 100)}%)` });
    recommendations.push(recommend({
      target: 'approval-bottleneck', class: 'strengthen', subject: b.authority,
      recommendation: `Delegate approval for part of ${b.authority}'s portfolio to a second authority of equal standing, or split the portfolio between two. Do not let the responsible authority approve its own work.`,
      preserves: ['separationOfDuties', 'namedAccountability', 'humanAuthorization'],
      wouldNotFix: 'This does not reduce the number of decisions; it changes who makes which. If the total exceeds what the institution can decide, that is a resourcing question, not a governance one.',
    }));
  }
  for (const a of load.approvalLoad.filter((x) => x.overCapacity)) {
    findings.push({ target: 'review-workload', subject: a.authority, detail: `owes ${a.reviewsPerYear} reviews a year against a declared capacity of ${a.capacityPerYear}` });
    recommendations.push(recommend({
      target: 'review-workload', class: 'clarify', subject: a.authority,
      recommendation: `Either lengthen the review cadence for part of ${a.authority}'s portfolio — recorded as a decision, with the risk stated — or add reviewing capacity. Do not quietly stop reviewing the subsystems that are usually fine.`,
      preserves: ['namedAccountability', 'humanAuthorization', 'evidencePerSubject'],
      wouldNotFix: 'The declared capacity of twelve reviews a year is a stated assumption about how a board works, not a measurement of this one.',
    }));
  }
  const overloadedBoards = load.boards.filter((b) => b.share >= 0.35);
  const idleBoards = load.boards.filter((b) => b.governs <= 1);
  for (const b of [...overloadedBoards, ...idleBoards]) {
    findings.push({ target: 'committee-utilisation', subject: b.board, detail: `governs ${b.governs} of ${load.subsystems} subsystems` });
    recommendations.push(recommend({
      target: 'committee-utilisation', class: 'clarify', subject: b.board,
      recommendation: b.governs <= 1
        ? `${b.name} governs ${b.governs} subsystem(s). Consider whether its mandate is right rather than whether it should exist — a board with a narrow mandate may be the only one able to scrutinise what it governs.`
        : `${b.name} governs ${Math.round(b.share * 100)}% of the estate. Rebalance which board governs what, keeping every subsystem governed by exactly one.`,
      preserves: ['namedAccountability', 'escalationTerminates'],
      wouldNotFix: 'Rebalancing changes who scrutinises; it does not change how much scrutiny the estate needs.',
    }));
  }
  for (const r of load.overdue) {
    findings.push({ target: 'governance-delay', subject: r.subsystem, detail: r.reason });
  }
  if (load.overdue.length) {
    recommendations.push(recommend({
      target: 'governance-delay', class: 'monitor', subject: `${load.overdue.length} subsystem(s)`,
      recommendation: `Complete the ${load.overdue.length} overdue review(s), or record a decision that the cadence is wrong. An overdue review is a control nobody has confirmed still works.`,
      preserves: ['humanAuthorization', 'evidencePerSubject'],
      wouldNotFix: 'Nothing here can complete a review; only a named human can.',
    }));
  }
  for (const c of conflicts) {
    findings.push({ target: 'policy-conflict', subject: `${c.from} → ${c.to}`, detail: c.detail });
    recommendations.push(recommend({
      target: 'policy-conflict', class: 'strengthen', subject: `${c.from} → ${c.to}`,
      recommendation: `Strengthen '${c.to}' to at least '${c.declares}', or record in an ADR that '${c.from}' accepts the weaker guarantee it actually receives. Do not weaken '${c.from}' to match.`,
      preserves: ['humanAuthorization', 'namedAccountability'],
      wouldNotFix: 'This is a correctness conflict, not a cost one. Resolving it will make something slower or make a guarantee honest; there is no version that is free.',
    }));
  }
  for (const d of duplicated) {
    findings.push({ target: 'duplicated-activity', subject: `${d.activity}/${d.accountable}`, detail: `performed identically across ${d.count} subsystems` });
    recommendations.push(recommend({
      target: 'duplicated-activity', class: 'automate', subject: `${d.activity}/${d.accountable}`,
      recommendation: `Run '${d.activity}' once across ${d.accountable}'s portfolio, producing the evidence for each of the ${d.count} subsystems it covers. Do not record one act against all of them.`,
      preserves: ['evidencePerSubject', 'namedAccountability', 'humanAuthorization'],
      wouldNotFix: 'Batching the meeting does not batch the work. Each subsystem still needs its own evidence.',
    }));
  }

  return {
    findings, findingCount: findings.length,
    recommendations, recommendationCount: recommendations.length,
    targets: Object.entries(OPTIMIZATION_TARGETS).map(([target, t]) => ({ target, ...t })),
    integrityProperties: Object.entries(GOVERNANCE_INTEGRITY).map(([property, means]) => ({ property, means })),
    load, policyConflicts: conflicts, duplicatedActivities: duplicated,
    bottleneckAuthorities: bottlenecks.map((b) => b.authority),
    overCapacityAuthorities: load.approvalLoad.filter((a) => a.overCapacity).map((a) => a.authority),
    // Every recommendation passed `assertPreservesIntegrity` before it was emitted; a recommendation
    // that could not name a property it preserves was refused rather than warned about.
    everyRecommendationPreservesIntegrity: recommendations.every((r) => r.preserves && r.preserves.length),
    // Part 11: what KIND of change is being proposed, so a reader can see at a glance whether they
    // are being asked to add rigour or take it away.
    classes: Object.entries(RECOMMENDATION_CLASSES).map(([id, c]) => ({ class: id, ...c })),
    mandatoryControls: Object.entries(MANDATORY_CONTROLS).map(([id, c]) => ({ control: id, ...c })),
    byClass: Object.keys(RECOMMENDATION_CLASSES).map((id) => ({
      class: id, ...RECOMMENDATION_CLASSES[id],
      count: recommendations.filter((r) => r.class === id).length,
      targets: [...new Set(recommendations.filter((r) => r.class === id).map((r) => r.target))].sort(),
    })),
    everyRecommendationClassified: recommendations.every((r) => !!RECOMMENDATION_CLASSES[r.class]),
    simplifications: recommendations.filter((r) => RECOMMENDATION_CLASSES[r.class] && RECOMMENDATION_CLASSES[r.class].removes).map((r) => r.target),
    recommendationsOnly: true, informationalOnly: true, authorizes: false,
    note: 'An optimizer for governance is an automated argument for removing controls. Every recommendation here names the integrity properties it preserves, and one that reduces the number of distinct authorities in a decision is refused rather than emitted.',
  };
}

// --- Part 14: resource and capacity planning ------------------------------------------------------
//
// Every forecast returns `{ value, basis, observations, derived }`. Where the evidence does not
// support a figure, `value` is null and `basis` says what would be needed — because a made-up number
// in a capacity plan is indistinguishable from a real one and outlives everybody who knew.
const CAPACITY_DIMENSIONS = {
  staffing: { question: 'How many accountable people does the estate require?', derivedFrom: 'the ownership model: distinct authorities across all roles' },
  infrastructure: { question: 'How many services and zones must be operated?', derivedFrom: 'the declared service topology' },
  operationalWorkload: { question: 'How much operational work does the estate generate?', derivedFrom: 'reports and cases supplied by the caller; nothing here invents a rate' },
  training: { question: 'How many training completions are required to keep every role current?', derivedFrom: 'the required-training table and the training register' },
  governanceWorkload: { question: 'How many governance reviews and decisions are owed per year?', derivedFrom: 'the declared review cadences' },
  investigationCapacity: { question: 'How many investigations can be run concurrently?', derivedFrom: 'investigator workload supplied by the caller' },
};

function unmeasured(dimension, needs) {
  return { dimension, ...CAPACITY_DIMENSIONS[dimension], value: null, observations: 0, derived: true, basis: `UNKNOWN — ${needs}. A capacity figure nobody can source is indistinguishable from a real one and survives longer than the person who made it up.` };
}

function capacityPlan({ now = 0, training = null, caseload = null, investigators = null, lastReviewed = {} } = {}) {
  const telemetry = require('../observability/telemetry');
  const subsystems = ownership.subsystems();

  // Staffing: distinct people across every governed role, plus the derived deputies each needs.
  const people = new Set();
  for (const s of subsystems) for (const role of ownership.ROLES) {
    if (role === 'governanceBoard') continue;
    people.add(ownership.OWNERSHIP[s][role]);
  }
  const deputies = new Set([...people].map((p) => ownership.deputyOf(p)));
  const staffing = {
    dimension: 'staffing', ...CAPACITY_DIMENSIONS.staffing,
    value: people.size + deputies.size, observations: subsystems.length, derived: true,
    detail: { primaries: people.size, deputies: deputies.size },
    basis: `${people.size} distinct accountable roles across ${subsystems.length} subsystems, each requiring a deputy. Derived from the ownership model; it counts posts, not headcount, and a post held by somebody with three other posts counts once.`,
  };

  // Infrastructure: services and zones, straight from the topology.
  const zones = new Set(Object.values(telemetry.TOPOLOGY).map((s) => s.zone));
  const constitutional = Object.entries(telemetry.TOPOLOGY).filter(([, s]) => s.criticality === 'constitutional').map(([id]) => id);
  const infrastructure = {
    dimension: 'infrastructure', ...CAPACITY_DIMENSIONS.infrastructure,
    value: Object.keys(telemetry.TOPOLOGY).length, observations: Object.keys(telemetry.TOPOLOGY).length, derived: true,
    detail: { services: Object.keys(telemetry.TOPOLOGY).length, zones: zones.size, constitutionalServices: constitutional.sort() },
    basis: `${Object.keys(telemetry.TOPOLOGY).length} declared services across ${zones.size} zones, of which ${constitutional.length} are constitutional and may not be reduced for cost.`,
  };

  // Governance workload: reviews owed per year, from declared cadences.
  const schedule = ownership.reviewSchedule({ now, lastReviewed });
  const reviewsPerYear = schedule.reduce((a, r) => a + (r.cadenceDays ? YEAR_DAYS / r.cadenceDays : 0), 0);
  const governanceWorkload = {
    dimension: 'governanceWorkload', ...CAPACITY_DIMENSIONS.governanceWorkload,
    value: +reviewsPerYear.toFixed(1), observations: schedule.length, derived: true,
    detail: { overdue: schedule.filter((r) => r.overdue).length, subsystems: schedule.length },
    basis: `${reviewsPerYear.toFixed(1)} subsystem reviews owed per year across ${schedule.length} subsystems, from the declared cadence of each. Excludes ad-hoc decisions, which the platform does not schedule.`,
  };

  // Training: required completions to keep every role current, and how many are actually held.
  let trainingDemand;
  if (!training) trainingDemand = unmeasured('training', 'no training register was supplied, so how many completions are outstanding cannot be derived');
  else {
    let required = 0, current = 0;
    for (const s of subsystems) {
      for (const role of ownership.DEPUTY_ROLES) {
        for (const person of [ownership.OWNERSHIP[s][role], ownership.deputyOf(ownership.OWNERSHIP[s][role])]) {
          const st = training.status(person, role, { now });
          required += st.courses.length;
          current += st.courses.filter((r) => r.held).length;
        }
      }
    }
    trainingDemand = {
      dimension: 'training', ...CAPACITY_DIMENSIONS.training,
      value: required - current, observations: required, derived: true,
      detail: { required, current, outstanding: required - current },
      basis: `${required - current} of ${required} required completions are outstanding across every accountable role and its deputy.`,
    };
  }

  // Operational workload and investigation capacity are the caller's measurements; the platform has
  // no synthetic caseload it is willing to pass off as a forecast.
  const operationalWorkload = caseload === null || caseload === undefined
    ? unmeasured('operationalWorkload', 'no caseload was supplied')
    : {
      dimension: 'operationalWorkload', ...CAPACITY_DIMENSIONS.operationalWorkload,
      value: caseload.openCases ?? null, observations: caseload.periods ?? 1, derived: true,
      detail: { ...caseload },
      basis: `${caseload.openCases} open case(s) over ${caseload.periods ?? 1} period(s), as measured and supplied by the caller.`,
    };
  const investigationCapacity = investigators === null || investigators === undefined
    ? unmeasured('investigationCapacity', 'no investigator workload was supplied')
    : (() => {
      const count = investigators.available ?? 0;
      const perInvestigator = investigators.concurrentPerInvestigator ?? null;
      if (!count || perInvestigator === null) return unmeasured('investigationCapacity', 'investigator availability and concurrent capacity are both required');
      return {
        dimension: 'investigationCapacity', ...CAPACITY_DIMENSIONS.investigationCapacity,
        value: count * perInvestigator, observations: count, derived: true,
        detail: { investigators: count, concurrentPerInvestigator: perInvestigator },
        basis: `${count} investigators × ${perInvestigator} concurrent matters. The per-investigator figure is the caller's measurement, not this platform's estimate.`,
      };
    })();

  const dimensions = [staffing, infrastructure, operationalWorkload, trainingDemand, governanceWorkload, investigationCapacity];
  const unmeasurable = dimensions.filter((d) => d.value === null);

  // Shortfalls: only where BOTH sides of a comparison are measured. A shortfall computed against an
  // unknown is a number with a sign and no meaning.
  const shortfalls = [];
  if (operationalWorkload.value !== null && investigationCapacity.value !== null && operationalWorkload.value > investigationCapacity.value) {
    shortfalls.push({
      dimension: 'investigationCapacity',
      detail: `${operationalWorkload.value} open case(s) against capacity for ${investigationCapacity.value} — ${operationalWorkload.value - investigationCapacity.value} report(s) are waiting on a person, not on a system`,
      shortfall: operationalWorkload.value - investigationCapacity.value,
    });
  }
  if (trainingDemand.value !== null && trainingDemand.value > 0) {
    shortfalls.push({ dimension: 'training', detail: `${trainingDemand.value} required training completion(s) outstanding`, shortfall: trainingDemand.value });
  }

  return {
    dimensions, count: dimensions.length,
    catalogue: Object.entries(CAPACITY_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d })),
    measured: dimensions.filter((d) => d.value !== null).map((d) => d.dimension),
    unmeasurable: unmeasurable.map((d) => ({ dimension: d.dimension, basis: d.basis })),
    complete: unmeasurable.length === 0,
    shortfalls, shortfallCount: shortfalls.length,
    everyFigureDerived: dimensions.every((d) => d.derived === true),
    now, informationalOnly: true, authorizes: false,
    note: 'Every figure is derived from a register or supplied as a measurement by the caller, and every one carries its basis. A dimension the evidence cannot support returns null rather than a plausible number, because a made-up figure in a capacity plan is indistinguishable from a real one.',
  };
}

function report({ now = 0, training = null, caseload = null, investigators = null, lastReviewed = {} } = {}) {
  return {
    optimization: governanceOptimization({ now, lastReviewed }),
    capacity: capacityPlan({ now, training, caseload, investigators, lastReviewed }),
    informationalOnly: true, recommendationsOnly: true, authorizes: false,
  };
}

module.exports = {
  OPTIMIZATION_TARGETS, GOVERNANCE_INTEGRITY, CAPACITY_DIMENSIONS,
  RECOMMENDATION_CLASSES, MANDATORY_CONTROLS, assertNoMandatoryRemoval,
  assertPreservesIntegrity, recommend,
  governanceLoad, policyConflicts, duplicatedActivities, governanceOptimization,
  capacityPlan, report,
};
