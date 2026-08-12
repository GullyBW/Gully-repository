'use strict';
// Institutional Resilience (Phase 13, Part 13) and the phase's new global invariant. Extends the
// governance-oversight bounded context.
//
//   NO CRITICAL CAPABILITY MAY DEPEND ON A SINGLE PERSON, A SINGLE PROCESS, A SINGLE DOCUMENT,
//   OR A SINGLE SYSTEM.
//
// Two things make this hard to implement honestly, and both are traps this module is built around.
//
// FIRST: the platform DERIVES a deputy for every role and a replica for every region, so counting
// names finds two of everything and reports perfect resilience. The invariant therefore asks for a
// VALIDATED alternative — one the platform has evidence could actually take over. A derived deputy
// who has never acted, a region that has never served a failover, a runbook nobody has followed:
// each is a name, not an alternative.
//
// SECOND: it would be easy to make every dimension pass by defining "critical capability" narrowly.
// So the capabilities are the constitutional ones the platform exists to deliver, named explicitly,
// and each declares what its loss costs — which is the sentence that makes narrowing them visible.
const ownership = require('./ownership');
const telemetry = require('../observability/telemetry');
const multiRegion = require('../twin2/multi-region');
const documentation = require('../architecture/documentation-assurance');

// The kinds of single dependency. Each states how an alternative is VALIDATED, because that is the
// whole difficulty: a second name is not a second option. Each also names the control that WOULD
// FAIL if the dependency broke (Phase 14, Part 6) — a dependency nothing would detect is a worse
// dependency than one something would, and `detectedBy: null` is stated rather than left implied.
//
// Phase 14, Part 11 added the five kinds below the rule: data, knowledge, facility, legal-authority
// and governance. The Phase 13 eight were an infrastructure engineer's list, and the institution has
// been depending on the other five all along without any of them being assessed.
const DEPENDENCY_KINDS = {
  person: { question: 'Could anybody else discharge this role today?', validatedBy: 'The alternative is available, active, currently trained and has rehearsed the role.', detectedBy: 'APP-FIT-KNOWLEDGE-CONTINUITY' },
  team: { question: 'Does more than one team hold this capability?', validatedBy: 'A second accountable team is recorded for the capability, not merely a second individual inside one team.', detectedBy: 'APP-FIT-RACI-GOVERNANCE' },
  document: { question: 'Is the procedure recorded anywhere it can be followed from?', validatedBy: 'A governed operational document exists, resolves against the implementation, and carries prerequisites, permissions, rollback and escalation.', detectedBy: 'APP-FIT-DOCUMENTATION-ASSURANCE' },
  process: { question: 'Is there a way to do this if the normal process is unavailable?', validatedBy: 'A declared fallback path exists and terminates at a named authority.', detectedBy: 'APP-FIT-GOVERNANCE-OWNERSHIP' },
  service: { question: 'Would losing one service stop this capability?', validatedBy: 'The capability survives the loss of any single service in the declared topology.', detectedBy: 'APP-FIT-CHAOS-DETECT-RECOVER' },
  region: { question: 'Would losing one region stop this capability?', validatedBy: 'The capability still serves — read-only counts — with any single region lost.', detectedBy: 'APP-FIT-MULTI-REGION' },
  supplier: { question: 'Does this rest on one supplier?', validatedBy: 'More than one approved supplier can provide it, or the platform has no runtime dependency on any.', detectedBy: 'APP-FIT-SUPPLY-CHAIN-GOVERNANCE' },
  // Detected by the escalation workflow: an escalation raised and never acknowledged is precisely
  // what a failed communication channel looks like from inside the platform.
  'communication-channel': { question: 'If the usual channel is down, can people still be reached?', validatedBy: 'The escalation path names more than one way to reach the accountable authority.', detectedBy: 'APP-FIT-GOVERNANCE-CONTINUITY' },
  data: { question: 'Would losing one dataset stop this capability, with no way to reconstruct it?', validatedBy: 'The data is replicated across zones, or derivable from an append-only source the capability also holds.', detectedBy: 'APP-FIT-DATA-GOVERNANCE' },
  knowledge: { question: 'Does the know-how exist anywhere other than in one person\'s head?', validatedBy: 'A second person is trained and has rehearsed, AND the procedure is written down. Either alone is a name, not knowledge.', detectedBy: 'APP-FIT-GOVERNANCE-REHEARSALS' },
  // Detected only through the proxy: APP-FIT-MULTI-REGION would fail if the region backing a site
  // were lost. It would not notice a shared power feed or a shared landlord, and the facility
  // assessment says so on every row it produces.
  facility: { question: 'Would losing one physical site stop this capability?', validatedBy: 'More than one sovereign site can host it. NOTE: the platform models regions, not buildings — this is a proxy and is reported as one.', detectedBy: 'APP-FIT-MULTI-REGION' },
  'legal-authority': { question: 'Does this rest on a single legal instrument or mandate?', validatedBy: 'More than one instrument authorises it, or the mandate is constitutional and cannot be withdrawn by ordinary amendment.', detectedBy: 'APP-FIT-LEGISLATIVE-IMPACT' },
  governance: { question: 'If one board or authority is unavailable, can a decision still be taken?', validatedBy: 'A second authority may approve, and the escalation terminates at a board that is not the same one.', detectedBy: 'APP-FIT-RACI-GOVERNANCE' },
};

// PART 11: the eleven categories the invariant is now evaluated across. Categories group the kinds
// above rather than replacing them — the kinds are what can actually be assessed, and the categories
// are what a board asks about. A capability must have a validated alternative in EVERY category.
const DEPENDENCY_CATEGORIES = {
  people: { kinds: ['person', 'team'], asks: 'Can the people be replaced?' },
  process: { kinds: ['process'], asks: 'Is there another way to do it?' },
  technology: { kinds: ['service'], asks: 'Does one system carry it?' },
  data: { kinds: ['data'], asks: 'Can the data be reconstructed?' },
  knowledge: { kinds: ['knowledge'], asks: 'Does anybody else know how?' },
  documentation: { kinds: ['document'], asks: 'Is it written down anywhere followable?' },
  facilities: { kinds: ['facility', 'region'], asks: 'Does one site carry it?' },
  communications: { kinds: ['communication-channel'], asks: 'Can people still be reached?' },
  suppliers: { kinds: ['supplier'], asks: 'Does one supplier carry it?' },
  'legal-authority': { kinds: ['legal-authority'], asks: 'Does one instrument authorise it?' },
  governance: { kinds: ['governance'], asks: 'Can a decision still be taken?' },
};

function categoryOfKind(kind) { return Object.keys(DEPENDENCY_CATEGORIES).find((c) => DEPENDENCY_CATEGORIES[c].kinds.includes(kind)) || null; }

// --- Dependency intelligence (Phase 15, Part 2) ---------------------------------------------------
//
// Part 2 asks for a STANDARDIZED type on every dependency. The temptation is to build a third
// taxonomy beside the thirteen kinds and the eleven categories, which would be the duplicate
// framework the phase forbids and would immediately drift from both.
//
// So the standardized types are a LABEL on the existing kinds, not a parallel model. The kinds remain
// what can actually be assessed; the categories remain what a board asks about; the types are the
// vocabulary an external reviewer expects to see. One taxonomy, three views of it.
//
// Each type declares what MAKES it fail, because the ten differ mainly in how they break: a technical
// dependency fails suddenly and visibly, a legal one fails silently on a date nobody diarised.
const DEPENDENCY_TYPES = {
  technical: { failsBy: 'A component stops working. Sudden, visible, and the one every runbook covers.', detectedIn: 'seconds to minutes' },
  operational: { failsBy: 'A process becomes unavailable or unusable, usually because something it rests on did.', detectedIn: 'minutes to hours' },
  organizational: { failsBy: 'A person leaves, is unavailable, or was never competent for the role. Fails quietly and is discovered when needed.', detectedIn: 'at the moment of need' },
  legal: { failsBy: 'An instrument is repealed, amended, or lapses on a date nobody diarised. Fails silently and completely.', detectedIn: 'at an inspection, or in court' },
  contractual: { failsBy: 'A supplier withdraws, is acquired, or does not renew. Usually with notice that somebody did not act on.', detectedIn: 'at renewal' },
  informational: { failsBy: 'Data is lost, corrupted, or was never written down. Loss is often unrecoverable rather than temporary.', detectedIn: 'when somebody looks for it' },
  governance: { failsBy: 'A board cannot convene, or an authority is vacant. The decision waits rather than fails.', detectedIn: 'at the next decision that needs it' },
  infrastructure: { failsBy: 'A region, zone or platform service is lost. Infrequent, large, and rehearsed.', detectedIn: 'seconds to minutes' },
  communications: { failsBy: 'The channel is down exactly when it is needed, often taken out by the same incident.', detectedIn: 'when an escalation goes unacknowledged' },
  facilities: { failsBy: 'A physical site becomes unusable. The platform assesses this by proxy and cannot see a building.', detectedIn: 'immediately, by somebody standing outside it' },
};

// Which standardized type each assessable kind is. Declared, so the mapping is reviewable in one place.
const KIND_TYPE = {
  person: 'organizational', team: 'organizational', knowledge: 'organizational',
  process: 'operational', service: 'technical', region: 'infrastructure',
  supplier: 'contractual', 'communication-channel': 'communications',
  document: 'informational', data: 'informational',
  facility: 'facilities', 'legal-authority': 'legal', governance: 'governance',
};
function typeOfKind(kind) { return KIND_TYPE[kind] || null; }

// The capabilities that must not rest on a single anything. Constitutional ones first: these are the
// things the platform exists to do, and their loss is not an inconvenience.
const CRITICAL_CAPABILITIES = {
  'anonymous-reporting': {
    title: 'A citizen can file a report anonymously', constitutional: true,
    lossMeans: 'A person who decided today to report corruption cannot, and may not decide again.',
    services: ['intake-api', 'persistence-ind', 'event-store-ind'], subsystems: ['intake'], contexts: ['intake'],
    document: 'operations/runbook.md',
  },
  'evidence-custody': {
    title: 'Evidence retains an unbroken chain of custody', constitutional: true,
    lossMeans: 'Evidence a person risked something to provide cannot be used, so the risk bought nothing.',
    services: ['evidence-store', 'custody-ledger', 'kms'], subsystems: ['custody'], contexts: ['custody'],
    document: 'operations/runbook.md',
  },
  'governance-decision-recording': {
    title: 'Every governance decision is attributable to a named human', constitutional: true,
    lossMeans: 'A decision affecting a person exists with nobody answerable for it, so it cannot be challenged.',
    services: ['governance-ledger', 'persistence-jud'], subsystems: ['governance-oversight'], contexts: ['governance-oversight'],
    document: 'operations/runbook.md',
  },
  'case-investigation': {
    title: 'A report is investigated to an outcome', constitutional: false,
    // `event-store-exec` was missing from this list until Phase 14. The data-resilience check added
    // in Part 11 reported the capability as holding an unreconstructible store of record, which was
    // false: the case aggregate is event-sourced (`src/eventsourcing/case-aggregate.js`) and
    // `case-service` declares a dependency on `event-store-exec` in the topology. The declaration
    // was incomplete, not the architecture — corrected here rather than by relaxing the check.
    lossMeans: 'Reports accumulate without progressing, and the people who filed them are told nothing.',
    services: ['case-service', 'event-store-exec', 'persistence-exec'], subsystems: ['investigation'], contexts: ['investigation'],
    document: 'operations/runbook.md',
  },
  'service-recovery': {
    title: 'The platform can be recovered after a failure', constitutional: false,
    // Same correction: recovery rests on the append-only event stores as much as on the stores of
    // record, because they are what makes a store reconstructible rather than merely restorable.
    lossMeans: 'An outage becomes permanent because nobody present knows how to end it.',
    services: ['persistence-ind', 'persistence-exec', 'persistence-jud', 'event-store-ind', 'event-store-exec', 'governance-ledger'],
    subsystems: ['resilience', 'infrastructure'], contexts: ['resilience'],
    document: 'operations/runbook.md',
  },
};

