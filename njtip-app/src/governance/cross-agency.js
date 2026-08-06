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

// ---------------------------------------------------------------------------
// Part 17 — Cross-Government Readiness (Phase 15).
//
// Phase 14 asked whether two institutions could coordinate. That was the right question and it was
// answered from too little: two bodies sharing a board and a rehearsal were called ready even if one
// sat in the judiciary and the other in the executive, and nothing recorded what legally permitted
// them to exchange anything at all.
//
// This extends the same analysis to what a WHOLE-OF-GOVERNMENT relationship actually needs. Five
// aspects, and a relationship is only as ready as its weakest one:
//
//   communication · legal interoperability · governance interoperability ·
//   operational coordination · dependency resilience
//
// Two rules carried forward, and one new one.
//
//   Carried: a declared relationship is not a working one. Carried: unknown is not ready — it is its
//   own finding, counted separately from a conflict, because "nobody has looked" and "we looked and
//   they disagree" need different people to act.
//
//   New: THE CONSTITUTIONAL ZONE IS PART OF THE RELATIONSHIP. Two institutions in different zones
//   relying on each other is not the same relationship as two inside one zone, and the platform now
//   records the zones (Part 6), so it can finally tell the difference. A reliance that crosses a
//   constitutional separation is reported as crossing one, whether or not anybody minds.
const ASPECT_STATES = {
  blocked: { rank: 0, ready: false, means: 'Something recorded actively conflicts. This is a finding somebody must resolve, not a gap somebody must fill.' },
  unknown: { rank: 1, ready: false, means: 'Nothing is recorded either way. Unknown is not ready and it is not blocked — nobody has looked.' },
  partial: { rank: 2, ready: false, means: 'Some of what this aspect needs is present and some is not.' },
  ready: { rank: 3, ready: true, means: 'Everything this aspect needs is recorded and, where it must be exercised, has been.' },
};
const ASPECT_ORDER = ['blocked', 'unknown', 'partial', 'ready'];

// The five aspects. Each says what it is asking, what would evidence it, and what its absence costs
// in the specific way THIS aspect fails — a relationship can fail five different ways and calling
// them all "not ready" hides which repair is needed.
const GOVERNMENT_READINESS_ASPECTS = {
  communication: {
    question: 'Can each institution reach the other, and how directly?',
    evidencedBy: 'a shared governance board, an escalation chain naming the other, or a chain of boards connecting them',
    failsAs: 'An incident where the two need each other within the hour and start by working out who to call.',
  },
  legalInteroperability: {
    question: 'What legally permits one institution to rely on the other?',
    evidencedBy: 'a reviewed legal authority covering each capability whose delivery depends on the other institution',
    failsAs: 'The reliance is challenged, and the answer to "under what authority" is a diagram.',
  },
  governanceInteroperability: {
    question: 'Do the two institutions\' recorded governance rules agree about what may cross between them?',
    evidencedBy: 'agreeing collaboration constraints, no classification downgrade across the flow, and compatible data residency',
    failsAs: 'Both sides follow their own rules correctly and the exchange breaches one of them.',
  },
  operationalCoordination: {
    question: 'Have these two institutions ever actually acted together?',
    evidencedBy: 'a recorded joint governance act or a rehearsal involving people from both',
    failsAs: 'The first time they coordinate is the time it matters.',
  },
  dependencyResilience: {
    question: 'If the relationship fails, does anything else carry the load?',
    evidencedBy: 'more than one declared flow between them, and a failover policy on what is depended upon',
    failsAs: 'One institution\'s outage becomes the other institution\'s outage, with no second path.',
  },
};

// Order matters: index 0 is the most restrictive. Derived from the declared sets so a new value added
// to the architecture cannot silently become the most permissive one.
const CLASSIFICATION_ORDER = [...contextMap.CLASSIFICATIONS];
const RESIDENCY_ORDER = [...contextMap.RESIDENCY_POLICIES];
const COLLABORATION_ORDER = [...contextMap.COLLABORATION_CONSTRAINTS];

// An institution's constitutional position, derived from the zones of what it is accountable for.
// Nothing lists this: an institution that is given a judiciary context tomorrow changes zone tomorrow.
function institutions() {
  return agencies().map((a) => {
    const held = a.responsibleFor.filter((s) => contextMap.ids().includes(s));
    const gov = held.map((s) => contextMap.zoneGovernance(s));
    const zones = [...new Set(gov.map((g) => g.zone))].sort();
    return {
      ...a, contexts: held,
      zones,
      // An institution accountable for contexts in more than one zone is itself a constitutional
      // crossing point, whatever its own letterhead says.
      zone: zones.length === 0 ? 'unknown' : zones.length === 1 ? zones[0] : 'spans-zones',
      spansZones: zones.length > 1,
      classifications: [...new Set(gov.map((g) => g.classification))].sort(),
      residencies: [...new Set(gov.map((g) => g.residency))].sort(),
      collaboration: [...new Set(gov.map((g) => g.collaboration))].sort(),
      // The strictest thing it holds. A body holding one constitutional context is governed by that,
      // not by the average of its portfolio.
      strictestClassification: gov.length ? CLASSIFICATION_ORDER.find((c) => gov.some((g) => g.classification === c)) || null : null,
    };
  });
}

