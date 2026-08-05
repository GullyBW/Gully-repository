'use strict';
// Cross-Agency Coordination (Phase 14, Part 16). Extends the governance-oversight bounded context.
//
// This platform is not run by one organisation. The ownership record already names twenty-odd
// institutions — the Directorate on Corruption and Economic Crime, the Data Protection Commissioner,
// the Attorney General's Chambers, the National Identity Authority — and every one of the platform's
// governance relationships is in fact a relationship BETWEEN two of them. Nothing has ever looked at
// the estate that way. Blast radius has always been computed over services; it has never been
// computed over institutions, and an inter-agency dependency fails differently: it fails at a
// meeting that does not happen.
//
// The agencies are DERIVED, never listed. They are the distinct accountable authorities in the
// ownership record, so an agency that is renamed or dissolved changes this analysis automatically and
// a hand-kept list of partners cannot drift away from who is actually accountable.
//
// The rule that keeps this honest, and it is the same rule as the deputy who has never acted:
//
//   A DECLARED RELATIONSHIP IS NOT A WORKING ONE. The platform can read an org chart. It cannot see
//   whether two institutions have ever actually coordinated. So readiness is capped at 'declared'
//   unless there is evidence of a joint act, and 'declared' is reported as what it is: a structure
//   that has never been tested.
const ownership = require('./ownership');
const contextMap = require('../architecture/context-map');

// What a working inter-agency relationship needs. Each says how it is evidenced and what its absence
// costs, on the same pattern as every other dimension in the platform.
const COORDINATION_DIMENSIONS = {
  governanceOwnership: {
    question: 'Is it recorded which institution is accountable for each side?',
    evidencedBy: 'the ownership record naming a responsible authority for both contexts',
    ifAbsent: 'Neither side is answerable, so the relationship has nobody to fix it.',
  },
  communicationPath: {
    question: 'Is there a recorded way for one to reach the other?',
    evidencedBy: 'an escalation path from either side terminating at a board both are governed by, or a shared board',
    ifAbsent: 'When something goes wrong the two institutions find each other by improvisation.',
  },
  approvalDependency: {
    question: 'Does one institution need the other\'s approval to act?',
    evidencedBy: 'the responsible authority of one context differing from its approving authority',
    ifAbsent: 'Nothing — this is a fact to be known, not a defect. It is a risk only when unrecorded.',
  },
  informationSharing: {
    question: 'Does data actually cross between them?',
    evidencedBy: 'a declared context-map dependency between contexts held by different institutions',
    ifAbsent: 'The relationship may be governance-only, which is a different and simpler thing.',
  },
  demonstratedCoordination: {
    question: 'Have they ever actually coordinated?',
    evidencedBy: 'a recorded joint governance act or a joint rehearsal involving both institutions',
    ifAbsent: 'The relationship exists on paper and has never been exercised. This is the dimension nothing else in the platform measures.',
  },
};

// Readiness bands. `declared` is deliberately NOT a passing state: it is the state of every
// relationship in an org chart, including the ones that do not work.
const READINESS_BANDS = {
  unknown: { ready: false, means: 'Nothing is recorded about this relationship.' },
  declared: { ready: false, means: 'The structure exists and has never been exercised. An untested relationship is a plan, not a capability.' },
  reachable: { ready: false, means: 'The structure exists and there is a recorded way for each side to reach the other. Still never exercised.' },
  demonstrated: { ready: true, means: 'The two institutions have coordinated in a recorded act or rehearsal.' },
};

// The institutions, derived from who is actually accountable.
function agencies() {
  const byAgency = new Map();
  for (const s of ownership.subsystems()) {
    const o = ownership.describe(s);
    for (const [agency, role] of [[o.responsibleAuthority, 'responsible'], [o.approvingAuthority, 'approving']]) {
      if (!byAgency.has(agency)) byAgency.set(agency, { agency, responsibleFor: [], approves: [], boards: new Set() });
      const rec = byAgency.get(agency);
      if (role === 'responsible') rec.responsibleFor.push(s); else rec.approves.push(s);
      rec.boards.add(o.governanceBoard);
    }
  }
  return [...byAgency.values()]
    .map((a) => ({ ...a, responsibleFor: a.responsibleFor.sort(), approves: a.approves.sort(), boards: [...a.boards].sort() }))
    .sort((a, b) => a.agency.localeCompare(b.agency));
}

