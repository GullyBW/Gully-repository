# Reliability Engineering (Phase 10, Part 4 · Phase 11, Part 4 · Phase 12, Part 4)

Site Reliability Engineering as executable practice: service-level objectives per **user journey**,
error budgets with burn rate, availability / latency / **recovery** targets, capacity planning,
autoscaling policy validation, resource forecasting and a **release gate driven by SLO health**
(`src/observability/sre.js`).

Phase 11 adds the *predictive* half: **multi-window burn-rate alerting**, availability trend
analysis, **reliability and recovery forecasting**, **service dependency risk scoring**, SLO
compliance history, reliability scorecards and release-readiness reporting.

Gated by `APP-FIT-SRE-RELIABILITY` — which **fails when an SLO is violated** — and by
`APP-FIT-SRE-PREDICTIVE`, which fails when the predictive layer stops predicting. Live:
`GET /api/admin/reliability` · `GET /api/observability/dependency-risk`.

## Service level objectives

Objectives are set per journey, not per endpoint, because a citizen does not experience an endpoint.

| Journey | Tier | Availability | Latency | RTO | RPO |
|---|---|---|---|---|---|
| Citizen files an anonymous report | **constitutional** | 99.9% | 95% < 300 ms | 15 min | **0** |
| Reporter checks status by case code | critical | 99.5% | 95% < 300 ms | 30 min | 5 min |
| Investigator works a case | critical | 99.5% | 95% < 500 ms | 60 min | 5 min |
| A named human records a governance decision | critical | 99.5% | 95% < 500 ms | 30 min | **0** |
| Oversight board reviews aggregate posture | important | 99% | 90% < 1000 ms | 240 min | 60 min |

Two journeys carry **RPO 0**: filing a report and recording a decision. Losing either would destroy
something the platform exists to guarantee, so no recovery strategy that loses data qualifies for them
— `recoveryCompliance()` checks the chosen strategy against both objectives and refuses the mismatch.

## Error budgets

```
budget    = 1 − objective
consumed  = (1 − attained) / budget
burnRate  = consumed / (elapsed / window)      ← spending measured against elapsed time
severity  = exhausted | fast-burn (≥2×) | over-pace (>1×) | healthy
```

Burn rate against *elapsed* window time is the useful signal: consuming half the monthly budget in
five days is a fast burn even though the budget is not gone.

## The release gate

```
SLO breached                → BLOCK
error budget exhausted      → BLOCK
fast burn (≥ 2×)            → BLOCK   "spend the budget on reliability, not features"
no measurement at all       → BLOCK   a release cannot be judged blind
otherwise                   → allow
```

The gate is **fail-closed**, and the only way past a block is a **recorded** risk acceptance by a
named human authority *with a rationale* — accepting risk is a decision someone owns, not a flag.
And as everywhere: `authorizes: false`. Reliability permitting a release is not the same as
authorizing a deployment.

## Capacity and autoscaling

`capacityPlan()` compounds demand monthly, reserves headroom and returns the instance count per
month; `resourceForecast()` projects storage and event volume. Both are deterministic — the same
inputs always produce the same plan, so a procurement conversation can be reproduced.

`validateAutoscaling()` catches the mistakes that make an autoscaling policy decorative:

| Rule | Why |
|---|---|
| `minReplicas ≥ 2` | One replica has no availability during a node loss |
| `maxReplicas > minReplicas` | A policy that cannot scale is not a policy |
| `0 < targetCpuPct ≤ 80` | Above 80% there is no room left to react |
| scale-down cooldown > scale-up cooldown | Otherwise the policy flaps |
| ≥ 2× burst headroom | A spike must have somewhere to go |

---

# Predictive reliability (Phase 11, Part 4)

## Multi-window burn-rate alerting

A single-window alert is either too slow to catch a fast outage or too noisy to survive a blip. Each
severity therefore pairs a **long window** that establishes the trend with a **short window** that
proves the burn is *still happening*. **Both must be burning, or nothing fires.**

| Alert | Long window | Short window | Burn rate | Action | What it means |
|---|---|---|---|---|---|
| `fast-burn` | 1 h | 5 min | **14.4×** | page | A 30-day budget gone in ~2 days |
| `medium-burn` | 6 h | 30 min | **6×** | page | Budget gone in ~5 days |
| `slow-burn` | 72 h | 6 h | **1×** | ticket | Budget spent exactly on schedule — no slack left for an incident |

