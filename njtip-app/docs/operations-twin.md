# Digital Twin of Operations (Phase 12, Part 17)

`src/twin2/operations-twin.js` extends the Digital Engineering Twin bounded context from simulating
individual concerns — capacity, failover, canary rollout — to simulating a **change** against a model
of the whole operating platform.

Gated by `APP-FIT-OPERATIONS-TWIN`. Live: `GET /api/twin/operations` ·
`POST /api/twin/operations/simulate`.

## The premise

> **The twin is built from the architecture-of-record, not maintained beside it.**

A twin somebody keeps up to date by hand diverges the first week nobody has time — and a divergent
twin is worse than no twin, because it answers confidently and wrongly, and the answer looks the
same either way. So every entity is **read** from a registry the platform already validates. Nothing
here is a second copy of anything.

| Entity kind | Read from |
|---|---|
| `bounded-context` | `src/architecture/context-map.js` |
| `service` · `infrastructure` | `src/observability/telemetry.js` (TOPOLOGY and zones) |
| `governance-control` | `src/governance/ownership.js` |
| `policy` | `src/twin2/multi-region.js` (consistency stances, each citing its ADR) |
| `risk` | `src/security/threat-model.js` |
| `data-flow` · `workflow` | `src/architecture/context-map.js` (relationships) |
| `regional-deployment` | `src/twin2/multi-region.js` (regions) |
| `evidence` | the fitness identifiers that actually ran |

Drift is checked **in both directions**: nothing modelled that the architecture lacks, and nothing in
the architecture the twin omits. Two twins built from the same registries produce the same digest —
the model is a function of the registries, not of history. The composition root therefore builds it
fresh on each call rather than holding one.

## Simulations never affect production state

Stated by Part 17, and enforced structurally rather than promised:

1. The baseline model is **deep-frozen** at construction. Not "treated as read-only by convention" —
   frozen, so a write fails rather than silently succeeding.
2. Every simulation runs against a **deep clone**.
3. `verifyIsolation()` **re-derives the baseline digest and compares it**, after *every* run.
4. `model()` hands out a copy, so a caller cannot mutate the baseline through the accessor.

A simulation that touched production state would change that digest. The property is verified, not
asserted.

## Scenarios

| Scenario | Question it answers |
|---|---|
| `infrastructure-change` | If this zone changes or is withdrawn, what stops working and who owns it? |
| `policy-update` | If this operating rule changes, which contexts are governed differently and what did they rely on? |
| `governance-change` | If this accountable authority changes, what becomes unowned? |
| `operational-failure` | If these services fail, what is the blast radius through declared dependencies? |
| `migration-plan` | If this context moves, what has to move with it? |
| `dr-exercise` | With these regions lost, what still serves, what degrades, and what refuses? |

A scenario nobody can state the question for is a scenario nobody can read the result of, so the
question is declared alongside the scenario and returned with every run.

## What the findings are careful about

- **The blast radius is a lower bound, and says so.** Reachability is over *declared* dependencies.
  An undeclared dependency does not appear, and pretending otherwise would be the twin's worst
  failure mode.
- **An unmodelled entity produces a finding, not silence.** "This entity is not modelled — its
  failure cannot be reasoned about, which is itself the finding."
- **A policy weakening is named as a weakening**, and a stance changed with no ADR behind it blocks —
  the same rule the consistency registry enforces everywhere else.
- **A migration plan names what depends on the thing being moved**, whether or not the plan does.

## What it is not

`authorizes: false` on every result. A simulation is a **rehearsal**: it produces findings against
the declared model, and the verdict says so in as many words —

> *"The simulated change produced no blocking finding against the declared model. It has not been
> approved, and an undeclared dependency would not have appeared here."*