const agencyOf = (subsystem) => ownership.OWNERSHIP[subsystem].responsibleAuthority;

// Every declared context dependency whose two sides are held by different institutions. This is
// information sharing as the architecture actually declares it, rather than as anyone remembers it.
function informationSharing() {
  const flows = [];
  for (const id of contextMap.ids()) {
    if (!ownership.OWNERSHIP[id]) continue;
    for (const dep of contextMap.describe(id).dependsOn || []) {
      if (!ownership.OWNERSHIP[dep.context]) continue;
      const from = agencyOf(id), to = agencyOf(dep.context);
      if (from === to) continue;
      flows.push({ fromAgency: from, toAgency: to, fromContext: id, toContext: dep.context, relationship: dep.relationship || 'depends-on' });
    }
  }
  return flows.sort((a, b) => a.fromAgency.localeCompare(b.fromAgency) || a.toAgency.localeCompare(b.toAgency) || a.fromContext.localeCompare(b.fromContext));
}

// Where one institution cannot act without another's approval.
function approvalDependencies() {
  const out = [];
  for (const s of ownership.subsystems()) {
    const o = ownership.describe(s);
    if (o.responsibleAuthority === o.approvingAuthority) continue;   // caught elsewhere as a duties failure
    out.push({ subsystem: s, needs: o.approvingAuthority, held: o.responsibleAuthority, board: o.governanceBoard, escalation: o.escalation });
  }
  return out.sort((a, b) => a.subsystem.localeCompare(b.subsystem));
}

// Can these two reach each other? Answered from the escalation paths and the boards each is governed
// by — a shared board is a recorded meeting both attend, which is the only communication channel the
// platform can actually see.
function communicationPath(a, b) {
  const all = agencies();
  const first = all.find((x) => x.agency === a);
  const second = all.find((x) => x.agency === b);
  if (!first || !second) return { reachable: false, via: null, reason: 'one of these institutions holds nothing in the ownership record' };
  const shared = first.boards.filter((x) => second.boards.includes(x));
  if (shared.length) return { reachable: true, via: `shared board: ${shared.join(', ')}`, reason: `both are governed by ${shared.join(', ')}, which is a recorded forum they both attend` };
  // Otherwise: does either appear in the other's escalation path?
  const paths = [];
  for (const s of ownership.subsystems()) {
    const o = ownership.describe(s);
    if ((o.responsibleAuthority === a && o.escalation.includes(b)) || (o.responsibleAuthority === b && o.escalation.includes(a))) {
      paths.push(`${s}: ${o.escalation.join(' → ')}`);
    }
  }
  if (paths.length) return { reachable: true, via: `escalation path: ${paths[0]}`, reason: 'one appears in the other\'s recorded escalation chain' };
  return { reachable: false, via: null, reason: 'no shared board and no escalation path connects them — in an incident they would find each other by improvisation' };
}

