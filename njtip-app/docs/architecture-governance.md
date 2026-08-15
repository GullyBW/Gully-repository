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
| [0008](./adr/0008-institutional-assurance-and-the-single-dependency-invariant.md) | Institutional assurance, and the single-dependency invariant | Accepted | The global invariant that no critical capability may rest on a single person, process, document or system |
| [0009](./adr/0009-adaptive-governance-and-the-four-clause-invariant.md) | Adaptive governance, strategic decision support, and the four-clause invariant | Accepted | Widens the invariant to unvalidated assumptions, unverified dependencies and undocumented governance relationships; governs optimization, forecasting and public-trust reporting |
| [0010](./adr/0010-institutional-intelligence-legal-authority-and-the-six-clause-invariant.md) | Institutional intelligence, legal authority assurance, and the six-clause invariant | Accepted | Widens the invariant to undocumented legal authority and ineffective detecting controls; records the constitutional zone of all 30 contexts; governs decision packages, control effectiveness and cross-government readiness |
| [0011](./adr/0011-operational-validation-calibration-and-the-traceability-invariant.md) | Operational validation, institutional calibration, and the traceability invariant | Accepted | A second global invariant, about conclusions rather than capabilities: nothing may exist without a complete, explainable, evidence-backed traceability chain. Governs evidence acquisition, forecast and twin calibration, control performance, exercise and capability maturity, and production transition planning |
| [0012](./adr/0012-decision-package-merge-and-specification-traceability.md) | Merging three decision-package specifications into one guard, and governing merges thereafter | Accepted | Records the merge of Phase 17 Parts 15 and 17 with Phase 18 Part 7 into the existing seventeen-field decision package, and establishes the `merge` ADR schema tier: from 0012 onward, an ADR recording a merge must name the requirements it absorbed, the rationale, the compatibility impact and the implementation strategy |
| [0013](./adr/0013-two-capability-axes-and-capability-centric-planning.md) | Two capability axes, and why the second one is not a duplicate of the first | Accepted | Records why the business capability map and the new platform capability registry coexist in one module rather than being merged or split, and establishes that a capability cannot reach OPERATIONAL by any machine path — whether an institution runs something is a fact about people |
| [0014](./adr/0014-shared-epistemic-machinery-and-the-governance-resilience-boundary.md) | One epistemic vocabulary for the whole platform, and where a resilience finding stops | Accepted | Establishes RESOLVED/BROKEN/UNKNOWN as one shared vocabulary in `src/assurance/epistemic.js` rather than three copies, fixes contiguous navigable depth as the walk before the first gap, and records that a single-point dependency in the platform's own governance machinery goes to a board rather than blocking a build |
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

## Specification compliance (Phase 18.1 Part 7)

`matrix()` answers *is this requirement verified*. A board asks a different question — *is this
specification implemented* — and those differ in one way that matters enormously: a specification
nobody wrote requirements for has a perfectly clean matrix, because a register you never wrote to
contains no failures.

`specificationCompliance()` is a view over the same register, told which specifications are expected
to exist, reporting five outcomes:

```
COMPLIANT            every element the artefact type demands is present and resolves
NON_COMPLIANT        a required element is absent — checked, and the specification is not met
EVIDENCE_UNRESOLVED  a declaration points at a file, control, owner or ADR that does not exist
UNKNOWN              nothing was checked, or nothing was ever declared
HUMAN_REVIEW_REQUIRED structurally complete, with a question no test can settle
```

The two most often merged are the two that must not be. **NON_COMPLIANT and UNKNOWN lead to
different institutional actions** — one is fixed, the other is investigated — so they map to
different epistemic states and are reported apart. A specification's state is the **weakest** of its
requirements, never their average.

No percentage is produced anywhere. "80% compliant" cannot distinguish a missing runbook from a
missing implementation, and a reader who sees 80 stops asking which it was.

### Three facts a control list can carry

The register distinguishes them because collapsing them produced a real defect:

