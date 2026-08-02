# Reliability Engineering (Phase 10, Part 4)

Site Reliability Engineering as executable practice: service-level objectives per **user journey**,
error budgets with burn rate, availability / latency / **recovery** targets, capacity planning,
autoscaling policy validation, resource forecasting and a **release gate driven by SLO health**
(`src/observability/sre.js`).

Gated by `APP-FIT-SRE-RELIABILITY` — which **fails when an SLO is violated**, as required. Live:
`GET /api/admin/reliability`.

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