const institutionOf = (agency) => institutions().find((i) => i.agency === agency) || null;

// Aspect 1 — communication. Direct reach is what Phase 14 measured. Indirect reach (a chain of shared
// boards) is real but weaker: every hop is a body that has to agree to pass the message on.
function communicationReadiness(a, b) {
  const direct = communicationPath(a, b);
  if (direct.reachable) {
    return { aspect: 'communication', state: 'ready', hops: 1, via: direct.via, detail: direct.reason, findings: [] };
  }
  // Breadth-first over the board graph: institutions are adjacent when they share a board.
  const all = institutions();
  const boardsOf = new Map(all.map((i) => [i.agency, new Set(i.boards)]));
  // An institution the accountability record does not know sits in no forum at all. It is not
  // "far away" — there is nothing to walk from, and the walk must say so rather than fail.
  if (!boardsOf.has(a) || !boardsOf.has(b)) {
    const missing = [a, b].filter((x) => !boardsOf.has(x));
    return {
      aspect: 'communication', state: 'blocked', hops: null, via: null,
      detail: `${missing.join(' and ')} hold${missing.length === 1 ? 's' : ''} nothing in the accountability record, so no forum connects them to anything`,
      findings: missing.map((x) => `'${x}' is not an institution in the accountability record — nothing can be routed to it`),
    };
  }
  const adjacent = (x) => all.filter((y) => y.agency !== x && [...boardsOf.get(x)].some((brd) => boardsOf.get(y.agency).has(brd))).map((y) => y.agency);
  const seen = new Set([a]);
  let frontier = [[a]];
  for (let hop = 1; hop <= all.length && frontier.length; hop += 1) {
    const next = [];
    for (const path of frontier) {
      for (const n of adjacent(path[path.length - 1])) {
        if (seen.has(n)) continue;
        seen.add(n);
        const extended = [...path, n];
        if (n === b) {
          return {
            aspect: 'communication', state: 'partial', hops: extended.length - 1, via: extended.join(' → '),
            detail: `no shared board and no escalation chain connects them directly; they are connected through ${extended.length - 2} intermediary institution(s): ${extended.join(' → ')}`,
            findings: [`reaching '${b}' from '${a}' requires ${extended.length - 2} other institution(s) to relay`],
          };
        }
        next.push(extended);
      }
    }
    frontier = next;
  }
  return {
    aspect: 'communication', state: 'blocked', hops: null, via: null,
    detail: `${direct.reason}; and no chain of shared boards connects them either`,
    findings: [`'${a}' and '${b}' are in different components of the governance graph — nothing recorded connects them at any distance`],
  };
}

// Which critical capabilities does one institution deliver by relying on the other? Derived from the
// capability's own context and that context's declared dependencies — never from a list of
// "partnerships", which is the kind of thing that is written once and then stops being true.
function crossInstitutionCapabilities(a, b) {
  const ir = require('./institutional-resilience');
  const out = [];
  for (const [capability, spec] of Object.entries(ir.CRITICAL_CAPABILITIES)) {
    for (const ctx of spec.contexts || []) {
      if (!ownership.OWNERSHIP[ctx]) continue;
      const holder = agencyOf(ctx);
      const other = holder === a ? b : holder === b ? a : null;
      if (!other) continue;
      const reliedOn = (contextMap.describe(ctx).dependsOn || [])
        .filter((d) => ownership.OWNERSHIP[d.context] && agencyOf(d.context) === other)
        .map((d) => d.context);
      if (!reliedOn.length) continue;
      out.push({ capability, constitutional: !!spec.constitutional, context: ctx, deliveredBy: holder, reliesOn: other, viaContexts: reliedOn.sort() });
    }
  }
  return out.sort((x, y) => x.capability.localeCompare(y.capability));
}

