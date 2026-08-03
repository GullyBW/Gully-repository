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
| [0005](./adr/0005-authorization-decision-caching.md) | Replace "nothing is cached" with signed, revocable, policy-versioned authorization decisions | Accepted | Zero Trust authorization path; scalability without weakening the guarantee |
| [0006](./adr/0006-adaptive-assurance-and-predictive-operations.md) | Adaptive assurance, predictive operations, and the extended ADR schema | Accepted | Phase 11 capabilities; ADR schema extension applied from 0006 onward |
| [0007](./adr/0007-session-consistency-and-adr-review-lifecycle.md) | Session-scoped consistency, and the ADR review lifecycle | Accepted | Read-your-writes / monotonic-reads stances; ADR governance schema applied from 0007 onward |
| [template](./adr/000-template.md) | ADR template | — | Required format for every new decision |

**Schema, in four tiers.** Each ADR is validated against the standard that was in force when it was
written — automatically, by `APP-FIT-ADR-GOVERNANCE` (`src/architecture/adr-governance.js`).

| Tier | Applies from | Adds |
|---|---|---|
| **legacy** | 0001 | Context · Decision · Consequences · Alternatives considered |
| **full** | **0004** | Business justification · risk assessment · performance / security / operational / compliance impact · rollback · migration · implementation cost · success metrics · decision owner · approval history |
| **extended** | **0006** | Rejected alternatives · architectural trade-offs · long-term maintenance impact · implementation complexity · operational cost · lifecycle implications · **measurable** success criteria · architectural debt assessment |
| **governance** | **0007** | **Review schedule** (must name a date or an interval) · **sunset criteria** |

Earlier ADRs are **not** rewritten to a later standard: an ADR records what was known and required
at the time, and retrofitting destroys precisely what the record exists to preserve. The cutovers
are data (`FULL_SCHEMA_FROM`, `EXTENDED_SCHEMA_FROM`, `GOVERNANCE_SCHEMA_FROM`), so the validator applies the right schema per
ADR rather than a blanket one.

**Measurability is checked, not requested.** A *Measurable success criteria* or *Success metrics*
section containing no number fails validation — "improve reliability" satisfies a heading check and
commits to nothing.

**Lifecycle and debt are queryable.** `lifecycle()` reports which decisions are live and what
replaced the rest; a `Superseded by ADR-XXXX` that points at a non-existent ADR, or a status that
disagrees with it, fails the build. `architecturalDebt()` aggregates what the catalogue has
knowingly left unpaid, recorded at the point it was taken on rather than discovered later.

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

---

# ADR Review Lifecycle & Quality Reporting (Phase 12, Part 11)

ADR-0004 expanded the schema; ADR-0006 extended it to record what a decision *costs*. Neither
addressed what happens to a decision **afterwards**. Every ADR written before 0007 is permanent —
not because anyone decided it should be, but because nothing obliged anyone to look at it again.

## The governance tier

| Section | Why |
|---|---|
| **Review schedule** | When this decision is next examined, and by whom. A decision nobody has agreed to re-read is permanent by accident |
| **Sunset criteria** | The observable conditions under which it stops applying. Without them a decision can only be replaced, never retired |

Applied from **ADR-0007** onward. Earlier ADRs are not retrofitted, for the reason already recorded
twice in this document: backdating a commitment nobody made is worse than an honest gap.

**A review schedule must name a date or an interval.** `periodically`, `as required` and `when
appropriate` are rejected by the validator — the same rule ADR-0006 introduced for success criteria,
applied to the other section that is easy to write and impossible to check.

## Automatic rejection

`admit(text)` validates a proposal against the schema in force for its number and returns
`admitted: false` with the specific sections at fault. It is a pure function over text, so a
proposal can be checked before it is written to disk and the check never touches the real catalogue.

**There is no "accepted pending sections" state.** That state is precisely how an incomplete record
becomes a permanent one. Admission is also *not* approval, and the response says so: passing the
completeness check makes an ADR admissible, and approval remains a recorded decision by the ARB.

## Quality reporting

A pass/fail verdict tells an author their ADR is incomplete. It does not tell a board whether the
catalogue is decaying, or in which dimension. `qualityReport()` scores each ADR across six:

| Dimension | Asks |
|---|---|
| `completeness` | Is every required section present and non-empty? |
| `specificity` | Do the sections that must carry a number or a date actually carry one? |
| `alternatives` | What was considered, and what was rejected and why? |
| `accountability` | Is there a named owner and a recorded approval history? |
| `reviewability` | When is this looked at again, and what would retire it? |
| `reversibility` | How do we get back, and how does existing state get forward? |

Two rules make the report mean something:

- **A dimension the ADR's schema never required scores `null`, not 0.** Otherwise the report
  measures age rather than quality, and ADR-0001 would score badly for lacking a section that did
  not exist when it was written.
- **Every figure aggregates to the weakest ADR, not the mean.** One decision with no rollback
  strategy *is* the catalogue's rollback story, whatever the other six say.

## Review tracking

`dueForReview({ now })` sorts every ADR into one of four states, and none of them is silent:

```
scheduled + dated + in date   → fine
scheduled + dated + past      → overdue
scheduled + no date           → UNDATED — an interval with no anchor cannot become overdue
no review schedule            → UNSCHEDULED — permanent by inertia rather than by choice
```

`now` is injected. A governance report that changes with the wall clock is not reproducible
evidence.

Live: `GET /api/architecture/adr/quality` · `POST /api/architecture/adr/admit` (admin).