const DAY = 24 * 3600_000;

// Would this capability survive losing any single service it depends on? Answered from the declared
// topology by removing each service in turn — not by counting them, because three services in a
// chain is a chain, not redundancy.
function serviceResilience(capability) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const results = spec.services.map((svc) => {
    const propagation = telemetry.failurePropagation([svc]);
    const impacted = new Set(propagation.impacted);
    const stillServes = spec.services.some((s) => !impacted.has(s));
    return { service: svc, survives: stillServes, impacted: propagation.impacted, reason: stillServes ? `other services of this capability survive losing ${svc}` : `losing ${svc} takes out every service this capability depends on` };
  });
  const fatal = results.filter((r) => !r.survives);
  return {
    kind: 'service', capability, services: spec.services, checks: results,
    singleDependency: fatal.length > 0,
    fatalSingleServices: fatal.map((r) => r.service),
    reason: fatal.length ? `the capability stops if any of these is lost: ${fatal.map((r) => r.service).join(', ')}` : 'no single service loss stops this capability',
  };
}

// Would it survive losing any single region? Read-only counts as surviving; unavailable does not.
function regionResilience(capability, { regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const contexts = CRITICAL_CAPABILITIES[capability].contexts;
  const checks = regions.map((region) => {
    const failover = multiRegion.validateFailover({ regions, failed: [region] });
    const lost = contexts.filter((c) => failover.unavailable.includes(c));
    return { region, survives: lost.length === 0, unavailableContexts: lost, reason: lost.length ? `losing ${region} makes ${lost.join(', ')} unavailable` : `the capability still serves without ${region}` };
  });
  const fatal = checks.filter((c) => !c.survives);
  return {
    kind: 'region', capability, regions, checks,
    singleDependency: fatal.length > 0,
    fatalSingleRegions: fatal.map((c) => c.region),
    reason: fatal.length ? `the capability stops if any of these regions is lost: ${fatal.map((c) => c.region).join(', ')}` : 'no single region loss stops this capability',
  };
}

// Is there a second person who could actually do this — validated, not merely named?
function personResilience(capability, { continuity = null } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  if (!continuity) {
    return { kind: 'person', capability, singleDependency: true, unknown: true, reason: 'no knowledge-continuity assessment was supplied — whether anybody else could do this is unknown, and unknown is not resilient' };
  }
  const relevant = continuity.roles.filter((r) => spec.subsystems.includes(r.subsystem));
  const single = relevant.filter((r) => r.singlePersonDependency);
  return {
    kind: 'person', capability, roles: relevant.length,
    singleDependency: single.length > 0,
    affectedRoles: single.map((r) => `${r.subsystem}/${r.role}`),
    minimumBusFactor: relevant.length ? Math.min(...relevant.map((r) => r.busFactor)) : null,
    reason: single.length ? `${single.length} role(s) have no validated alternative: ${single.map((r) => `${r.subsystem}/${r.role}`).join(', ')}` : 'every role has a validated alternative',
  };
}

// Is the procedure written down somewhere followable?
function documentResilience(capability, { controls = [] } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const verified = documentation.verifyDocument(spec.document, { controls });
  const procedures = documentation.verifyProcedures({});
  const proc = procedures.procedures.find((p) => p.document === spec.document) || null;
  const followable = !verified.missing && verified.sound && !!proc && proc.complete;
  return {
    kind: 'document', capability, document: spec.document,
    resolves: !verified.missing && verified.sound,
    followable, singleDependency: !followable,
    // Deliberately strict: a document that exists but names routes that 404, or omits rollback, is
    // not somewhere a procedure can be followed from at 03:00.
    reason: verified.missing ? 'the governing document does not exist'
      : !verified.sound ? `the governing document makes ${verified.unresolved.length} claim(s) that do not resolve`
        : !proc ? 'the governing document is not classified as an operational procedure'
          : !proc.complete ? `the procedure is missing: ${proc.absent.join(', ')}`
            : 'the procedure is recorded, resolves, and carries what an operator needs',
  };
}

// Team, process, supplier and channel. These rest on declared structure rather than telemetry, and
// each says so — an assessment resting on a declaration is weaker than one resting on a measurement.
function structuralResilience(capability) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const teams = new Set();
  const channels = new Set();
  for (const s of spec.subsystems) {
    try {
      const o = ownership.describe(s);
      teams.add(o.operationalOwner); teams.add(o.responsibleAuthority);
      for (const step of o.escalation || []) channels.add(step);
    } catch (_) { /* not a governed subsystem */ }
  }
  const supplierIndependent = true;   // zero runtime dependencies: no supplier can withdraw one
  return [
    {
      kind: 'team', capability, teams: [...teams].sort(),
      singleDependency: teams.size < 2,
      basis: 'declared ownership record',
      reason: teams.size < 2 ? 'one team holds this capability' : `${teams.size} accountable teams are recorded`,
    },
    {
      kind: 'process', capability,
      singleDependency: !spec.subsystems.every((s) => { try { return (ownership.describe(s).escalation || []).length >= 2; } catch (_) { return false; } }),
      basis: 'declared escalation path',
      reason: 'a fallback path exists when the escalation chain has more than one step terminating at a board',
    },
    {
      kind: 'supplier', capability, singleDependency: !supplierIndependent,
      basis: 'the platform has zero runtime dependencies, so no supplier can withdraw one',
      reason: 'no runtime supplier dependency exists to be single',
    },
    {
      kind: 'communication-channel', capability, channels: [...channels].sort(),
      singleDependency: channels.size < 2,
      basis: 'declared escalation path',
      reason: channels.size < 2 ? 'only one way to reach the accountable authority is recorded' : `${channels.size} escalation steps are recorded`,
    },
  ];
}

// --- The five dimensions Part 11 added -------------------------------------------------------------
//
// Each is assessed from something the platform actually records. Where it cannot be — facilities are
// the honest example, because the platform models regions and has never seen a building — the
// assessment says what it is a proxy for rather than reporting a number it cannot support.

// Data: could the capability's data be reconstructed if one store were lost? Derived from the zone
// topology and from whether an append-only event store sits alongside the store of record.
function dataResilience(capability) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const stores = spec.services.filter((s) => /^persistence-/.test(s));
  const eventStores = spec.services.filter((s) => /^event-store-/.test(s));
  const ledgers = spec.services.filter((s) => /ledger$/.test(s));
  // An append-only event store or a hash-chained ledger means the state of record can be rebuilt.
  const reconstructible = eventStores.length > 0 || ledgers.length > 0;
  return {
    kind: 'data', capability, stores, eventStores, ledgers,
    singleDependency: stores.length > 0 && !reconstructible,
    basis: 'declared service topology',
    reason: !stores.length ? 'this capability holds no store of record of its own'
      : reconstructible ? `the store of record is reconstructible from ${[...eventStores, ...ledgers].join(', ')}`
        : `${stores.join(', ')} holds the only copy — if it is lost the data is gone, not merely unavailable`,
  };
}

// Knowledge: does the know-how exist outside one head? BOTH a trained, rehearsed second person AND a
// followable document. Either one alone is what the platform has been counting as continuity, and
// neither alone is knowledge: a document nobody has followed is a guess, and a person who has
// rehearsed but written nothing down takes it with them.
function knowledgeResilience(capability, { continuity = null, controls = [] } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const person = personResilience(capability, { continuity });
  const doc = documentResilience(capability, { controls });
  const held = !person.singleDependency && !doc.singleDependency;
  return {
    kind: 'knowledge', capability,
    peopleValidated: !person.singleDependency, documentValidated: doc.followable,
    singleDependency: !held,
    basis: 'the ownership registers and the governed procedure, together',
    reason: held ? 'a trained, rehearsed alternative exists and the procedure is written down somewhere followable'
      : !person.singleDependency ? 'people could take over, and nothing is written down for them to take over from'
        : !doc.singleDependency ? 'the procedure is written down and nobody is currently validated to follow it'
          : 'neither a validated alternative person nor a followable procedure exists — this capability lives in somebody\'s head',
    contexts: spec.contexts,
  };
}