// Aspect 2 — legal interoperability. The question is not "is there a statute" but "does anything
// recorded permit THIS institution to depend on THAT one for THIS capability".
function legalInteroperability(a, b, { authorities = null, now = 0, controls = [] } = {}) {
  const reliances = crossInstitutionCapabilities(a, b);
  const ia = institutionOf(a); const ib = institutionOf(b);
  const crossesZone = !!(ia && ib && ia.zone !== ib.zone);
  if (!reliances.length) {
    return {
      aspect: 'legalInteroperability', state: 'ready', crossesZone, reliances: [],
      detail: 'no critical capability of either institution is delivered by relying on the other, so no authority is required for one',
      findings: [],
    };
  }
  if (!authorities) {
    return {
      aspect: 'legalInteroperability', state: 'unknown', crossesZone, reliances,
      detail: `${reliances.length} critical capability reliance(s) cross between these institutions and no legal authority register was supplied — what permits the reliance is unknown, and unknown is not permission`,
      findings: reliances.map((r) => `'${r.capability}' is delivered by '${r.deliveredBy}' relying on '${r.reliesOn}' and nothing states under what authority`),
    };
  }
  const rows = reliances.map((r) => ({ ...r, authority: authorities.state(r.capability, { now, controls }) }));
  const unauthorized = rows.filter((r) => !r.authority.authorized);
  const findings = unauthorized.map((r) => `'${r.capability}' (${r.deliveredBy} → ${r.reliesOn}): legal authority is '${r.authority.state}' — ${r.authority.reason}`);
  // A reliance that crosses a constitutional zone without authority is the sharper case, and it is
  // named rather than folded into the count.
  if (crossesZone && unauthorized.length) {
    findings.push(`this reliance crosses a constitutional separation ('${ia.zone}' → '${ib.zone}') and no reviewed authority covers it`);
  }
  const state = !unauthorized.length ? 'ready'
    : unauthorized.every((r) => r.authority.state === 'unknown') ? 'unknown' : 'blocked';
  return {
    aspect: 'legalInteroperability', state, crossesZone, reliances: rows,
    detail: unauthorized.length
      ? `${unauthorized.length} of ${rows.length} cross-institution capability reliance(s) rest on no reviewed legal authority`
      : `all ${rows.length} cross-institution capability reliance(s) rest on a reviewed legal authority`,
    findings,
  };
}

// Aspect 3 — governance interoperability. Read from the zone governance record, which is the only
// place the platform states what may cross a boundary. Every finding here is two correct rules
// disagreeing, which is why it reports `blocked` rather than `unknown`: nothing is missing.
function governanceInteroperability(a, b) {
  const flows = informationSharing().filter((f) => (f.fromAgency === a && f.toAgency === b) || (f.fromAgency === b && f.toAgency === a));
  if (!flows.length) {
    return { aspect: 'governanceInteroperability', state: 'ready', flows: [], detail: 'no declared data flow crosses between these institutions, so no rule has to reconcile with another', findings: [] };
  }
  const findings = []; const rows = [];
  for (const f of flows) {
    // The dependency is declared from → to, so data moves from the depended-upon context to the
    // depending one. The source is `toContext`.
    const source = contextMap.zoneGovernance(f.toContext);
    const sink = contextMap.zoneGovernance(f.fromContext);
    const issues = [];
    // Onward disclosure, and ONLY onward disclosure. A declared dependency between two contexts of
    // this platform is not an act of sharing — `collaboration` governs what may be passed OUTWARD to
    // another body, so an internal dependency on a 'no-sharing' context is architecture working as
    // designed, not a breach. What matters is where the data LANDS: data that may only leave under
    // governance arriving somewhere that may publish it is a real leak of authority, and reading the
    // field the other way would fire on almost every dependency in the estate and teach everybody to
    // ignore it.
    if (COLLABORATION_ORDER.indexOf(sink.collaboration) > COLLABORATION_ORDER.indexOf(source.collaboration)) {
      issues.push(`onward disclosure: '${f.toContext}' permits '${source.collaboration}' and it flows into '${f.fromContext}', which permits the looser '${sink.collaboration}'`);
    }
    if (CLASSIFICATION_ORDER.indexOf(sink.classification) > CLASSIFICATION_ORDER.indexOf(source.classification)) {
      issues.push(`classification downgrade: '${source.classification}' data from '${f.toContext}' lands in '${f.fromContext}', classified '${sink.classification}'`);
    }
    if (RESIDENCY_ORDER.indexOf(sink.residency) > RESIDENCY_ORDER.indexOf(source.residency)) {
      issues.push(`residency relaxation: '${f.toContext}' is '${source.residency}' and '${f.fromContext}' is '${sink.residency}'`);
    }
    rows.push({ ...f, sourceZone: source.zone, sinkZone: sink.zone, crossesZone: source.zone !== sink.zone, issues });
    for (const i of issues) findings.push(`${f.fromAgency} ← ${f.toAgency}: ${i}`);
  }
  const sharedBoard = (institutionOf(a)?.boards || []).some((brd) => (institutionOf(b)?.boards || []).includes(brd));
  if (!sharedBoard) {
    findings.push(`no board governs both institutions, so a disagreement about these ${flows.length} flow(s) has no forum that can settle it`);
  }
  const state = rows.some((r) => r.issues.length) ? 'blocked' : sharedBoard ? 'ready' : 'partial';
  return {
    aspect: 'governanceInteroperability', state, flows: rows, sharedBoard,
    detail: findings.length ? `${findings.length} governance conflict(s) across ${flows.length} declared flow(s)` : `${flows.length} declared flow(s) and no recorded rule conflicts with another`,
    findings,
  };
}

