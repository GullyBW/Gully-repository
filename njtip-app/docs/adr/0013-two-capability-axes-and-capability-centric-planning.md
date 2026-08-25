# ADR-0013: Two capability axes, and why the second one is not a duplicate of the first

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** Architecture Review Board · Oversight Board
- **Review required:** ARB (the second axis) + OB (the rule that operational status is a human statement)

## Context

`src/capability/model.js` has declared business capabilities since Phase 38: Anonymous Reporting,
Case Management, Evidence & Custody, and seven more. Each carries a domain, the services that deliver
it, its dependencies and the controls that protect it. The resilience invariant, the risk ranking and
the legal authority registry all read those declarations, which is why Phase 15 gave them a change
history.

Phase 18.1 Part 10 asks for a capability-centric roadmap built on a different vocabulary entirely:
Executive Intelligence, Governance Assurance, Digital Twin, Architecture Governance, Decision
Intelligence, and five more. It asks that capabilities become the primary planning unit while phases
remain the historical delivery mechanism.

The two lists share no member. They also share the word "capability", and that is the whole problem
this decision addresses.

A codebase with two things called capability, in one module, with two vocabularies and two sets of
dependencies, is exactly what Phase 18.1 Part 4 exists to detect. Running that Part's own analysis
over this pair produces `GOVERNANCE_REVIEW_REQUIRED`: they overlap on registry, ownership,
dependency and calculation dimensions. By the rule that Part establishes — similarity is evidence,
not a verdict — that is a candidate requiring an architectural judgement, not a duplicate.

This ADR is that judgement.

## Decision

**The two axes coexist in one module, and they are not duplicates.**

They answer different questions for different audiences:

- `CAPABILITY_MAP` answers a question about the Republic's justice system. *What can this institution
  do for a citizen, and what protects it?* A member of the public would recognise "Anonymous
  Reporting". An engineer plans nothing against it.
- `PLATFORM_CAPABILITIES` answers a question about the platform that serves it. *What enduring
  engineering capabilities does this codebase deliver, so planning survives the end of a phase?* An
  engineer plans against "Architecture Governance". A citizen has no use for it.

They live in **one module** rather than two, sharing the declaration-history machinery. Splitting
them would have been the actual duplication: two modules both named for capability, each with its own
change history, and nothing keeping the histories consistent.

**A capability does not become VERIFIED because a module exists.** VERIFIED requires an authorising
requirement, attributed modules, an accountable owner, and executable controls that ran. A module
existing is implementation, not verification, and the lifecycle reports it as `IMPLEMENTING`.

**A capability cannot become OPERATIONAL by any machine path at all.** `OPERATIONAL` is marked
`machineReachable: false` and requires a recorded human statement that the institution is running the
capability. There is no branch in `lifecycle()` that can produce it from evidence. Whether an
institution operates something is a fact about people, and a passing test is not evidence of it.

**Nine maturity dimensions, never summed.** A capability can be fully implemented, fully owned, and
verified by nothing. One number would call that "mostly mature".

## Consequences

Planning gains an abstraction that outlives a phase. A reader asking "what does Architecture
Governance consist of, who owns it, what verifies it, and what depends on it" has one place to look,
and it does not become stale when Phase 18.1 ends.

The phase view is preserved untouched. `phaseView` in the capability roadmap reports the same 17
transition items and 4 waves the migration roadmap always has. Part 10 adds an axis and deletes no
history.

The word "capability" is now overloaded in this codebase, and that is a real cost. It is mitigated by
the two vocabularies being disjoint sets — a name in both would be a genuine defect, and a fitness
function checks for exactly that.

`OPERATIONAL` will read as unreachable to anybody who has not read this decision, because it is. Ten
capabilities can be VERIFIED and none operational, and that will look like a failure on a dashboard.
It is not: it is the platform declining to claim that an institution runs something on the strength
of its own tests.

## Alternatives considered

**Rename the business capabilities to "business services" and take the word.** Rejected. The
declarations are load-bearing — the resilience invariant, the risk ranking and the legal authority
registry all read them — and renaming a load-bearing declaration to free up a word is a change with
real blast radius and no benefit to anybody reading the result.

**Put the platform capabilities in a new module, `src/capability/platform.js`.** Rejected, and this
was the closest call. It would read more cleanly. It would also produce two modules named for
capability with two independent change histories, and nothing structural keeping them consistent —
which is the duplication rather than the cure for it.

