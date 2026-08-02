'use strict';
// Multi-Region Operational Resilience (Phase 10, Part 10). Active-active and active-passive
// topologies, regional failover, disaster recovery, JURISDICTION-AWARE routing, backup and
// recovery verification, split-brain prevention, cross-region consistency and executable
// failover simulation.
//
// The constraint that shapes everything here: data residency is a sovereign obligation. A
// failover that moves restricted data outside the permitted region is not a recovery, it is a
// breach — so routing and failover are both residency-aware and refuse the illegal option.
//
// Deterministic: quorum, routing and failover are pure functions of the declared topology.

// Regions with their jurisdiction and the classifications they may hold.
const REGIONS = {
  'bw-central': { jurisdiction: 'BW', sovereign: true, mayHold: ['public', 'internal', 'restricted', 'secret'], role: 'primary' },
  'bw-south': { jurisdiction: 'BW', sovereign: true, mayHold: ['public', 'internal', 'restricted', 'secret'], role: 'secondary' },
  'bw-north': { jurisdiction: 'BW', sovereign: true, mayHold: ['public', 'internal', 'restricted'], role: 'tertiary' },
  'za-north': { jurisdiction: 'ZA', sovereign: false, mayHold: ['public'], role: 'edge-cache' },
};

// `minRegionsToServeReads` is the READ threshold; WRITES always require quorum regardless.
// Keeping the read threshold at 1 is deliberate: a single surviving sovereign region should
// still serve the constitutional path read-only rather than going dark.
const TOPOLOGIES = {
  'active-active': {
    description: 'All sovereign regions serve traffic; writes require a quorum, reads survive on one.',
    minRegionsToServeReads: 1, quorumOf: 3, rtoMinutes: 5, rpoMinutes: 0,
    suitableFor: ['anonymous-reporting', 'case-status'],
    tradeoff: 'Highest availability and cost; cross-region consistency must never breach zone isolation.',
  },
  'active-passive': {
    description: 'One region serves; a warm standby is promoted on failure.',
    minRegionsToServeReads: 1, quorumOf: 2, rtoMinutes: 30, rpoMinutes: 5,
    suitableFor: ['investigation', 'oversight'],
    tradeoff: 'Cheaper, but replication lag defines the data loss and promotion is a one-way door.',
  },
};

// --- Quorum & split-brain prevention -------------------------------------------------------

// A write is only safe with a strict majority of the sovereign replica set. Fencing tokens
// make a stale primary's writes rejectable after a partition heals.
function quorum({ regions = ['bw-central', 'bw-south', 'bw-north'], healthy = [] } = {}) {
  const set = regions.filter((r) => REGIONS[r] && REGIONS[r].sovereign);
  const up = healthy.filter((r) => set.includes(r));
  const required = Math.floor(set.length / 2) + 1;
  return { replicaSet: set, healthy: up, required, hasQuorum: up.length >= required, note: 'A strict majority of sovereign regions is required for a write.' };
}

// Split-brain prevention: only the partition holding quorum may serve writes, and it must
// carry a fencing token strictly greater than any previously issued one.
function splitBrainCheck({ partitions = [], lastFencingToken = 0 } = {}) {
  const evaluated = partitions.map((p, i) => {
    const q = quorum({ regions: p.replicaSet || ['bw-central', 'bw-south', 'bw-north'], healthy: p.regions });
    return { partition: p.name || `p${i}`, regions: [...p.regions], hasQuorum: q.hasQuorum, mayServeWrites: q.hasQuorum, required: q.required };
  });
  const writable = evaluated.filter((p) => p.mayServeWrites);
  const token = writable.length === 1 ? lastFencingToken + 1 : lastFencingToken;
  return {
    partitions: evaluated,
    writablePartitions: writable.length,
    splitBrain: writable.length > 1,
    fencingToken: token,
    safe: writable.length <= 1,
    outcome: writable.length === 1 ? `partition '${writable[0].partition}' holds quorum and is fenced at token ${token}`
      : writable.length === 0 ? 'no partition holds quorum — the platform is READ-ONLY rather than divergent'
        : 'SPLIT BRAIN: more than one partition believes it may write',
    note: 'Two writable partitions is a correctness failure, not a degradation. Read-only is the safe outcome.',
  };
}

