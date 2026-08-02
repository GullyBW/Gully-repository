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
  return { valid: violations.length === 0, violations, regions: Object.keys(REGIONS).length, topologies: Object.keys(TOPOLOGIES).length };
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

module.exports = { REGIONS, TOPOLOGIES, SCENARIOS, quorum, splitBrainCheck, consistencyCheck, route, failover, verifyBackupRecovery, simulate, simulateAll, validate, report };
