'use strict';
// Government Capability Model (Phase 38). Documents the platform as BUSINESS CAPABILITIES:
// a capability map with domain/service ownership, dependencies, governance mapping, and a
// heat map driven by the LIVE fitness gate. Deterministic. This model drives future evolution.

// The capability map (data): capability → { domain, services, dependsOn, controls (fitness ids) }.
const CAPABILITY_MAP = {
  'Anonymous Reporting': { domain: 'Intake', services: ['workflow', 'events'], dependsOn: [], controls: ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANONYMITY-BOUNDARY'] },
  'Case Management': { domain: 'Investigation', services: ['workflow', 'orchestration'], dependsOn: ['Anonymous Reporting'], controls: ['APP-FIT-LIFECYCLE-DEFAULT-DENY', 'APP-FIT-WORKFLOW-INTEGRITY'] },
  'Evidence & Custody': { domain: 'Investigation', services: ['custody', 'objectStore'], dependsOn: ['Case Management'], controls: ['APP-FIT-CIPHERTEXT-ONLY', 'APP-FIT-CUSTODY-SIGNED-CHAIN', 'FIT-CHAIN-OF-CUSTODY'] },
  'Identity & Access': { domain: 'Security', services: ['iam', 'session', 'oidc'], dependsOn: [], controls: ['APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-POLICY-AS-DATA', 'APP-FIT-CREDENTIAL-HYGIENE'] },
  'Event Governance': { domain: 'Platform', services: ['events', 'eventRegistry', 'eventBus'], dependsOn: [], controls: ['APP-FIT-EVENT-SOURCING', 'APP-FIT-EVENT-GOVERNANCE', 'APP-FIT-EVENTBUS-FEDERATION'] },
  'Analytics & Intelligence': { domain: 'Insight', services: ['analytics', 'graph', 'ai'], dependsOn: ['Case Management'], controls: ['APP-FIT-ANALYTICS-PRIVACY', 'APP-FIT-SEMANTIC-GRAPH-ADVISORY', 'APP-FIT-AI-ADVISORY-ONLY'] },
  'Multi-Agency Federation': { domain: 'Collaboration', services: ['tenants', 'federation'], dependsOn: ['Identity & Access'], controls: ['APP-FIT-TENANT-ISOLATION'] },
  'Privacy Engineering': { domain: 'Security', services: ['privacy'], dependsOn: [], controls: ['APP-FIT-PRIVACY-ENGINEERING', 'FIT-IDENTITY-MINIMIZATION'] },
  'Assurance & Governance': { domain: 'Governance', services: ['compliance', 'twin2', 'workflowSim'], dependsOn: [], controls: ['FIT-GOVERNANCE', 'FIT-AUDITABILITY', 'APP-FIT-WORKFLOW-SIMULATION'] },
  'Operations & Resilience': { domain: 'Operations', services: ['tracer', 'evaluateSlo', 'twin3'], dependsOn: [], controls: ['INFRA-FIT-HA-SCALABILITY', 'INFRA-FIT-DR-BACKUP-RESTORE'] },
};


// --- Capability declaration history (Phase 15, Part 4) --------------------------------------------
//
// The capability declarations in this file, and the critical-capability declarations in
// `src/governance/institutional-resilience.js`, are load-bearing: the resilience invariant, the risk
// ranking and the legal authority registry all read them. They have been AMENDED — twice in Phase 14
// alone — and nothing recorded that they had been, why, or on whose authority.
//
// That is the gap this closes. A capability declaration that changes silently is an architecture that
// changes silently, and the whole platform rests on the declaration being right.
//
// The rule that keeps the register honest:
//
//   THE SEEDED HISTORY CONTAINS ONLY CHANGES THIS REPOSITORY ACTUALLY MADE. Every entry below is a
//   real amendment, recorded in git and decided in a real ADR. Backfilling a plausible history for
//   the declarations that have never changed would be the fabrication the phase forbids, so those
//   have one entry — their creation — and nothing else.
const CHANGE_KINDS = {
  creation: { requires: ['rationale'], means: 'The capability was declared for the first time.' },
  modification: { requires: ['rationale', 'was', 'now'], means: 'An existing declaration was amended. The before and after are both recorded, because "it was changed" is not a record of what changed.' },
  approval: { requires: ['approvedBy'], means: 'A named authority approved the declaration as it then stood.' },
  retirement: { requires: ['rationale'], means: 'The capability stopped being declared. Recorded rather than deleted.' },
};

class CapabilityDeclarationHistory {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._entries = []; }

  record(capability, kind, {
    rationale = null, adr = null, by, at = null,
    was = null, now = null, affectedContexts = [], affectedCapabilities = [], approvedBy = null,
  } = {}) {
    if (!capability) throw new Error('a declaration change must name the capability');
    const spec = CHANGE_KINDS[kind];
    if (!spec) throw new Error(`unknown declaration change kind '${kind}' — one of ${Object.keys(CHANGE_KINDS).join(', ')}`);
    if (!by) { const e = new Error('a capability declaration change must name who recorded it'); e.failClosed = true; throw e; }
    const payload = { rationale, was, now, approvedBy };
    for (const field of spec.requires) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        const e = new Error(`a '${kind}' entry requires '${field}' — ${spec.means}`);
        e.failClosed = true; throw e;
      }
    }
    // A modification with no ADR is a change nobody decided. Creation may predate ADR governance;
    // a later amendment may not.
    if (kind === 'modification' && !adr) {
      const e = new Error('amending a capability declaration requires an ADR — a load-bearing declaration changed without a recorded decision is an architecture that changed without one');
      e.failClosed = true; throw e;
    }
    const rec = {
      capability, kind, rationale, adr, by, at: at ?? this._clock(),
      was, now, approvedBy,
      affectedContexts: [...affectedContexts], affectedCapabilities: [...affectedCapabilities],
    };
    this._entries.push(rec);
    return { ...rec };
  }

  entries(capability = null) {
    return this._entries.filter((e) => !capability || e.capability === capability).map((e) => ({ ...e }))
      .sort((a, b) => a.at - b.at || a.capability.localeCompare(b.capability));
  }
  capabilities() { return [...new Set(this._entries.map((e) => e.capability))].sort(); }

  // The evolution of one capability, end to end.
  evolution(capability) {
    const rows = this.entries(capability);
    const modifications = rows.filter((r) => r.kind === 'modification');
    const approvals = rows.filter((r) => r.kind === 'approval');
    const created = rows.find((r) => r.kind === 'creation') || null;
    const latestApproval = approvals.length ? approvals[approvals.length - 1] : null;
    const latestModification = modifications.length ? modifications[modifications.length - 1] : null;
    return {
      capability, entries: rows, changes: rows.length,
      created, createdAt: created ? created.at : null,
      modifications: modifications.length,
      // The finding worth having: amended since it was last approved. Everything downstream is
      // relying on a declaration nobody has signed off in its current form.
      amendedSinceApproval: !!(latestModification && (!latestApproval || latestModification.at > latestApproval.at)),
      lastApprovedAt: latestApproval ? latestApproval.at : null,
      lastApprovedBy: latestApproval ? latestApproval.approvedBy : null,
      adrs: [...new Set(rows.map((r) => r.adr).filter(Boolean))].sort(),
      affectedContexts: [...new Set(rows.flatMap((r) => r.affectedContexts))].sort(),
      affectedCapabilities: [...new Set(rows.flatMap((r) => r.affectedCapabilities))].sort(),
      unrecorded: rows.length === 0,
      reason: rows.length === 0
        ? `nothing records how '${capability}' came to be declared as it is`
        : `${rows.length} recorded change(s)${latestApproval ? `, last approved by ${latestApproval.approvedBy}` : ', never approved'}`,
    };
  }

  // The architectural evolution report: how the declarations have moved, and which are unrecorded.
  report({ capabilities = null } = {}) {
    const declared = capabilities || Object.keys(CAPABILITY_MAP).sort();
    const known = new Set([...declared, ...this.capabilities()]);
    const rows = [...known].sort().map((c) => this.evolution(c));
    const unrecorded = rows.filter((r) => r.unrecorded);
    const amended = rows.filter((r) => r.amendedSinceApproval);
    return {
      capabilities: rows, count: rows.length,
      changeKinds: Object.entries(CHANGE_KINDS).map(([kind, k]) => ({ kind, ...k })),
      totalChanges: this._entries.length,
      // Which declarations nobody has recorded a history for. On a platform where the register was
      // added in Phase 15, that is most of them, and saying so is the point.
      unrecorded: unrecorded.map((r) => r.capability),
      amendedSinceApproval: amended.map((r) => ({ capability: r.capability, lastApprovedAt: r.lastApprovedAt })),
      neverApproved: rows.filter((r) => !r.unrecorded && r.lastApprovedAt === null).map((r) => r.capability),
      byAdr: [...new Set(this._entries.map((e) => e.adr).filter(Boolean))].sort()
        .map((adr) => ({ adr, capabilities: [...new Set(this._entries.filter((e) => e.adr === adr).map((e) => e.capability))].sort() })),
      coverage: rows.length ? +((rows.length - unrecorded.length) / rows.length).toFixed(4) : null,
      coverageBasis: `${rows.length - unrecorded.length} of ${rows.length} capability declarations have a recorded history. The register was introduced in Phase 15 and is not backfilled: a plausible history for a declaration that has never changed would be a fabricated one.`,
      informationalOnly: true, authorizes: false,
      note: 'A capability declaration that changes silently is an architecture that changes silently. Amending one requires an ADR; creating one may predate ADR governance, and a later amendment may not.',
    };
  }
}