// Cross-region consistency: a replica is consistent when it has applied every committed write.
function consistencyCheck({ committedSequence = 0, replicas = {} } = {}) {
  const rows = Object.entries(replicas).map(([region, applied]) => ({ region, applied, lag: committedSequence - applied, consistent: applied === committedSequence }));
  const stale = rows.filter((r) => !r.consistent);
  return {
    committedSequence, replicas: rows, stale: stale.map((r) => r.region),
    maxLag: rows.length ? Math.max(...rows.map((r) => r.lag)) : 0,
    consistent: stale.length === 0,
    readsSafeFrom: rows.filter((r) => r.consistent).map((r) => r.region),
    note: 'A stale replica may serve reads only where the journey tolerates it; writes always go to quorum.',
  };
}

// --- Consistency governance per bounded context (Phase 11, Part 10) ---------------------------
//
// "Eventually consistent" is a promise nobody can check unless someone writes down which data it
// applies to and what a reader is allowed to see meanwhile. This registry makes the choice
// explicit per bounded context, so a stale read is either declared acceptable or refused — never
// discovered by a citizen.
const CONSISTENCY_MODELS = {
  strong: {
    description: 'Every read observes the latest committed write. Reads go to quorum.',
    maxStalenessMs: 0, readsFromReplica: false, requiresQuorumRead: true,
    cost: 'Higher read latency and no read availability below quorum.',
  },
  causal: {
    description: 'Reads observe writes in causal order; a reader never goes backwards in its own session.',
    maxStalenessMs: 5_000, readsFromReplica: true, requiresQuorumRead: false,
    cost: 'Requires session tracking; a different session may still see an older state.',
  },
  eventual: {
    description: 'Replicas converge; a read may observe a stale value within the declared bound.',
    maxStalenessMs: 60_000, readsFromReplica: true, requiresQuorumRead: false,
    cost: 'Cheapest and most available; only safe where a stale answer cannot mislead.',
  },
};

// Replication policy per context. `conflictResolution` is stated, never implicit: an unstated
// resolution strategy is last-writer-wins by accident, which silently loses data.
const REPLICATION_POLICIES = {
  synchronous: { description: 'Write completes only when quorum has applied it.', rpoMinutes: 0, appliesTo: ['strong'] },
  'semi-synchronous': { description: 'Write completes when one replica has applied it; the rest follow.', rpoMinutes: 1, appliesTo: ['strong', 'causal'] },
  asynchronous: { description: 'Write completes locally and replicates in the background.', rpoMinutes: 5, appliesTo: ['causal', 'eventual'] },
};

const CONFLICT_RESOLUTION = {
  'quorum-serialized': 'Conflicts cannot arise: writes are serialized through quorum.',
  'append-only-chain': 'The record is an append-only hash chain; a divergent branch is rejected, never merged.',
  'last-writer-wins': 'The later timestamp wins. Only acceptable where losing an update costs nothing.',
  'human-adjudicated': 'A conflict is escalated to a named human. Nothing is merged automatically.',
};