// Facilities. Stated plainly as a proxy: this platform models regions, not sites. A region is a
// reasonable stand-in for a site and it is not the same thing, and reporting a facilities assessment
// as though the platform could see buildings would be the fabrication the requirements forbid.
function facilityResilience(capability, { regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const sovereign = regions.filter((r) => multiRegion.REGIONS[r] && multiRegion.REGIONS[r].sovereign);
  return {
    kind: 'facility', capability, sites: sovereign, siteCount: sovereign.length,
    singleDependency: sovereign.length < 2,
    basis: 'sovereign regions, used as a PROXY for physical sites',
    proxy: true,
    reason: sovereign.length < 2
      ? `only ${sovereign.length} sovereign site(s) are declared — a single site failure would be total`
      : `${sovereign.length} sovereign sites are declared. This is a proxy: the platform models regions and has never seen a building, so a shared power feed or a shared landlord is invisible here.`,
  };
}

// Legal authority: does the capability rest on one instrument? A constitutional mandate counts as
// resilient in a way an ordinary regulation does not, because it cannot be withdrawn by an ordinary
// amendment — that is a real difference and it is declared, not computed.
function legalAuthorityResilience(capability, { instruments = null } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const list = instruments || [];
  const relevant = list.filter((i) => (i.contexts || []).some((c) => spec.contexts.includes(c)));
  if (spec.constitutional) {
    return {
      kind: 'legal-authority', capability, instruments: relevant.map((i) => i.id), constitutional: true,
      singleDependency: false, basis: 'declared constitutional mandate',
      reason: 'the mandate is constitutional — it does not rest on a single ordinary instrument that could be amended away',
    };
  }
  return {
    kind: 'legal-authority', capability, instruments: relevant.map((i) => i.id), constitutional: false,
    singleDependency: relevant.length < 2,
    basis: relevant.length ? 'the legal instrument registry supplied by the caller' : 'no instrument registry was supplied',
    reason: !relevant.length
      ? 'no legal instrument register was supplied, so what authorises this capability is UNKNOWN — and unknown is not resilient'
      : relevant.length < 2 ? `rests on a single instrument: ${relevant.map((i) => i.id).join(', ')}`
        : `${relevant.length} instruments authorise it`,
  };
}

// Governance: if one authority is unavailable, can a decision still be taken? The separation of
// duties the ownership model already enforces is what makes this answerable — responsible and
// approving authorities are structurally different people.
function governanceResilience(capability) {
  const spec = CRITICAL_CAPABILITIES[capability];
  const authorities = new Set();
  const boards = new Set();
  for (const s of spec.subsystems) {
    try {
      const o = ownership.describe(s);
      authorities.add(o.responsibleAuthority); authorities.add(o.approvingAuthority);
      boards.add(o.governanceBoard);
    } catch (_) { /* not a governed subsystem */ }
  }
  return {
    kind: 'governance', capability, authorities: [...authorities].sort(), boards: [...boards].sort(),
    singleDependency: authorities.size < 2,
    basis: 'declared accountability record and its separation of duties',
    reason: authorities.size < 2
      ? 'one authority both holds and approves this capability, so its absence stops every decision about it'
      : `${authorities.size} distinct authorities are recorded, and the responsible one may not also be the approving one`,
  };
}

// THE GLOBAL INVARIANT, evaluated across every dimension for every critical capability.
function evaluate({ continuity = null, controls = [], regions = ['bw-central', 'bw-south', 'bw-north'], instruments = null } = {}) {
  const capabilities = Object.keys(CRITICAL_CAPABILITIES).sort().map((id) => {
    const spec = CRITICAL_CAPABILITIES[id];
    const findings = [
      personResilience(id, { continuity }),
      ...structuralResilience(id),
      documentResilience(id, { controls }),
      serviceResilience(id),
      regionResilience(id, { regions }),
      // Part 11.
      dataResilience(id),
      knowledgeResilience(id, { continuity, controls }),
      facilityResilience(id, { regions }),
      legalAuthorityResilience(id, { instruments }),
      governanceResilience(id),
    ];
    const singles = findings.filter((f) => f.singleDependency);
    // Part 11: rolled up to the eleven categories a board actually asks about. A category is
    // validated only when every kind inside it is — a capability with a second team and no second
    // person does not have "people" covered.
    const categories = Object.entries(DEPENDENCY_CATEGORIES).map(([category, spec2]) => {
      const inCategory = findings.filter((f) => spec2.kinds.includes(f.kind));
      const failing = inCategory.filter((f) => f.singleDependency);
      return {
        category, asks: spec2.asks, kinds: spec2.kinds,
        assessed: inCategory.length, validated: failing.length === 0 && inCategory.length > 0,
        // A category nothing assessed is UNVALIDATED, not validated — the same rule as everywhere.
        unassessed: inCategory.length === 0,
        failingKinds: failing.map((f) => f.kind),
        reason: !inCategory.length ? 'nothing assessed this category, so whether an alternative exists is unknown'
          : failing.length ? `no validated alternative for: ${failing.map((f) => f.kind).join(', ')}`
            : 'a validated alternative exists for every kind in this category',
      };
    });
    const unvalidatedCategories = categories.filter((c) => !c.validated);
    return {
      capability: id, title: spec.title, constitutional: spec.constitutional, lossMeans: spec.lossMeans,
      findings, singleDependencies: singles.map((f) => f.kind),
      categories, unvalidatedCategories: unvalidatedCategories.map((c) => c.category),
      // Weakest link: a capability with a validated alternative on ten dimensions and none on the
      // eleventh depends on a single thing.
      resilient: singles.length === 0,
      categoriesValidated: unvalidatedCategories.length === 0,
      reason: singles.length ? `depends on a single ${singles.map((f) => f.kind).join(', a single ')}` : 'has a validated alternative on every dimension',
    };
  });
  const violations = capabilities.filter((c) => !c.resilient);
  const constitutional = violations.filter((c) => c.constitutional);
  return {
    invariant: 'No critical capability may depend on a single person, a single process, a single document, or a single system.',
    capabilities, dependencyKinds: Object.entries(DEPENDENCY_KINDS).map(([kind, k]) => ({ kind, ...k })),
    dependencyCategories: Object.entries(DEPENDENCY_CATEGORIES).map(([category, c]) => ({ category, ...c })),
    // Part 11: the taxonomy view — which categories are unvalidated, across the whole estate.
    categoryCoverage: Object.keys(DEPENDENCY_CATEGORIES).map((category) => {
      const rows = capabilities.map((c) => c.categories.find((x) => x.category === category));
      return {
        category, asks: DEPENDENCY_CATEGORIES[category].asks,
        validatedFor: rows.filter((r) => r.validated).length, of: rows.length,
        failingCapabilities: capabilities.filter((c) => c.unvalidatedCategories.includes(category)).map((c) => c.capability),
      };
    }),
    violations: violations.map((c) => ({ capability: c.capability, constitutional: c.constitutional, singleDependencies: c.singleDependencies, unvalidatedCategories: c.unvalidatedCategories, lossMeans: c.lossMeans })),
    violationCount: violations.length,
    constitutionalViolations: constitutional.map((c) => c.capability),
    holds: violations.length === 0,
    // Part 13: violations BLOCK institutional readiness until mitigated or explicitly accepted.
    blocksInstitutionalReadiness: violations.length > 0,
    failClosed: true, authorizes: false,
    note: 'An alternative counts only if the platform has evidence it could actually take over. This platform derives a deputy for every role and a replica for every region, so counting names would report perfect resilience everywhere and mean nothing.',
  };
}

// PART 2: the dependency intelligence report. Every finding carries its kind, its category and its
// standardized type, so the same assessment answers an engineer's question, a board's question and an
// external reviewer's question without three models drifting apart.
function dependencyIntelligence(evaluation) {
  const rows = [];
  for (const c of evaluation.capabilities) {
    for (const f of c.findings) {
      rows.push({
        capability: c.capability, constitutional: c.constitutional,
        kind: f.kind, category: categoryOfKind(f.kind), type: typeOfKind(f.kind),
        singleDependency: !!f.singleDependency,
        detectedBy: (DEPENDENCY_KINDS[f.kind] || {}).detectedBy || null,
        basis: f.basis || 'derived from the declared topology',
        reason: f.reason,
      });
    }
  }
  const byType = Object.keys(DEPENDENCY_TYPES).map((type) => {
    const inType = rows.filter((r) => r.type === type);
    const open = inType.filter((r) => r.singleDependency);
    return {
      type, ...DEPENDENCY_TYPES[type],
      assessed: inType.length, singleDependencies: open.length,
      kinds: [...new Set(inType.map((r) => r.kind))].sort(),
      capabilities: [...new Set(open.map((r) => r.capability))].sort(),
      // A type nothing assesses is a blind spot, not a clean bill.
      blindSpot: inType.length === 0,
    };
  });
  const unmapped = [...new Set(rows.filter((r) => !r.type).map((r) => r.kind))];
  return {
    dependencies: rows, count: rows.length,
    types: Object.entries(DEPENDENCY_TYPES).map(([type, t]) => ({ type, ...t })),
    byType,
    blindSpots: byType.filter((t) => t.blindSpot).map((t) => t.type),
    unmappedKinds: unmapped,
    open: rows.filter((r) => r.singleDependency).length,
    // The type most often open across the estate. Says where the institution is structurally weak
    // rather than which capability happens to be worst.
    weakestType: byType.filter((t) => t.assessed).sort((a, b) => b.singleDependencies - a.singleDependencies || a.type.localeCompare(b.type))[0] || null,
    informationalOnly: true, authorizes: false,
    note: 'One taxonomy, three views: the kind is what can be assessed, the category is what a board asks about, and the type is the vocabulary an external reviewer expects. A type nothing assesses is reported as a blind spot rather than as clean.',
  };
}

// PART 2: impact propagation. What else is affected when one dependency of one capability fails?
// Propagated through the declared topology and the shared contexts, never guessed.
function dependencyImpact({ capability, kind, controls = [], continuity = null, regions = ['bw-central', 'bw-south', 'bw-north'], instruments = null } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  if (!spec) throw new Error(`unknown critical capability '${capability}'`);
  if (!DEPENDENCY_KINDS[kind]) throw new Error(`unknown dependency kind '${kind}'`);

  // Technical and infrastructure dependencies propagate through the service topology; the rest
  // propagate through shared subsystems and contexts, which is how an organizational failure spreads.
  const type = typeOfKind(kind);
  const services = ['technical', 'infrastructure'].includes(type) ? spec.services : [];
  const propagation = services.length ? telemetry.failurePropagation(services) : { impacted: [], blastRadius: 0 };
  const impactedServices = [...new Set(propagation.impacted)].sort();

  // Other critical capabilities that share a service, a subsystem or a context with this one.
  const others = Object.entries(CRITICAL_CAPABILITIES).filter(([id]) => id !== capability).map(([id, other]) => {
    const sharedServices = other.services.filter((svc) => spec.services.includes(svc) || impactedServices.includes(svc));
    const sharedSubsystems = other.subsystems.filter((sub) => spec.subsystems.includes(sub));
    const sharedContexts = other.contexts.filter((ctx) => spec.contexts.includes(ctx));
    const reached = sharedServices.length || sharedSubsystems.length || sharedContexts.length;
    return {
      capability: id, constitutional: other.constitutional,
      via: [
        ...(sharedServices.length ? [`shared service(s): ${sharedServices.sort().join(', ')}`] : []),
        ...(sharedSubsystems.length ? [`shared subsystem(s): ${sharedSubsystems.sort().join(', ')}`] : []),
        ...(sharedContexts.length ? [`shared context(s): ${sharedContexts.sort().join(', ')}`] : []),
      ],
      reached: !!reached,
    };
  }).filter((o) => o.reached);

  // Would anything notice? The same question the global invariant asks, answered per dependency.
  const control = DEPENDENCY_KINDS[kind].detectedBy;
  const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
  const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
  const detected = !!control && ran.has(control) && holding.get(control) !== false;

  return {
    capability, kind, type, category: categoryOfKind(kind),
    failsBy: DEPENDENCY_TYPES[type] ? DEPENDENCY_TYPES[type].failsBy : 'unknown failure mode',
    detectedIn: DEPENDENCY_TYPES[type] ? DEPENDENCY_TYPES[type].detectedIn : 'unknown',
    directServices: [...spec.services].sort(), impactedServices,
    reaches: others, reachCount: others.length,
    constitutionalReach: others.filter((o) => o.constitutional).map((o) => o.capability),
    detected, detectedBy: control,
    // Propagation over declared structure is a LOWER bound, and it says so — the same caveat blast
    // radius has carried since Phase 10.
    caveat: 'Propagation follows declared services, subsystems and contexts. An undeclared coupling does not appear here, so this is a lower bound on the reach rather than a bound on it.',
    summary: others.length
      ? `A ${type} failure of '${capability}' reaches ${others.length} other critical capability(ies)${others.some((o) => o.constitutional) ? ', including constitutional ones' : ''}.`
      : `A ${type} failure of '${capability}' reaches no other critical capability through any declared path.`,
    informationalOnly: true, authorizes: false,
  };
}

// --- Institutional risk prioritisation (Phase 14, Part 6) -----------------------------------------
//
// Phase 13 produced a list of single dependencies with constitutional ones first. That was enough to
// know what mattered and not enough to know what to do on Monday: eight open dependencies with
// nothing to separate them is a list somebody reads once.
//
// Six factors, and the thing that makes this honest is that each declares its BASIS. Three are
// derived from what the platform records; three are declared priors, arguable and reviewable, and
// they say so. A single "risk score" that mixed the two and presented the result as a measurement
// would be the most dangerous number in the whole platform.
//
// The ranking rule is deliberately NOT a weighted sum:
//
//   A constitutional capability always outranks a non-constitutional one, whatever the arithmetic
//   says. A weighted average would eventually let a well-detected constitutional dependency fall
//   below a badly-detected trivial one, and no amount of tuning makes that acceptable.
const RISK_FACTORS = {
  likelihood: {
    scale: ['rare', 'occasional', 'frequent'],
    basis: 'declared',
    question: 'How often does this kind of thing actually happen?',
    derivation: 'A declared prior per dependency kind, sharpened by the platform\'s own evidence where evidence exists. An institution loses people constantly and regions almost never; pretending otherwise would flatten the list.',
  },
  operationalImpact: {
    scale: ['limited', 'significant', 'total'],
    basis: 'derived',
    question: 'How much of the capability stops?',
    derivation: 'Derived from the declared topology: a dependency whose loss stops every service the capability needs is total.',
  },
  detectability: {
    scale: ['detected', 'partially-detected', 'undetected'],
    basis: 'derived',
    question: 'Would anything tell us this had broken?',
    derivation: 'Derived from whether the kind names a control that runs. An undetected dependency is worse than a detected one of the same size, because the first anybody hears of it is the incident.',
  },
  recoveryComplexity: {
    scale: ['simple', 'involved', 'hard'],
    basis: 'declared',
    question: 'How much work is it to close?',
    derivation: 'Declared per kind. Recording a second escalation contact is simple; giving a deputy real rehearsed competence takes a year.',
  },
  businessCriticality: {
    scale: ['standard', 'high', 'constitutional'],
    basis: 'derived',
    question: 'What does its loss cost the citizen?',
    derivation: 'Derived from CRITICAL_CAPABILITIES: constitutional capabilities are the ones the platform exists to deliver.',
  },
  governancePriority: {
    scale: ['board', 'oversight-board'],
    basis: 'derived',
    question: 'Who has to decide about it?',
    derivation: 'Derived from the accountability record. A dependency only the Oversight Board can accept is one that reaches the top of somebody\'s agenda whether or not it is urgent.',
  },
};

// Declared priors. Written here so they can be argued with in one place rather than being buried in
// an expression, and each carries the sentence that justifies it.
const KIND_LIKELIHOOD = {
  person: { level: 'frequent', why: 'People are ill, on leave, promoted and resign. This is the most common failure an institution has, and the one least often planned for.' },
  knowledge: { level: 'frequent', why: 'Knowledge leaves with the person, and it leaves quietly — nothing fails on the day it goes.' },
  team: { level: 'occasional', why: 'Reorganisations are periodic rather than constant.' },
  document: { level: 'occasional', why: 'Documents rot on the same cadence the code changes.' },
  process: { level: 'occasional', why: 'A process becomes unavailable when the system supporting it does.' },
  service: { level: 'occasional', why: 'Services fail; that is what the resilience engineering is for.' },
  data: { level: 'rare', why: 'Data loss is rare and close to unrecoverable, which is why it is scored on impact rather than frequency.' },
  region: { level: 'rare', why: 'Regional loss is a genuine but infrequent event.' },
  facility: { level: 'rare', why: 'Site loss is infrequent. It is also the dimension the platform assesses by proxy, so this prior is weaker than the others.' },
  supplier: { level: 'occasional', why: 'Suppliers withdraw, are acquired, and fail to renew.' },
  'communication-channel': { level: 'occasional', why: 'Channels fail exactly when they are needed, because the incident that needs them often took them out.' },
  'legal-authority': { level: 'rare', why: 'Instruments are amended on a legislative timescale, not an operational one.' },
  governance: { level: 'occasional', why: 'A board fails to reach quorum far more often than it is dissolved.' },
};

const KIND_RECOVERY = {
  'communication-channel': { level: 'simple', why: 'Record a second way to reach the authority.' },
  team: { level: 'simple', why: 'Record a second accountable team, or record in writing that there is not one.' },
  governance: { level: 'simple', why: 'Name a second approving authority in the accountability record.' },
  document: { level: 'involved', why: 'Write or repair the procedure so it resolves and carries what an operator needs.' },
  process: { level: 'involved', why: 'Declare and test a fallback path.' },
  supplier: { level: 'involved', why: 'Identify and approve a second supplier.' },
  'legal-authority': { level: 'hard', why: 'A second authorising instrument is a legislative act, on a legislative timescale.' },
  person: { level: 'hard', why: 'A validated alternative needs training, rehearsal and real governance acts. A name on an org chart takes an afternoon and is not an alternative.' },
  knowledge: { level: 'hard', why: 'Both a trained second person and a written procedure. Either alone is what most institutions stop at.' },
  service: { level: 'hard', why: 'Redundancy for a store of record is an architecture change.' },
  data: { level: 'hard', why: 'A second copy of a store of record, with the consistency questions that brings.' },
  region: { level: 'hard', why: 'Extending a capability to serve from a second region.' },
  facility: { level: 'hard', why: 'A physical site is procurement, construction and accreditation.' },
};

const bandIndex = (scale, level) => scale.indexOf(level);

// Score one open dependency across the six factors. Every factor returns its level, its basis and
// why — a factor a reader cannot argue with is a number, not an assessment.
function scoreDependency({ capability, kind, finding = null, controls = [] } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  if (!spec) throw new Error(`unknown critical capability '${capability}'`);
  const kindSpec = DEPENDENCY_KINDS[kind];
  if (!kindSpec) throw new Error(`unknown dependency kind '${kind}'`);
  const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
  const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));

  const likelihood = KIND_LIKELIHOOD[kind] || { level: 'occasional', why: 'no prior is declared for this kind' };

  // Derived: does losing this stop everything the capability needs, or part of it?
  const svc = kind === 'service' ? serviceResilience(capability) : null;
  const operationalImpact = kind === 'service'
    ? (svc.fatalSingleServices.length ? 'total' : 'significant')
    : ['person', 'knowledge', 'data', 'governance'].includes(kind) ? 'total' : 'significant';

  // Derived: would anything tell us? A control that does not run cannot detect anything; a control
  // that runs and is failing detects it and is already telling us.
  const control = kindSpec.detectedBy;
  const detectability = !control ? 'undetected'
    : !ran.has(control) ? 'undetected'
      : holding.get(control) === false ? 'partially-detected' : 'detected';

  const recovery = KIND_RECOVERY[kind] || { level: 'involved', why: 'no recovery prior is declared for this kind' };
  const businessCriticality = spec.constitutional ? 'constitutional' : 'high';
  const governancePriority = spec.constitutional ? 'oversight-board' : 'board';

  const factors = [
    { factor: 'likelihood', level: likelihood.level, basis: 'declared', why: likelihood.why },
    { factor: 'operationalImpact', level: operationalImpact, basis: 'derived', why: kind === 'service' ? (svc.reason) : `losing the ${kind} this capability rests on stops it rather than degrading it` },
    { factor: 'detectability', level: detectability, basis: 'derived', why: !control ? `no control exists that would fail if the ${kind} dependency broke` : detectability === 'detected' ? `${control} runs and would fail` : `${control} is not currently holding, or did not run` },
    { factor: 'recoveryComplexity', level: recovery.level, basis: 'declared', why: recovery.why },
    { factor: 'businessCriticality', level: businessCriticality, basis: 'derived', why: spec.lossMeans },
    { factor: 'governancePriority', level: governancePriority, basis: 'derived', why: spec.constitutional ? 'only the Oversight Board may accept a single point of failure in a constitutional capability' : 'the owning governance board may accept it' },
  ];
  // The arithmetic, used ONLY to order within a criticality band. Stated as an ordering key rather
  // than dressed up as a risk score, because it mixes derived facts with declared priors and a
  // number that hid that would be the most misleading figure in the platform.
  const orderingKey = bandIndex(RISK_FACTORS.likelihood.scale, likelihood.level)
    + bandIndex(RISK_FACTORS.operationalImpact.scale, operationalImpact)
    + bandIndex(RISK_FACTORS.detectability.scale, detectability)
    + bandIndex(RISK_FACTORS.recoveryComplexity.scale, recovery.level);
  return {
    capability, kind, category: categoryOfKind(kind),
    constitutional: spec.constitutional,
    factors,
    levels: Object.fromEntries(factors.map((f) => [f.factor, f.level])),
    derivedFactors: factors.filter((f) => f.basis === 'derived').length,
    declaredFactors: factors.filter((f) => f.basis === 'declared').length,
    orderingKey, maxOrderingKey: 8,
    finding: finding || kindSpec.question,
    detectedBy: control,
    note: 'Four of the six factors order this dependency against others; business criticality and governance priority do not enter the arithmetic at all — they select the band it is ranked within.',
  };
}