// The changes this repository actually made. Nothing here is backfilled: each is a real amendment
// with a real rationale, decided in a real ADR, and recorded in git.
function seedDeclarationHistory(history, { at = 0 } = {}) {
  history.record('case-investigation', 'modification', {
    by: 'Office of the Chief Architect', adr: 'ADR-0009', at,
    rationale: 'The Phase 14 dependency taxonomy reported this capability as holding an unreconstructible store of record, which was false: the case aggregate is event-sourced and case-service declares a dependency on event-store-exec in the topology. The declaration was incomplete, not the architecture.',
    was: 'services: case-service, persistence-exec',
    now: 'services: case-service, event-store-exec, persistence-exec',
    affectedContexts: ['investigation'], affectedCapabilities: ['case-investigation'],
  });
  history.record('service-recovery', 'modification', {
    by: 'Office of the Chief Architect', adr: 'ADR-0009', at,
    rationale: 'The same correction: recovery rests on the append-only event stores as much as on the stores of record, because they are what makes a store reconstructible rather than merely restorable.',
    was: 'services: persistence-ind, persistence-exec, persistence-jud',
    now: 'services: persistence-ind, persistence-exec, persistence-jud, event-store-ind, event-store-exec, governance-ledger',
    affectedContexts: ['resilience', 'infrastructure'], affectedCapabilities: ['service-recovery'],
  });
  return history;
}

