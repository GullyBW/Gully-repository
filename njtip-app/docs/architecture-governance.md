# Architecture Governance Process (post-baseline)

**Goal:** keep architecture stable and implementation-driven. Architecture changes are the
**exception**, justified by measured need, recorded as ADRs, and validated by the Twin.

**Baselines in force:** [`ARCHITECTURE-BASELINE-v1.7.md`](./ARCHITECTURE-BASELINE-v1.7.md)
(structure: contexts, ports, contracts, assurance, ownership) over
[`ARCHITECTURE-BASELINE-v1.0.md`](./ARCHITECTURE-BASELINE-v1.0.md) (constitutional invariants, still
binding). After v1.7, **no new high-level government domain or major bounded context** may be added
without a demonstrated, implementation-driven need.

## ADR catalogue

| ADR | Title | Status | Scope |
|---|---|---|---|
| [0001](./adr/0001-baseline-and-mvp.md) | Freeze Architecture Baseline v1.0, select the MVP, reuse Twin components | Accepted | Constitutional invariants, MVP selection, zero-dependency stance |
| [0002](./adr/0002-freeze-architecture-baseline-v1.7.md) | Freeze Architecture Baseline v1.7 and transition to production engineering | Accepted | Structural freeze; architecture-of-record and ownership as verified data |
| [0003](./adr/0003-context-consolidation-and-data-exchange-terminology.md) | Boundary consolidation and "National Data Exchange" terminology | Accepted | Federation merge, exchange governance model, responsibility scoping |
| [0004](./adr/0004-operational-excellence-and-continuous-assurance.md) | Operational excellence, continuous assurance, and the expanded ADR schema | Accepted | Phase 10 capabilities; ADR schema expansion applied from 0004 onward |
| [template](./adr/000-template.md) | ADR template | — | Required format for every new decision |

**Schema:** ADRs numbered **0004 and later** must record business justification, risk assessment,
performance / security / operational / compliance impact, rollback strategy, migration strategy,
estimated implementation cost, success metrics, decision owner and approval history — validated
automatically by `APP-FIT-ADR-GOVERNANCE` (`src/architecture/adr-governance.js`). ADRs 0001–0003
predate the expansion and are held to the legacy schema; rewriting them to a later standard would
destroy the record of what was known at the time.

## When an ADR is required
Any change to a **frozen baseline component** (`ARCHITECTURE-BASELINE-v1.7.md`), the **bounded-context
map** (adding, removing, merging or re-pointing a context), a **published API/event contract**, a
**security/privacy control**, a **cross-zone boundary**, or an **institutional ownership record**.
Implementation details *inside* a context, UI, dashboards and feature composition do **not** require
an ADR.

## Flow
```
Measured need (from implementation) → ADR (adr/000-template.md) → Twin stays green
→ ARB review → [constitutional-invariant? → OB super-majority] → Accepted → merge
```

## Guardrails (enforced in CI)
- **Twin fitness gate** must pass (`npm run twin`) — architecture violations fail CI.
- **Architecture-of-record stays true**: `APP-FIT-CONTEXT-MAP` fails the build if a source module is
  unowned, a dependency cycle appears, an interaction lacks a declared pattern/mechanism, or two
  contexts claim the same responsibility without an accepted-overlap record.
- **Accountability stays complete**: `APP-FIT-GOVERNANCE-OWNERSHIP` fails the build if a context has
  no institutional owner or if one authority both owns and approves a subsystem.
- **Contracts stay stable**: `APP-FIT-INTEGRATION-CONTRACTS` fails the build on an undeclared
  cross-context interaction or an unversioned breaking change.
- **API contract** must remain valid & versioned (`/v1`); breaking changes need a new major version.
- **Backward compatibility** preserved, or a documented deprecation path (dual-run + sunset).
- **Drift detection** (Twin `src/drift`) flags any change to the architecture-of-record not reflected
  in an ADR + the approved manifest.

## Decision rights (from blueprint phase2/01)
- **ARB:** architecture changes, DDR/ADR conformance (veto on invariant breach).
- **ISRB:** 🔒 security-critical subsystem changes (sign-off gate).
- **OB super-majority:** constitutional-invariant changes (zones, key custody, no-identity).
- Human accountability: legal/constitutional/judicial/governance decisions never automated.

## Cadence
ADRs reviewed at the ARB cadence; the Twin runs on every commit; drift + threat-model refresh per the
assurance calendar (blueprint phase3/03).