// Has this pair ever actually coordinated? Only answerable from a register, and never seeded: a
// relationship with no recorded joint act has had none, and the report says exactly that.
function demonstratedCoordination(a, b, { activity = null, exercises = null, now = 0 } = {}) {
  if (!activity && !exercises) {
    return { demonstrated: false, unknown: true, acts: 0, reason: 'no activity or exercise register was supplied — whether these two have ever coordinated is unknown, and unknown is not a working relationship' };
  }
  const people = new Set();
  for (const s of ownership.subsystems()) {
    const o = ownership.describe(s);
    if ([o.responsibleAuthority, o.approvingAuthority].includes(a) || [o.responsibleAuthority, o.approvingAuthority].includes(b)) {
      for (const role of ownership.DEPUTY_ROLES) people.add(o[role]);
    }
  }
  const forAgency = (agency) => ownership.subsystems()
    .filter((s) => { const o = ownership.describe(s); return o.responsibleAuthority === agency || o.approvingAuthority === agency; })
    .flatMap((s) => ownership.DEPUTY_ROLES.map((r) => ownership.OWNERSHIP[s][r]));
  const peopleA = new Set(forAgency(a));
  const peopleB = new Set(forAgency(b));

  // A joint act: an exercise both institutions took part in, or governance acts on a shared subject.
  let joint = 0;
  const evidence = [];
  if (exercises) {
    const byExercise = new Map();
    for (const p of exercises.participation()) {
      if (!byExercise.has(p.exercise)) byExercise.set(p.exercise, new Set());
      byExercise.get(p.exercise).add(p.person);
    }
    for (const [exercise, participants] of byExercise) {
      const hasA = [...participants].some((x) => peopleA.has(x));
      const hasB = [...participants].some((x) => peopleB.has(x));
      if (hasA && hasB) { joint += 1; evidence.push(`joint rehearsal: ${exercise}`); }
    }
  }
  if (activity) {
    const bySubsystem = new Map();
    for (const act of activity.acts ? activity.acts() : []) {
      if (!act.subsystem) continue;
      if (!bySubsystem.has(act.subsystem)) bySubsystem.set(act.subsystem, new Set());
      bySubsystem.get(act.subsystem).add(act.person);
    }
    for (const [subsystem, actors] of bySubsystem) {
      const hasA = [...actors].some((x) => peopleA.has(x));
      const hasB = [...actors].some((x) => peopleB.has(x));
      if (hasA && hasB) { joint += 1; evidence.push(`joint governance acts on '${subsystem}'`); }
    }
  }
  return {
    demonstrated: joint > 0, unknown: false, acts: joint, evidence: evidence.sort(),
    reason: joint ? `${joint} recorded joint act(s): ${evidence.join('; ')}` : 'no recorded act involves people from both institutions — the relationship exists on paper and has never been exercised',
  };
}

// Readiness for one pair, across all five dimensions.
function pairReadiness(a, b, { activity = null, exercises = null, now = 0 } = {}) {
  const sharing = informationSharing().filter((f) => (f.fromAgency === a && f.toAgency === b) || (f.fromAgency === b && f.toAgency === a));
  const approvals = approvalDependencies().filter((d) => (d.held === a && d.needs === b) || (d.held === b && d.needs === a));
  const comms = communicationPath(a, b);
  const coordination = demonstratedCoordination(a, b, { activity, exercises, now });
  const known = new Set(agencies().map((x) => x.agency));
  const owned = known.has(a) && known.has(b);

  const band = !owned ? 'unknown'
    : coordination.demonstrated ? 'demonstrated'
      : comms.reachable ? 'reachable' : 'declared';
  const dimensions = [
    { dimension: 'governanceOwnership', ...COORDINATION_DIMENSIONS.governanceOwnership, satisfied: owned, detail: owned ? 'both institutions hold accountability in the ownership record' : 'at least one holds nothing' },
    { dimension: 'communicationPath', ...COORDINATION_DIMENSIONS.communicationPath, satisfied: comms.reachable, detail: comms.reason },
    { dimension: 'approvalDependency', ...COORDINATION_DIMENSIONS.approvalDependency, satisfied: true, detail: approvals.length ? `${approvals.length} subsystem(s) where one needs the other's approval: ${approvals.map((d) => d.subsystem).join(', ')}` : 'neither needs the other\'s approval for anything recorded' },
    { dimension: 'informationSharing', ...COORDINATION_DIMENSIONS.informationSharing, satisfied: true, detail: sharing.length ? `${sharing.length} declared data flow(s)` : 'no declared data flow between them' },
    { dimension: 'demonstratedCoordination', ...COORDINATION_DIMENSIONS.demonstratedCoordination, satisfied: coordination.demonstrated, detail: coordination.reason },
  ];
  return {
    agencies: [a, b].sort(), dimensions,
    informationSharing: sharing, approvalDependencies: approvals,
    communicationPath: comms, coordination,
    readiness: band, ...READINESS_BANDS[band],
    // The pairs that matter most: data crosses between them and they have never coordinated.
    sharesWithoutCoordinating: sharing.length > 0 && !coordination.demonstrated,
  };
}

