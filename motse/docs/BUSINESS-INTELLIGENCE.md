# Phases 1 + 2 — Business Observability & Operational Intelligence

Phase 1 (highest priority) turns the platform's existing technical telemetry into
**business intelligence**; Phase 2 turns that plus the runtime/capacity/resilience
signals into **evidence-based operational recommendations**. Both are additive,
read-only over existing telemetry, and validated: **42 unit tests + 7 new
chaos-harness checks (W16/W17), all green (100/100 total)**.

- **Business observability** — `src/observability/business.observability.js`
- **Operational intelligence** — `src/observability/operational.intelligence.js`
- **Wiring** — `container.js` (built with MonitoringService, sees every schema), `health.service.js` (opsIntel trend sample per cycle)
- **Control plane** — `/v1/admin/business/*`, `/v1/admin/intelligence`, folded into `/overview`
- **Tests / gate** — `tests/business-intelligence.test.js`, `motse:coverage:business` (≥95/95/90)
- **Validation** — harness `W16` (business correlation) + `W17` (recommendations)

---

## Executive summary

**Phase 1** correlates the domain events every module already emits (payments,
payouts, fundraising, heritage, civic, workflows, notifications) with **business
capabilities**, tracking per-capability **success/failure**, **transaction value**
(from event `amount_minor`), **customers reached** (distinct actors), and **SLA
compliance** vs a target. It answers, for any technical signal: *which business
capability is affected, how many customers, what value is at risk, which product*.
Three audience views — **executive** (KPIs, SLA, value, customer reach),
**operations** (capability health), and per-capability **impact** — plus
`motse_business_*` metrics for the dashboards. It is strictly read-only over the
bus: it cannot affect domain behaviour.

**Phase 2** is an **evidence-based advisor** (not an actuator). It records a small
trend history of key operational counters each health cycle and, from **observed
trends** (least-squares slope over the window) plus the live state of the
resilience/dependency/business subsystems, composes recommendations — scale out,
add queue workers, increase memory, reduce concurrency, adjust retry budget,
consider safe mode, trigger incident response, investigate degradation. Every
recommendation carries **supporting metrics, a confidence score, expected
operational impact, estimated business impact, urgency, and rollback
considerations**, and is sorted by urgency then confidence. It never applies
anything — the operator (or the governance workflow) decides. Validated to be
silent on a healthy platform (no false positives) and to surface a critical,
customer-framed recommendation under real fault injection.

## Business justification

An SRE paged at 3am needs to know not just "Redis is degraded" but "which of our
services is affected, how many members can't transact, how much value is at risk."
Business observability provides exactly that correlation from telemetry that
already exists — no new instrumentation in the domain code. Operational
intelligence then closes the loop: instead of an operator eyeballing ten
dashboards, the platform proposes the evidence-backed action and quantifies its
business impact — turning telemetry into decisions.

## Current state → gap → design

**Gap (P1):** the platform emitted rich technical events and metrics, but nothing
expressed them in **business terms** — no capability model, no SLA per capability,
no customer/value correlation, no executive view.
**Design:** `BusinessObservability` defines a data-driven capability map (event
types → success/failure/value sets, product name, SLA target), subscribes to only
the schemas the platform actually registered (defensive — no crash on absent
types), and maintains per-capability tallies. `snapshot`, `executiveView`,
`operationsView`, and `impactOf(capability)` are the read surfaces; metrics land
in the shared registry. Auth/registration (identity emits no events — not
redesigned) are derived from existing HTTP route counters on the dashboards.

**Gap (P2):** runtime intelligence, the capacity planner, resilience, dependency
health and now business observability each produced signals, but nothing
**composed** them into ranked, actionable, evidence-cited recommendations — and
the mission forbids static-threshold-only logic.
**Design:** `OperationalIntelligence.record()` snapshots key counters each cycle;
`advise()` reads the *trends* (slopes) and live subsystem state to emit
recommendations, each a structured object with evidence/confidence/impact/urgency/
rollback. It leans on already-trend-based sources (runtime insights, capacity) and
observed ratios (lock contention, retry slope, backlog slope), never a bare level.

## Alternatives considered