```
no control list supplied     → UNKNOWN   nobody checked
empty control list supplied  → BLOCKED   the check ran; the declared control was not there
full control list supplied   → VERIFIED / PARTIAL / BLOCKED on the evidence
```

Until close-out, `verify()` defaulted the list to `[]`, so a requirement nobody had verified reported
BLOCKED — absence of input rendered as evidence of failure.

### The synthetic corpus

The register ships empty, so the dashboard would otherwise be exercised only against fixtures.
`seedSyntheticRequirements()` seeds seven entries under the specification `SYNTHETIC-CORPUS`, every
identifier prefixed `SYN-`. **Every entry is invented for verification and describes nothing the
Republic has ever required, decided or recorded.** `APP-FIT-SYNTHETIC-CORPUS` asserts the separation
in both directions and that the corpus reaches all five compliance states.

Live: `GET /api/architecture/specification-compliance` (admin) — `?evidence=false` asks what is
known with nothing supplied and answers UNKNOWN rather than failing; `?specifications=A,B` names
specifications expected to exist · `GET /api/architecture/requirements-matrix` (admin).

## Epistemic states and contiguous chains

`src/assurance/epistemic.js` holds one vocabulary for the whole platform ([ADR-0014](./adr/0014-shared-epistemic-machinery-and-the-governance-resilience-boundary.md)):

```
RESOLVED   the evidence exists and establishes the claim
BROKEN     the evidence was checked and establishes the claim is invalid
UNKNOWN    the available evidence establishes neither
```

`UNKNOWN` is a **successful verification outcome** where the evidence genuinely cannot settle the
question. It is never a pass: it does not satisfy, it is not examined, and it does not continue a
chain. `weakest()` rolls a set up to its weakest member — BROKEN over UNKNOWN over RESOLVED.

`assuranceChain()` walks a sequential chain and stops at the first unresolved step. Two numbers are
kept apart on purpose:

```
contiguousNavigableDepth   how far you walk before the first gap
resolvedCount              how many steps resolve in total, wherever they sit
```

A chain broken at step 1 with steps 2–9 intact has depth **0** and a resolved count of **8**.
Reporting the 8 as depth produced `TRACEABLE THROUGH HOP 8/9` for a decision package with nothing at
the top of it, which is the percentage this module refuses to print wearing a count.
`resolvedButUnreachable` names the steps that individually resolve behind a gap.

`machineBoundary()` states, in the output, what a control observed and what it cannot settle:

```
observation → evidence → human judgement → governance decision      (preserved)
observation → institutional verdict                                 (refused)
```

## Governance resilience (Phase 18.1 Batch 7)

The global invariant asks whether a critical capability rests on a single person, process, document
or system. `governanceCapabilityResilience()` asks it of the governance machinery Phase 18.1 itself
built. A finding reports `SINGLE_POINT_OBSERVED` and goes to a board; it does **not** block a build.
`BLOCKED` remains reachable only where the governance model already required resilience —
ADR-0009's blocking behaviour for constitutional capabilities is untouched.

Current findings, and the remediation requirements they raise, are recorded in
[`phase18-1-resilience-findings.md`](./phase18-1-resilience-findings.md). All are OPEN; no board has
reviewed them.

Live: `GET /api/governance/governance-resilience` (oversight-board — a finding that escalates to a
board is read by that board).

## Capability evidence quality (Stage A)

The `evidenceQuality` maturity dimension was a stub. It read *"grading them against evidence quality
is not yet wired to this registry"* and counted controls — which is the specific failure the
dimension exists to prevent. Five weak controls are not better evidence than one authoritative one,
and ten stale references are not twice as good as five.

Ten dimensions, never summed: presence · authority · provenance · freshness · integrity ·
completeness · reproducibility · consistency · scope · ownership. Five grades:

