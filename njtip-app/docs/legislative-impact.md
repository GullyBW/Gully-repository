# Legislative Impact Analysis (Stabilization Part 7)

Digital legislation now supports the analysis a legal change actually needs **before** enactment:
a transitive regulatory dependency graph, policy impact analysis, service dependency mapping,
fitness-function impact assessment, diffable version history, change simulation and obsolete-policy
detection (`src/legislation/impact.js`).

Gated by `APP-FIT-LEGISLATIVE-IMPACT`. Live: `GET /api/legislation/impact` ·
`POST /api/legislation/{id}/simulate`.

> Every legal change is **fully simulatable before human enactment**. Nothing in this module enacts,
> amends or repeals anything — and `enact()` still requires a **named human authority**.

## Regulatory dependency graph

`ancestors(id)` — everything the instrument depends on, transitively (what a change must respect).
`descendants(id)` — everything that depends on it (what a change will reach).
`cycles()` — a cycle between instruments is an authoring error, not a legal construct, and is reported.

## Policy and service impact

`policyImpact(id)` unions the direct impact with the **transitive** reach: dependent instruments plus
every system and control they map to, with a `breadth` figure. `serviceDependencyMap()` inverts it:
system → the instruments that govern it and the controls they mandate.

## Fitness-function impact assessment

The distinctive check. For an instrument, each mandated control is resolved against the live fitness
gate and lands in one of three states:

| State | Meaning |
|---|---|
| implemented and holding | The mandate is met and continuously verified. |
| implemented and **failing** | A **live breach of the legal mandate** — not a technical debt item. |
| **not implemented** | A **compliance gap**: the law requires something no fitness function checks. |

This is what makes the platform's compliance claim falsifiable: a law that mandates a control nobody
implemented shows up as a gap on every build, not at audit time.

## Version history and weakening amendments

Each instrument version snapshots the control and system mappings in force, so `versionHistory(id)`
produces a real diff: controls/systems added and removed per version. Any amendment that **removes** a
mandated control or governed system is flagged as `weakening` and listed in `weakeningAmendments` —
the amendments that most deserve scrutiny are the hardest to spot by reading prose.

## Change simulation

`simulateChange(id, { proposedControls, proposedSystems, fitnessResults })` returns the registry's
compatibility verdict plus transitive reach, live control state, and an explainable risk band:

```
score = 2 × (controls + systems removed) + dependent instruments reached + unimplemented controls
        high ≥ 4   ·   medium ≥ 2   ·   low otherwise
```

Every band carries its reasons in plain language (e.g. *"removes 1 mandated control(s)"*, *"reaches 1
dependent instrument(s)"*). `simulatable: true`, `enacts: false` — always.

## Obsolete policy detection

| Finding | Severity |
|---|---|
| Repealed but still mapped to live systems | high |
| Repealed but an in-force instrument still depends on it | high |
| In the register but governs no system and mandates no control | medium |
| Mandates a control no fitness function implements | medium |
| Draft duplicating another instrument's title | low |

Advisory throughout: repeal and amendment remain decisions of the responsible legal authority
(Attorney General Chambers, approved by the Oversight Board — see the
[ownership model](./governance-ownership.md)).
