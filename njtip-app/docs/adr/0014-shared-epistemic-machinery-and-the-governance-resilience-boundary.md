# ADR-0014: One epistemic vocabulary for the whole platform, and where a resilience finding stops

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Architecture Review Board · Oversight Board
- **Review required:** ARB (the shared module) + OB (the rule that a resilience finding about the platform's own tooling does not block a build)

## Context

Two things happened while building Phase 18.1 Part 8, and both turned out to be architectural rather
than local.

The first was a defect. The decision-explainability chain shipped with two hop outcomes: a hop
resolved or it did not. A decision package whose precedent field honestly read *"no comparable
recommendation has been recorded, so nothing is known about how this has gone before"* then resolved
the precedent hop — because the code counted records and a record was present — and the chain
reported "explainable end to end across all 9 hops" for a recommendation with no precedent
whatsoever. A stated absence had been read as a presence. Two states cannot express the difference
between *checked and wrong* and *could not be established*, and those two lead to different
institutional actions: one is fixed, the other is investigated.

The second was a near-duplication. The fix — three states, and a chain that stops at its first
unresolved step — was written inside `explainDecision()`. Part 7 then needed the same three states
for specification compliance, and Batch 7 needed them again for governance resilience. Three copies
of the same vocabulary, in three modules, is precisely what Part 4 of this phase exists to detect.

A third, smaller decision was forced by Batch 7. The global invariant of ADR-0009 blocks institutional
readiness when a constitutional capability rests on a single point of organizational failure. Batch 7
applies the same invariant to the governance machinery Phase 18.1 built. Nothing in the governance
model says that a single-point dependency in the platform's own tooling should block a build, and
making it so would be a change to governance semantics introduced by a commit rather than by a board.

## Decision

**One epistemic vocabulary, in one module, for the whole platform.** `src/assurance/epistemic.js`
holds `EPISTEMIC_STATES` — RESOLVED, BROKEN, UNKNOWN — with `weakest()` for roll-ups, the
`assuranceChain()` first-break walker, and `machineBoundary()`. It sits in the existing `assurance`
bounded context, which claims `src/assurance/` by directory prefix, so no new context is created.

`institutional.js` no longer defines its own copy: `HOP_STATES` **is** `EPISTEMIC_STATES`, and
`explainDecision()` runs its chain arithmetic through `assuranceChain()`. That is what makes it one
explainability engine rather than two implementations of one rule. `COMPLIANCE_STATES` and
`GOVERNANCE_RESILIENCE_STATES` each declare which epistemic state they map onto, so a finding from
any of them can enter any other assurance chain without a translation layer inventing a fourth
meaning on the way.

**UNKNOWN is a successful verification outcome.** Where the available evidence cannot establish
either resolution or failure, reporting UNKNOWN is the correct result and not a gap in the check. It
is never a pass: it does not satisfy, it is not examined, and it does not continue a chain.

**Depth is the walk before the first gap.** `contiguousNavigableDepth` and `resolvedCount` are
reported separately and must not be conflated. A chain broken at step 1 with steps 2–9 intact has
depth 0 and a resolved count of 8; reporting the 8 as depth produced `TRACEABLE THROUGH HOP 8/9` for
a decision package with nothing at the top of it. No assurance chain is summarised as a percentage.

**A resilience finding about the platform's own governance machinery goes to a board, not to the
build.** `governanceCapabilityResilience()` reports `SINGLE_POINT_OBSERVED`, which requires
governance review and does not block. `BLOCKED` remains reachable, but only for a capability whose
governance model already required resilience. ADR-0009's blocking behaviour for constitutional
capabilities is unchanged.

## Consequences

The three states are now enforceable estate-wide by a single control rather than re-argued at each
call site, and a fourth caller gets the first-break rule for free instead of reimplementing it
slightly differently.

The immediate cost is visible in the first report the new machinery produced. All five Phase 18.1
governance capabilities rest on a single accountable body, and four on a single implementing module:
eleven single-point dependencies. None blocks the build; all five went to governance review. The
platform now says something unflattering about itself that it previously had no vocabulary to say.

A second cost, accepted: `UNKNOWN` appears far more often than the states it replaced. Fifteen of the
thirty constitutional invariant clause results are UNKNOWN, and the platform's own legal-authority
decision package now stops at hop 6 of 9. Those were always the facts. The reports were previously
unable to distinguish them from success.

## Alternatives considered

**Leave the three states inside `explainDecision()` and let each caller define its own.** Rejected
because Part 4 of this same phase would classify the result as `GOVERNANCE_REVIEW_REQUIRED` on the
registry and validation-logic dimensions, and a phase that ships the duplication it was written to
prevent has argued against itself.

**A new bounded context for epistemic primitives.** Rejected as unnecessary: `src/assurance/` already
claims the directory, and this phase forbids creating a context unless an ADR proves it is needed.
Nothing here needs it.

**Two states plus a nullable field, rather than three states.** Rejected. A nullable `resolved` is
what the original defect looked like from the inside — the absence read as a value — and a state that
has to be inferred from a null is one a later refactor will collapse.

**Block the build on a single-point dependency in the governance machinery.** Rejected as a change
to governance semantics that no board took. It would also be self-defeating: the finding is real, so
the gate would be red from the moment it was written, and a permanently red gate is turned off.

## Business justification

An institution that cannot tell "we checked and it is wrong" from "we could not establish it" will
treat both as noise or both as alarm, and will be wrong either way. The distinction is what lets an
oversight body allocate attention: broken findings are assigned, unknown findings are investigated.
Without it, the platform's reports get less useful as they get more numerous.

## Risk assessment

The principal risk is that `UNKNOWN` becomes the default answer and the reports lose meaning through
abundance. Mitigated by requiring every UNKNOWN to state what would resolve it, and by
`APP-FIT-EPISTEMIC-INTEGRITY` asserting that RESOLVED is reachable in every chain — a state nothing
can reach is not a state, and a chain nothing can complete proves nothing.

The secondary risk is that a future change reintroduces depth-as-tally, since the two numbers look
interchangeable. Mitigated by a control that breaks the first step of a chain and asserts depth 0
with a resolved count of 8.

## Security impact

None. No authentication, authorization, cryptographic or data-handling behaviour changes. The module
is pure computation over values supplied by callers and reads no data of any classification.

## Performance impact

Negligible and bounded: `assuranceChain()` is a single linear pass over a fixed-length step list, and
`governanceCapabilityResilience()` performs a handful of `existsSync` calls per capability at
verification time only. Nothing runs on a request path.

## Operational impact

Reports that previously rendered a stated absence as a resolved hop now stop and name the hop. Anyone
reading a decision explanation or a compliance dashboard will see fewer complete chains than before,
and each will say where it stopped and what would resolve it. No runbook changes; no new operational
task is created.

## Compliance impact

Specification compliance gains an axis: a specification with no declared requirements now reports
UNKNOWN rather than being invisible. No legal mandate mapping changes, and no obligation moves
between controls.

## Rollback strategy

`epistemic.js` is additive and has one behavioural dependency: `institutional.js` imports
`HOP_STATES` from it. Reverting means restoring the local three-state literal in `institutional.js`
and reverting `specificationCompliance()` and `governanceCapabilityResilience()`, both of which are
new functions no other module calls. No stored state, no schema, no migration — the registers are
declarative and hold nothing between runs.

## Migration strategy

None required. No persisted data carries these states; every consumer computes them per run. The
existing six-clause constitutional invariant is untouched and continues to block readiness exactly as
ADR-0009 specifies.

## Estimated implementation cost

One module of roughly 180 lines, three fitness functions, and 31 deterministic tests. The larger cost
is not code: it is that reports now show more unresolved findings, and somebody has to look at them.

## Reversibility

Reversible. Additive module, three new controls, and one import substitution in `institutional.js`.

## Monitoring

`APP-FIT-EPISTEMIC-INTEGRITY` asserts the three states, the roll-up rule, all seven chain shapes and
that the decision chain runs on the shared walker rather than a private copy.
`APP-FIT-SPECIFICATION-COMPLIANCE` and `APP-FIT-GOVERNANCE-RESILIENCE` assert the mappings hold and
that no report is rendered as a percentage.

## Review

Reviewed when a fourth subject adopts the epistemic states, or when any consumer proposes a state
outside the three.

## Rejected alternatives

- **A numeric confidence score per hop (0.0–1.0) instead of three states.** Rejected because it
  reintroduces the percentage by another name. A chain averaging 0.89 tells a reader nothing about
  whether the missing 0.11 is a runbook or the legal authority, and the reader stops asking.
- **Treating UNKNOWN as blocking, so the build goes red on any unestablished claim.** Rejected: the
  gate would be red permanently — fifteen of thirty constitutional clause results are UNKNOWN today —
  and a permanently red gate is switched off, taking the honest findings with it.
- **A prose-classifier that decides whether a precedent record is substantive.** Rejected. The
  narrow declared-absence marker used instead catches records that *say* they are absences, which is
  the honest case the platform produces, and states plainly that it cannot catch a record which is
  empty of precedent without saying so. A checker claiming to read prose would be confidently wrong.
- **Deriving governance capability membership from the code rather than declaring it.** Rejected for
  the reason the requirement register was declared rather than inferred: a resilience matrix full of
  guesses reads exactly like one full of declarations.

## Architectural trade-offs

Bought: one enforceable rule, estate-wide, with a single control guarding it, and a fourth consumer
gets first-break semantics without reimplementing them.

Paid: `institutional.js` now depends on `epistemic.js`, so the assurance context has an internal
ordering it did not have before. And the reports are less comfortable — more chains stop, more
findings are unresolved, and the platform states single-point dependencies in its own governance.
That discomfort is the product, not a side effect, but it is a real cost to anyone who has to read
the output and act on it.

## Long-term maintenance impact

`epistemic.js` is small, pure and dependency-free: three state definitions, a roll-up, a linear
walker and a boundary helper. The maintenance risk is not the module but the pressure on it — every
future subject wanting a fourth state, or a score, or "just a percentage for the summary". The
control asserts exactly three states and no percentage, so that pressure surfaces as a failing build
and a conversation rather than as a quiet commit.

## Implementation complexity

Low. No new abstraction is introduced that did not already exist implicitly in `explain()`;
the change names it. The one subtlety a reader must hold is that `contiguousNavigableDepth` and
`resolvedCount` are different numbers, which is documented at the point of computation and asserted
by a control that breaks the first step of a chain and expects depth 0 with a resolved count of 8.

## Operational cost

No runtime cost: nothing added runs on a request path. The verification cost is a linear pass per
chain and a small number of `existsSync` calls per governance capability, within the existing gate.
The real operational cost is human — eleven single-point dependencies now sit with a board, and
somebody has to work through them.

## Lifecycle implications

This decision expires when the three states no longer describe the platform's findings — most likely
by a fourth being genuinely needed rather than merely convenient. It supersedes nothing. ADR-0009's
invariant and its blocking behaviour are untouched, and ADR-0012's requirement register is extended
rather than replaced.

## Success metrics

The decision has worked if, one phase from now, at least 1 new assurance subject adopts the 3 states
and the chain walker without adding a 4th vocabulary, and if exactly 0 reports in the estate
summarise assurance as a percentage. Today the count of adopting subjects is 3 — decision
explainability, specification compliance and governance resilience — and the count of percentage
summaries is 0.

## Measurable success criteria

- `Object.keys(EPISTEMIC_STATES).length === 3`, and `UNKNOWN.satisfied === false`,
  `UNKNOWN.examined === false`, `UNKNOWN.continuesChain === false`.
- `institutional.HOP_STATES === epistemic.EPISTEMIC_STATES` — identity, not equality, so a private
  copy cannot drift back in.
- A chain of shape `[BROKEN, RESOLVED × 4]` reports `contiguousNavigableDepth === 0` and
  `resolvedCount === 4`, and `resolvedButUnreachable.length === 4`.
- Every one of the 5 `COMPLIANCE_STATES` and 4 `GOVERNANCE_RESILIENCE_STATES` maps to a defined
  epistemic state — 9 of 9.
- A specification with 0 declared requirements reports `UNKNOWN` and `measurable === false`.
- 0 assurance summaries match `/\d+\s?%|percent/`.
- 36 mutations attempted across Batches 5–7 with a kill rate of 100%.

## Architectural debt assessment

Two debts are knowingly left unpaid.

First, `GOVERNANCE_CAPABILITIES` is a hand-declared list of five. It is declared rather than derived
on purpose, but it will drift as controls are added, and nothing yet notices a Phase 18.1 control
that belongs to none of the five. Comes due when a sixth governance capability is built.

Second, the requirement register ships empty, so `specificationCompliance()` currently has nothing
real to report on. The dashboard is verified against fixtures and against an empty register; it has
never been run over a populated one. That is a genuine limit on what the passing control establishes,
and it comes due when requirements are declared for the phases already delivered.

## Review schedule

Reviewed by the Architecture Review Board every 12 months, next due 2027-08-12, and immediately on
any of: a 4th epistemic state being proposed; a consumer requesting a percentage summary of an
assurance chain; or a second copy of the vocabulary appearing outside `src/assurance/epistemic.js`.

The Oversight Board reviews the non-blocking resilience boundary within 30 days of any single-point
finding being proposed for escalation to BLOCKED.

## Sunset criteria

This decision stops applying when either: a fourth epistemic state is accepted by the ARB, at which
point the vocabulary and every consumer mapping is revisited; or the governance model is amended to
require that single-point dependencies in the platform's own tooling block readiness, at which point
the boundary recorded here is replaced by whatever the board decided.

## Decision owner

Office of the Chief Architect (the shared module and the chain semantics), with the Oversight Board
owning the rule that a governance-resilience finding does not block a build.

## Approval history

- **2026-08-12** — Proposed by the Architecture Review Board. The proposal was triggered by a defect
  rather than a design review: the decision-explainability chain reported "explainable end to end
  across all 9 hops" for a package whose precedent record stated that nothing comparable had ever
  happened. The defect is recorded here because it is the reason the third state exists, and a reader
  who does not know that will eventually remove it as redundant.
- **2026-08-12** — Accepted by the Architecture Review Board on the grounds that three copies of one
  vocabulary would be the duplication Part 4 of this phase exists to detect. Accepted by the
  Oversight Board, which required that a single-point finding about the platform's own governance
  machinery report `GOVERNANCE_REVIEW_REQUIRED` rather than block, on the grounds that changing what
  blocks a build is a governance decision and not an implementation detail — that is how it is
  implemented, and the fitness function checks both directions.
