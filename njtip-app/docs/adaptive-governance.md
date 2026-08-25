# Adaptive governance and strategic decision support

Phase 14. Governance optimization, capacity planning, cross-agency coordination and adaptive
analytics — the four pieces of the platform that generate advice about how the institution should run
itself, and therefore the four most dangerous things in it.

Every one of them is an automated argument for doing something. This document is mostly about the
constraints that stop those arguments being persuasive in the wrong direction.

---

## Governance optimization

`src/governance/optimization.js` · verified by `APP-FIT-GOVERNANCE-OPTIMIZATION`

A governance optimizer is an automated argument for removing controls. Every genuine finding it makes
has an obvious remedy that is also the fastest way to dismantle separation of duties:

> "The Oversight Board is a bottleneck" is true. "So let the operational owner approve their own work"
> follows from it and is catastrophic.

So each of the six targets records the **wrong** remedy alongside the right one:

| Target | Right remedy | Wrong remedy |
|---|---|---|
| `approval-bottleneck` | Delegate to a second authority of equal standing | Let the responsible authority approve its own work |
| `review-workload` | Lengthen the cadence deliberately, or add capacity | Stop reviewing the things that are usually fine |
| `committee-utilisation` | Rebalance which board governs what | Fold the small board into a larger one |
| `governance-delay` | Complete the reviews, or record why the cadence is wrong | Mark them complete |
| `policy-conflict` | Strengthen the weaker stance, or record acceptance in an ADR | Weaken the stronger stance to match |
| `duplicated-activity` | Run it once across the portfolio, evidencing each subsystem | Record one act against all of them |

And the rule that makes it a control rather than an essay:

> **No recommendation may remove an approval, merge a responsible authority with its approver, or
> reduce the number of distinct authorities involved in a decision.**

`assertPreservesIntegrity` refuses any recommendation that cannot name a property it preserves, and
`recommend()` runs the guard before anything is emitted. A recommendation that fails is not emitted
with a warning; it does not exist.

**What it currently finds.** Two approval bottlenecks, three authorities owing more reviews per year
than a monthly board can perform, six consistency conflicts and four duplicated activities. The
consistency conflicts are the sharpest: a context declaring a strong guarantee that depends on one
declaring a weaker one cannot honour its own promise through that path, whatever its stance says.

---

## Capacity planning

`src/governance/optimization.js` (`capacityPlan`) · same control

A capacity forecast is an automated argument for a budget, so:

> **A forecast the evidence cannot support returns `null`, not a plausible number.**

Three of the six dimensions are derived from registries the platform holds — staffing from the
ownership model, infrastructure from the service topology, governance workload from the declared
review cadences. Three require measurements the platform does not take, and say so:

```
staffing              = 164   derived from the ownership model
infrastructure        = 20    declared services across 3 zones
governanceWorkload    = 88.2  reviews owed per year
operationalWorkload   = null  UNKNOWN — no caseload was supplied
training              = null  UNKNOWN — no training register was supplied
investigationCapacity = null  UNKNOWN — no investigator workload was supplied
```

A shortfall is only computed where **both** sides are measured. A shortfall against an unknown is a
number with a sign and no meaning.

---

## Cross-agency coordination

`src/governance/cross-agency.js` · verified by `APP-FIT-CROSS-AGENCY`

This platform is not run by one organisation. The ownership record has always named the institutions —
the Directorate on Corruption and Economic Crime, the Data Protection Commissioner, the Attorney
General's Chambers — and every governance relationship in the estate is in fact a relationship between
two of them. Nothing had ever looked at it that way.

The institutions are **derived**, never listed: they are the distinct accountable authorities in the
ownership record, so an agency that is renamed or dissolved changes this analysis automatically.

Currently: **27 institutions, 48 declared data flows crossing institutional boundaries, 39 pairs.**

The rule, and it is the same rule as the deputy who has never acted:

> **A declared relationship is not a working one.** The platform can read an org chart. It cannot see
> whether two institutions have ever actually coordinated.

So readiness has four bands and only one of them counts:

| Band | Ready | Means |
|---|---|---|
| `unknown` | no | Nothing is recorded about this relationship. |
| `declared` | no | The structure exists and has never been exercised. |
| `reachable` | no | There is a recorded way for each side to reach the other. Still never exercised. |
| `demonstrated` | **yes** | A recorded act involved people from both institutions. |

**Currently 0 of 39 pairs are demonstrated**, because no joint-act register has been populated. That
is the true answer, not a discouraging one.

Inter-agency risks are derived rather than scored, and each names where it would fail. The one worth
reading: an institution approving a quarter of the estate is a bottleneck for the *other* institutions
whose work it approves — its unavailability stops them acting, not only itself.

---

## Adaptive governance analytics

`src/architecture/drift-prevention.js` (`adaptiveGovernanceAnalytics`) · verified by
`APP-FIT-ADAPTIVE-ANALYTICS`

Six forecasts — governance maturity, audit readiness, institutional resilience, organizational
learning, policy effectiveness, operational stability — each with a confidence interval.

This is where most governance analytics quietly become fiction. An interval is a claim about how much
the evidence constrains the answer. Printed beside a figure derived from four observations, a ±0.05
band says "we are nearly certain" when the truth is "we have almost no data", and it is more misleading
than the bare number would have been.

> **The interval is a function of the observation count, and with no observations it is [0, 1].**

Half-width is `1/√n`, capped at `[0,1]`. It is explicitly **not** a statistical confidence interval,
and every row says so. `constrained` is `false` below seventeen observations, because five observations
give ±0.45 and that spans almost the whole range.

```
auditReadiness          0.9855  [0.9, 1]      152 obs   constrained
institutionalResilience 0.0000  [0, 0.4472]     5 obs   unconstrained
organizationalLearning  null    —               0 obs   no learning register was supplied
```

An interval that does not narrow with evidence is decoration. One that narrows faster than the evidence
justifies is worse.

---

## Drift classification

`src/architecture/drift-prevention.js` · verified by `APP-FIT-DRIFT-CLASSIFICATION`

Phase 13 detected drift and reported it as one list — enough to fail a build, not enough to route
anything. Eight classifications now each declare their own governance response, and:

> **No two classifications may have the same response.** If two classes route to the same board with
> the same action on the same timescale, they are one class wearing two names.

`assertDistinctResponses` checks this structurally.

| Class | Routes to | Blocks | Within |
|---|---|---|---|
| `architectural` | Architecture Review Board | yes | before the next merge |
| `dependency` | Architecture Review Board | no (ratcheted) | at the next architecture review |
| `documentation` | the owning document steward | yes | the same day |
| `ownership` | Oversight Board | yes | immediately |
| `governance` | Oversight Board | yes | before the next board meeting |
| `runtime` | Operations Review Board | no | at the next release |
| `security` | Information Security Review Board | yes | immediately |
| `policy` | Architecture Review Board | yes | before the stance is relied upon |

Three detectors are new in Phase 14. The security one matters most: a threat whose treating control
stopped running is a threat carried on the register as treated with nothing treating it.

---

## What this deliberately does not do

Nothing here decides anything. Every recommendation carries `authorizes: false` and `recommendationOnly:
true`, every forecast carries its basis and its observation count, and every capacity figure that
cannot be derived returns `null` with a sentence saying what would be needed.

The registers behind all of it — joint governance acts, training completions, caseload, investigator
availability — are empty. Populating them is organizational work, and the platform reports their
absence as *unknown* rather than as a low score.