// Aspect 4 — operational coordination. Unchanged in substance from Phase 14; restated as an aspect so
// that "they have never worked together" caps the whole relationship rather than one dimension of it.
function operationalCoordination(a, b, { activity = null, exercises = null, now = 0 } = {}) {
  const c = demonstratedCoordination(a, b, { activity, exercises, now });
  const state = c.unknown ? 'unknown' : c.demonstrated ? 'ready' : 'blocked';
  return {
    aspect: 'operationalCoordination', state, coordination: c, detail: c.reason,
    findings: state === 'ready' ? [] : [`'${a}' and '${b}': ${c.reason}`],
  };
}

// Aspect 5 — dependency resilience. What happens to the relationship when it fails. A single declared
// flow is a single path, and a single path across an institutional boundary fails at a boundary
// nobody controls both sides of.
function dependencyResilience(a, b) {
  const flows = informationSharing().filter((f) => (f.fromAgency === a && f.toAgency === b) || (f.fromAgency === b && f.toAgency === a));
  if (!flows.length) {
    return { aspect: 'dependencyResilience', state: 'ready', flows: [], detail: 'neither institution depends on the other for anything declared, so there is no relationship to lose', findings: [] };
  }
  const findings = [];
  const rows = flows.map((f) => {
    const source = contextMap.zoneGovernance(f.toContext);
    const noFailover = source.failover === 'no-failover';
    if (noFailover) findings.push(`'${f.toContext}' (${f.toAgency}) is declared 'no-failover' and '${f.fromContext}' (${f.fromAgency}) depends on it — when it is gone it is gone, across an institutional boundary`);
    return { ...f, failover: source.failover, noFailover };
  });
  // Direction matters. One institution depending on another through exactly one context has one path
  // to lose; the reciprocal direction is a separate relationship with its own single point.
  const byDirection = new Map();
  for (const f of rows) {
    const key = `${f.fromAgency}|${f.toAgency}`;
    byDirection.set(key, (byDirection.get(key) || 0) + 1);
  }
  for (const [key, count] of [...byDirection.entries()].sort()) {
    const [from, to] = key.split('|');
    if (count === 1) findings.push(`'${from}' depends on '${to}' through exactly one declared flow — there is no second path between these institutions in that direction`);
  }
  const state = rows.some((r) => r.noFailover) ? 'blocked' : findings.length ? 'partial' : 'ready';
  return {
    aspect: 'dependencyResilience', state, flows: rows,
    detail: findings.length ? `${findings.length} resilience finding(s) across ${rows.length} declared flow(s)` : `${rows.length} declared flow(s), each with an alternative path and a failover policy`,
    findings,
  };
}

// One pair, across all five aspects, aggregated to the weakest link — never averaged. A relationship
// that is exemplary on four aspects and has no legal basis is a relationship with no legal basis.
function pairGovernmentReadiness(a, b, { authorities = null, activity = null, exercises = null, now = 0, controls = [] } = {}) {
  const aspects = [
    communicationReadiness(a, b),
    legalInteroperability(a, b, { authorities, now, controls }),
    governanceInteroperability(a, b),
    operationalCoordination(a, b, { activity, exercises, now }),
    dependencyResilience(a, b),
  ].map((x) => ({ ...x, ...GOVERNMENT_READINESS_ASPECTS[x.aspect], ...ASPECT_STATES[x.state] }));

  const weakest = aspects.reduce((w, x) => (ASPECT_STATES[x.state].rank < ASPECT_STATES[w.state].rank ? x : w), aspects[0]);
  const ia = institutionOf(a); const ib = institutionOf(b);
  return {
    agencies: [a, b].sort(),
    zones: [ia ? ia.zone : 'unknown', ib ? ib.zone : 'unknown'],
    // Recorded whether or not it is a problem: a relationship spanning the constitutional separation
    // is a different relationship, and the report says so instead of leaving the reader to notice.
    crossesConstitutionalSeparation: !!(ia && ib && ia.zone !== ib.zone),
    aspects,
    // Both counted, never merged. "Nobody looked" and "we looked and they conflict" are different jobs.
    unknownAspects: aspects.filter((x) => x.state === 'unknown').map((x) => x.aspect),
    blockedAspects: aspects.filter((x) => x.state === 'blocked').map((x) => x.aspect),
    readyAspects: aspects.filter((x) => x.state === 'ready').map((x) => x.aspect),
    findings: aspects.flatMap((x) => x.findings),
    readiness: weakest.state, weakestAspect: weakest.aspect,
    ready: aspects.every((x) => x.state === 'ready'),
    basis: `weakest of five aspects; '${weakest.aspect}' is '${weakest.state}' — ${ASPECT_STATES[weakest.state].means}`,
  };
}