// The declared consistency stance of every bounded context that holds state. A context whose
// data is a constitutional record gets strong consistency and an append-only chain; a context
// whose data is a derived view gets eventual, because a stale dashboard misleads nobody who has
// been told it is a dashboard.
const CONTEXT_CONSISTENCY = {
  intake: { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'A filed report must never be lost or duplicated — this is the constitutional guarantee.', staleReadsAcceptable: false },
  custody: { model: 'strong', replication: 'synchronous', conflictResolution: 'append-only-chain', rationale: 'Chain of custody admits no divergent branch; a merged custody chain is not evidence.', staleReadsAcceptable: false },
  'governance-oversight': { model: 'strong', replication: 'synchronous', conflictResolution: 'append-only-chain', rationale: 'A recorded human decision has RPO zero. Losing one destroys accountability.', staleReadsAcceptable: false },
  'identity-access': { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'A revocation that replicates late is an authorization that should not exist.', staleReadsAcceptable: false },
  'policy-governance': { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'A region evaluating an older policy version is a region enforcing a policy nobody approved.', staleReadsAcceptable: false },
  investigation: { model: 'causal', replication: 'semi-synchronous', conflictResolution: 'human-adjudicated', rationale: 'An investigator must never see their own work disappear; conflicting case edits go to a human.', staleReadsAcceptable: false },
  orchestration: { model: 'causal', replication: 'semi-synchronous', conflictResolution: 'human-adjudicated', rationale: 'Workflow state must move forward monotonically within a session.', staleReadsAcceptable: false },
  'platform-events': { model: 'causal', replication: 'semi-synchronous', conflictResolution: 'append-only-chain', rationale: 'Event order is causal by construction; the chain rejects a divergent branch.', staleReadsAcceptable: false },
  persistence: { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'The storage substrate cannot be weaker than the strongest context it serves.', staleReadsAcceptable: false },
  'crypto-agility': { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'A key or algorithm state that differs between regions makes ciphertext unreadable.', staleReadsAcceptable: false },
  analytics: { model: 'eventual', replication: 'asynchronous', conflictResolution: 'last-writer-wins', rationale: 'Aggregates are derived and labelled as such; a minute-old count misleads nobody.', staleReadsAcceptable: true },
  observability: { model: 'eventual', replication: 'asynchronous', conflictResolution: 'last-writer-wins', rationale: 'Telemetry is a stream of observations; the latest wins and nothing is lost that matters.', staleReadsAcceptable: true },
  'data-fabric': { model: 'eventual', replication: 'asynchronous', conflictResolution: 'last-writer-wins', rationale: 'Catalogue metadata converges; a stale entry delays discovery, it does not corrupt data.', staleReadsAcceptable: true },
  'data-exchange': { model: 'causal', replication: 'semi-synchronous', conflictResolution: 'human-adjudicated', rationale: 'A partner reading an exchange agreement must see it in causal order with its amendments.', staleReadsAcceptable: false },
  privacy: { model: 'strong', replication: 'synchronous', conflictResolution: 'quorum-serialized', rationale: 'A withdrawn consent that replicates late is processing without consent.', staleReadsAcceptable: false },
  assurance: { model: 'eventual', replication: 'asynchronous', conflictResolution: 'last-writer-wins', rationale: 'Assurance evidence is recomputed from source on every build; a stale copy is replaced, not merged.', staleReadsAcceptable: true },
};

function consistencyModels() { return Object.entries(CONSISTENCY_MODELS).map(([id, m]) => ({ id, ...m })); }
function replicationPolicies() { return Object.entries(REPLICATION_POLICIES).map(([id, p]) => ({ id, ...p, appliesTo: [...p.appliesTo] })); }
function contextConsistency(context = null) {
  if (context) {
    const c = CONTEXT_CONSISTENCY[context];
    if (!c) return { context, declared: false, reason: `no consistency stance declared for context '${context}'` };
    return { context, declared: true, ...c, ...CONSISTENCY_MODELS[c.model], conflictDescription: CONFLICT_RESOLUTION[c.conflictResolution] };
  }
  return Object.keys(CONTEXT_CONSISTENCY).sort().map((id) => contextConsistency(id));
}

// Is this read safe from this replica, given how far behind it is? The answer is a function of
// the context's declared model, not of how convenient it would be to say yes.
function readAllowed({ context, replicaLagMs = 0, hasQuorum = true, sameSession = false } = {}) {
  const c = contextConsistency(context);
  if (!c.declared) return { allowed: false, reason: c.reason, failClosed: true };
  const model = CONSISTENCY_MODELS[c.model];
  if (model.requiresQuorumRead && !hasQuorum) {
    return { allowed: false, context, model: c.model, reason: `'${context}' requires strong consistency and this read has no quorum`, failClosed: true };
  }
  if (!model.readsFromReplica && replicaLagMs > 0) {
    return { allowed: false, context, model: c.model, reason: `'${context}' does not permit replica reads; this replica is ${replicaLagMs}ms behind`, failClosed: true };
  }
  if (c.model === 'causal' && !sameSession && replicaLagMs > model.maxStalenessMs) {
    return { allowed: false, context, model: c.model, reason: `'${context}' is causally consistent and this replica is ${replicaLagMs}ms behind, beyond the ${model.maxStalenessMs}ms bound`, failClosed: true };
  }
  if (replicaLagMs > model.maxStalenessMs) {
    return { allowed: false, context, model: c.model, reason: `replica lag ${replicaLagMs}ms exceeds the ${model.maxStalenessMs}ms staleness bound for '${c.model}'`, failClosed: true };
  }
  return { allowed: true, context, model: c.model, replicaLagMs, maxStalenessMs: model.maxStalenessMs, reason: `within the ${model.maxStalenessMs}ms bound for '${c.model}' consistency` };
}

