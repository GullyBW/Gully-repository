# ADR-0002: Freeze Architecture Baseline v1.7 and transition to production engineering

- **Status:** Accepted · **Date:** 2026-08-01
- **Deciders:** Chief Architect, Enterprise Architect, Principal Engineer, DevSecOps Lead, ARB
- **Review required:** ARB (no constitutional invariant changed → no OB super-majority)

## Context

Seventy implementation phases produced ~29 bounded contexts spanning justice, governance,
infrastructure, identity, legislation, process mining, observability, resilience, analytics and
sovereign digital-government capability. Each increment was additive and Twin-verified, and the
foundation (stable ports, deterministic execution, zero runtime dependencies, offline operation,
synthetic-data validation, CI fitness functions, adversarial simulation, formal verification,
evidence generation, human accountability in code, fail-closed behaviour) is in place.

Measured signal, not speculation, prompted this decision:

- **Cohesion is high and coupling is directional** — the map is acyclic and the two most-depended-upon
  contexts (`privacy` Ca 9, `identity-access` Ca 8) have instability 0. The structure is not the
  constraint any more.
- **Marginal architectural return is falling.** Recent increments added capability *inside* existing
  boundaries; none required a boundary change.
- **The remaining risk is engineering risk**, not design risk: synthetic components, contract drift,
  operational readiness, usability, and institutional accountability.

## Decision

1. **Freeze Architecture Baseline v1.7** (`ARCHITECTURE-BASELINE-v1.7.md`). It supersedes v1.0 for
   structure while keeping every v1.0 constitutional invariant in force.
2. **No new high-level government domain and no new major bounded context** may be introduced unless
   implementation demonstrates a measured architectural need, recorded as an ADR.
3. **Record the architecture-of-record as data** (`src/architecture/context-map.js`) and enforce it
   with `APP-FIT-CONTEXT-MAP`: module ownership, acyclic dependencies, declared relationship patterns
   and mechanisms, and no unreviewed responsibility overlap.
4. **Record institutional accountability as data** (`src/governance/ownership.js`) and enforce it with
   `APP-FIT-GOVERNANCE-OWNERSHIP`, including structural separation of duties.
5. **Redirect effort** to stabilization, integration contracts, incremental replacement of synthetic
   components, operational readiness, governance maturity, usability and maintainability.

## Consequences

- **Backward compatibility:** fully preserved. No existing module, port, contract or endpoint changed;
  everything added is additive and descriptive.
- **Twin impact:** two new application fitness functions; the gate stays green. The composition root
  now *fails closed* if the architecture-of-record or the ownership model is invalid.
- **Threats/risks:** reduces architectural drift (undetected boundary erosion) and accountability
  gaps (a subsystem nobody owns). Adds a maintenance obligation: adding a source file requires
  assigning it to a context in the same commit — deliberately, so drift is impossible to merge.
- **Trade-offs (named):** the map costs a small tax on every new module, and a frozen baseline will
  occasionally be wrong. Both are accepted: the tax is one line, and the ADR path exists precisely so
  a demonstrated need can still change the architecture.

## Alternatives considered

- **Keep expanding conceptually** — rejected: added breadth without depth and increased the unbuilt
  surface.
- **Document the map in prose only** — rejected: prose cannot fail a build, and every prior context
  map drifted from the code within one increment.
- **Freeze by convention (review discipline only)** — rejected: reviews miss module-level drift; a
  fitness function does not.
- **Re-baseline at v1.8** — rejected: v1.8 changed no structure, so v1.7 is the honest architectural
  generation to freeze.

## Human review

Production go-live, procurement, funding, legal and constitutional validation remain human decisions.
This ADR changes engineering direction only; it authorizes no deployment.