// PART 6: rank every open dependency and produce executive remediation priorities.
function riskPrioritisation(evaluation, { controls = [] } = {}) {
  const rows = [];
  for (const c of evaluation.capabilities.filter((x) => !x.resilient)) {
    for (const f of c.findings.filter((x) => x.singleDependency)) {
      rows.push(scoreDependency({ capability: c.capability, kind: f.kind, finding: f.reason, controls }));
    }
  }
  // THE RANKING RULE. Constitutional first, always; then by the ordering key; then deterministically.
  const ranked = rows.slice().sort((a, b) => (b.constitutional ? 1 : 0) - (a.constitutional ? 1 : 0)
    || b.orderingKey - a.orderingKey
    || a.capability.localeCompare(b.capability)
    || a.kind.localeCompare(b.kind))
    .map((r, i) => ({ rank: i + 1, ...r }));

  const undetected = ranked.filter((r) => r.levels.detectability === 'undetected');
  const constitutional = ranked.filter((r) => r.constitutional);
  return {
    ranked, count: ranked.length,
    factors: Object.entries(RISK_FACTORS).map(([factor, f]) => ({ factor, ...f })),
    // The three lists an executive actually needs, each answering a different question.
    remediationPriorities: ranked.slice(0, 5).map((r) => ({
      rank: r.rank, capability: r.capability, kind: r.kind, category: r.category,
      why: `${r.levels.businessCriticality}, ${r.levels.likelihood}, ${r.levels.operationalImpact} impact, ${r.levels.detectability}`,
      action: (recommendations(evaluation).recommendations.find((x) => x.capability === r.capability && x.kind === r.kind) || {}).recommendedAction || 'Review this dependency.',
      effort: r.levels.recoveryComplexity,
      decidedBy: r.levels.governancePriority === 'oversight-board' ? 'Oversight Board' : 'the owning governance board',
    })),
    // Undetected dependencies are surfaced on their own because they are the ones whose first
    // symptom is an incident, whatever their rank.
    undetected: undetected.map((r) => ({ capability: r.capability, kind: r.kind, why: r.factors.find((f) => f.factor === 'detectability').why })),
    undetectedCount: undetected.length,
    constitutionalOpen: constitutional.map((r) => `${r.capability}/${r.kind}`),
    // Honesty about the method, carried with the output rather than kept in a comment.
    declaredFactorShare: ranked.length ? +(ranked[0].declaredFactors / (ranked[0].declaredFactors + ranked[0].derivedFactors)).toFixed(4) : null,
    method: 'Constitutional capabilities always rank first, whatever the arithmetic says. Within a band, four factors order the list; two of those four are declared priors and are marked as such.',
    recommendationsOnly: true, informationalOnly: true, authorizes: false,
    note: 'A ranking, not a decision. Closing a dependency is work somebody does; accepting one is a decision a named authority records with a rationale and an expiry.',
  };
}