**Extend `CAPABILITY_MAP` with the ten platform names.** Rejected outright. The heat map, the
resilience readings and the legal authority registry all iterate that map. Adding ten
platform-engineering entries would corrupt every one of those readings with things a citizen has no
stake in.

## Rejected alternatives

**Deriving platform capabilities from the module tree.** Every module under `src/architecture/` could
be attributed to Architecture Governance automatically. Rejected: it would produce a capability map
that is a restatement of the directory structure, and a capability that is just a folder name tells a
planner nothing they could not get from `ls`.

**Letting a capability reach VERIFIED on control coverage alone.** Cheaper, and it would have made
the ten capabilities look far healthier. Rejected because a capability with controls and no
authorising requirement exists because somebody built it rather than because anybody asked for it,
and that is precisely the finding Phase 18.1 exists to surface.

**Reporting a single capability maturity score.** Rejected on the same grounds as every other score
in this platform. Nine dimensions with different evidence and different owners do not add up, and the
one number would be the number everybody quotes.

## Architectural trade-offs

One overloaded word buys one shared change-history and one place to look. The alternative — a clean
word — costs a second module, a second history, and a consistency problem nothing enforces.

An unreachable `OPERATIONAL` state buys honesty at the cost of a dashboard that will never show
green. That trade is deliberate and is the same one the production-transition framework has made
since Phase 16.

## Long-term maintenance impact

Whoever maintains `src/capability/model.js` maintains two vocabularies in one file, and must
understand that they are different axes before touching either. The module comment says so at the
point of the second declaration, which is where somebody will be reading when it matters.

The ten platform capabilities need their declarations kept current as modules move between them. That
is real work, and it is the work that makes the capability view worth having: a capability whose
module list is stale is a capability nobody is planning against.

## Implementation complexity

Moderate. The registry, the nine-dimension maturity model, the lifecycle derivation and the
dependency cycle detection are about 300 lines in an existing module. The cycle detection is a
standard three-colour walk.

The subtle part is the lifecycle: `OPERATIONAL` must be unreachable from evidence while still being
reachable from a recorded human statement, and the fitness function checks both directions —
a state nothing can reach is not a state.

## Operational cost

Negligible at runtime. `maturity()` reads the context map, the ownership model and the filesystem
once per capability; ten capabilities is thirty lookups.

The human cost is the point: declaring a capability requires naming an owner who exists, an
authorising requirement, and the modules that deliver it. That is minutes of thought per capability
and it is what makes the register worth reading.

## Lifecycle implications

This decision holds while phases remain how work is delivered. If NJTIP moves to continuous delivery
with no phase structure, the phase view becomes historical only and this ADR should be revisited —
the capability view would then be the sole planning mechanism rather than the primary one.

The ten-name vocabulary is expected to change. It is declared in one place so that it can, and a
capability added to it needs a declaration, not just a string.

## Business justification

The Republic plans against capabilities that outlive any phase of work. A roadmap organised only by
phase answers "what did we build in Phase 17" and cannot answer "what is Architecture Governance,
who owns it, and what would break if it stopped" — which is the question a planning meeting actually
asks.

## Risk assessment

**The overloaded word causes a real mistake.** Somebody reads `CAPABILITY_MAP` expecting platform
capabilities, or the reverse. Mitigated by disjoint vocabularies and a control that fails if a name
appears in both; not eliminated.

**The capability declarations go stale.** A module moves and no declaration follows it. Mitigated by
the module-existence check in `implementationCoverage`, which catches a module that was deleted and
not one that was moved between capabilities. Named as a debt below.

**`OPERATIONAL` never being reached is read as a defect.** Mitigated by the lifecycle stating the
reason on every row rather than in this document alone.

## Performance impact

None measurable. Ten capabilities × three lookups, on demand.

## Security impact

None directly. The registry holds no data about people beyond the accountable institution's name,
which is already in the accountability record.

## Operational impact

A capability declared with an owner who does not appear in the accountability record is refused. That
is a behaviour change operators will meet the first time they declare one, and the error names the
problem.

## Compliance impact

None directly. `Constitutional Assurance` appears in the vocabulary as a capability, which means the
constitutional properties of the platform become plannable rather than only assertable.

## Rollback strategy

Delete `PLATFORM_CAPABILITIES`, `PlatformCapabilityRegistry` and their exports. `CAPABILITY_MAP` and
the declaration history are untouched by this change and continue to work. No stored state exists to
migrate: the registry is constructed per request.

