# Evidence Quality, Drift Prevention & Governance Analytics (Phase 13, Parts 14, 16, 17)

Gated by `APP-FIT-EVIDENCE-QUALITY` and `APP-FIT-ARCHITECTURE-DRIFT`.
Live: `GET /api/assurance/evidence-quality` · `GET /api/architecture/drift` ·
`GET /api/governance/analytics`.

## Part 14 — Evidence quality

Phase 11 computed confidence from source, completeness and freshness. Three inputs is enough to rank
evidence and not enough to say whether it is any good. Five dimensions were missing, and they are the
ones an auditor asks about: **provenance · integrity · reproducibility · corroboration ·
independence · historical consistency**.

The rule that makes this more than a longer list:

> **Corroboration from the same source kind is not corroboration.** Two checks that read the same
> registry agree by construction, and counting them as two would make the most inbred evidence look
> the strongest.

`independence` therefore scores on the number of **distinct source kinds** that corroborate, not on
the number of corroborators.

Other properties worth naming:

- **Quality is the weakest dimension, never the mean**, and the report names which one and what weak
  means for it.
- **Reproducibility is inferred from the source kind** — a check that re-runs is reproducible, a
  human attestation is not — and an explicit check overrides the inference in both directions.
- **One verification is no history to be consistent with**, so historical consistency scores zero
  until there are two.
- `contributesToReadiness: true`, `replacesAuthorization: false`, stated on the dashboard rather
  than in a footnote.

## Part 16 — Architecture drift prevention

Six kinds, each checked **in both directions**:

| Kind | Undocumented reality | Unrealised documentation |
|---|---|---|
| `module` | A source file no context claims | A context claiming files that do not exist |
| `coupling` | A cross-context `require()` the curated list does not name | A declared dependency no module requires |
| `api` | A route served but not published | A contract published but not served |
| `control` | A fitness function with no owning context | — |
| `ownership` | A context with no accountability record | A record for a context that does not exist |
| `assumption` | A constitutional context with no registered assumption | An assumption naming a context that is gone |

> A checker that looks only one way will happily pass a document describing a system nobody built.

### The bug this checker had first

It reported **121 findings** by treating every cross-context `require()` as an undeclared dependency.
That is wrong: `dependsOn` in the context map is a curated **DDD relationship** — customer-supplier,
conformist, in-process-port — and a `require()` of a shared hash function is not one.

A report people learn to ignore is worse than no report, so coupling became its **own kind**:
informational, and **ratcheted** at its current count so it cannot grow unnoticed. Structural drift
must be zero.

It also found a real gap: the `custody` bounded context had no registered assumption, so the
witnessing requirement — which the platform can require but cannot observe — was unexamined. It is
now `ASM-0009`.

## Part 17 — Governance analytics

Forecasts where governance will jam, from what the registers already hold:

- **Ownership overload** — an authority accountable for a quarter or more of the estate is a
  bottleneck whether or not anything has jammed yet. (Currently: the ARB and the Oversight Board.)
- **Review delay** — subsystems past their board's cadence.
- **Assumption decay** — expired or overdue assumptions.
- **Rehearsal gaps** — exercises never run.
- **Unmeasured capacity** — no activity or training register supplied, so whether the accountable
  people can actually act is unknown, *and unknown is not capacity*.

An unmeasurable figure reports `null` rather than a plausible number, and *"no bottleneck visible"*
is stated as a limit of what was recorded rather than as a clean bill of health.