// Whole-of-government. The pairs analysed are the ones that actually have a relationship to assess:
// a declared data flow, or a critical capability delivered by relying on the other. Two institutions
// with neither are not partners who are failing — they are simply not partners.
function crossGovernmentReadiness({ authorities = null, activity = null, exercises = null, now = 0, controls = [] } = {}) {
  const all = institutions();
  const keys = new Set(informationSharing().map((f) => [f.fromAgency, f.toAgency].sort().join('|')));
  for (const x of all) {
    for (const y of all) {
      if (x.agency >= y.agency) continue;
      if (crossInstitutionCapabilities(x.agency, y.agency).length) keys.add([x.agency, y.agency].sort().join('|'));
    }
  }
  const pairs = [...keys].sort().map((k) => { const [a, b] = k.split('|'); return pairGovernmentReadiness(a, b, { authorities, activity, exercises, now, controls }); });

  // Per aspect, across every pair. This is the figure that says WHICH repair would move the most
  // relationships, rather than how many relationships are unhappy.
  const byAspect = Object.keys(GOVERNMENT_READINESS_ASPECTS).map((aspect) => {
    const states = pairs.map((p) => p.aspects.find((x) => x.aspect === aspect).state);
    const counts = Object.fromEntries(ASPECT_ORDER.map((s) => [s, states.filter((x) => x === s).length]));
    return {
      aspect, ...GOVERNMENT_READINESS_ASPECTS[aspect], counts,
      readyPairs: counts.ready, blockedPairs: counts.blocked, unknownPairs: counts.unknown,
      // The weakest state ANY pair is in for this aspect, not the common one.
      weakestState: ASPECT_ORDER.find((s) => counts[s] > 0) || 'ready',
    };
  });
  const ready = pairs.filter((p) => p.ready);
  const crossZone = pairs.filter((p) => p.crossesConstitutionalSeparation);
  const limiting = [...byAspect].sort((x, y) => (x.readyPairs - y.readyPairs) || x.aspect.localeCompare(y.aspect))[0] || null;

  return {
    institutions: all, institutionCount: all.length,
    zones: [...new Set(all.map((i) => i.zone))].sort(),
    spanningInstitutions: all.filter((i) => i.spansZones).map((i) => i.agency),
    aspects: Object.entries(GOVERNMENT_READINESS_ASPECTS).map(([aspect, a]) => ({ aspect, ...a })),
    states: ASPECT_ORDER.map((state) => ({ state, ...ASPECT_STATES[state] })),
    pairs, pairCount: pairs.length,
    byAspect,
    limitingAspect: limiting ? limiting.aspect : null,
    readyPairs: ready.map((p) => p.agencies.join(' ↔ ')),
    readinessRate: pairs.length ? +(ready.length / pairs.length).toFixed(4) : null,
    crossZonePairs: crossZone.map((p) => ({ agencies: p.agencies.join(' ↔ '), zones: p.zones, readiness: p.readiness })),
    crossZonePairCount: crossZone.length,
    // Counted separately at the top level too, so the headline cannot quietly become "mostly blocked"
    // when the truth is "mostly unexamined".
    pairsWithUnknownAspects: pairs.filter((p) => p.unknownAspects.length).length,
    pairsWithBlockedAspects: pairs.filter((p) => p.blockedAspects.length).length,
    findings: pairs.flatMap((p) => p.findings),
    // What the report is entitled to say. Without a legal register and an activity register, two of
    // the five aspects cannot be answered at all, and the summary states that rather than scoring it.
    measurable: { legalInteroperability: authorities !== null, operationalCoordination: activity !== null || exercises !== null, communication: true, governanceInteroperability: true, dependencyResilience: true },
    ready: pairs.length > 0 && ready.length === pairs.length,
    informationalOnly: true, authorizes: false,
    note: 'Institutions, their constitutional zones and their relationships are all derived from the accountability and architecture records — nothing here is a list of partners. A pair is only as ready as its weakest aspect, and unknown is counted apart from blocked because nobody having looked and two rules conflicting need different people to act.',
  };
}