The `APP-FIT-CAPABILITY-ROADMAP` control would be removed with it. Nothing else reads the platform
axis.

## Migration strategy

No migration. The business capability axis is unchanged, every existing consumer of `CAPABILITY_MAP`
sees the same data, and the platform axis is new with no prior state.

## Estimated implementation cost

Approximately 300 lines in `src/capability/model.js`, 150 in the fitness function, plus this ADR and
the deterministic tests. Under a day including mutation testing.

## Success metrics

- Exactly 2 capability axes exist, sharing 1 module and 1 change-history mechanism.
- 0 names appear in both vocabularies.
- 0 machine paths reach `OPERATIONAL`.
- 9 maturity dimensions, reported separately, summed 0 times.
- 6 mutations against the control, 6 caught.

## Measurable success criteria

- `PLATFORM_CAPABILITIES.length >= 10` and the intersection with `Object.keys(CAPABILITY_MAP)` has
  length exactly 0, enforced by `APP-FIT-CAPABILITY-ROADMAP`.
- `CAPABILITY_LIFECYCLE.OPERATIONAL.machineReachable === false`, and a capability with every
  verification dimension satisfied reports `VERIFIED` rather than `OPERATIONAL` — checked in both
  directions, since a state nothing can reach is not a state.
- `maturity().scored === false` for every capability, over all 9 dimensions.
- The phase view reports the same 17 transition items and 4 waves as the migration roadmap, so Part
  10 is verifiably additive.
- A 3-capability dependency cycle is detected and produces at least 1 violation.

## Architectural debt assessment

Three debts, named rather than closed.

**Module drift is only half-detected.** `implementationCoverage` catches a declared module that no
longer exists. It cannot catch a module that moved from one capability to another, because nothing
declares which capability a module belongs to from the module's side. Closing this needs a reverse
index, which is Phase 18.1 Part 1's territory and is not in this decision.

**`evidenceQuality` is a placeholder.** It counts controls and reports `PARTIALLY_VERIFIED` without
grading them against the evidence-confidence framework that exists elsewhere in the platform. The
dimension is honest about this in its detail string; it is still weaker than the other eight.

**The two axes are related only by convention.** Nothing connects "Evidence & Custody" (business) to
"Evidence Intelligence" (platform), though the second plainly serves the first. A cross-axis mapping
would be useful and would also be the point at which the two axes start to merge, which is why it is
deferred rather than added.

All three come due when somebody asks which platform capability supports a given business capability.
The answer today is a human one.

## Review schedule

Reviewed by the Architecture Review Board every 12 months, next due 2027-08-07, and immediately on
any of: a name appearing in both vocabularies; a third capability axis being proposed; or the
platform vocabulary growing beyond 15 entries, at which point it is no longer a vocabulary but a
taxonomy and needs different governance.

The Oversight Board reviews the `OPERATIONAL`-requires-a-human rule every 24 months, next due
2028-08-07.

## Sunset criteria

This decision stops applying when any of the following becomes observably true:

- Phases cease to be how work is delivered, making the dual view unnecessary — the capability view
  would become the sole mechanism rather than the primary one.
- The business capability axis is retired or moved out of this module, at which point the word is no
  longer overloaded and the reasoning here is moot.
- A formal capability-management system holds the platform axis natively, making this registry a view
  over it rather than the record.

## Decision owner

Architecture Review Board.

The ARB owns whether the two axes remain distinct. The Oversight Board owns the rule that operational
status requires a human statement, because that is a question about what the platform is permitted to
claim rather than about how it is built.

## Approval history

- **2026-08-07** — Proposed by the Architecture Review Board. The proposal was triggered by running
  Phase 18.1 Part 4's own duplication analysis over the pair `CAPABILITY_MAP` /
  `PLATFORM_CAPABILITIES`, which returned `GOVERNANCE_REVIEW_REQUIRED` on four overlap dimensions.
  Using the platform's own duplication detector on the platform's own change is recorded here because
  it is the first time that control has been applied to work in progress rather than to a
  hypothetical.
- **2026-08-07** — Accepted by the Architecture Review Board, which judged the two axes distinct on
  the grounds that their vocabularies are disjoint and their audiences are different. Accepted by the
  Oversight Board, which required that `OPERATIONAL` be structurally unreachable rather than merely
  undeclared — that is how it is implemented, and the fitness function checks it in both directions.