// Inter-agency risk. Derived, never scored: each risk names the condition that produced it, so it can
// be argued with.
function interAgencyRisks({ activity = null, exercises = null, now = 0 } = {}) {
  const risks = [];
  const all = agencies();
  const sharing = informationSharing();

  // 1. Data crosses an institutional boundary that has never been exercised.
  const pairs = new Map();
  for (const f of sharing) {
    const key = [f.fromAgency, f.toAgency].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(f);
  }
  for (const [key, flows] of [...pairs.entries()].sort()) {
    const [a, b] = key.split('|');
    const r = pairReadiness(a, b, { activity, exercises, now });
    if (!r.ready) {
      risks.push({
        risk: 'untested-sharing', agencies: [a, b], flows: flows.length,
        detail: `${flows.length} declared data flow(s) between '${a}' and '${b}', and the relationship is '${r.readiness}' — ${READINESS_BANDS[r.readiness].means}`,
        wouldFailAt: 'the first incident requiring the two to act together at short notice',
      });
    }
  }

  // 2. An institution nothing can reach.
  for (const a of all) {
    const reachable = all.filter((b) => b.agency !== a.agency && communicationPath(a.agency, b.agency).reachable);
    if (!reachable.length) {
      risks.push({ risk: 'unreachable-institution', agencies: [a.agency], detail: `'${a.agency}' shares no board and appears in no other institution's escalation chain`, wouldFailAt: 'any situation requiring it to be told something quickly' });
    }
  }

  // 3. A single institution approving a large share of the estate is a cross-agency bottleneck as
  //    well as a governance one — its absence stops other institutions acting, not only itself.
  const total = ownership.subsystems().length;
  for (const a of all) {
    if (a.approves.length / total >= 0.25) {
      const blocked = [...new Set(a.approves.map(agencyOf).filter((x) => x !== a.agency))].sort();
      if (blocked.length) {
        risks.push({
          risk: 'cross-agency-approval-bottleneck', agencies: [a.agency, ...blocked],
          detail: `'${a.agency}' approves ${a.approves.length} of ${total} subsystems, held by ${blocked.length} other institution(s): ${blocked.join(', ')}. Its unavailability stops them acting, not only itself.`,
          wouldFailAt: 'a period when that institution cannot convene',
        });
      }
    }
  }
  return risks.sort((a, b) => a.risk.localeCompare(b.risk) || a.agencies.join().localeCompare(b.agencies.join()));
}

function collaborationReadiness({ activity = null, exercises = null, now = 0 } = {}) {
  const all = agencies();
  const sharing = informationSharing();
  const pairKeys = [...new Set(sharing.map((f) => [f.fromAgency, f.toAgency].sort().join('|')))].sort();
  const pairs = pairKeys.map((k) => { const [a, b] = k.split('|'); return pairReadiness(a, b, { activity, exercises, now }); });
  const risks = interAgencyRisks({ activity, exercises, now });
  const ready = pairs.filter((p) => p.ready);
  return {
    agencies: all, agencyCount: all.length,
    pairs, pairCount: pairs.length,
    dimensions: Object.entries(COORDINATION_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d })),
    bands: Object.entries(READINESS_BANDS).map(([band, b]) => ({ band, ...b })),
    informationSharing: sharing, sharingFlows: sharing.length,
    approvalDependencies: approvalDependencies(),
    risks, riskCount: risks.length,
    readyPairs: ready.map((p) => p.agencies.join(' ↔ ')),
    // The figure worth reading. On a platform with no joint-act register this is 0, and that is the
    // true answer rather than a discouraging one.
    readinessRate: pairs.length ? +(ready.length / pairs.length).toFixed(4) : null,
    untestedPairs: pairs.filter((p) => p.sharesWithoutCoordinating).map((p) => p.agencies.join(' ↔ ')),
    measurable: activity !== null || exercises !== null,
    informationalOnly: true, authorizes: false,
    note: 'The institutions are derived from who is actually accountable, never listed. A declared relationship is not a working one: readiness reaches "demonstrated" only where a recorded act involved people from both institutions, and every other band is reported as untested rather than as adequate.',
  };
}

module.exports = {
  COORDINATION_DIMENSIONS, READINESS_BANDS,
  agencies, agencyOf, informationSharing, approvalDependencies,
  communicationPath, demonstratedCoordination, pairReadiness, interAgencyRisks, collaborationReadiness,
};