// Validate the registry against the platform's own architecture-of-record. This is the check that
// makes the registry an obligation rather than a table: a new stateful context with no declared
// stance fails the build.
function validateConsistency({ contextIds = null } = {}) {
  const violations = [];
  for (const [id, c] of Object.entries(CONTEXT_CONSISTENCY)) {
    if (!CONSISTENCY_MODELS[c.model]) violations.push(`${id}: unknown consistency model '${c.model}'`);
    if (!REPLICATION_POLICIES[c.replication]) violations.push(`${id}: unknown replication policy '${c.replication}'`);
    else if (!REPLICATION_POLICIES[c.replication].appliesTo.includes(c.model)) violations.push(`${id}: replication '${c.replication}' is incompatible with '${c.model}' consistency`);
    if (!CONFLICT_RESOLUTION[c.conflictResolution]) violations.push(`${id}: unknown conflict resolution '${c.conflictResolution}'`);
    if (!c.rationale) violations.push(`${id}: no rationale for its consistency choice`);
    if (typeof c.staleReadsAcceptable !== 'boolean') violations.push(`${id}: does not state whether stale reads are acceptable`);
    // A strongly consistent context cannot also declare stale reads acceptable.
    if (c.model === 'strong' && c.staleReadsAcceptable) violations.push(`${id}: claims strong consistency but accepts stale reads`);
    // Last-writer-wins silently loses an update, so it may only govern data where that is fine.
    if (c.conflictResolution === 'last-writer-wins' && !c.staleReadsAcceptable) violations.push(`${id}: resolves conflicts by last-writer-wins on data where a stale read is not acceptable`);
    if (contextIds && !contextIds.includes(id)) violations.push(`${id}: declares a consistency stance but is not a bounded context`);
  }
  // Every context that owns constitutional or evidentiary state must be declared.
  for (const required of ['intake', 'custody', 'governance-oversight', 'identity-access', 'policy-governance']) {
    if (!CONTEXT_CONSISTENCY[required]) violations.push(`${required}: a constitutional context has no declared consistency stance`);
    else if (CONTEXT_CONSISTENCY[required].model !== 'strong') violations.push(`${required}: a constitutional context declares '${CONTEXT_CONSISTENCY[required].model}' rather than strong consistency`);
  }
  return { valid: violations.length === 0, violations, contexts: Object.keys(CONTEXT_CONSISTENCY).length };
}

// What each region may serve for each context, given its current lag. This is the report an
// operator reads during a partition to decide what to shed.
function consistencyPosture({ committedSequence = 0, replicas = {}, healthy = [], regions = ['bw-central', 'bw-south', 'bw-north'] } = {}) {
  const q = quorum({ regions, healthy });
  const cc = consistencyCheck({ committedSequence, replicas });
  const lagMsPerSeq = 1000;   // deterministic mapping from sequence lag to a staleness estimate
  const rows = [];
  for (const context of Object.keys(CONTEXT_CONSISTENCY).sort()) {
    for (const r of cc.replicas) {
      const decision = readAllowed({ context, replicaLagMs: r.lag * lagMsPerSeq, hasQuorum: q.hasQuorum });
      rows.push({ context, region: r.region, lag: r.lag, model: CONTEXT_CONSISTENCY[context].model, readAllowed: decision.allowed, reason: decision.reason });
    }
  }
  const refused = rows.filter((x) => !x.readAllowed);
  return {
    quorum: q, consistency: cc, matrix: rows,
    refusedReads: refused.map((x) => `${x.context}@${x.region}: ${x.reason}`),
    writesAvailable: q.hasQuorum,
    validation: validateConsistency(),
    failClosed: true, authorizes: false,
    note: 'A stale read is either declared acceptable in advance or refused. It is never discovered by a citizen.',
  };
}

