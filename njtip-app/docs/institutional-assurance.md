# NJTIP v1.13 — Institutional Resilience, Documentation Assurance & Organizational Continuity

Phase 12 made the platform able to prove things about the **system**. Phase 13 asks the question
nothing had asked: **could the institution that runs it survive losing one of anything?**

The architecture stays frozen at [Baseline v1.7](./ARCHITECTURE-BASELINE-v1.7.md). No new bounded
context; every capability extends an existing module. Recorded as
[ADR-0008](./adr/0008-institutional-assurance-and-the-single-dependency-invariant.md).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human accountability. **Evidence ≠ authorization** — thirteen
> verified assurance domains still print `NOT AUTHORIZED`.

## The new global invariant

> **No critical capability may depend on a single person, a single process, a single document, or a
> single system.**

Evaluated continuously across eight dimensions for five critical capabilities. A violation **blocks
institutional readiness** until mitigated or explicitly accepted by a named authority with an expiry.

**It does not currently hold, and that is the point of adopting it.** See
[`institutional-resilience.md`](./institutional-resilience.md).

## What Phase 13 added

| Part | Capability | Module | The guarantee |
|---|---|---|---|
| 1 | Twin confidence | `twin2/operations-twin.js` · [doc](./assumptions.md) | A simulation nobody has checked against reality cannot claim high confidence |
| 2 | Assumption registry | `architecture/assumptions.js` · [doc](./assumptions.md) | An assumption with no expiry is a belief, and is refused |
| 3 | Institutional mission chain | `observability/business.js` · [doc](./business-observability.md) | The chain reaches the institution and the government outcome |
| 4 | Compliance lifecycle | `legislation/compliance-intelligence.js` · [doc](./compliance-intelligence.md) | No unknown state reads as compliant; `verified` cannot be self-declared |
| 5 | Temporal knowledge graph | `graph/enterprise-graph.js` · [doc](./enterprise-graph.md) | An undated edge is excluded from history, not assumed eternal |
| 6 | Documentation assurance | `architecture/documentation-assurance.js` · [doc](./documentation-assurance.md) | An unresolvable claim is a finding; the extractor guards its own yield |
| 7 | Procedure verification | same | A procedure must carry prerequisites, permissions, rollback and escalation |
| 8 | Knowledge continuity | `governance/ownership.js` · [doc](./institutional-resilience.md) | A derived deputy is a name, not an alternative |
| 9 | Decision memory | `architecture/decision-memory.js` · [doc](./rehearsals-and-memory.md) | A decision with no recorded outcome is unevaluated, not successful |
| 10 | Organizational twin | `twin2/operations-twin.js` · [doc](./rehearsals-and-memory.md) | An institution loses people more often than regions |
| 11 | Training assurance | `governance/ownership.js` · [doc](./institutional-resilience.md) | Expired qualifications reduce readiness on their own |
| 12 | Governance rehearsals | `governance/rehearsals.js` · [doc](./rehearsals-and-memory.md) | Scored against what the document promised, not against effort |
| 13 | Institutional resilience | `governance/institutional-resilience.js` · [doc](./institutional-resilience.md) | **The global invariant** |
| 14 | Evidence quality | `assurance/evidence-confidence.js` · [doc](./drift-and-quality.md) | Corroboration from the same source kind is not corroboration |
| 15 | Executive intelligence | `assurance/institutional.js` | No manually entered executive metric — there is no parameter that accepts one |
| 16 | Drift prevention | `architecture/drift-prevention.js` · [doc](./drift-and-quality.md) | Every kind checked in **both** directions |
| 17 | Governance analytics | same | Unmeasured capacity is itself a bottleneck |
| 18 | Operational intelligence | `observability/business.js` | An unmeasured layer breaks the chain rather than being skipped |
| 19 | Continuous improvement | `assurance/institutional.js` | Verified means the control that **failed** is now passing |
| 20 | Institutional assurance | `assurance/institutional.js` | Thirteen domains; an unmeasured one is never a green one |

## Assurance

```bash
npm test                    # 742 deterministic tests
npm run twin                # combined gate: 14 twin + 120 app + 9 infra = 143 invariants
npm run assurance           # 16 assurance domains → deployment authorization package
```

Twelve new fitness functions, each written so it **can** fail. Real defects found and fixed rather
than excused:

- **The drift checker's own first bug.** It reported 121 findings by treating every cross-context
  `require()` as an undeclared dependency, conflating source coupling with a curated DDD
  relationship. A report people learn to ignore is worse than no report, so coupling became its own
  informational, ratcheted kind.
- **The runbook had no prerequisites and no communication plan.** An operational document that does
  not say who to tell is one where nobody is told.
- **`docs/enterprise-graph.md` documented a route the checker could not resolve** because its
  placeholder substitution only tried a word against a numeric parameter.
- **The `custody` context had no registered assumption**, so the witnessing requirement — which the
  platform can require but cannot observe — was unexamined. Now `ASM-0009`.
- **Compliance evolution reported `flat`** for an estate that went unknown → compliant → failing.
  Literally true, and it hid the regression. Net and recent direction are now separate facts.

## The thing that runs through all of it

**Every register in this phase starts empty, and every report says so.**

No rehearsal has been run. No assumption has been verified. No simulation has been compared against
reality. No improvement loop has closed. So the twin reports `unknown` confidence, the assumption
registry reports every platform assumption as overclaimed, institutional readiness is blocked, and
the executive dashboard is mostly unmeasured.

That is not a defect to be tuned away. It is the true state of a platform that has never rehearsed
anything, and seeding those registers to make the dashboards green would make every figure
downstream a lie — which is the one failure this entire phase exists to prevent.

## Version

**v1.13.0** — additive and backward compatible at every published surface. Two internal behaviours
were tightened, with call sites updated in the same commit: `simulate()` now refuses a scenario with
undeclared assumptions, and the mission chain gained two layers.
