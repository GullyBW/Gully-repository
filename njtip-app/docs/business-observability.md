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

---

# Institutional & Government Impact (Phase 13, Part 3)

Phase 12's chain stopped at the strategic goal. Two hops were missing at the ends that matter most,
and the chain is now eight stages:

```
Technical Event → Business Process → Justice Service → Citizen Impact
                → Institutional Impact → Mission Objective → Strategic Goal
                → Government Mission Outcome
```

The spec's *"Service Impact"* is the technical layer's service set and *"Justice Process"* is the
justice-service layer; both were already here, so they are not duplicated under new names.

## Institutional impact — the layer that changes the conversation

> A citizen harmed once is an incident. The same harm repeating is an institution that cannot
> discharge its mandate.

| Impact | Institution | Escalates to |
|---|---|---|
| `mandate-undeliverable` | Directorate on Corruption and Economic Crime | OB |
| `evidence-base-unreliable` | Judiciary | OB |
| `oversight-cannot-report` | Oversight Board | OB |
| `institutional-credibility-lost` | Whole of government | OB |

The mechanisms are what make these arguable rather than assertions — *"a court that has seen custody
fail once discounts the next chain too"*, *"someone turned away once does not return, and tells
others"*.

## Government mission outcomes

`accountable-government` · `equitable-access-to-justice` · `public-confidence-in-the-state`. The
terminal layer: past here the platform has nothing further to say, and says so rather than inventing
another level of abstraction.

## Mission dependency graph

`missionDependencyGraph()` returns the whole chain as nodes and directed edges with a layer index,
**derived from the same links the forecast traverses** — so the picture and the calculation cannot
disagree. Validated for backward edges (which would make the chain a cycle), unresolved endpoints and
isolated nodes.

`GET /api/observability/mission-graph`.

> **The unknown-vs-none distinction survives the extension.** Part 3 is exactly the kind of change
> that could quietly lose it, so the fitness function re-checks it: an unmapped affected component
> still reports `safeToDeploy: false` and *"the citizen impact is unknown, not nil."*

## Temporal mission impact (Phase 14, Part 3)

Verified by `APP-FIT-TEMPORAL-MISSION-IMPACT`.

The Phase 13 forecast answers "what does this change cost?" as though the whole cost arrived at once.
It does not. An intake outage stops filings within minutes; the reports that were never filed are
missing from the caseload for months; the erosion of the belief that reporting is worth doing shows up
years later, if anybody is still measuring. A board given one figure acts on the minutes and discounts
the years, because the years were never in the number.

| Horizon | Within | What changes there |
|---|---|---|
| `immediate` | minutes to hours | Services stop responding and work stops moving. |
| `short-term` | hours to days | A justice service stops being delivered and a person experiences that. |
| `medium-term` | weeks to months | The institution accumulates backlog or loses the ability to answer for itself. |
| `long-term` | months to years | The objectives the platform exists for stop being achieved. |
| `strategic-institutional` | years, not fully recoverable | Public confidence that reporting is worth the risk. |

Each mission-chain layer is assigned to exactly one horizon, checked by `validateMissionChain()` — a
layer added without deciding when its consequences arrive would otherwise be reported nowhere, and a
consequence reported nowhere is one nobody plans for.

> **Unknown impact must never become "no impact".**

A horizon the chain cannot be traversed to reports `unknown`, and so does a horizon where impact stops
with no declared link forward — an undeclared path is a gap in the model, not evidence of safety.
`no-declared-impact` is reserved for the case where nothing was affected at all, and even then it is
stated as a limit of what is declared.

## Public trust indicators (Phase 14, Part 9)

Verified by `APP-FIT-PUBLIC-TRUST`.

The operational correlation now runs eight layers to public trust. `governance-performance` moved out
of the chain into `CROSS_CUTTING_LAYERS`, because it is not downstream of public trust — it bears on
every layer, and modelling it as a link put it in an order that was simply false. It is still required
for the correlation to be complete.

**This platform cannot measure public trust.** It has no survey, no polling, no channel through which a
citizen tells it whether they believe reporting corruption is worth the risk. Anything here calling
itself a trust score would be an invention, and the most consequential one in the platform — a
government told its trust score is 0.87 stops asking.

What it derives is five leading indicators of whether trust would be **warranted**: can a citizen file
a report, do cases progress, is evidence intact, is every decision attributable, can the institutions
deliver. Every row carries `measuresTrust: false`, the composite is a word (`warranted`,
`not-warranted`, `unknown`) rather than a score, and an unmeasured indicator makes the whole thing
`unknown` — a partial picture of whether trust is warranted is not a favourable one.

The report states what *would* measure it: a survey of citizens who considered reporting, **including
those who decided not to**. Nothing in this platform can reach them, and they are the ones whose trust
matters most.
