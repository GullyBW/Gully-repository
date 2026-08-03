# Business Observability (Phase 11, Part 5 · Phase 12, Part 5)

Technical telemetry answers *"is the system up?"*. This module answers the question the Oversight
Board actually asks: **"is justice moving?"** (`src/observability/business.js`).

Gated by `APP-FIT-BUSINESS-OBSERVABILITY`. Live: `GET /api/observability/business` (oversight-board).

> **Every value is derived; none is entered.** A national KPI that someone can type in is a number
> about the person typing it, not about the justice system.

## The metrics

| Metric | Unit | Better | Objective | Board | Derived from |
|---|---|---|---|---|---|
| Case throughput | cases/period | higher | 20 | SDB | `CaseTransitioned` reaching a terminal state |
| Investigation latency | hours | lower | 168 | SDB | `CaseCreated` → terminal `CaseTransitioned` |
| Evidence processing time | hours | lower | 48 | SDB | `EvidenceIngested` → `EvidenceAdmitted` |
| Judicial workflow duration | hours | lower | 336 | OB | `CaseReviewed` → `GovernanceDecided` |
| Policy violation rate | per 100 events | lower | 2 | OB | `PolicyViolated` / domain events |
| Audit completion rate | fraction | higher | 0.95 | OB | `AuditCompleted` / `AuditScheduled` |
| Governance review time | hours | lower | 120 | OB | `ReviewRequested` → `ReviewCompleted` |
| Approval delay | hours | lower | 72 | OB | `ApprovalRequested` → `ApprovalGranted`/`Rejected` |
| Compliance rate | fraction | higher | 0.98 | OB | `ComplianceChecked` with outcome ok |

Every metric names an **owning governance board** and at least one technical service level to
correlate against — a KPI with no owner is a chart, and the fitness gate rejects one.

## Three rules that shape the module

**1. Identity-bearing events are refused, not stripped.** `assertPiiFree()` throws on any event
carrying a denylisted field. Silently dropping the field would hide the real problem — something
upstream is emitting identity into an analytics stream, and that needs fixing at the source rather
than laundering at the boundary. `fromEventLog()` then carries exactly four fields across from the
immutable log (`type`, `correlationId`, `at`, `to`/`outcome`), so a new domain field cannot leak
into a business surface by default.

**2. No evidence is not a pass.** A metric with nothing behind it reports `no-evidence` — never
`met`. An empty event stream produces an *unhealthy* dashboard, not a green one. The gate asserts
this directly, because the failure mode of every KPI system is a metric that looks fine because
nothing is reporting.

**3. An in-flight case counts as `open`.** Averaging only *completed* work is the classic way to
make a growing backlog look healthy: close the easy cases fast, and the mean improves while the
queue grows. `dwellTimes()` reports `completed` and `open` side by side.

## Trend polarity

`trend()` says whether a number is rising. Whether that is *good* depends on the metric, so movement
is interpreted against each metric's own direction:

```
approval-delay   [10 → 40]   rising duration        → worsening
case-throughput  [30 → 24]   falling throughput     → worsening
approval-delay   [40 → 10]   falling duration       → improving
```

## Correlating technical with business

`correlateWithReliability()` computes Pearson correlation between a business metric's history and
the availability history of the services it depends on, then reports a **hypothesis**:

- `causal: false` and `authorizes: false` on every response.
- Fewer than three paired points, or a constant series → `null`, not a misleading zero.
- **An unexpected direction is flagged, not buried.** If availability rises while a higher-better
  metric falls, the finding says the *model may be wrong* — that is the interesting result, and a
  correlation engine that only confirms its own assumptions is worse than none.

Nothing here triggers an action. It gives a named human a specific thing to go and check.

---

# The Mission Correlation Chain (Phase 12, Part 5)

Gated by `APP-FIT-MISSION-CORRELATION`. Live: `GET /api/observability/mission` ·
`GET /api/observability/mission-impact/{component}`.

```
Infrastructure → Applications → Business Processes → Mission Outcomes
```

The chain exists because those four layers are owned by four different groups who each see their
own and none of the others. An infrastructure engineer knows a broker is degraded; nobody
downstream knows that means evidence is queuing, which means cases stall, which means the platform
is failing at the thing it exists to do.

**Every link states a mechanism.** A link with no mechanism is a diagram, not a model — and the
validator refuses one.

## Mission outcomes

| Outcome | Constitutional | Board |
|---|---|---|
| A citizen can file a report anonymously | **yes** | OB |
| Reported conduct is investigated and reaches an outcome | no | SDB |
| Evidence retains an unbroken, admissible chain of custody | **yes** | OB |
| Every governance decision is attributable to a named human | **yes** | OB |
| Oversight can see the true state of the system | no | OB |