function capabilityMap() { return CAPABILITY_MAP; }
function dependencies() { const m = {}; for (const [c, d] of Object.entries(CAPABILITY_MAP)) m[c] = d.dependsOn; return m; }
function ownership() { const m = {}; for (const [c, d] of Object.entries(CAPABILITY_MAP)) (m[d.domain] = m[d.domain] || []).push(c); return m; }

// Heat map: per-capability health from the live fitness results ({id, pass}).
function heatMap(fitnessResults) {
  const pass = new Set(fitnessResults.filter((r) => r.pass).map((r) => r.id));
  const known = new Set(fitnessResults.map((r) => r.id));
  const out = {};
  for (const [cap, d] of Object.entries(CAPABILITY_MAP)) {
    const present = d.controls.filter((id) => known.has(id));
    const green = present.filter((id) => pass.has(id)).length;
    out[cap] = { domain: d.domain, controls: present.length, green, health: present.length ? +(green / present.length).toFixed(2) : null, status: present.length && green === present.length ? 'healthy' : green > 0 ? 'degraded' : 'unknown' };
  }
  return out;
}

// --- Platform capabilities (Phase 18.1, Part 10) -----------------------------------------------------
//
// A SECOND AXIS, and the first thing to say is why it is not a duplicate of the one above.
//
// `CAPABILITY_MAP` answers a question about the Republic's justice system: what business capabilities
// does it have, and what protects them. Anonymous Reporting, Case Management, Evidence & Custody.
// Those are the capabilities a citizen would recognise.
//
// This registry answers a question about the platform that serves it: what enduring ENGINEERING
// capabilities does this codebase deliver, so that planning can be capability-centric rather than
// phase-centric. Executive Intelligence, Governance Assurance, Architecture Governance. Those are the
// capabilities an engineer plans against.
//
// The two sets are disjoint, they answer different questions for different audiences, and they share
// only the word. They live in one module and share the declaration-history machinery because
// splitting them would be the duplication — two modules both called "capability" with two histories.
// ADR-0013 records the judgement, because "there are now two capability vocabularies" is exactly the
// kind of thing that looks like an oversight to whoever reads it next.
//
// The rule that governs everything below:
//
//   A CAPABILITY DOES NOT BECOME VERIFIED BECAUSE A MODULE EXISTS, AND DOES NOT BECOME OPERATIONAL
//   BECAUSE TESTS PASS. The first needs verification evidence. The second needs a human to say the
//   institution is running it, which is a fact about people that no test can establish.
const CAPABILITY_LIFECYCLE = {
  UNKNOWN: {
    rank: null, machineReachable: true, requires: [],
    means: 'Declared with too little to place it anywhere. Not a failure — nobody has said enough about it yet.',
  },
  PROPOSED: {
    rank: 0, machineReachable: true, requires: [],
    means: 'Somebody has named the capability. Nothing is built and nothing is owned.',
  },
  DEFINED: {
    rank: 1, machineReachable: true, requires: ['owner', 'contexts'],
    means: 'An accountable owner and a bounded context are recorded. Still nothing built.',
  },
  IMPLEMENTING: {
    rank: 2, machineReachable: true, requires: ['owner', 'contexts', 'modules'],
    means: 'Modules exist and are attributed to it. Existing is not working.',
  },
  VERIFIED: {
    rank: 3, machineReachable: true, requires: ['owner', 'contexts', 'modules', 'controls', 'requirements'],
    means: 'Executable controls enforce it and an approved requirement authorises it. Verified by evidence, never by a module existing.',
  },
  OPERATIONAL: {
    rank: 4, machineReachable: false, requires: ['owner', 'contexts', 'modules', 'controls', 'requirements', 'humanAuthorization'],
    means: 'The institution is running it. This platform cannot reach this state: whether an institution operates something is a fact about people, and a passing test is not evidence of it.',
  },
  DEPRECATED: {
    rank: null, machineReachable: true, requires: ['deprecationRationale'],
    means: 'Deliberately retired, with a reason. Distinct in every way that matters from a capability nobody maintains.',
  },
  BLOCKED: {
    rank: null, machineReachable: true, requires: [],
    means: 'Something it needs is missing or a dependency is broken. Blocked is a finding, not a stage.',
  },
};

