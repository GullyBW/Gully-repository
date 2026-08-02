# Business Observability (Phase 11, Part 5)

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
