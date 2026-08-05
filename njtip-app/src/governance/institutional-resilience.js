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
  'communication-channel': { question: 'If the usual channel is down, can people still be reached?', validatedBy: 'The escalation path names more than one way to reach the accountable authority.', detectedBy: null },
  data: { question: 'Would losing one dataset stop this capability, with no way to reconstruct it?', validatedBy: 'The data is replicated across zones, or derivable from an append-only source the capability also holds.', detectedBy: 'APP-FIT-DATA-GOVERNANCE' },
  knowledge: { question: 'Does the know-how exist anywhere other than in one person\'s head?', validatedBy: 'A second person is trained and has rehearsed, AND the procedure is written down. Either alone is a name, not knowledge.', detectedBy: 'APP-FIT-GOVERNANCE-REHEARSALS' },
  facility: { question: 'Would losing one physical site stop this capability?', validatedBy: 'More than one sovereign site can host it. NOTE: the platform models regions, not buildings — this is a proxy and is reported as one.', detectedBy: null },
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
  active({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((a) => t < a.expiresAt).map((a) => ({ ...a })); }
  expired({ now = null } = {}) { const t = now ?? this._clock(); return this._items.filter((a) => t >= a.expiresAt).map((a) => ({ ...a })); }
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
    failClosed: true, authorizes: false,
  };
}

module.exports = {
  DEPENDENCY_KINDS, DEPENDENCY_CATEGORIES, CRITICAL_CAPABILITIES, categoryOfKind,
  serviceResilience, regionResilience, personResilience, documentResilience, structuralResilience,
  dataResilience, knowledgeResilience, facilityResilience, legalAuthorityResilience, governanceResilience,
  RISK_FACTORS, KIND_LIKELIHOOD, KIND_RECOVERY, scoreDependency, riskPrioritisation,
  evaluate, recommendations, ResilienceAcceptance, report,
};
