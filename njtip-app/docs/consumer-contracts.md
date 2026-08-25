# Consumer-Driven Contract Testing (Phase 10, Part 12 · Phase 11, Part 12)

The [contract registry](./integration-contracts.md) says what the platform **offers**. This says what
each consumer actually **depends on**, and verifies the provider still satisfies every consumer
expectation before a change ships (`src/contracts/consumer-contracts.js`).

Gated by `APP-FIT-CONSUMER-CONTRACTS`. Live: `GET /api/contracts/consumers` ·
`POST /api/contracts/impact`.

> **The asymmetry that makes it useful:** a provider may **add** freely, but may only **remove or
> tighten** something no consumer depends on.

## Registered consumers

| Consumer | Owner | Criticality | Depends on |
|---|---|---|---|
| Citizen web client | intake | **constitutional** | `api.reports.submit`, `api.reports.status` |
| Investigator console | investigation | critical | `api.investigator.review`, `api.case.transition` |
| Oversight portal | governance-oversight | critical | `api.oversight.dashboard`, `api.governance.decision` |
| Partner agency integration | data-exchange | important | `api.data-exchange.request`, `schema.Case` |
| Analytics pipeline | analytics | important | `event.case.submitted`, `event.case.transitioned` |
| Audit archive | assurance | critical | `schema.EventEnvelope`, `event.governance.decided` |

Each expectation names precisely what the consumer reads, sends, which error codes it handles and the
authentication mode it is built for — so "we didn't know anyone used that" stops being possible.

## Impact analysis — before the change, not after the deploy

```
impactOfChange('api.case.transition', { fields: { required: ['case_code'] } })
→ safe: false
  affectedConsumers: [investigator-console]
  verdict: "BREAKS 1 consumer(s) — publish a new major version with a sunset and migrate them first"
```

A technically-breaking change that no registered consumer depends on is reported as such — precision
matters, because treating every removal as catastrophic is how teams learn to ignore the check.

Breaking the **citizen web client** raises `constitutionalImpact: true` separately, because that
consumer is the constitutional guarantee and deserves to be named, not counted.

## Deprecation and lifecycle

`deprecationReport()` lists every deprecated or sunsetting contract with its **live consumers** —
a deprecated contract with live consumers is a migration obligation, not a retirement.
`unconsumedContracts()` lists the opposite: published surface nobody depends on, which is
maintenance without a beneficiary and a candidate for deprecation.

## Validation

A consumer must name an owning context, a criticality, at least one expectation, at least one handled
error (a consumer that ignores failure is a consumer that fails silently), only canonical error codes,
and an expected authentication mode. The composition root refuses to start if any registered consumer
expectation is unmet.

---

# Consumer Impact Analysis (Phase 11, Part 12)

Gated by `APP-FIT-CONSUMER-IMPACT`. Live: `GET /api/contracts/consumer-impact`.

## Impact scoring — weighted by whom, not how many

```
score = Σ criticality weight of each newly-broken consumer
      + 15 if the change is technically breaking
      + 10 if three or more consumers depend on the contract
      (capped at 100)

constitutional 60 · critical 30 · important 10
severe ≥ 60 · high ≥ 30 · moderate > 0 · none = 0
```

Breaking the citizen client **once** outweighs inconveniencing several internal pipelines, and the
score has to say so — a count would rank them the other way round.

## Dependency visualization

`dependencyVisualization()` returns nodes and edges for a renderer **and** a deterministic text
rendering, so the graph is readable from a terminal and diffable in review:

```
api.reports.submit (v1, stable)
  └─ citizen-web [constitutional]
api.case.transition (v1, stable)
  └─ investigator-console [critical]
```

## Compatibility forecasting

`compatibilityForecast({ contract, steps })` applies planned changes **cumulatively** — because that
is how they will actually land — and reports the first step that breaks someone:

> *steps 0–0 are safe; step 1 ('drop category') requires a major version and a migration*

A roadmap that breaks a consumer at step four is a roadmap you want to know about at step zero.

## Adoption tracking

Adoption is **observed, never assumed**. `recordAdoption()` states which contract version a consumer
is actually running; `adoption(contract)` reports coverage, who is current, who is behind and by how
much, and — the important one — **who has not reported at all**. A provider that assumes its
consumers have upgraded is a provider about to break one.

## Deprecation analytics and migration readiness

`deprecationAnalytics({ now })` reports days to sunset, remaining consumers, weighted migration
burden, and flags `atRisk` (< 90 days) and `overdue` (past sunset with consumers still on it):

> *OVERDUE: consumers remain past the sunset — retiring now would break them*

`migrationReadiness({ contract, spec })` is **fail-closed**: an affected consumer whose adoption has
not been reported is **not ready**, and a blocked constitutional consumer is flagged separately. As
everywhere: `authorizes: false`.

---

# Release Impact Reporting (Phase 12, Part 12)

Everything above answers a question about **one** contract. A release is a **set** of changes
landing together, and the property that matters is not "is each change safe?" but "**is any consumer
hit by more than one of them?**"

`releaseImpact({ release, changes, now })` is the report that answers it, produced **before**
deployment — afterwards the same information is an incident report.

## What it blocks on

| Blocker | Why |
|---|---|
| `constitutional-consumer` | The change breaks a constitutional consumer. The constitutional path is not broken by a release, whatever the schedule says |
| `migration-not-ready` | The change is breaking and named consumers are not migrated |
| `simultaneous-break` | **Two or more changes in this release land on the same consumer** |
| `sunset-overdue` | Consumers remain past a contract's sunset date |
| `no-changes-assessed` | Nothing was submitted for assessment |

## The two that a per-contract report cannot produce

**Simultaneous break.** Two separately-acceptable changes hitting one consumer make one
*unacceptable* release: there is no intermediate version the consumer can run, so it cannot migrate
incrementally. Every per-contract report says "fine" twice; the roll-up says no.

**Nothing assessed.** An empty release is not a safe release — it is an **unmeasured** one, and the
two must not produce the same verdict. A gate that passes when it has been given nothing to check is
a gate that passes when it is bypassed.

## Aggregation

The release band is its **worst** change, not the mean of them. `totalScore` is reported alongside,
but nothing decides on it: a release containing one severe change and nine harmless ones is a severe
release.

`failClosed: true`, `authorizes: false`. Clearing the gate means no registered consumer is broken.
Deployment itself remains a recorded decision by a named human authority.

Live: `POST /api/contracts/release-impact` (admin).