// Nine dimensions, never summed. A capability can be fully implemented, fully owned, and verified by
// nothing — and a single maturity score would report that as "mostly mature".
const MATURITY_DIMENSIONS = {
  specificationCoverage: { asks: 'Does an approved requirement authorise this capability?', ifUnknown: 'The capability exists because somebody built it, not because anybody asked for it.' },
  implementationCoverage: { asks: 'Are modules attributed to it?', ifUnknown: 'The capability is a name with nothing behind it.' },
  verificationCoverage: { asks: 'Do executable controls enforce it?', ifUnknown: 'Nothing would fail if the capability stopped working.' },
  ownershipCoverage: { asks: 'Is an accountable institution recorded?', ifUnknown: 'There is nobody to ask when it is questioned.' },
  evidenceQuality: { asks: 'How good is the evidence behind its verification?', ifUnknown: 'The controls are counted and never graded.' },
  governanceStatus: { asks: 'Does a recorded decision govern it?', ifUnknown: 'It is enforced and nobody can say who decided it.' },
  operationalReadiness: { asks: 'Has the institution said it is running this?', ifUnknown: 'Unknown, and it stays unknown — no test can establish it.' },
  dependencyHealth: { asks: 'Do the capabilities it rests on themselves hold?', ifUnknown: 'It can be sound and rest on something that is not.' },
  documentationStatus: { asks: 'Is there a governed document describing it?', ifUnknown: 'An operator has nothing to read.' },
};

const MATURITY_STATES = {
  VERIFIED: { satisfied: true, examined: true, means: 'Evidence exists and resolves.' },
  PARTIALLY_VERIFIED: { satisfied: false, examined: true, means: 'Some of what this dimension needs is present.' },
  UNKNOWN: { satisfied: false, examined: false, means: 'Nothing was supplied that could answer this. Not examined is not failed.' },
  BLOCKED: { satisfied: false, examined: true, means: 'Examined, and what this dimension needs is absent or does not resolve.' },
  NOT_APPLICABLE: { satisfied: true, examined: true, means: 'This dimension does not apply to this kind of capability, and saying so is different from having no answer.' },
};

// The enduring planning vocabulary. Declared here so it can be argued with, and deliberately NOT
// scattered as string literals across the codebase — a vocabulary that lives in twenty files is one
// that can be extended by accident.
const PLATFORM_CAPABILITIES = [
  'Executive Intelligence', 'Governance Assurance', 'Digital Twin', 'Institutional Learning',
  'Architecture Governance', 'Decision Intelligence', 'Evidence Intelligence',
  'Organisational Readiness', 'Mission Intelligence', 'Constitutional Assurance',
];

class PlatformCapabilityRegistry {
  constructor({ clock = () => 0 } = {}) { this._capabilities = new Map(); this._dependencies = []; this._clock = clock; }