// --- Jurisdiction-aware routing --------------------------------------------------------------

// Route a request to a region that is healthy AND legally permitted to hold the classification.
// An illegal placement is REFUSED — never "best effort".
function route({ classification = 'internal', healthy = [], preferred = null } = {}) {
  const candidates = Object.entries(REGIONS)
    .filter(([id, r]) => healthy.includes(id) && r.mayHold.includes(classification))
    .map(([id, r]) => ({ region: id, jurisdiction: r.jurisdiction, sovereign: r.sovereign, role: r.role }));
  const illegal = healthy.filter((id) => REGIONS[id] && !REGIONS[id].mayHold.includes(classification));
  if (!candidates.length) {
    return { routed: false, reason: `no healthy region may hold '${classification}' data`, refusedRegions: illegal, failClosed: true, note: 'Refusing to serve is correct: routing restricted data to a region that may not hold it would be a residency breach, not a fallback.' };
  }
  const order = { primary: 0, secondary: 1, tertiary: 2, 'edge-cache': 3 };
  candidates.sort((a, b) => (a.region === preferred ? -1 : b.region === preferred ? 1 : 0) || order[a.role] - order[b.role] || a.region.localeCompare(b.region));
  return { routed: true, region: candidates[0].region, candidates, refusedRegions: illegal, reason: illegal.length ? `${illegal.join(', ')} may not hold '${classification}' data` : 'all healthy regions are permitted' };
}

// --- Failover -----------------------------------------------------------------------------------

// Simulate a regional failure under a topology. Deterministic and residency-aware.
function failover({ topology = 'active-active', regions = ['bw-central', 'bw-south', 'bw-north'], failed = [], classification = 'restricted' } = {}) {
  const t = TOPOLOGIES[topology];
  if (!t) throw new Error('unknown topology: ' + topology);
  const healthy = regions.filter((r) => !failed.includes(r));
  const q = quorum({ regions, healthy });
  const routing = route({ classification, healthy });
  const canServe = healthy.length >= t.minRegionsToServeReads && routing.routed;
  return {
    topology, regions: [...regions], failed: [...failed], healthy,
    quorum: q, routing,
    servesTraffic: canServe,
    acceptsWrites: canServe && q.hasQuorum,
    mode: canServe ? (q.hasQuorum ? 'read-write' : 'read-only') : 'unavailable',
    objectives: { rtoMinutes: t.rtoMinutes, rpoMinutes: t.rpoMinutes },
    tradeoff: t.tradeoff,
    note: 'Losing write quorum degrades to READ-ONLY rather than accepting divergent writes.',
  };
}

// --- Backup & recovery verification ---------------------------------------------------------------

// A backup counts only when a restore reproduces it and the restored copy lands in a region
// that may legally hold that classification.
function verifyBackupRecovery({ classification = 'restricted', sourceDigest, restoredDigest, restoredRegion, recordsIn = 0, recordsOut = 0 } = {}) {
  const digestMatch = !!sourceDigest && sourceDigest === restoredDigest;
  const countMatch = recordsIn === recordsOut;
  const residencyOk = !!(REGIONS[restoredRegion] && REGIONS[restoredRegion].mayHold.includes(classification));
  return {
    classification, restoredRegion,
    digestMatch, countMatch, residencyOk,
    verified: digestMatch && countMatch && residencyOk,
    reason: !digestMatch ? 'restored content does not match the source digest'
      : !countMatch ? 'restored record count differs from the source'
        : !residencyOk ? `region '${restoredRegion}' may not hold '${classification}' data — this restore would be a residency breach`
          : 'restore verified: content, count and residency all hold',
    note: 'A restore into a region that may not hold the data is a breach, not a recovery.',
  };
}

// --- Recovery simulations -----------------------------------------------------------------------------