The short window is what makes this humane: once an incident ends, the long window keeps burning for
hours. Without the pair, the pager keeps going off at a system that has already recovered. That case
is reported as `suppressed`, and the fitness gate asserts it explicitly.

## Trend, forecasting and the recovery cliff

`trend()` is a deterministic least-squares fit — the same history always produces the same line, with
an r² that becomes the forecast's stated `confidence`. Direction is reported as
`improving | degrading | flat | insufficient-data`; a single observation is **never** a trend.

`reliabilityForecast()` projects attainment forward and names the period at which the objective is
expected to break, so the conversation happens before the breach rather than after it.

`recoveryForecast()` exists because of one asymmetry worth stating plainly:

> **Restore time scales with data volume. The RTO does not.**

A backup strategy that meets a 60-minute RTO today, against 100 GB growing 6% a month, stops meeting
it in month **4**. The forecast names the month and the remedy (parallelise restore, shard the
dataset, or renegotiate the objective) — a recovery plan that was true when it was written and is
quietly false now is worse than no plan.

## Service dependency risk

Risk per service is **derived from the declared topology**, never from opinion:

```
score = 45 × blastFraction        how much of the platform goes down with it
      + 30 × (criticality / 4)    constitutional | critical | important | supporting
      + 15 × min(1, fanIn / 4)    how many services depend on it directly
      + 10 × isSinglePointOfFailure(constitutional path)
```

Bands: `severe ≥ 70 · high ≥ 50 · moderate ≥ 30 · low`. The gate asserts ordering, reproducibility,
and that a constitutional single point of failure outranks a leaf analytics service — a scoring
model that cannot tell those apart is not measuring risk.

## Compliance history, scorecards and release readiness

`SloComplianceHistory` is **append-only**: re-recording a period is refused, not overwritten. A
reliability record you can edit is not a record.

The scorecard grades each service out of 100 — 50 points for meeting the objective, 30 for error
budget remaining, 20 for compliance history — then A–F. Two rules matter more than the arithmetic:

- **An unmeasured service scores 0 / grade F.** Absence of evidence is never evidence of health.
- **Every non-perfect score names its reasons**, so a grade is a starting point for work rather than
  a number to argue about.

`releaseReadiness()` wraps the fail-closed error-budget gate and adds *advisory* warnings — a
degrading trend or a budget under 25% warns without blocking. A green gate is not an all-clear, and
the report says so. As everywhere: `authorizes: false`.

---

# Predictive Operations (Phase 12, Part 4)

Gated by `APP-FIT-SRE-PREDICTIVE-OPS`. Live: `GET /api/observability/predictive`.

Phase 11 forecast *reliability*. This forecasts the operational conditions that **cause** reliability
to fail — in one shape, so a dashboard renders them together and an operator can compare "how long
have I got?" across six unrelated things.

| Predictor | Threshold it heads for | The insight |
|---|---|---|
| **Storage exhaustion** | 85% of capacity, not 100% | The time you need is *before* it is full |
| **Certificate expiry** | The renewal window | Not a forecast so much as arithmetic nobody does until the outage |
| **Capacity ceiling** | Replicas × rps, **less reserved headroom** | The ceiling is where surge capacity runs out, not where the service stops |
| **Queue saturation** | Max depth, via arrival − service rate | A queue with utilization > 1 has no steady state, and its current depth says nothing about that |
| **Dependency degradation** | The latency budget | The question is *when* it breaches, not whether it has |
| **SLO burn** | Error budget exhausted | At this burn, when is the budget gone? |

Every predictor returns the same four things — current value, threshold, days remaining, urgency
band — and:

> **An unmeasurable prediction reports `unknown`, never `healthy`.** `predicted: false` and
> `daysUntilThreshold: null`. The report enumerates exactly what could not be projected.

Lead-time bands: `imminent ≤ 7d · near-term ≤ 30d · planned ≤ 90d · distant`, plus `breached` for a
threshold already crossed. `maintenanceRecommendations` is the ordered list of what to do and
roughly when — one list, rather than six dashboards each insisting it is the urgent one.

## Prediction in the release gate

```
threshold already breached   → BLOCK
≤ 7 days of headroom         → BLOCK   shipping now spends slack that is not there
≤ 30 days                    → warn
otherwise                    → allow
```

Fail-closed, with the same recorded-human-risk-acceptance override as the reliability gate. A
near-term prediction **warns** rather than blocking — the gate distinguishes "this needs planning"
from "this needs stopping".