// --- Multi-perspective prioritisation (Phase 15, Part 9) ------------------------------------------
//
// One ranking answers one question, and the people who read it are asking seven different ones. A
// board asks what is constitutionally most serious. An operations chief asks what will bite first. A
// service owner asks what a citizen feels. Handing all three the same list and expecting them to
// re-sort it in their heads is how a ranking gets ignored.
//
// So seven perspectives are computed in PARALLEL, each ordering the same open dependencies by its own
// question. And the rule that survives from Phase 14, restated because it is the one that matters:
//
//   CONSTITUTIONAL PRIORITY IS NEVER COLLAPSED INTO AN ARITHMETIC AVERAGE.
//
// It is not a factor with a weight. It is a BAND: within the constitutional band the other
// perspectives order things, and no amount of low likelihood or easy recovery moves a
// non-constitutional dependency above a constitutional one. `assertConstitutionalPrimacy` checks that
// structurally on every ranking this module produces.
const RISK_PERSPECTIVES = {
  constitutional: { asks: 'What does the platform exist to do, and what threatens it?', orderedBy: 'constitutional status, then the ordering key', band: true },
  operational: { asks: 'What will bite first in day-to-day running?', orderedBy: 'likelihood, then detectability', band: false },
  mission: { asks: 'What stops the outcomes the platform exists for?', orderedBy: 'operational impact, then criticality', band: false },
  citizenImpact: { asks: 'What does a person filing a report actually experience?', orderedBy: 'whether the capability is citizen-facing, then impact', band: false },
  likelihood: { asks: 'What is most likely to happen at all?', orderedBy: 'the declared likelihood prior', band: false },
  recoveryDifficulty: { asks: 'What takes longest to put right once it happens?', orderedBy: 'the declared recovery prior', band: false },
  urgency: { asks: 'What needs a decision soonest?', orderedBy: 'likelihood against detectability — a likely thing nothing would notice is the most urgent', band: false },
};

// Which capabilities a citizen experiences directly. Declared, because "citizen-facing" is a
// judgement about who feels it rather than a property of the topology.
const CITIZEN_FACING = new Set(['anonymous-reporting', 'case-investigation']);

// The structural guarantee. Exported so it can be fed a crafted ranking that violates it.
function assertConstitutionalPrimacy(ranked = []) {
  let seenNonConstitutional = null;
  for (const r of ranked) {
    if (!r.constitutional) { seenNonConstitutional = seenNonConstitutional || r; continue; }
    if (seenNonConstitutional) {
      const e = new Error(`'${r.capability}/${r.kind}' is constitutional and ranks below '${seenNonConstitutional.capability}/${seenNonConstitutional.kind}', which is not — constitutional priority may never be collapsed into an arithmetic average`);
      e.failClosed = true; throw e;
    }
  }
  return true;
}

function multiPerspectiveRisk(evaluation, { controls = [] } = {}) {
  const scored = [];
  for (const c of evaluation.capabilities.filter((x) => !x.resilient)) {
    for (const f of c.findings.filter((x) => x.singleDependency)) {
      const s = scoreDependency({ capability: c.capability, kind: f.kind, finding: f.reason, controls });
      scored.push({ ...s, type: typeOfKind(f.kind), citizenFacing: CITIZEN_FACING.has(c.capability) });
    }
  }
  const idx = (factor, level) => RISK_FACTORS[factor].scale.indexOf(level);
  const tie = (a, b) => a.capability.localeCompare(b.capability) || a.kind.localeCompare(b.kind);
  const rank = (rows) => rows.map((r, i) => ({
    rank: i + 1, capability: r.capability, kind: r.kind, type: r.type,
    constitutional: r.constitutional, levels: r.levels,
  }));

  const orders = {
    // The banded one. Constitutional first, always, then the ordering key.
    constitutional: scored.slice().sort((a, b) => (b.constitutional ? 1 : 0) - (a.constitutional ? 1 : 0) || b.orderingKey - a.orderingKey || tie(a, b)),
    operational: scored.slice().sort((a, b) => idx('likelihood', b.levels.likelihood) - idx('likelihood', a.levels.likelihood)
      || idx('detectability', b.levels.detectability) - idx('detectability', a.levels.detectability) || tie(a, b)),
    mission: scored.slice().sort((a, b) => idx('operationalImpact', b.levels.operationalImpact) - idx('operationalImpact', a.levels.operationalImpact)
      || idx('businessCriticality', b.levels.businessCriticality) - idx('businessCriticality', a.levels.businessCriticality) || tie(a, b)),
    citizenImpact: scored.slice().sort((a, b) => (b.citizenFacing ? 1 : 0) - (a.citizenFacing ? 1 : 0)
      || idx('operationalImpact', b.levels.operationalImpact) - idx('operationalImpact', a.levels.operationalImpact) || tie(a, b)),
    likelihood: scored.slice().sort((a, b) => idx('likelihood', b.levels.likelihood) - idx('likelihood', a.levels.likelihood) || tie(a, b)),
    recoveryDifficulty: scored.slice().sort((a, b) => idx('recoveryComplexity', b.levels.recoveryComplexity) - idx('recoveryComplexity', a.levels.recoveryComplexity) || tie(a, b)),
    urgency: scored.slice().sort((a, b) => (idx('likelihood', b.levels.likelihood) + idx('detectability', b.levels.detectability))
      - (idx('likelihood', a.levels.likelihood) + idx('detectability', a.levels.detectability)) || tie(a, b)),
  };

  const perspectives = Object.keys(RISK_PERSPECTIVES).map((id) => ({
    perspective: id, ...RISK_PERSPECTIVES[id],
    ranking: rank(orders[id]),
    top: orders[id].length ? `${orders[id][0].capability}/${orders[id][0].kind}` : null,
  }));

  // Where the perspectives AGREE is the interesting output: a dependency at the top of several
  // different questions is one nobody has to be persuaded about.
  const appearances = new Map();
  for (const p of perspectives) {
    for (const r of p.ranking.slice(0, 3)) {
      const key = `${r.capability}/${r.kind}`;
      if (!appearances.has(key)) appearances.set(key, { item: key, capability: r.capability, kind: r.kind, constitutional: r.constitutional, perspectives: [] });
      appearances.get(key).perspectives.push(p.perspective);
    }
  }
  const consensus = [...appearances.values()]
    .filter((a) => a.perspectives.length >= 3)
    .sort((a, b) => b.perspectives.length - a.perspectives.length || a.item.localeCompare(b.item));

  // Where they DISAGREE is worth just as much: it says the choice is a judgement, not a calculation.
  // Measured over the WHOLE ordering rather than the first item, because two perspectives that agree
  // on what is worst and disagree about everything else have not agreed.
  const distinctTops = [...new Set(perspectives.map((p) => p.top).filter(Boolean))];
  const signatures = new Map();
  for (const p of perspectives) {
    const sig = p.ranking.map((r) => `${r.capability}/${r.kind}`).join('|');
    if (!signatures.has(sig)) signatures.set(sig, []);
    signatures.get(sig).push(p.perspective);
  }
  const orderings = [...signatures.values()].map((group) => ({ perspectives: group.sort(), distinct: group.length === 1 }));

  return {
    perspectives, count: scored.length,
    perspectiveCount: perspectives.length,
    consensus, consensusCount: consensus.length,
    distinctTopItems: distinctTops,
    // How many genuinely different answers the seven questions produce. A single figure would be the
    // thing this whole structure exists to avoid, so there is not one.
    distinctOrderings: orderings.length, orderings,
    // Perspectives that produce an identical ordering are answering the same question twice on this
    // data, and saying so is more useful than pretending to seven independent views.
    coincidingPerspectives: orderings.filter((o) => o.perspectives.length > 1).map((o) => o.perspectives),
    contested: orderings.length > 1,
    contestedNote: distinctTops.length > 1
      ? `The seven perspectives put ${distinctTops.length} different dependencies first, and produce ${orderings.length} distinct orderings. There is no single correct order, and producing one number would have hidden that.`
      : orderings.length > 1
        ? `Every perspective agrees on what is worst, and they produce ${orderings.length} distinct orderings below it — so they agree on the emergency and not on the queue behind it.`
        : 'All seven perspectives produce the same ordering. That is unusual, and it means the priorities are currently uncontested rather than that the perspectives are redundant.',
    constitutionalPrimacy: (() => { try { assertConstitutionalPrimacy(orders.constitutional); return true; } catch (_) { return false; } })(),
    recommendationsOnly: true, informationalOnly: true, authorizes: false,
    note: 'Seven parallel rankings, never averaged into one. Constitutional priority is a band rather than a factor: within it the other perspectives order things, and nothing non-constitutional moves above it whatever the arithmetic says.',
  };
}

// Recommendations: what would actually close each single dependency, ranked with constitutional
// capabilities first. Recommendations only — nothing here mitigates anything.
function recommendations(evaluation) {
  const actions = {
    person: 'Give the deputy the training and rehearsal the role requires, and record a governance act by them — a name on an org chart is not an alternative.',
    team: 'Record a second accountable team for this capability, or accept in writing that it rests on one.',
    document: 'Write or repair the operational procedure so it resolves and carries prerequisites, permissions, rollback and escalation.',
    process: 'Declare a fallback path that terminates at a named authority.',
    service: 'Introduce redundancy for the service whose loss stops the capability, or accept the single point of failure at board level.',
    region: 'Extend the capability to serve from a second region, at least read-only.',
    supplier: 'Identify a second approved supplier.',
    'communication-channel': 'Record a second way to reach the accountable authority.',
    data: 'Give the store of record a reconstructible source — an append-only event store or a hash-chained ledger — or replicate it across zones.',
    knowledge: 'Both halves: train and rehearse a second person, AND write the procedure down somewhere followable. Either alone leaves the capability in one head.',
    facility: 'Host the capability from a second sovereign site. Note that the platform assesses this by proxy and cannot see a shared power feed or a shared landlord.',
    'legal-authority': 'Identify a second authorising instrument, or record that the mandate is constitutional and why.',
    governance: 'Name a second authority who may approve decisions about this capability, distinct from the one accountable for it.',
  };
  const items = [];
  for (const c of evaluation.capabilities.filter((x) => !x.resilient)) {
    for (const f of c.findings.filter((x) => x.singleDependency)) {
      items.push({
        capability: c.capability, constitutional: c.constitutional, kind: f.kind,
        finding: f.reason, recommendedAction: actions[f.kind] || 'Review this dependency.',
        priority: c.constitutional ? 'constitutional' : 'standard',
      });
    }
  }
  return {
    recommendations: items.sort((a, b) => (a.priority === 'constitutional' ? 0 : 1) - (b.priority === 'constitutional' ? 0 : 1) || a.capability.localeCompare(b.capability) || a.kind.localeCompare(b.kind)),
    count: items.length,
    recommendationsOnly: true, authorizes: false,
    note: 'Recommendations, constitutional capabilities first. Nothing here mitigates anything: closing a single dependency is work somebody does, and accepting one is a decision a named authority records.',
  };
}