// --- Cross-government workflow validation (Phase 16, Part 8) ---------------------------------------
//
// Part 17 assessed a RELATIONSHIP between two institutions. Part 8 asks about the thing the
// relationship exists to carry: a complete piece of work that crosses several of them and either
// finishes or does not.
//
// A workflow is DERIVED, never listed: it is the delivery path of a critical capability — the
// capability's own bounded context plus the contexts it declares a dependency on — with the
// accountable institution resolved at each step. A capability whose path is renamed changes its
// workflow automatically.
//
// The rule Part 8 states and this section enforces:
//
//   UNKNOWN COLLABORATION IS NEVER SUCCESSFUL COLLABORATION. A workflow whose execution nobody has
//   recorded has an UNKNOWN completion, which is a separate state from a workflow that ran and
//   failed and from one that ran and finished. Reading the absence of a record as a success is the
//   single failure this part exists to prevent.
const WORKFLOW_DIMENSIONS = {
  workflowCompletion: {
    asks: 'Has this workflow ever actually run from end to end?',
    evidencedBy: 'a recorded governance act at every step, by somebody accountable for that step',
    ifUnknown: 'Nobody knows whether the work can cross the institutions it has to cross.',
  },
  legalCompatibility: {
    asks: 'Is every hand-off legally permitted?',
    evidencedBy: 'a reviewed legal authority covering the capability the workflow delivers',
    ifUnknown: 'The work crosses institutions and nothing states what permits it to.',
  },
  operationalCompatibility: {
    asks: 'Can the steps actually run in the order the workflow needs?',
    evidencedBy: 'each step\'s context declaring a dependency on the one before it',
    ifUnknown: 'The sequence exists on a diagram and nothing says the systems support it.',
  },
  governanceCompatibility: {
    asks: 'Do the institutions along the path agree about what may cross between them?',
    evidencedBy: 'no governance conflict between consecutive steps held by different institutions',
    ifUnknown: 'Each institution follows its own rules correctly and the hand-off breaches one of them.',
  },
  communicationEfficiency: {
    asks: 'How many relays does a message need to cross the whole path?',
    evidencedBy: 'the communication hops between consecutive institutions on the path',
    ifUnknown: 'Nobody knows how long it takes to get a decision across the workflow.',
  },
  dependencyResilience: {
    asks: 'If one institution on the path stops, does the workflow stop?',
    evidencedBy: 'more than one institution able to carry each step, or a declared failover',
    ifUnknown: 'One institution\'s bad week becomes a national capability outage.',
  },
};

// The states a dimension can be in. `unknown` is deliberately NOT between failed and satisfied: it
// is its own column, and it never counts as either.
const WORKFLOW_STATES = {
  unknown: { satisfied: false, examined: false, means: 'Nothing has been recorded either way. Unknown collaboration is never successful collaboration.' },
  incompatible: { satisfied: false, examined: true, means: 'Examined, and something on the path actively prevents it.' },
  partial: { satisfied: false, examined: true, means: 'Examined, and some of what this dimension needs is present.' },
  satisfied: { satisfied: true, examined: true, means: 'Examined, and everything this dimension needs is recorded.' },
};

// The path a capability's delivery actually takes, derived from the architecture.
function workflowPath(capability) {
  const ir = require('./institutional-resilience');
  const spec = ir.CRITICAL_CAPABILITIES[capability];
  if (!spec) throw new Error(`unknown critical capability '${capability}'`);
  const steps = [];
  const seen = new Set();
  for (const ctx of spec.contexts || []) {
    // The capability's own context first, then everything it declares a dependency on. Deterministic
    // and shallow on purpose: a transitive closure would make every workflow the whole estate.
    for (const c of [ctx, ...(contextMap.describe(ctx).dependsOn || []).map((d) => d.context).sort()]) {
      if (seen.has(c) || !ownership.OWNERSHIP[c]) continue;
      seen.add(c);
      steps.push({ context: c, institution: agencyOf(c), zone: contextMap.zoneGovernance(c).zone });
    }
  }
  return steps;
}

