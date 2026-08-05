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

module.exports = {
  CAPABILITY_MAP, capabilityMap, dependencies, ownership, heatMap,
  CHANGE_KINDS, CapabilityDeclarationHistory, seedDeclarationHistory,
};
