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

// The eight kinds of single dependency Part 13 names. Each states how an alternative is VALIDATED,
// because that is the whole difficulty: a second name is not a second option.
const DEPENDENCY_KINDS = {
  person: { question: 'Could anybody else discharge this role today?', validatedBy: 'The alternative is available, active, currently trained and has rehearsed the role.' },
  team: { question: 'Does more than one team hold this capability?', validatedBy: 'A second accountable team is recorded for the capability, not merely a second individual inside one team.' },
  document: { question: 'Is the procedure recorded anywhere it can be followed from?', validatedBy: 'A governed operational document exists, resolves against the implementation, and carries prerequisites, permissions, rollback and escalation.' },
  process: { question: 'Is there a way to do this if the normal process is unavailable?', validatedBy: 'A declared fallback path exists and terminates at a named authority.' },
  service: { question: 'Would losing one service stop this capability?', validatedBy: 'The capability survives the loss of any single service in the declared topology.' },
  region: { question: 'Would losing one region stop this capability?', validatedBy: 'The capability still serves — read-only counts — with any single region lost.' },
  supplier: { question: 'Does this rest on one supplier?', validatedBy: 'More than one approved supplier can provide it, or the platform has no runtime dependency on any.' },
  'communication-channel': { question: 'If the usual channel is down, can people still be reached?', validatedBy: 'The escalation path names more than one way to reach the accountable authority.' },
};

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
    lossMeans: 'Reports accumulate without progressing, and the people who filed them are told nothing.',
    services: ['case-service', 'persistence-exec'], subsystems: ['investigation'], contexts: ['investigation'],
    document: 'operations/runbook.md',
  },
  'service-recovery': {
    title: 'The platform can be recovered after a failure', constitutional: false,
    lossMeans: 'An outage becomes permanent because nobody present knows how to end it.',
    services: ['persistence-ind', 'persistence-exec', 'persistence-jud'], subsystems: ['resilience', 'infrastructure'], contexts: ['resilience'],
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

// THE GLOBAL INVARIANT, evaluated across all eight dimensions for every critical capability.
function evaluate({ continuity = null, controls = [], regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const capabilities = Object.keys(CRITICAL_CAPABILITIES).sort().map((id) => {
    const spec = CRITICAL_CAPABILITIES[id];
    const findings = [
      personResilience(id, { continuity }),
      ...structuralResilience(id),
      documentResilience(id, { controls }),
      serviceResilience(id),
      regionResilience(id, { regions }),
    ];
    const singles = findings.filter((f) => f.singleDependency);
    return {
      capability: id, title: spec.title, constitutional: spec.constitutional, lossMeans: spec.lossMeans,
      findings, singleDependencies: singles.map((f) => f.kind),
      // Weakest link: a capability with a validated alternative on seven dimensions and none on the
      // eighth depends on a single thing.
      resilient: singles.length === 0,
      reason: singles.length ? `depends on a single ${singles.map((f) => f.kind).join(', a single ')}` : 'has a validated alternative on every dimension',
    };
  });
  const violations = capabilities.filter((c) => !c.resilient);
  const constitutional = violations.filter((c) => c.constitutional);
  return {
    invariant: 'No critical capability may depend on a single person, a single process, a single document, or a single system.',
    capabilities, dependencyKinds: Object.entries(DEPENDENCY_KINDS).map(([kind, k]) => ({ kind, ...k })),
    violations: violations.map((c) => ({ capability: c.capability, constitutional: c.constitutional, singleDependencies: c.singleDependencies, lossMeans: c.lossMeans })),
    violationCount: violations.length,
    constitutionalViolations: constitutional.map((c) => c.capability),
    holds: violations.length === 0,
    // Part 13: violations BLOCK institutional readiness until mitigated or explicitly accepted.
    blocksInstitutionalReadiness: violations.length > 0,
    failClosed: true, authorizes: false,
    note: 'An alternative counts only if the platform has evidence it could actually take over. This platform derives a deputy for every role and a replica for every region, so counting names would report perfect resilience everywhere and mean nothing.',
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

function report({ continuity = null, controls = [], acceptances = null, now = 0, regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const evaluation = evaluate({ continuity, controls, regions });
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
    failClosed: true, authorizes: false,
  };
}

module.exports = {
  DEPENDENCY_KINDS, CRITICAL_CAPABILITIES,
  serviceResilience, regionResilience, personResilience, documentResilience, structuralResilience,
  evaluate, recommendations, ResilienceAcceptance, report,
};