function validateWorkflow(capability, { authorities = null, activity = null, exercises = null, controls = [], now = 0 } = {}) {
  const ir = require('./institutional-resilience');
  const spec = ir.CRITICAL_CAPABILITIES[capability];
  const steps = workflowPath(capability);
  const institutions = [...new Set(steps.map((s) => s.institution))];
  const dimension = (id, state, detail, findings = []) => ({
    dimension: id, ...WORKFLOW_DIMENSIONS[id], state, ...WORKFLOW_STATES[state], detail, findings,
  });

  // 1. Completion. Only answerable from a register of who actually did what, and it is empty.
  let completion;
  if (!activity) {
    completion = dimension('workflowCompletion', 'unknown',
      'no activity register was supplied — whether this workflow has ever run end to end is unknown, and unknown is not successful');
  } else {
    const acts = activity.acts ? activity.acts() : [];
    const covered = steps.filter((s) => acts.some((a) => a.subsystem === s.context));
    const state = covered.length === steps.length ? 'satisfied' : covered.length ? 'partial' : 'incompatible';
    completion = dimension('workflowCompletion', state,
      `${covered.length} of ${steps.length} step(s) have a recorded governance act`,
      steps.filter((s) => !covered.includes(s)).map((s) => `no recorded act at '${s.context}' (${s.institution})`));
  }

  // 2. Legal compatibility — the capability's own authority, since that is what permits the whole path.
  let legal;
  if (!authorities) {
    legal = dimension('legalCompatibility', 'unknown',
      `no legal authority register was supplied — what permits '${capability}' to cross ${institutions.length} institution(s) is unknown`);
  } else {
    const state = authorities.state(capability, { now, controls });
    legal = dimension('legalCompatibility', state.authorized ? 'satisfied' : state.state === 'unknown' ? 'unknown' : 'incompatible',
      state.reason, state.authorized ? [] : [`'${capability}': ${state.reason}`]);
  }

  // 3. Operational compatibility — does each step actually depend on the one before it?
  const breaks = [];
  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1], cur = steps[i];
    const linked = (contextMap.describe(prev.context).dependsOn || []).some((d) => d.context === cur.context)
      || (contextMap.describe(cur.context).dependsOn || []).some((d) => d.context === prev.context);
    if (!linked) breaks.push(`'${prev.context}' and '${cur.context}' are consecutive on this path and neither declares a dependency on the other`);
  }
  const operational = dimension('operationalCompatibility',
    steps.length < 2 ? 'unknown' : breaks.length ? 'partial' : 'satisfied',
    steps.length < 2 ? 'the path has fewer than two steps, so there is no sequence to support'
      : breaks.length ? `${breaks.length} consecutive pair(s) with no declared dependency`
        : `all ${steps.length - 1} consecutive pair(s) are linked by a declared dependency`,
    breaks);

  // 4. Governance compatibility — between consecutive steps held by DIFFERENT institutions.
  const conflicts = [];
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i - 1].institution === steps[i].institution) continue;
    const g = governanceInteroperability(steps[i - 1].institution, steps[i].institution);
    for (const f of g.findings) conflicts.push(`${steps[i - 1].context} → ${steps[i].context}: ${f}`);
  }
  const crossings = steps.slice(1).filter((s, i) => steps[i].institution !== s.institution).length;
  const governance = dimension('governanceCompatibility',
    crossings === 0 ? 'satisfied' : conflicts.length ? 'incompatible' : 'satisfied',
    crossings === 0 ? 'every step is held by the same institution, so no rule has to reconcile with another'
      : conflicts.length ? `${conflicts.length} conflict(s) across ${crossings} institutional crossing(s)`
        : `${crossings} institutional crossing(s) and no recorded rule conflicts with another`,
    conflicts);

  // 5. Communication efficiency — relays needed to cross the whole path.
  const hops = [];
  let unreachable = 0;
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i - 1].institution === steps[i].institution) continue;
    const c = communicationReadiness(steps[i - 1].institution, steps[i].institution);
    if (c.state === 'blocked') unreachable += 1;
    else hops.push(c.hops);
  }
  const totalHops = hops.reduce((a, b) => a + b, 0);
  const communication = dimension('communicationEfficiency',
    crossings === 0 ? 'satisfied' : unreachable ? 'incompatible' : hops.some((h) => h > 1) ? 'partial' : 'satisfied',
    crossings === 0 ? 'no institutional crossing, so no message has to travel'
      : unreachable ? `${unreachable} crossing(s) where the two institutions cannot reach each other at all`
        : `${totalHops} relay(s) across ${crossings} institutional crossing(s)`,
    unreachable ? [`${unreachable} crossing(s) on this workflow have no recorded communication path`] : []);

  // 6. Dependency resilience — could anything else carry a step? Every step on this estate rests on
  // exactly one institution, so the honest answer is 'partial' with the holders named, and it only
  // becomes 'incompatible' when one institution holds the entire path.
  const resilience = dimension('dependencyResilience',
    steps.length < 2 ? 'unknown' : institutions.length === 1 ? 'incompatible' : 'partial',
    steps.length < 2 ? 'the path has one step, so there is nothing to lose'
      : institutions.length === 1 ? `every step is held by '${institutions[0]}' — one institution's bad week stops this workflow entirely`
        : `${institutions.length} institution(s) hold ${steps.length} step(s); each step rests on exactly one of them, and no failover between institutions is declared`,
    institutions.map((i) => `'${i}' holds ${steps.filter((s) => s.institution === i).length} step(s) that nothing else on this path can carry`));

  const dimensions = [completion, legal, operational, governance, communication, resilience];
  const unknown = dimensions.filter((d) => d.state === 'unknown');
  const failing = dimensions.filter((d) => d.examined && !d.satisfied);
  return {
    capability, constitutional: !!spec.constitutional,
    steps, stepCount: steps.length,
    institutions, institutionCount: institutions.length,
    zones: [...new Set(steps.map((s) => s.zone))].sort(),
    crossesConstitutionalSeparation: new Set(steps.map((s) => s.zone)).size > 1,
    dimensions,
    unknownDimensions: unknown.map((d) => d.dimension),
    failingDimensions: failing.map((d) => d.dimension),
    findings: dimensions.flatMap((d) => d.findings),
    // THE PART 8 RULE. Validated requires every dimension EXAMINED and satisfied; an unknown one
    // leaves the workflow unvalidated rather than passing.
    validated: dimensions.every((d) => d.satisfied),
    examined: dimensions.every((d) => d.examined),
    verdict: dimensions.every((d) => d.satisfied) ? 'validated'
      : unknown.length ? 'unvalidated' : 'invalid',
    basis: unknown.length
      ? `${unknown.length} of ${dimensions.length} dimensions could not be examined at all. This workflow is UNVALIDATED — not failed, and certainly not successful.`
      : failing.length ? `examined on all ${dimensions.length} dimensions; ${failing.length} prevent it: ${failing.map((d) => d.dimension).join(', ')}`
        : `examined and satisfied on all ${dimensions.length} dimensions`,
    now, informationalOnly: true, authorizes: false,
  };
}