// --- THE PHASE 14 GLOBAL INVARIANT ----------------------------------------------------------------
//
//   NO CRITICAL INSTITUTIONAL CAPABILITY MAY DEPEND UPON AN UNVALIDATED ASSUMPTION, AN UNVERIFIED
//   DEPENDENCY, AN UNDOCUMENTED GOVERNANCE RELATIONSHIP, OR A SINGLE POINT OF ORGANIZATIONAL FAILURE.
//
// Phase 13's invariant was the fourth clause alone. The three new ones each close a way a capability
// can be quietly fragile while passing the old test:
//
//   AN UNVALIDATED ASSUMPTION. A capability can have a validated alternative on every dimension and
//   rest on a belief nobody has checked since it was written. The registry knows which assumptions
//   bear on which contexts and whether each still holds; nothing had ever joined that to the
//   capabilities.
//
//   AN UNVERIFIED DEPENDENCY. Phase 13 asked whether an alternative existed. It never asked whether
//   anything would NOTICE the dependency breaking. A dependency with no detecting control fails
//   silently, and the first anybody hears of it is the incident.
//
//   AN UNDOCUMENTED GOVERNANCE RELATIONSHIP. Every capability spans institutions, and a relationship
//   with no recorded way for one side to reach the other is one that fails at a meeting nobody
//   convened.
//
// Each clause is evaluated from a register that already exists. Where a register is not supplied the
// clause reports UNKNOWN and the invariant does not hold — the same rule as everywhere else, because
// an unexamined capability is not a sound one.
const INVARIANT_CLAUSES = {
  'unvalidated-assumption': {
    statement: 'No critical capability may depend upon an unvalidated assumption.',
    evaluatedFrom: 'src/architecture/assumptions.js — the propagated health of every assumption bearing on the capability\'s contexts',
    ifUnknown: 'The capability may rest on a belief that stopped being true, and nothing would say when.',
  },
  'unverified-dependency': {
    statement: 'No critical capability may depend upon an unverified dependency.',
    evaluatedFrom: 'the `detectedBy` control of each dependency kind, resolved against the checks that actually ran',
    ifUnknown: 'The dependency may already have broken, and the first anybody hears of it is the incident.',
  },
  'undocumented-governance-relationship': {
    statement: 'No critical capability may depend upon an undocumented governance relationship.',
    evaluatedFrom: 'src/governance/cross-agency.js — whether every institution pair the capability spans has a recorded way to reach the other',
    ifUnknown: 'Two institutions may be jointly responsible for something with no recorded way to reach each other.',
  },
  'single-point-of-organizational-failure': {
    statement: 'No critical capability may depend upon a single point of organizational failure.',
    evaluatedFrom: 'the thirteen dependency kinds across the eleven categories',
    ifUnknown: 'One person, document, dataset, site, instrument or board may be able to stop a constitutional capability.',
  },
  // --- Phase 15 -------------------------------------------------------------------------------
  'undocumented-legal-authority': {
    statement: 'No critical capability may depend upon an undocumented legal authority.',
    evaluatedFrom: 'src/legislation/legal-authority.js — the recorded, reviewed legal basis for the capability',
    ifUnknown: 'The capability is operating and nobody can say what permits it to. That is not a paperwork gap; it is a capability nobody can defend.',
  },
  'ineffective-detecting-control': {
    statement: 'No critical capability may depend upon an ineffective detecting control.',
    evaluatedFrom: 'src/assurance/control-effectiveness.js — observations of the control actually doing its job',
    ifUnknown: 'A control runs, passes, and nobody has watched it work. It may miss everything it was written for and the build would stay green.',
  },
};

// Clause 1: the assumptions this capability's contexts rest on.
function assumptionClause(capability, { assumptions = null, controls = [], now = 0 } = {}) {
  const spec = CRITICAL_CAPABILITIES[capability];
  if (!assumptions) {
    return { clause: 'unvalidated-assumption', capability, holds: false, unknown: true, assumptions: [], reason: 'no assumption registry was supplied — which beliefs this capability rests on, and whether they still hold, is unknown' };
  }
  const bearing = spec.contexts.flatMap((c) => assumptions.forContext(c).map((a) => a.id));
  const unique = [...new Set(bearing)].sort();
  if (!unique.length) {
    return { clause: 'unvalidated-assumption', capability, holds: false, unknown: true, assumptions: [], reason: `no assumption is registered against ${spec.contexts.join(', ')} — a capability whose assumptions nobody has written down is not one whose assumptions have been checked` };
  }
  const health = assumptions.health(unique, { now, controls });
  return {
    clause: 'unvalidated-assumption', capability, assumptions: unique,
    confidence: health.confidence, invalid: health.invalid || [],
    holds: health.sound, unknown: false,
    reason: health.sound
      ? `${unique.length} assumption(s) bear on this capability and the weakest is '${health.confidence}'`
      : `rests on assumption(s) that are not validated: ${health.reason}`,
  };
}

// Clause 2: would anything notice each dependency breaking?
function verificationClause(capability, { controls = [] } = {}) {
  const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
  const holding = new Map(controls.filter((c) => typeof c === 'object').map((c) => [c.id, c.pass]));
  const rows = Object.entries(DEPENDENCY_KINDS).map(([kind, spec]) => {
    const control = spec.detectedBy;
    const verified = !!control && ran.has(control) && holding.get(control) !== false;
    return { kind, category: categoryOfKind(kind), detectedBy: control, verified, reason: !control ? 'no control exists that would fail if this dependency broke' : !ran.has(control) ? `${control} did not run` : holding.get(control) === false ? `${control} ran and did not hold` : `${control} runs and would fail` };
  });
  const unverified = rows.filter((r) => !r.verified);
  return {
    clause: 'unverified-dependency', capability, dependencies: rows,
    unverified: unverified.map((r) => r.kind),
    holds: unverified.length === 0, unknown: !controls.length,
    reason: unverified.length ? `${unverified.length} dependency kind(s) would break without anything noticing: ${unverified.map((r) => r.kind).join(', ')}` : 'every dependency kind has a control that runs and would fail',
  };
}

// Clause 3: is every institutional relationship this capability spans recorded and reachable — and
// is its constitutional relationship DECLARED? Phase 15, Part 6 gave every bounded context an
// explicit zone, trust boundary and collaboration constraint; a capability spanning a context whose
// constitutional placement is undeclared has a relationship nobody has written down.
function governanceRelationshipClause(capability) {
  const crossAgency = require('./cross-agency');
  const contextMap = require('../architecture/context-map');
  const spec = CRITICAL_CAPABILITIES[capability];
  const undeclaredContexts = [];
  for (const ctx of spec.contexts) {
    try { contextMap.zoneGovernance(ctx); } catch (_) { undeclaredContexts.push(ctx); }
  }
  const institutions = new Set();
  for (const s of spec.subsystems) {
    try {
      const o = ownership.describe(s);
      institutions.add(o.responsibleAuthority); institutions.add(o.approvingAuthority);
    } catch (_) { /* not a governed subsystem */ }
  }
  const list = [...institutions].sort();
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const path = crossAgency.communicationPath(list[i], list[j]);
      pairs.push({ agencies: [list[i], list[j]], reachable: path.reachable, via: path.via, reason: path.reason });
    }
  }
  const unreachable = pairs.filter((p) => !p.reachable);
  const zones = spec.contexts.filter((c) => !undeclaredContexts.includes(c)).map((c) => contextMap.zoneGovernance(c));
  return {
    clause: 'undocumented-governance-relationship', capability, institutions: list, pairs,
    unreachable: unreachable.map((p) => p.agencies.join(' ↔ ')),
    undeclaredContexts,
    constitutionalZones: [...new Set(zones.map((z) => z.zone))].sort(),
    holds: list.length > 0 && unreachable.length === 0 && undeclaredContexts.length === 0,
    unknown: list.length === 0 || undeclaredContexts.length > 0,
    reason: undeclaredContexts.length ? `the constitutional placement of ${undeclaredContexts.join(', ')} is undeclared, so the relationship this capability has to the zones is unrecorded`
      : !list.length ? 'no institution is recorded as accountable for this capability'
        : unreachable.length ? `${unreachable.length} institution pair(s) share responsibility with no recorded way to reach each other: ${unreachable.map((p) => p.agencies.join(' ↔ ')).join('; ')}`
          : `${list.length} institution(s) share responsibility across the ${[...new Set(zones.map((z) => z.zone))].sort().join(', ')} zone(s), and each pair has a recorded way to reach the other`,
  };
}

// Clause 5 (Phase 15): is the legal basis recorded, current and reviewed?
function legalAuthorityClause(capability, { authorities = null, controls = [], now = 0 } = {}) {
  if (!authorities) {
    return {
      clause: 'undocumented-legal-authority', capability, holds: false, unknown: true, state: 'unknown',
      reason: 'no legal authority registry was supplied — what permits this capability to operate is unknown, and unknown is not documented',
    };
  }
  const state = authorities.state(capability, { now, controls });
  return {
    clause: 'undocumented-legal-authority', capability,
    state: state.state, authorized: state.authorized,
    holds: state.authorized, unknown: state.state === 'unknown',
    reason: state.reason,
  };
}

// Clause 6 (Phase 15): are the controls that detect this capability's dependencies actually
// EFFECTIVE — as distinct from merely running and passing?
function controlEffectivenessClause(capability, { observations = null, controls = [] } = {}) {
  const ce = require('../assurance/control-effectiveness');
  const detecting = [...new Set(Object.values(DEPENDENCY_KINDS).map((k) => k.detectedBy).filter(Boolean))].sort();
  if (!observations) {
    return {
      clause: 'ineffective-detecting-control', capability, controls: detecting,
      holds: false, unknown: true,
      reason: `no performance evidence exists for the ${detecting.length} control(s) that detect this capability's dependencies. They run and pass; nobody has watched any of them work.`,
    };
  }
  const rows = detecting.map((c) => ce.controlEffectiveness(c, { register: observations }));
  const unknown = rows.filter((r) => r.state === 'unknown');
  const failing = rows.filter((r) => r.state === 'ineffective' || r.state === 'degraded');
  return {
    clause: 'ineffective-detecting-control', capability, controls: detecting,
    unobserved: unknown.map((r) => r.control), ineffective: failing.map((r) => r.control),
    holds: unknown.length === 0 && failing.length === 0,
    unknown: unknown.length > 0,
    reason: unknown.length ? `${unknown.length} detecting control(s) have no performance evidence: ${unknown.map((r) => r.control).join(', ')}`
      : failing.length ? `${failing.length} detecting control(s) are observed working badly: ${failing.map((r) => `${r.control} (${r.state})`).join(', ')}`
        : `all ${rows.length} detecting controls are observed effective`,
  };
}