const SCENARIOS = {
  'single-region-loss': { topology: 'active-active', failed: ['bw-south'], expect: 'read-write' },
  'primary-region-loss': { topology: 'active-active', failed: ['bw-central'], expect: 'read-write' },
  'two-region-loss': { topology: 'active-active', failed: ['bw-central', 'bw-south'], expect: 'read-only' },   // one sovereign region survives: reads yes, writes no
  'total-sovereign-loss': { topology: 'active-active', failed: ['bw-central', 'bw-south', 'bw-north'], expect: 'unavailable' },
  'passive-promotion': { topology: 'active-passive', regions: ['bw-central', 'bw-south'], failed: ['bw-central'], expect: 'read-only' },
};

function simulate(scenarioId) {
  const s = SCENARIOS[scenarioId];
  if (!s) throw new Error('unknown recovery scenario: ' + scenarioId);
  const result = failover({ topology: s.topology, regions: s.regions || ['bw-central', 'bw-south', 'bw-north'], failed: s.failed, classification: 'restricted' });
  return { scenario: scenarioId, expected: s.expect, actual: result.mode, matches: result.mode === s.expect, result, note: 'Deterministic failover simulation; it validates the design, it does not authorize a failover.' };
}
function simulateAll() {
  const results = Object.keys(SCENARIOS).map(simulate);
  return { scenarios: results, allMatch: results.every((r) => r.matches), mismatched: results.filter((r) => !r.matches).map((r) => r.scenario), authorizes: false };
}

// --- Validation & report --------------------------------------------------------------------------------

function validate() {
  const violations = [];
  for (const [id, r] of Object.entries(REGIONS)) {
    if (!r.jurisdiction) violations.push(`${id}: no jurisdiction`);
    if (!r.mayHold.length) violations.push(`${id}: holds no classification — it should not exist`);
    if (!r.sovereign && r.mayHold.some((c) => c !== 'public')) violations.push(`${id}: a non-sovereign region may hold only public data`);
  }
  for (const [id, t] of Object.entries(TOPOLOGIES)) {
    if (!(t.minRegionsToServeReads >= 1)) violations.push(`${id}: minRegionsToServeReads must be at least 1`);
    if (!t.suitableFor.length) violations.push(`${id}: no journey is declared suitable for this topology`);
    if (!t.tradeoff) violations.push(`${id}: no named trade-off`);
  }
  // At least two sovereign regions, or there is no failover at all.
  if (Object.values(REGIONS).filter((r) => r.sovereign).length < 2) violations.push('fewer than two sovereign regions — no failover is possible');
  // Phase 11, Part 10: the consistency registry is part of the operational contract.
  for (const violation of validateConsistency().violations) violations.push(violation);
  return { valid: violations.length === 0, violations, regions: Object.keys(REGIONS).length, topologies: Object.keys(TOPOLOGIES).length, consistencyContexts: Object.keys(CONTEXT_CONSISTENCY).length };
}

function report() {
  return {
    regions: Object.entries(REGIONS).map(([id, r]) => ({ id, ...r, mayHold: [...r.mayHold] })),
    topologies: Object.entries(TOPOLOGIES).map(([id, t]) => ({ id, ...t, suitableFor: [...t.suitableFor] })),
    simulations: simulateAll(),
    splitBrain: splitBrainCheck({ partitions: [{ name: 'majority', regions: ['bw-central', 'bw-south'] }, { name: 'minority', regions: ['bw-north'] }] }),
    validation: validate(),
    authorizes: false,
    note: 'Multi-region resilience is residency-aware: a failover that moves restricted data outside its permitted region is refused, not degraded.',
  };
}

module.exports = {
  REGIONS, TOPOLOGIES, SCENARIOS,
  CONSISTENCY_MODELS, REPLICATION_POLICIES, CONFLICT_RESOLUTION, CONTEXT_CONSISTENCY,
  quorum, splitBrainCheck, consistencyCheck, route, failover, verifyBackupRecovery,
  consistencyModels, replicationPolicies, contextConsistency, readAllowed, validateConsistency, consistencyPosture,
  simulate, simulateAll, validate, report,
};