function workflowValidation({ authorities = null, activity = null, exercises = null, controls = [], now = 0 } = {}) {
  const ir = require('./institutional-resilience');
  const rows = Object.keys(ir.CRITICAL_CAPABILITIES).sort()
    .map((c) => validateWorkflow(c, { authorities, activity, exercises, controls, now }));
  const byDimension = Object.keys(WORKFLOW_DIMENSIONS).map((id) => {
    const states = rows.map((r) => r.dimensions.find((d) => d.dimension === id).state);
    return {
      dimension: id, ...WORKFLOW_DIMENSIONS[id],
      counts: Object.fromEntries(Object.keys(WORKFLOW_STATES).map((s) => [s, states.filter((x) => x === s).length])),
    };
  });
  return {
    workflows: rows, count: rows.length,
    dimensions: byDimension, states: Object.entries(WORKFLOW_STATES).map(([state, s]) => ({ state, ...s })),
    validated: rows.filter((r) => r.validated).map((r) => r.capability),
    unvalidated: rows.filter((r) => r.verdict === 'unvalidated').map((r) => r.capability),
    invalid: rows.filter((r) => r.verdict === 'invalid').map((r) => r.capability),
    crossZoneWorkflows: rows.filter((r) => r.crossesConstitutionalSeparation).map((r) => r.capability),
    // Counted apart at the top level too, so the headline cannot become "mostly invalid" when the
    // truth is "mostly unexamined".
    unvalidatedCount: rows.filter((r) => r.verdict === 'unvalidated').length,
    invalidCount: rows.filter((r) => r.verdict === 'invalid').length,
    validationRate: rows.length ? +(rows.filter((r) => r.validated).length / rows.length).toFixed(4) : null,
    measurable: { workflowCompletion: activity !== null, legalCompatibility: authorities !== null },
    findings: rows.flatMap((r) => r.findings),
    informationalOnly: true, authorizes: false,
    note: 'A workflow is the delivery path of a critical capability, derived from the architecture rather than listed. Unknown collaboration is never successful collaboration: a workflow nobody has recorded running is UNVALIDATED, which is a separate state from one that ran and failed.',
  };
}

module.exports = {
  WORKFLOW_DIMENSIONS, WORKFLOW_STATES, workflowPath, validateWorkflow, workflowValidation,
  COORDINATION_DIMENSIONS, READINESS_BANDS,
  agencies, agencyOf, informationSharing, approvalDependencies,
  communicationPath, demonstratedCoordination, pairReadiness, interAgencyRisks, collaborationReadiness,
  ASPECT_STATES, ASPECT_ORDER, GOVERNMENT_READINESS_ASPECTS,
  institutions, institutionOf, crossInstitutionCapabilities,
  communicationReadiness, legalInteroperability, governanceInteroperability,
  operationalCoordination, dependencyResilience,
  pairGovernmentReadiness, crossGovernmentReadiness,
};