// The invariant, evaluated across all four clauses for every critical capability.
// --- Phase 18.1 Batch 7: the invariant applied to the governance machinery itself -----------------
//
// The global invariant has been evaluated against the five constitutional capabilities since ADR-0009.
// What nothing asked was whether the governance machinery that evaluates it is itself resilient. A
// phase that builds a requirement register, a merge register, a compliance dashboard and a decision
// assurance chain has built four new things an institution would depend on, and the invariant's own
// question applies to them:
//
//     no critical capability may depend on a single person, a single process,
//     a single document, or a single system
//
// Four kinds, mapped onto what is actually observable about a control:
//
//   person    how many distinct accountable bodies stand behind it
//   process   how many distinct controls would notice if it broke
//   document  how many governed documents record it
//   system    how many modules implement it
//
// THE GOVERNANCE BOUNDARY, and it is the reason this is a separate function rather than six more
// capabilities bolted into CRITICAL_CAPABILITIES. A violation against a constitutional capability
// BLOCKS institutional readiness, because ADR-0009 says so. Nothing in the governance model says a
// single-point dependency in the platform's own tooling does the same, and inventing that here would
// be a silent change to governance semantics. So this reports GOVERNANCE_REVIEW_REQUIRED and leaves
// the decision where it belongs. Resilience findings are evidence for a board, not a verdict.
const GOVERNANCE_RESILIENCE_STATES = {
  RESILIENT: {
    epistemic: 'RESOLVED', blocking: false, requiresGovernanceReview: false,
    means: 'More than one of every kind this capability depends on. No single loss removes it.',
  },
  SINGLE_POINT_OBSERVED: {
    epistemic: 'BROKEN', blocking: false, requiresGovernanceReview: true,
    means: 'A dependency of some kind has exactly one instance. Observed structurally, and what to do about it is a governance judgement rather than a build failure.',
  },
  BLOCKED: {
    epistemic: 'BROKEN', blocking: true, requiresGovernanceReview: true,
    means: 'A single point of failure in a capability the governance model requires to be resilient. This is the only state that blocks, and only where existing governance already said so.',
  },
  UNKNOWN: {
    epistemic: 'UNKNOWN', blocking: false, requiresGovernanceReview: true,
    means: 'Nothing was supplied to evaluate this capability against. Not resilient, not fragile — unexamined.',
  },
};

// The four kinds the invariant names, and what having exactly one of each would cost.
const SINGLE_POINT_KINDS = {
  person: {
    asks: 'How many distinct accountable bodies stand behind this capability?',
    ifSingle: 'One board holds it. If that board lapses, is reorganised or simply does not meet, nothing else is accountable and the capability continues unattended.',
  },
  process: {
    asks: 'How many distinct controls would notice if this capability stopped working?',
    ifSingle: 'One control is the only thing that would notice. A control nothing checks is a control nobody knows has stopped.',
  },
  document: {
    asks: 'How many governed documents record this capability?',
    ifSingle: 'One document carries it. A document is a single point of failure in exactly the way a server is, and it is the kind institutions notice last.',
  },
  system: {
    asks: 'How many modules implement this capability?',
    ifSingle: 'One module implements it. Not necessarily wrong — a small capability should live in one place — which is why this is reported for judgement rather than treated as a fault.',
  },
};

// Declared, never inferred. Each entry says which controls, documents and modules carry it; a
// capability that named none of those would report UNKNOWN rather than passing by having nothing
// checked about it.
const GOVERNANCE_CAPABILITIES = {
  'requirements-traceability': {
    title: 'Every specification requirement traces to what implements and verifies it',
    controls: ['APP-FIT-REQUIREMENTS-TRACEABILITY', 'APP-FIT-SPECIFICATION-COMPLIANCE'],
    documents: ['docs/architecture-governance.md', 'docs/adr/0012-decision-package-merge-and-specification-traceability.md'],
    modules: ['src/architecture/adr-governance.js'],
    governanceModelRequiresResilience: false,
  },
  'merge-governance': {
    title: 'Requirements merged into one implementation are recorded and justified',
    controls: ['APP-FIT-MERGE-GOVERNANCE', 'APP-FIT-ADR-GOVERNANCE'],
    documents: ['docs/architecture-governance.md', 'docs/adr/0012-decision-package-merge-and-specification-traceability.md'],
    modules: ['src/architecture/adr-governance.js'],
    governanceModelRequiresResilience: false,
  },
  'decision-assurance': {
    title: 'An executive recommendation can be walked back to what authorises it',
    controls: ['APP-FIT-DECISION-QUALITY', 'APP-FIT-DECISION-EXPLAINABILITY', 'APP-FIT-DECISION-SUPPORT'],
    documents: ['docs/institutional-intelligence.md', 'docs/adaptive-governance.md'],
    modules: ['src/assurance/institutional.js', 'src/assurance/epistemic.js'],
    governanceModelRequiresResilience: false,
  },
  'epistemic-integrity': {
    title: 'Unknown is never reported as pass, anywhere in the platform',
    controls: ['APP-FIT-EPISTEMIC-INTEGRITY', 'APP-FIT-DECISION-EXPLAINABILITY', 'APP-FIT-SPECIFICATION-COMPLIANCE'],
    documents: ['docs/architecture-governance.md'],
    modules: ['src/assurance/epistemic.js'],
    governanceModelRequiresResilience: false,
  },
  'duplication-prevention': {
    title: 'A second framework cannot be built without an architectural authority saying so',
    controls: ['APP-FIT-DUPLICATE-FRAMEWORK', 'APP-FIT-SPECIFICATION-EVOLUTION'],
    documents: ['docs/architecture-governance.md'],
    modules: ['src/architecture/drift-prevention.js'],
    governanceModelRequiresResilience: false,
  },
};

// Applies the invariant's single-point clause to the platform's own governance machinery.
// Deterministic, fail-closed on missing evidence, and it authorises nothing.
function governanceCapabilityResilience({ controls = [], capabilities = GOVERNANCE_CAPABILITIES, now = 0 } = {}) {
  const fs2 = require('fs');
  const path2 = require('path');
  const raci = require('./raci');
  const { EPISTEMIC_STATES, weakest, machineBoundary } = require('../assurance/epistemic');
  const ran = new Set(controls.map((c) => (typeof c === 'string' ? c : c.id)));
  const root = path2.join(__dirname, '..', '..');

  const rows = Object.keys(capabilities).sort().map((id) => {
    const spec = capabilities[id];
    // A control that did not run is not evidence. Counting declared controls rather than executed
    // ones would let a capability look watched by naming a control that no longer exists.
    const running = (spec.controls || []).filter((c) => ran.has(c));
    const declaredNotRunning = (spec.controls || []).filter((c) => !ran.has(c));
    const existingDocs = (spec.documents || []).filter((d) => fs2.existsSync(path2.join(root, d)));
    const missingDocs = (spec.documents || []).filter((d) => !fs2.existsSync(path2.join(root, d)));
    const existingModules = (spec.modules || []).filter((m) => fs2.existsSync(path2.join(root, m)));
    const missingModules = (spec.modules || []).filter((m) => !fs2.existsSync(path2.join(root, m)));
    const bodies = [...new Set(raci.controlOwnership(running).controls
      .map((c) => c.governanceBoard).filter(Boolean))];

    const counts = { person: bodies.length, process: running.length, document: existingDocs.length, system: existingModules.length };
    const kinds = Object.keys(SINGLE_POINT_KINDS).map((kind) => {
      const count = counts[kind];
      const state = count === 0 ? 'UNKNOWN' : count === 1 ? 'SINGLE_POINT_OBSERVED' : 'RESILIENT';
      return {
        kind, ...SINGLE_POINT_KINDS[kind], count,
        state, ...GOVERNANCE_RESILIENCE_STATES[state],
        detail: count === 0 ? `nothing of this kind is recorded, so whether the capability is resilient to losing one is unexamined`
          : count === 1 ? SINGLE_POINT_KINDS[kind].ifSingle
            : `${count} recorded — losing one leaves ${count - 1}`,
      };
    });

    // Weakest link across the four kinds, then translated back. A capability with one single point
    // is single-pointed regardless of how well spread the other three are.
    const worstEpistemic = weakest(kinds.map((k) => GOVERNANCE_RESILIENCE_STATES[k.state].epistemic));
    let state = worstEpistemic === 'RESOLVED' ? 'RESILIENT'
      : worstEpistemic === 'UNKNOWN' ? 'UNKNOWN' : 'SINGLE_POINT_OBSERVED';
    // …and only the governance model can escalate that to BLOCKED. Nothing here decides it.
    if (state === 'SINGLE_POINT_OBSERVED' && spec.governanceModelRequiresResilience) state = 'BLOCKED';

    const single = kinds.filter((k) => k.state === 'SINGLE_POINT_OBSERVED');
    const unexamined = kinds.filter((k) => k.state === 'UNKNOWN');
    return {
      capability: id, title: spec.title,
      state, ...GOVERNANCE_RESILIENCE_STATES[state],
      kinds, counts,
      singlePointKinds: single.map((k) => k.kind),
      unexaminedKinds: unexamined.map((k) => k.kind),
      controlsRunning: running, controlsDeclaredNotRunning: declaredNotRunning,
      documentsMissing: missingDocs, modulesMissing: missingModules,
      accountableBodies: bodies,
      governanceModelRequiresResilience: !!spec.governanceModelRequiresResilience,
      reason: unexamined.length ? `${unexamined.length} dependency kind(s) have nothing recorded: ${unexamined.map((k) => k.kind).join(', ')}`
        : single.length ? `${single.length} dependency kind(s) have exactly one instance: ${single.map((k) => k.kind).join(', ')}`
          : 'more than one instance of every kind this capability depends on',
    };
  });

  const of = (state) => rows.filter((r) => r.state === state).map((r) => r.capability);
  return {
    invariant: 'No critical capability may depend on a single person, a single process, a single document, or a single system.',
    appliedTo: 'the governance machinery Phase 18.1 built, rather than the five constitutional capabilities the same invariant has always covered',
    capabilities: rows, count: rows.length,
    states: Object.entries(GOVERNANCE_RESILIENCE_STATES).map(([state, s]) => ({ state, ...s })),
    kinds: Object.entries(SINGLE_POINT_KINDS).map(([kind, k]) => ({ kind, ...k })),
    epistemicStates: Object.entries(EPISTEMIC_STATES).map(([state, e]) => ({ state, ...e })),
    resilient: of('RESILIENT'),
    singlePointObserved: of('SINGLE_POINT_OBSERVED'),
    blocked: of('BLOCKED'),
    unknown: of('UNKNOWN'),
    singlePointDependencies: rows.flatMap((r) => r.singlePointKinds.map((kind) => ({ capability: r.capability, kind, detail: r.kinds.find((k) => k.kind === kind).detail }))),
    // Only a capability the governance model already requires to be resilient can block. Nothing
    // observed here changes that, and nothing here authorises anything.
    blocksInstitutionalReadiness: rows.some((r) => r.state === 'BLOCKED'),
    governanceReviewRequired: rows.filter((r) => r.requiresGovernanceReview).map((r) => r.capability),
    ...machineBoundary({
      observed: [
        'how many accountable bodies stand behind a capability\'s controls',
        'how many controls actually ran that would notice it break',
        'how many governed documents recording it exist on disk',
        'how many implementing modules exist on disk',
      ],
      judged: [
        'whether a capability that lives in one module SHOULD live in more than one',
        'whether a second accountable body would add oversight or only add delay',
        'whether a single-point dependency is acceptable for this capability at this time',
      ],
    }),
    holds: rows.length > 0 && rows.every((r) => r.state === 'RESILIENT'),
    measurable: rows.length > 0,
    basis: rows.length
      ? `${of('RESILIENT').length} resilient, ${of('SINGLE_POINT_OBSERVED').length} with an observed single point, ${of('BLOCKED').length} blocked, ${of('UNKNOWN').length} unexamined, of ${rows.length} governance capability(ies).`
      : 'No governance capability was supplied. Nothing is reported rather than nothing being wrong.',
    now, failClosed: true, informationalOnly: true, authorizes: false,
    note: 'A single-point dependency in the platform\'s own governance machinery is reported for a board to judge, not treated as a build failure. Escalating it to BLOCKED would be a silent change to governance semantics: ADR-0009 says a violation against a CONSTITUTIONAL capability blocks readiness, and says nothing about this. Resilience findings are evidence for a decision, never the decision.',
  };
}

