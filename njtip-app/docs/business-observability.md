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