```
NO_EVIDENCE    nothing supports the claim — an absence in the record   → UNKNOWN
WEAK           somebody looked and found little                        → UNKNOWN
INCOMPLETE     part of what the claim requires is covered              → UNKNOWN
CONFLICTING    the pieces contradict each other                        → BROKEN
AUTHORITATIVE  present, attributable, traceable, consistent            → RESOLVED
```

`NO_EVIDENCE` and `WEAK` are kept apart because nobody having looked is a different institutional
fact from somebody having looked and found little. `CONFLICTING` is the grade most often lost:
contradictory evidence gets averaged into "partial" and the contradiction disappears.

Aggregation is to the **weakest** dimension. Nine authoritative dimensions do not pay for one
conflicting one, and no single score is produced. **Evidence never promotes a capability** — the
grader reports, the lifecycle decides state, and `OPERATIONAL` remains machine-unreachable.

## Capability ↔ module reverse index (Stage B)

The registry always answered *which modules implement this capability*. Nothing answered the
reverse, and the reverse is where drift lives. Five findings:

```
MISSING_MODULE            a claimed module is not on disk              → BROKEN
UNIMPLEMENTED_CAPABILITY  no module where implementation is required   → BROKEN
DUPLICATE_MAPPING         the same module declared twice               → BROKEN
ORPHAN_MODULE             a watched module no capability claims        → UNKNOWN
SHARED_MODULE             one module serving several capabilities      → UNKNOWN
```

Orphans are reported only over **watched paths** the caller declares: scanning the whole tree would
report every file as an orphan, which is true and useless. The index is a **traceability**
mechanism — `establishesVerification` is `false`, because a module existing says nothing about
whether the capability works.

## Business ↔ platform cross-axis mapping (Stage C)

Governed by [ADR-0013](./adr/0013-two-capability-axes-and-capability-centric-planning.md): the axes
relate without merging. Mappings are **declared, never inferred** — deriving one from name
similarity would be the "similarity is a verdict" error Phase 18.1 Part 4 forbids. A declaration
naming no declarer is refused as an inference.

Five relations (`supports`, `enables`, `depends-on`, `governed-by`, `evidenced-by`) and five states:

```
MAPPED                  a declared relationship                        → RESOLVED
INTENTIONALLY_UNMAPPED  recorded as deliberately unmapped, with reason → RESOLVED
MAPPING_REQUIRED        something requires a mapping and none exists   → BROKEN
AMBIGUOUS               structural similarity nobody has declared      → UNKNOWN
UNMAPPED                no mapping and no statement that none is wanted → UNKNOWN
```

One-to-many and many-to-one are both legitimate. Lack of a mapping is **not** a failure unless a
requirement says it must be mapped.

## Governance succession assurance

Four things get called "we have succession" and they are not the same thing:

```
DOCUMENTED  a chain exists with a named holder at each level     machine
EXECUTABLE  every holder is known and the chain ends at a body   machine
REHEARSED   somebody walked it, attested by a named human        record of a human act
VERIFIED    a human recorded that authority actually transferred human judgement
```

Each requires the ones before it; **none implies the one after**. The estate reports **30 documented,
30 executable, 0 rehearsed, 0 verified**. The drill walks seven stages and stops at six: the
seventh, `authority-restored`, is UNKNOWN and stays UNKNOWN, because a succession chain says who
acts while the primary is away and nothing says how acting ends.

**SUCCESSION DESIGN IS NOT SUCCESSION PROOF.**

## Governance capability drift

`GOVERNANCE_CAPABILITIES` stays explicitly declared. Deriving membership from the bounded context
was tried and rejected on the evidence: 83 controls sit in the two governance contexts and 10 are
claimed, so sweeping them in would make "governance capability" mean "anything in two contexts".

What is derived instead is **drift** — which controls require a module a capability claims, read
from the source, because a require is a fact and a naming convention is a convention. Current
state: **35 findings** (33 undeclared members, 2 duplicate claims), UNKNOWN, governance review
required, blocking nothing. Placing a control in a capability is a statement about what the
capability *is*, so the detector reports rather than adopts.