function evaluateGlobalInvariant({ assumptions = null, continuity = null, controls = [], instruments = null, authorities = null, observations = null, regions = ['bw-central', 'bw-south', 'bw-north'], now = 0 } = {}) {
  const structural = evaluate({ continuity, controls, regions, instruments });
  const capabilities = Object.keys(CRITICAL_CAPABILITIES).sort().map((id) => {
    const spec = CRITICAL_CAPABILITIES[id];
    const structuralRow = structural.capabilities.find((c) => c.capability === id);
    const clauses = [
      assumptionClause(id, { assumptions, controls, now }),
      verificationClause(id, { controls }),
      governanceRelationshipClause(id),
      legalAuthorityClause(id, { authorities, controls, now }),
      controlEffectivenessClause(id, { observations, controls }),
      {
        clause: 'single-point-of-organizational-failure', capability: id,
        holds: structuralRow.resilient, unknown: false,
        singleDependencies: structuralRow.singleDependencies,
        unvalidatedCategories: structuralRow.unvalidatedCategories,
        reason: structuralRow.reason,
      },
    ];
    const failing = clauses.filter((c) => !c.holds);
    return {
      capability: id, title: spec.title, constitutional: spec.constitutional, lossMeans: spec.lossMeans,
      clauses, failingClauses: failing.map((c) => c.clause),
      // Weakest link across four clauses, exactly as within one.
      holds: failing.length === 0,
      reason: failing.length ? `fails ${failing.length} clause(s): ${failing.map((c) => c.clause).join(', ')}` : 'satisfies every clause of the invariant',
    };
  });
  const violations = capabilities.filter((c) => !c.holds);
  const byClause = Object.keys(INVARIANT_CLAUSES).map((clause) => ({
    clause, ...INVARIANT_CLAUSES[clause],
    failingCapabilities: capabilities.filter((c) => c.failingClauses.includes(clause)).map((c) => c.capability),
  }));
  return {
    invariant: 'No critical institutional capability may depend upon an unverified assumption, an undocumented legal authority, an ineffective detecting control, an undeclared constitutional relationship, or a single point of organizational failure.',
    supersedes: 'The four-clause invariant of ADR-0009. Its clauses are preserved verbatim; Phase 15 adds legal authority and control effectiveness, and extends the governance-relationship clause to require a declared constitutional placement.',
    clauses: byClause, capabilities,
    violations: violations.map((c) => ({ capability: c.capability, constitutional: c.constitutional, failingClauses: c.failingClauses, lossMeans: c.lossMeans })),
    violationCount: violations.length,
    constitutionalViolations: violations.filter((c) => c.constitutional).map((c) => c.capability),
    holds: violations.length === 0,
    // Violations block institutional readiness until mitigated or formally accepted.
    blocksInstitutionalReadiness: violations.length > 0,
    structural,
    failClosed: true, authorizes: false,
    note: 'Four clauses, evaluated across architecture, governance, documentation, operations, institutional resilience, organizational capability and strategic planning. A clause with no register behind it reports UNKNOWN and the invariant does not hold, because an unexamined capability is not a sound one.',
  };
}

// The same acceptance mechanism, extended to cover a failing CLAUSE rather than only a single
// dependency kind. Rationale, owner and expiry are all required; constitutional capabilities remain
// the Oversight Board's alone.
function globalInvariantReport({ assumptions = null, continuity = null, controls = [], instruments = null, authorities = null, observations = null, acceptances = null, regions = ['bw-central', 'bw-south', 'bw-north'], now = 0 } = {}) {
  const evaluation = evaluateGlobalInvariant({ assumptions, continuity, controls, instruments, authorities, observations, regions, now });
  const accepted = acceptances ? acceptances.activeClauses({ now }) : [];
  const acceptedKeys = new Set(accepted.map((a) => `${a.capability}|${a.clause}`));
  const unaccepted = evaluation.violations.flatMap((vi) => vi.failingClauses
    .filter((c) => !acceptedKeys.has(`${vi.capability}|${c}`))
    .map((c) => ({ capability: vi.capability, clause: c, constitutional: vi.constitutional, ifUnknown: INVARIANT_CLAUSES[c].ifUnknown })));
  return {
    ...evaluation,
    acceptances: accepted,
    expiredAcceptances: acceptances ? acceptances.expiredClauses({ now }) : [],
    unaccepted, unacceptedCount: unaccepted.length,
    blocksInstitutionalReadiness: unaccepted.length > 0,
    failClosed: true, authorizes: false,
  };
}

// An accepted single dependency is still a single dependency; it is just one somebody has taken
// responsibility for. Acceptances are attributed and time-bound, like every other acceptance here.
class ResilienceAcceptance {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = []; }
  accept({ capability, kind, by, rationale, expiresAt, at = null } = {}) {
    if (!CRITICAL_CAPABILITIES[capability]) throw new Error(`unknown critical capability '${capability}'`);
    if (!DEPENDENCY_KINDS[kind]) throw new Error(`unknown dependency kind '${kind}'`);
    if (!by || !rationale) { const e = new Error('accepting a single point of failure requires a named authority and a rationale'); e.failClosed = true; throw e; }
    if (!Number.isFinite(expiresAt)) { const e = new Error('an acceptance must expire — a permanent acceptance is a decision nobody revisits'); e.failClosed = true; throw e; }
    if (CRITICAL_CAPABILITIES[capability].constitutional && !/oversight board/i.test(by)) {
      const e = new Error(`'${capability}' is constitutional — only the Oversight Board may accept a single point of failure in it`);
      e.failClosed = true; throw e;
    }
    const rec = { capability, kind, by, rationale, expiresAt, at: at ?? this._clock() };
    this._items.push(rec);
    return { ...rec };
  }
  // Phase 16: accepting an untraceable conclusion. Same class, same discipline — a named authority,
  // a rationale and an expiry — because a second acceptance framework would be a second place to
  // forget to expire something.
  acceptTraceability({ subject, by, rationale, expiresAt, at = null } = {}) {
    if (!subject) throw new Error('accepting an untraceable conclusion must name what is being accepted');
    if (!by || !rationale) { const e = new Error('accepting an untraceable conclusion requires a named authority and a rationale'); e.failClosed = true; throw e; }
    if (!Number.isFinite(expiresAt)) { const e = new Error('an acceptance must expire — a permanent acceptance is a decision nobody revisits'); e.failClosed = true; throw e; }
    if (!this._traceability) this._traceability = [];
    const rec = { subject, by, rationale, expiresAt, at: at ?? this._clock() };
    this._traceability.push(rec);
    return { ...rec };
  }
  activeTraceability({ now = null } = {}) { const t = now ?? this._clock(); return (this._traceability || []).filter((a) => t < a.expiresAt).map((a) => ({ ...a })); }
  expiredTraceability({ now = null } = {}) { const t = now ?? this._clock(); return (this._traceability || []).filter((a) => t >= a.expiresAt).map((a) => ({ ...a })); }

  active({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((a) => t < a.expiresAt).map((a) => ({ ...a })); }
  expired({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((a) => t >= a.expiresAt).map((a) => ({ ...a })); }

  // Phase 14: accepting a failing CLAUSE of the global invariant. Same requirements — a named
  // authority, a rationale and an expiry — and the same constitutional restriction, because a clause
  // failure on a constitutional capability is at least as serious as a single point of failure in it.
  acceptClause({ capability, clause, by, rationale, expiresAt, at = null } = {}) {
    if (!CRITICAL_CAPABILITIES[capability]) throw new Error(`unknown critical capability '${capability}'`);
    if (!INVARIANT_CLAUSES[clause]) throw new Error(`unknown invariant clause '${clause}' — one of ${Object.keys(INVARIANT_CLAUSES).join(', ')}`);
    if (!by || !rationale) { const e = new Error('accepting a failing clause of the global invariant requires a named authority and a rationale'); e.failClosed = true; throw e; }
    if (!Number.isFinite(expiresAt)) { const e = new Error('an acceptance must expire — a permanent acceptance is a decision nobody revisits'); e.failClosed = true; throw e; }
    if (CRITICAL_CAPABILITIES[capability].constitutional && !/oversight board/i.test(by)) {
      const e = new Error(`'${capability}' is constitutional — only the Oversight Board may accept a failing clause of the global invariant in it`);
      e.failClosed = true; throw e;
    }
    if (!this._clauses) this._clauses = [];
    const rec = { capability, clause, by, rationale, expiresAt, at: at ?? this._clock() };
    this._clauses.push(rec);
    return { ...rec };
  }
  activeClauses({ now = null } = {}) { const t = now ?? this._clock(); return (this._clauses || []).filter((a) => t < a.expiresAt).map((a) => ({ ...a })); }
  expiredClauses({ now = null } = {}) { const t = now ?? this._clock(); return (this._clauses || []).filter((a) => t >= a.expiresAt).map((a) => ({ ...a })); }
}

function report({ continuity = null, controls = [], acceptances = null, now = 0, regions = ['bw-central', 'bw-south', 'bw-north'], instruments = null } = {}) {
  const evaluation = evaluate({ continuity, controls, regions, instruments });
  const accepted = acceptances ? acceptances.active({ now }) : [];
  const acceptedKeys = new Set(accepted.map((a) => `${a.capability}|${a.kind}`));
  const unaccepted = evaluation.violations.flatMap((v) => v.singleDependencies.filter((k) => !acceptedKeys.has(`${v.capability}|${k}`)).map((k) => ({ capability: v.capability, kind: k, constitutional: v.constitutional })));
  return {
    ...evaluation,
    acceptances: accepted, expiredAcceptances: acceptances ? acceptances.expired({ now }) : [],
    unaccepted, unacceptedCount: unaccepted.length,
    // The blocking rule: a violation blocks until mitigated OR explicitly accepted by a named
    // authority. An expired acceptance stops covering it, without anyone deciding to withdraw it.
    blocksInstitutionalReadiness: unaccepted.length > 0,
    recommendations: recommendations(evaluation),
    riskPrioritisation: riskPrioritisation(evaluation, { controls }),
    dependencyIntelligence: dependencyIntelligence(evaluation),
    multiPerspectiveRisk: multiPerspectiveRisk(evaluation, { controls }),
    failClosed: true, authorizes: false,
  };
}

module.exports = {
  GOVERNANCE_RESILIENCE_STATES, SINGLE_POINT_KINDS, GOVERNANCE_CAPABILITIES, governanceCapabilityResilience,
  DEPENDENCY_KINDS, DEPENDENCY_CATEGORIES, CRITICAL_CAPABILITIES, categoryOfKind,
  serviceResilience, regionResilience, personResilience, documentResilience, structuralResilience,
  dataResilience, knowledgeResilience, facilityResilience, legalAuthorityResilience, governanceResilience,
  DEPENDENCY_TYPES, KIND_TYPE, typeOfKind, dependencyIntelligence, dependencyImpact,
  RISK_PERSPECTIVES, CITIZEN_FACING, assertConstitutionalPrimacy, multiPerspectiveRisk,
  RISK_FACTORS, KIND_LIKELIHOOD, KIND_RECOVERY, scoreDependency, riskPrioritisation,
  INVARIANT_CLAUSES, assumptionClause, verificationClause, governanceRelationshipClause,
  legalAuthorityClause, controlEffectivenessClause,
  evaluateGlobalInvariant, globalInvariantReport,
  evaluate, recommendations, ResilienceAcceptance, report,
};