  declare(id, {
    name, description, owner = null, contexts = [], modules = [], requirements = [],
    phases = [], controls = [], documentation = null, adr = null,
    humanAuthorization = null, deprecationRationale = null, declaredBy, at = null,
  } = {}) {
    const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
    if (!id) fail('a capability must have an identifier');
    if (!name) fail(`'${id}' must have a name`);
    if (!description) fail(`'${id}' must describe what it is — an identifier and a name say nothing a planner could act on`);
    if (!declaredBy) fail(`'${id}' must name who declared it`);
    // Human authorization is a claim about the institution. This platform records one; it never
    // makes one, so an authorization with no named human is refused rather than assumed.
    if (humanAuthorization && !humanAuthorization.by) {
      fail(`'${id}' carries an operational authorization with nobody named as having given it — whether an institution runs something is a fact about people`);
    }
    const rec = {
      id, name, description, owner,
      contexts: [...contexts], modules: [...modules], requirements: [...requirements],
      phases: [...phases], controls: [...controls], documentation, adr,
      humanAuthorization: humanAuthorization ? { ...humanAuthorization } : null,
      deprecationRationale, declaredBy, at: at ?? this._clock(),
    };
    this._capabilities.set(id, rec);
    return { ...rec };
  }

  // An explicit dependency between capabilities. Never inferred: two capabilities whose modules
  // import each other may or may not depend on each other as capabilities, and only somebody who
  // knows why can say.
  dependOn(source, target, { rationale, owner, justification, lifecycleState = 'active', at = null } = {}) {
    const fail = (msg) => { const e = new Error(msg); e.failClosed = true; throw e; };
    if (!source || !target) fail('a capability dependency must name both a source and a target');
    if (source === target) fail(`'${source}' cannot depend on itself`);
    if (!rationale) fail(`the dependency '${source}' → '${target}' must state WHY — a dependency with no reason cannot be challenged or removed`);
    if (!owner) fail(`the dependency '${source}' → '${target}' must name who is accountable for it`);
    if (!justification) fail(`the dependency '${source}' → '${target}' must carry its architectural justification or the evidence for it`);
    const rec = { source, target, rationale, owner, justification, lifecycleState, at: at ?? this._clock() };
    this._dependencies.push(rec);
    return { ...rec };
  }

  capabilities() { return [...this._capabilities.values()].map((c) => ({ ...c })).sort((a, b) => a.id.localeCompare(b.id)); }
  capability(id) { const c = this._capabilities.get(id); return c ? { ...c } : null; }
  dependencyEdges() { return this._dependencies.map((d) => ({ ...d })); }

  // Cycles, missing targets and concentration. A cycle between capabilities means neither can be
  // planned before the other, which is a planning failure rather than a code one.
  dependencyAnalysis() {
    const known = new Set(this._capabilities.keys());
    const edges = this.dependencyEdges();
    const missingTargets = edges.filter((e) => !known.has(e.target));
    const orphanSources = edges.filter((e) => !known.has(e.source));

    const adjacency = new Map();
    for (const e of edges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, []);
      adjacency.get(e.source).push(e.target);
    }
    const cycles = [];
    const colour = new Map();
    const walk = (node, path) => {
      colour.set(node, 'grey');
      for (const next of adjacency.get(node) || []) {
        if (colour.get(next) === 'grey') {
          cycles.push([...path.slice(path.indexOf(next)), next]);
        } else if (!colour.has(next) && known.has(next)) {
          walk(next, [...path, next]);
        }
      }
      colour.set(node, 'black');
    };
    for (const node of known) if (!colour.has(node)) walk(node, [node]);

    // Concentration: how much of the graph rests on one capability. Reported, not judged — a
    // foundational capability that many depend on is normal and is not a finding by itself.
    const inbound = new Map();
    for (const e of edges) inbound.set(e.target, (inbound.get(e.target) || 0) + 1);
    const heaviest = [...inbound.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0] || null;