## Tracing a failure to the board's language

```
persistence-ind fails
  → event-store-ind, intake-api unavailable
  → case-throughput falls to zero
  → "A citizen can file a report anonymously"  ← CONSTITUTIONAL
```

`impactOf({ failed })` returns each layer separately plus a `boardSummary` in the Oversight Board's
own words. That is the point: an incident commander should not have to translate.

## Two rules the validator enforces

- **Every business metric must reach a mission outcome** — otherwise nobody can say why it is
  measured. This immediately found `governance-review-time` measured and reaching nothing; the link
  was real and simply missing from the record.
- **Every mission outcome must be reachable** — otherwise nothing the platform measures says
  anything about it.

## Executive analytics

Mission health derived from the business metrics that feed each outcome, through the declared
chain. An outcome fed only by unmeasured metrics reports **`unknown`** — which, as the payload says
in as many words, *is not the same as fine*.

---

# Predictive Mission Impact Analysis (Phase 12, Part 18)

The correlation chain answers an incident commander's question: *"what has this outage broken, in the
board's language?"* This section answers a different one, asked **before** anything is deployed:

```
Technical Event → Business Process → Justice Service → Citizen Impact → Mission Objective
                                                                            → Strategic Goal
```

Gated by `APP-FIT-MISSION-IMPACT`. Live: `GET /api/observability/mission-chain` ·
`POST /api/observability/mission-forecast`.

## The two layers nobody writes down

A **justice service** is the thing a citizen actually receives. A **citizen impact** is what happens
to a person when they do not receive it.

| Justice service | Delivers | Constitutional |
|---|---|---|
| `anonymous-reporting` | A route into the justice system for someone who cannot afford to be known to have used it | ✅ |
| `case-investigation` | The state examining reported conduct rather than filing it | |
| `evidence-custody` | An unbroken chain of custody, which is what makes evidence usable at all | ✅ |
| `judicial-review` | A named human answerable for the decision, and a record of it | ✅ |
| `public-accountability` | Published, verifiable figures rather than assurances | |

> **A citizen impact is stated in the citizen's words, not the platform's.** `intake-api unavailable`
> is not an impact on anybody. *"A person who decided today to report corruption cannot, and may not
> decide again"* is. The fitness function checks this: an experience containing `api`, `service`,
> `store`, `endpoint` or `latency` fails.

Severity is **declared**, not computed from a weight — the ordering is a judgement about people and
should be arguable. `severe` impacts also carry `irreversible: true`, because "the person may not
decide to report again" is not something a later fix undoes.

## What the forecast reports

- **A service is not delivered when *any* component it needs is down.** Services do not partially
  exist.
- **Impact aggregates to the worst harm, not the average.** Averaging harm across people is how a
  severe irreversible impact on one person disappears behind five material ones on nobody in
  particular.
- **Every hop is traceable and states its mechanism**, so a reader can disagree with any of them.
- The **board summary** is one sentence in the citizen's language: *"withdraw the intake store: A
  person who decided today to report corruption cannot, and may not decide again. This is
  irreversible for the people it happens to."*

## An undeclared path is unknown, not safe

The failure mode a forecast like this normally has is reassurance by omission: nothing was declared,
so nothing was reported, so it looks fine. Two guards:

| Case | Reported as |
|---|---|
| An affected component in no justice service's dependency tree | `unmappedComponents` — *"citizen impact is UNKNOWN rather than absent"* |
| An affected component the topology has never heard of | `unmodelledComponents` — deployed before it was modelled |

Either one sets `safeToDeploy: false`. The board summary says *"the citizen impact is unknown, not
nil."*

The mapped set is the **transitive** closure over the operational topology, including soft
(`degradesOn`) edges — a component that only degrades a service still has a citizen-impact path.
Listing every transitive component by hand would be a second copy of the topology and would drift.

## What the chain validator found

Two real gaps, fixed in the record rather than by relaxing the check:

- **`anonymous-reporting` — the constitutional service — was reached by no business process at all.**
  The platform measures nothing directly about whether people can report. `case-throughput` is the
  nearest real signal and is now linked, with the weakness recorded in the link's own mechanism text:
  it is a **proxy**, and a fall in throughput has several other explanations.
- **`notification-service`, `analytics` and the brokers mapped to no justice service**, which would
  have made every forecast involving them report "no citizen impact". Somebody who files a report and
  is then told nothing has received a worse service, so they are mapped.

`authorizes: false`, `failClosed: true`. The forecast tells a board what a change would do to people.
It never approves the change.
