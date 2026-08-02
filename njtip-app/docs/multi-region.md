# Multi-Region Operational Resilience (Phase 10, Part 10 · Phase 11, Part 10)

Active-active and active-passive topologies, regional failover, disaster recovery,
jurisdiction-aware routing, backup and recovery verification, split-brain prevention, cross-region
consistency and executable failover simulation (`src/twin2/multi-region.js`).

Gated by `APP-FIT-MULTI-REGION`. Live: `GET /api/resilience/multi-region`.

> **The constraint that shapes everything here:** data residency is a sovereign obligation. A
> failover that moves restricted data outside its permitted region is not a recovery — it is a
> breach. So routing and failover are residency-aware and **refuse** the illegal option rather than
> degrading to it.

## Regions

| Region | Jurisdiction | Sovereign | May hold | Role |
|---|---|---|---|---|
| `bw-central` | BW | ✅ | public · internal · restricted · secret | primary |
| `bw-south` | BW | ✅ | public · internal · restricted · secret | secondary |
| `bw-north` | BW | ✅ | public · internal · restricted | tertiary |
| `za-north` | ZA | ❌ | **public only** | edge cache |

A non-sovereign region may hold only public data — enforced by the validator, not by convention.

## Topologies

| Topology | Reads survive on | Writes | RTO | RPO | Suitable for |
|---|---|---|---|---|---|
| active-active | 1 sovereign region | quorum of 3 | 5 min | 0 | anonymous reporting, case status |
| active-passive | 1 region | quorum of 2 | 30 min | 5 min | investigation, oversight |

`minRegionsToServeReads` is deliberately 1: a single surviving sovereign region should still serve
the constitutional path **read-only** rather than going dark. Writes always require quorum.

## Failover behaviour

| Scenario | Healthy | Quorum | Mode |
|---|---|---|---|
| Single region lost | 2 of 3 | ✅ | read-write |
| Primary region lost | 2 of 3 | ✅ | read-write |
| Two regions lost | 1 of 3 | ❌ | **read-only** |
| All sovereign regions lost | 0 | ❌ | unavailable |
| Active-passive promotion | 1 of 2 | ❌ | read-only |

Losing write quorum degrades to read-only rather than accepting divergent writes. That is the whole
design: availability is valuable, correctness is not negotiable.

## Split-brain prevention

Only the partition holding a **strict majority** of sovereign regions may write, and it receives a
**fencing token** strictly greater than any previously issued — so a stale primary's writes are
rejectable after the partition heals.

```
majority partition holds quorum   → writable, fenced at token n+1
no partition holds quorum         → READ-ONLY (the safe outcome, not a failure)
two writable partitions           → SPLIT BRAIN — a correctness failure, reported as such
```

## Jurisdiction-aware routing

`route({ classification, healthy })` returns a region that is healthy **and** legally permitted to
hold that classification. If none qualifies it returns `routed: false, failClosed: true` — refusing
to serve is correct, because routing restricted data to `za-north` would be a residency breach, not
a fallback. Refused regions are named in the response so the operator sees *why*.

## Backup and recovery verification

A restore counts only when **content digest**, **record count** and **residency** all hold. A
byte-perfect restore into a region that may not hold the data is reported as a breach, not a
recovery.

---

# Consistency Governance (Phase 11, Part 10)

"Eventually consistent" is a promise nobody can check unless someone writes down **which data** it
applies to and **what a reader is allowed to see meanwhile**. The registry in
`src/twin2/multi-region.js` makes that explicit per bounded context, so a stale read is either
declared acceptable in advance or refused — never discovered by a citizen.

Gated by `APP-FIT-CONSISTENCY-GOVERNANCE`. Live: `GET /api/resilience/consistency`.

## Models

| Model | Max staleness | Replica reads | Quorum read | Cost |
|---|---|---|---|---|
| **strong** | 0 | no | required | Higher read latency; no read availability below quorum |
| **causal** | 5 s | yes | no | Session tracking required; another session may see older state |
| **eventual** | 60 s | yes | no | Cheapest and most available; only safe where a stale answer cannot mislead |

## Stance per context

| Consistency | Contexts | Why |
|---|---|---|
| **strong** | intake · custody · governance-oversight · identity-access · policy-governance · privacy · persistence · crypto-agility | A filed report, a custody chain, a recorded decision, a revocation, a policy version, a withdrawn consent — none of these may be observed late |
| **causal** | investigation · orchestration · platform-events · data-exchange | An investigator must never see their own work disappear; workflow state moves forward monotonically within a session |
| **eventual** | analytics · observability · data-fabric · assurance | Derived views, labelled as such. A minute-old count misleads nobody |

Two rules are checked mechanically because they are the ways this table quietly goes wrong:

- A context claiming **strong** consistency may not also accept stale reads.
- **last-writer-wins** may only govern data where a stale read is already acceptable — it silently
  loses an update, and an unstated conflict strategy *is* last-writer-wins by accident.

## Replication and conflict resolution

`synchronous` (RPO 0) · `semi-synchronous` (RPO 1 min) · `asynchronous` (RPO 5 min), each declaring
which consistency models it can support — an incompatible pairing fails validation.

Conflict resolution is always stated: `quorum-serialized` (conflicts cannot arise),
`append-only-chain` (a divergent branch is rejected, never merged — a merged custody chain is not
evidence), `last-writer-wins`, or `human-adjudicated`.

## The read gate

`readAllowed({ context, replicaLagMs, hasQuorum, sameSession })` refuses rather than degrades, and
**an undeclared context fails closed**. A new stateful bounded context with no declared stance fails
the build rather than inheriting something permissive.

`consistencyPosture()` renders the whole matrix — context × region × lag — so an operator reading it
during a partition knows exactly which reads to shed rather than guessing.