    return {
      edges, count: edges.length,
      cycles, hasCycles: cycles.length > 0,
      missingTargets: missingTargets.map((e) => ({ source: e.source, target: e.target })),
      orphanDependencies: orphanSources.map((e) => ({ source: e.source, target: e.target })),
      mostDependedUpon: heaviest ? { capability: heaviest[0], dependents: heaviest[1] } : null,
      concentrationNote: heaviest
        ? `'${heaviest[0]}' is depended on by ${heaviest[1]} capability(ies). Reported rather than judged — a foundational capability with many dependents is normal.`
        : 'no capability has a recorded dependent',
      // Only a cycle or a dependency on something that does not exist is a confirmed violation.
      violations: [
        ...cycles.map((c) => ({ kind: 'dependency-cycle', detail: `${c.join(' → ')} — neither capability can be planned before the other` })),
        ...missingTargets.map((e) => ({ kind: 'missing-target', detail: `'${e.source}' depends on '${e.target}', which is not declared` })),
      ],
    };
  }

  // --- Maturity: nine dimensions, never summed -------------------------------------------------
  maturity(id, { controls = [], requirements = null, now = null } = {}) {
    const t = now ?? this._clock();
    const c = this._capabilities.get(id);
    if (!c) throw new Error('unknown capability: ' + id);
    const contextMap = require('../architecture/context-map');
    const ownershipModule = require('../governance/ownership');
    const fs = require('node:fs');
    const path = require('node:path');
    const ROOT = path.join(__dirname, '..', '..');

    const contexts = new Set(contextMap.ids());
    const owners = new Set(ownershipModule.subsystems().flatMap((s) => {
      const o = ownershipModule.describe(s);
      return [o.operationalOwner, o.approvingAuthority, o.responsibleAuthority, o.dataSteward, o.board && o.board.name].filter(Boolean);
    }));
    const ran = new Set(controls.map((x) => (typeof x === 'string' ? x : x.id)));
    const declared = requirements && typeof requirements.requirements === 'function' ? requirements.requirements() : null;

    const dimension = (dim, state, detail) => ({ dimension: dim, ...MATURITY_DIMENSIONS[dim], state, ...MATURITY_STATES[state], detail });

    const rows = [
      dimension('specificationCoverage',
        !declared ? 'UNKNOWN' : !c.requirements.length ? 'BLOCKED'
          : c.requirements.every((r) => declared.some((d) => d.id === r)) ? 'VERIFIED' : 'PARTIALLY_VERIFIED',
        !declared ? 'no requirement register was supplied'
          : !c.requirements.length ? 'no approved requirement authorises this capability — it exists because somebody built it'
            : `${c.requirements.filter((r) => declared.some((d) => d.id === r)).length} of ${c.requirements.length} declared requirement(s) resolve in the register`),
      dimension('implementationCoverage',
        !c.modules.length ? 'BLOCKED'
          : c.modules.every((m) => fs.existsSync(path.join(ROOT, m))) ? 'VERIFIED' : 'PARTIALLY_VERIFIED',
        !c.modules.length ? 'no module is attributed to this capability'
          : `${c.modules.filter((m) => fs.existsSync(path.join(ROOT, m))).length} of ${c.modules.length} declared module(s) exist on disk`),
      dimension('verificationCoverage',
        !c.controls.length ? 'BLOCKED'
          : c.controls.every((x) => ran.has(x)) ? 'VERIFIED'
            : c.controls.some((x) => ran.has(x)) ? 'PARTIALLY_VERIFIED' : 'BLOCKED',
        !c.controls.length ? 'no executable control enforces this capability — nothing would fail if it stopped working'
          : `${c.controls.filter((x) => ran.has(x)).length} of ${c.controls.length} declared control(s) ran on this build`),
      dimension('ownershipCoverage',
        !c.owner ? 'BLOCKED' : owners.has(c.owner) ? 'VERIFIED' : 'BLOCKED',
        !c.owner ? 'no accountable institution is recorded'
          : owners.has(c.owner) ? `'${c.owner}' holds a role in the accountability record`
            : `'${c.owner}' holds nothing in the accountability record`),
      dimension('evidenceQuality',
        !c.controls.length ? 'UNKNOWN' : 'PARTIALLY_VERIFIED',
        !c.controls.length ? 'no control to grade' : `${c.controls.length} control(s) counted; grading them against evidence quality is not yet wired to this registry`),
      dimension('governanceStatus',
        !c.adr ? 'UNKNOWN' : 'VERIFIED',
        c.adr ? `governed by ${c.adr}` : 'no recorded decision is cited — unknown rather than ungoverned, since not every capability needs its own ADR'),
      // THE DIMENSION NO TEST CAN ANSWER.
      dimension('operationalReadiness',
        c.humanAuthorization && c.humanAuthorization.by ? 'VERIFIED' : 'UNKNOWN',
        c.humanAuthorization && c.humanAuthorization.by
          ? `${c.humanAuthorization.by} recorded that the institution is running this`
          : 'no human has recorded that the institution operates this. UNKNOWN, and it stays unknown — a passing test is not evidence that an institution runs something.'),
      dimension('dependencyHealth',
        (() => {
          const analysis = this.dependencyAnalysis();
          const mine = analysis.edges.filter((e) => e.source === id);
          if (!mine.length) return 'NOT_APPLICABLE';
          if (analysis.violations.some((x) => x.detail.includes(`'${id}'`))) return 'BLOCKED';
          return 'VERIFIED';
        })(),
        `${this.dependencyEdges().filter((e) => e.source === id).length} declared dependency(ies)`),
      dimension('documentationStatus',
        !c.documentation ? 'UNKNOWN' : fs.existsSync(path.join(ROOT, c.documentation)) ? 'VERIFIED' : 'BLOCKED',
        c.documentation ? `${c.documentation}` : 'no governed document is cited'),
    ];

    const blocked = rows.filter((r) => r.state === 'BLOCKED');
    const unknown = rows.filter((r) => r.state === 'UNKNOWN');
    return {
      capability: id, name: c.name,
      dimensions: rows,
      blocked: blocked.map((r) => r.dimension),
      unknown: unknown.map((r) => r.dimension),
      verified: rows.filter((r) => r.state === 'VERIFIED').map((r) => r.dimension),
      // Counts per state. Never a single maturity score: a capability can be fully implemented,
      // fully owned and verified by nothing, and one number would call that "mostly mature".
      counts: Object.fromEntries(Object.keys(MATURITY_STATES).map((s) => [s, rows.filter((r) => r.state === s).length])),
      scored: false,
      basis: `${rows.filter((r) => r.state === 'VERIFIED').length} verified, ${blocked.length} blocked, ${unknown.length} unknown of ${rows.length} dimensions. Reported per dimension, never summed.`,
      now: t,
    };
  }

  // --- Lifecycle: evidence-backed, and OPERATIONAL is unreachable ------------------------------
  lifecycle(id, { controls = [], requirements = null, now = null } = {}) {
    const t = now ?? this._clock();
    const c = this._capabilities.get(id);
    if (!c) throw new Error('unknown capability: ' + id);
    const m = this.maturity(id, { controls, requirements, now: t });
    const has = (dim) => m.dimensions.find((d) => d.dimension === dim).state === 'VERIFIED';

    const deps = this.dependencyAnalysis();
    const blockedByDependency = deps.violations.some((x) => x.detail.includes(`'${id}'`));

    let state;
    if (c.deprecationRationale) state = 'DEPRECATED';
    else if (blockedByDependency) state = 'BLOCKED';
    else if (has('specificationCoverage') && has('implementationCoverage') && has('verificationCoverage') && has('ownershipCoverage')) state = 'VERIFIED';
    else if (c.modules.length && has('ownershipCoverage')) state = 'IMPLEMENTING';
    else if (c.owner && c.contexts.length) state = 'DEFINED';
    else if (c.name) state = 'PROPOSED';
    else state = 'UNKNOWN';

    // OPERATIONAL is never derived. It requires a recorded human statement that the institution runs
    // this, and there is no branch above that can produce it — which is the point.
    const operational = !!(c.humanAuthorization && c.humanAuthorization.by);
    return {
      capability: id, state: operational && state === 'VERIFIED' ? 'OPERATIONAL' : state,
      ...CAPABILITY_LIFECYCLE[operational && state === 'VERIFIED' ? 'OPERATIONAL' : state],
      derivedState: state,
      humanAuthorization: c.humanAuthorization,
      // Stated on every row so it cannot be read past.
      operationalRequiresHuman: true,
      reason: c.deprecationRationale ? `deliberately retired: ${c.deprecationRationale}`
        : blockedByDependency ? `blocked by a dependency violation: ${deps.violations.filter((x) => x.detail.includes(`'${id}'`)).map((x) => x.detail).join('; ')}`
          : state === 'VERIFIED' && !operational
            ? 'every verification dimension holds. NOT operational: whether the institution runs this is a fact about people, and no test can establish it.'
            : `blocked or unmet dimensions: ${[...m.blocked, ...m.unknown].join(', ') || 'none'}`,
      now: t,
    };
  }

  // --- The two synchronized views (Part 10's central requirement) -------------------------------
  //
  // Phases remain the historical delivery mechanism. Capabilities become the planning unit. Neither
  // replaces the other, and the report carries both so they cannot drift apart.
  roadmap({ controls = [], requirements = null, now = null } = {}) {
    const t = now ?? this._clock();
    const migration = require('../migration/roadmap');
    const rows = this.capabilities().map((c) => ({
      ...c,
      maturity: this.maturity(c.id, { controls, requirements, now: t }),
      lifecycle: this.lifecycle(c.id, { controls, requirements, now: t }),
      dependsOn: this.dependencyEdges().filter((e) => e.source === c.id).map((e) => e.target),
      dependents: this.dependencyEdges().filter((e) => e.target === c.id).map((e) => e.source),
    }));
    const deps = this.dependencyAnalysis();
    const declared = requirements && typeof requirements.requirements === 'function' ? requirements.requirements() : null;

    // Requirement → capability, and back. Both directions, because each finds a different problem.
    const mapped = new Set(rows.flatMap((r) => r.requirements));
    const requirementsWithoutCapability = declared ? declared.filter((d) => !mapped.has(d.id)).map((d) => d.id) : null;
    const capabilitiesWithoutRequirement = rows.filter((r) => !r.requirements.length).map((r) => r.id);
    const capabilitiesWithoutImplementation = rows.filter((r) => !r.modules.length).map((r) => r.id);
    const capabilitiesWithoutOwner = rows.filter((r) => !r.owner).map((r) => r.id);
    // A requirement claimed by more than one capability cannot have one implementation
    // responsibility, which is what the Phase 18.1 invariant is about.
    const claimCounts = new Map();
    for (const r of rows) for (const req of r.requirements) claimCounts.set(req, [...(claimCounts.get(req) || []), r.id]);
    const conflictingCapabilityClaims = [...claimCounts.entries()].filter(([, v]) => v.length > 1)
      .map(([requirement, capabilities]) => ({ requirement, capabilities }));

    return {
      // View A — historical delivery. Preserved untouched.
      phaseView: {
        items: migration.ids().length, waves: Object.keys(migration.waves()).length,
        progress: migration.progress(),
        note: 'The phase-centric delivery history, unchanged. Phases remain how work was delivered; capabilities are how it is planned.',
      },
      // View B — capability planning.
      capabilityView: {
        capabilities: rows, count: rows.length,
        vocabulary: PLATFORM_CAPABILITIES,
        lifecycleStates: Object.entries(CAPABILITY_LIFECYCLE).map(([state, s]) => ({ state, ...s })),
        maturityDimensions: Object.entries(MATURITY_DIMENSIONS).map(([dimension, d]) => ({ dimension, ...d })),
        maturityStates: Object.entries(MATURITY_STATES).map(([state, s]) => ({ state, ...s })),
        dependencies: deps,
      },
      // Findings, each separated from the others rather than summed.
      capabilitiesWithoutOwner,
      capabilitiesWithoutRequirement,
      capabilitiesWithoutImplementation,
      requirementsWithoutCapability,
      conflictingCapabilityClaims,
      dependencyViolations: deps.violations,
      byLifecycle: Object.fromEntries(Object.keys(CAPABILITY_LIFECYCLE).map((s) => [s, rows.filter((r) => r.lifecycle.state === s).map((r) => r.id)])),
      // OPERATIONAL is unreachable without a recorded human statement, and the report says how many.
      operational: rows.filter((r) => r.lifecycle.state === 'OPERATIONAL').map((r) => r.id),
      awaitingHumanAuthorization: rows.filter((r) => r.derivedState !== 'OPERATIONAL' && r.lifecycle.derivedState === 'VERIFIED').map((r) => r.id),
      measurable: rows.length > 0,
      viewsSynchronized: true,
      basis: rows.length
        ? `${rows.length} platform capability(ies) across ${new Set(rows.flatMap((r) => r.contexts)).size} bounded context(s). ${capabilitiesWithoutOwner.length} without an owner, ${capabilitiesWithoutRequirement.length} with no authorising requirement, ${deps.violations.length} dependency violation(s). The phase view is preserved alongside and reports ${migration.ids().length} transition item(s).`
        : 'No platform capability is declared. The capability view is empty, which is not the same as the platform having no capabilities — it is a platform that has not declared them.',
      now: t, declarative: true, informationalOnly: true, authorizes: false,
      note: 'Two axes, one module. CAPABILITY_MAP describes the justice system\'s business capabilities; this describes the platform\'s engineering capabilities. They are disjoint sets answering different questions for different audiences, and ADR-0013 records why that is not duplication. A capability does not become VERIFIED because a module exists, and cannot become OPERATIONAL at all without a recorded human statement that the institution runs it.',
    };
  }
}

module.exports = {
  CAPABILITY_MAP, capabilityMap, dependencies, ownership, heatMap,
  CHANGE_KINDS, CapabilityDeclarationHistory, seedDeclarationHistory,
  CAPABILITY_LIFECYCLE, MATURITY_DIMENSIONS, MATURITY_STATES, PLATFORM_CAPABILITIES,
  PlatformCapabilityRegistry,
};