- **A BI/warehouse pipeline (P1):** rejected for the operational path — the
  question "who is affected right now" needs live in-process correlation, not a
  nightly ETL. Exporting `motse_business_*` to a warehouse is a documented
  extension for historical analytics.
- **Instrumenting the domain modules directly (P1):** rejected — that would touch
  proven code; subscribing to the events they *already emit* is additive and
  keeps the domain untouched.
- **Auto-applying recommendations (P2):** deliberately rejected — an advisor that
  acts is a foot-gun; recommendations flow to the operator or, for config changes,
  through the governance approval workflow. Safe by construction.
- **Static-threshold alerting (P2):** rejected by the mission and on merit — the
  trend history makes "backlog *growing*" distinct from "backlog momentarily high."

## Trade-offs & risks

- Customer-affected counts are **distinct actors seen in events that carry one**
  (bounded set, capped at `maxCustomers`); anonymized events (e.g. contributions
  keyed by campaign) count toward throughput but not customer identity — the API
  is honest about this.
- SLA is computed over the process lifetime tally (not a rolling window) — a
  long-running pod's SLA is cumulative; a windowed SLA is a documented refinement.
- Recommendations are advisory and confidence-scored; a low-confidence item is
  labelled as such so operators don't over-react to noise.
- Both modules are per-process; cross-pod aggregation is done at the Prometheus/
  dashboard layer over the emitted metrics.

## Security, business & operational impact

Read-only over the bus and telemetry; no new inbound surface; all routes reuse the
`platform_admin(platform)` L3 guard. Business views expose product-level
aggregates and coarse counts — no PII beyond opaque actor ids held in memory for
distinct-count only. Operationally: a single `/v1/admin/overview` now answers
executive, operations, and engineering questions; the new `business` Grafana
dashboard (events/SLA/value/success-rate by capability, open recommendations) and
the `motse_opsintel_recommendations` gauge make the advisor observable.

## Testing strategy & validation results

- **Unit (`tests/business-intelligence.test.js`, 22):** capability correlation,
  value/customer/SLA, impactOf, executive/operations views, idle capability,
  defensive subscription, failure-buffer cap, no-arg construction; opsIntel no-
  false-positives, dependency-failure critical rec, trend-based backlog, open
  breaker → safe mode, lock contention, degraded dependency, worst-business-impact,
  memory pressure, business SLA breach, urgency sorting, minimal-platform
  tolerance, business-not-wired path; admin API + overview.
- **Chaos (harness W16/W17):** real campaign contributions correlate into business
  value + executive view + impactOf; a healthy platform yields no recommendations
  while injected dependency failure produces a critical, evidence+confidence+
  business-impact-bearing recommendation.
- **Results:** motse suite **710 green** (was 688; +22), root 131 green, harness
  **100/100 PASS** full + smoke. Gates: foundation 99.4/94.7, config 96.9/91.0,
  govdr 97.0/90.0, **business 95.8/92.8** — all ≥95/95/90.

## Rollback plan

Fully reversible. Both are new read-only modules plus wiring and two `/overview`
fields; the health-cycle hook is one guarded call. Removing them changes no domain
behaviour and no API contract — the domain events and metrics they consume are
unchanged. Reverting the commit is clean (no schema/state migration).

## Future extension points

Windowed (rolling) SLA; derive auth/registration business metrics from the HTTP
counters into the capability model; export `motse_business_*` to a warehouse for
historical BI; feed opsIntel recommendations that are config changes straight into
the governance approval queue (propose-on-detect); per-tenant business views;
financial-impact estimation from settlement data.

## Production readiness assessment & success criteria — met

✅ Technical telemetry is **correlated with measurable business outcomes and
customer impact** (value, customers, SLA per capability; executive/ops/impact
views). ✅ Operational intelligence produces **evidence-based, trend-driven
recommendations** with confidence, business impact, urgency and rollback — never
static thresholds alone, and silent when healthy. ✅ All existing guarantees intact
(transactions, idempotency, observability, backward compatibility); coverage gate
added, none weakened; CI enforces it. The platform now understands not just *what*
is happening technically, but *who and what business capability* it affects — and
recommends what to do about it.
