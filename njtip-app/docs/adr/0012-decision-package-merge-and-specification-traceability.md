# ADR-0012: Merging three decision-package specifications into one guard, and governing merges thereafter

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** Architecture Review Board · Oversight Board · Operations Review Board
- **Review required:** ARB (the merge itself) + OB (the governance rule it establishes)

## Context

Three specifications arrived asking for fields on the executive decision package: Phase 17 Part 15
("Decision Intelligence"), Phase 17 Part 17 ("Executive Decision Intelligence"), and Phase 18 Part 7
("Executive Decision Intelligence 2.0"). Their field lists overlap substantially — all three ask for
evidence, assumptions, confidence, legal authority and risks — and each adds a few the others do not.

The platform already had a decision package with eight required fields and a fail-closed guard,
`assertAdvisory`, built in Phase 15. Every one of the three specifications says, in its own words,
not to create another decision framework. Phase 18 Part 7 says it in capitals.

Implementing them separately would have produced three parallel field schemas over one concept. The
failure mode is specific and it is not hypothetical: a board reads whichever package it is handed,
two of the three omit constitutional implications, and nobody discovers the difference until a
decision is taken on the thinner one.

So the three were merged into the existing guard. That was the right engineering call. It was
recorded in a commit message, which is not architectural governance — and that gap is what the rest
of this ADR exists to close.

The problem with an ungoverned merge is not that it is wrong. It is that it is **invisible**. A
future reader searching the codebase for "Phase 18 Part 7" finds nothing under that name. There is no
way, from the code alone, to distinguish a requirement that was absorbed into a larger implementation
from one that was quietly dropped. Both look like absence.

## Decision

Two decisions, one retrospective and one forward-looking.

**First**: the nine fields required by Phase 17 Parts 15 and 17 and Phase 18 Part 7 are implemented
as additions to the existing `DECISION_PACKAGE_FIELDS` schema and the existing `assertAdvisory`
guard in `src/assurance/institutional.js`, taking it from eight required fields to seventeen. No
second decision framework exists. The merged requirements are enumerated below so that a reader
looking for any one of them can find where it went.

**Second**: from ADR-0012 onward, an ADR that records a merge must satisfy a **merge schema** —
four additional sections naming the merged requirements, the rationale, the compatibility impact and
the implementation strategy. This is added to `src/architecture/adr-governance.js` as a schema tier
in the same style as the full, extended and governance tiers before it: applied from this number
forward, never retrofitted onto earlier decisions.

A merge register in the same module holds the record of which implementations absorbed which
requirements. It refuses to accept a merge that cites no ADR, fail-closed, for the same reason the
authority register refuses an unattributed declaration.

## Consequences

A reader looking for any of the three merged specifications now finds a record naming where it went
and what satisfies it. The `merge` schema tier means any future merge is held to the same standard
without anybody having to remember this decision.

The decision package now requires seventeen fields. That is a high bar for assembling one, and it is
deliberate: a package a board can act on without checking is the most dangerous artefact this
platform produces, and the cost of assembling one should be felt by whoever assembles it rather than
by whoever reads it.

Two of the seventeen do work beyond documentation. `alternativesConsidered` must be non-empty,
because a recommendation with no alternative is an instruction and a board asked to approve it has
nothing to choose between. `governanceOwner` and every named actor in `recommendedHumanActions` are
resolved against the accountability record, because advice addressed to a body that does not exist is
advice into the air.

The existing three assembled packages were extended rather than rewritten. Their historical-outcome
and validation-history fields state the absence of history explicitly — an absence of history is not
a history of success, and leaving those fields empty would have let the guard pass while saying
nothing.

## Alternatives considered

**Implement all three specifications separately and reconcile later.** Rejected. Reconciling three
live schemas over one concept is strictly harder than not creating them, and the window in which the
three would have coexisted is exactly the window in which a board could read the wrong one.

**Implement the union of fields with no ADR, as before.** This is what had already happened, and the
reason this ADR exists. It works and it is untraceable.

**Create a fourth "decision quality" module that validates the other three.** Rejected explicitly: it
would have been a fourth framework whose purpose was to manage the existence of three others.

## Rejected alternatives

**A generic "specification alias" table mapping requirement identifiers to implementations.** This
would have been cheaper than a schema tier and would have carried no rationale — a mapping says
*where* a requirement went and never *why* it was merged, which is the part a future reader needs.
The merge schema requires the rationale because a merge made to prevent duplication and one made for
convenience are indistinguishable afterwards.

**Retrofitting the merge schema onto ADRs 0001–0011.** Rejected on the same principle as the three
schema expansions before it. An ADR records what was known and required when it was written;
rewriting earlier decisions to a later standard destroys the thing the record exists to preserve.

**Making the merge register fabricate entries by scanning commit history for merge-shaped commits.**
Rejected. A merge is a claim about intent, and inferring intent from a diff would populate the
register with guesses that read exactly like recorded decisions.

## Architectural trade-offs

Seventeen required fields buys completeness at the cost of assembly effort. A package now takes real
work to construct, and the three the platform assembles automatically are long. The alternative —
fewer required fields — buys convenience by letting an incomplete package reach a board.

The merge schema buys traceability at the cost of a governance step on every future merge. That step
is the point: a merge that is too much trouble to record is a merge somebody should think about
twice.

## Long-term maintenance impact

Whoever maintains the decision package maintains seventeen fields rather than eight, and the guard
grows with each specification that asks for more. The mitigation is that they land in one place: the
maintenance cost of one seventeen-field schema is materially lower than three eight-field schemas
that must be kept consistent with each other.

The merge register needs an entry per merge, which is a few lines and a paragraph of rationale. If
merges become frequent enough for that to be burdensome, the frequency itself is the finding.

## Implementation complexity

Low. The merge is nine entries in an existing object literal and nine checks in an existing
fail-closed guard. The schema tier follows the pattern of three tiers already present, and
`schemaFor` gains one branch.

The two non-trivial checks are the accountability-record resolution for `governanceOwner` and the
`recommendedHumanActions` role validation, both of which read the ownership model rather than a
list.

## Operational cost

Negligible at runtime — the guard runs when a package is assembled, and the accountability lookup is
over thirty subsystems. The real cost is human: assembling a decision package now requires somebody
to state alternatives, predicted consequences and constitutional implications, which is minutes of
thought rather than milliseconds of compute.

## Lifecycle implications

The merge schema applies from ADR-0012 forward and has no expiry. It is superseded if the platform
ever adopts a formal requirements-management system that tracks specification identifiers natively,
at which point the register becomes a view over that system rather than the record itself.

The seventeen-field package is expected to grow. Each addition should be weighed against whether a
board would actually read it: a field nobody reads is a field that trains people to skim.

## Business justification

The Republic's boards act on the recommendations this platform assembles. A recommendation that
cannot be traced back to the requirement that asked for it, or that omits an alternative because one
of three schemas did not require one, is a governance failure with the platform's name on it.

The merge register is the smaller half of the justification and the more durable one: it is what
lets an auditor confirm that a specification requirement was implemented rather than dropped.

## Risk assessment

**The merge hides a requirement rather than absorbing it.** This is the risk the ADR is written
against, and the mitigation is the enumeration below plus the merge-verification checks that confirm
each merged requirement still has a field satisfying it.

**Seventeen fields produce packages nobody reads.** Real, and unmitigated by anything structural. The
countermeasure is editorial: each field states what its absence means, so a field that cannot justify
itself in one sentence should not be there.

**The register is trusted more than it deserves.** It records what somebody declared, not what the
code does. The merge-verification checks close part of this by testing the merged behaviour rather
than reading the register.

## Performance impact

None measurable. `accountableBodies()` builds a set of roughly thirty entries per guard invocation;
packages are assembled a handful of times per request at most.

## Security impact

None directly. The guard's refusal to accept a package whose recommended actions arrive already
taken is a small integrity property: this platform recommends actions and never records itself
performing one, and that remains structurally true after the merge.

## Operational impact

Whoever assembles a decision package must now name a governance owner that exists in the
accountability record. Packages that named a plausible-sounding body would previously have been
accepted and are now refused, which is a behaviour change operators will notice the first time.

## Compliance impact

`constitutionalImplications` is now a required field on every package. Recommendations touching
judicial independence or executive separation must say so rather than leaving a reader to notice.

## Rollback strategy

The nine added fields can be removed from `DECISION_PACKAGE_FIELDS` and the corresponding checks from
`assertAdvisory`, returning the guard to its Phase 15 shape. The three assembled packages carry the
extra fields harmlessly if the guard stops requiring them, so rollback is a schema change with no
data migration.

The merge schema tier can be removed by deleting `MERGE_SCHEMA` and its `schemaFor` branch; ADR-0012
would then be held to the governance schema and would still validate, since the merge sections are
additional headings rather than replacements.

## Migration strategy

No migration. Every existing caller of `decisionPackage` was updated in the same change, and the
Phase 15 and Phase 16 tests that pinned the eight-field schema were updated to the seventeen-field
one in place. No stored state exists to migrate: packages are assembled per request from reports.

## Estimated implementation cost

Approximately 200 lines across `src/assurance/institutional.js` (fields, guard, three package
bodies), 60 lines in `src/architecture/adr-governance.js` (schema tier and register), plus this ADR.
Roughly one engineering day including the mutation testing.

## Success metrics

- The decision package requires exactly 17 fields, checked by `APP-FIT-DECISION-SUPPORT`.
- 3 specification requirements (Phase 17 Parts 15 and 17, Phase 18 Part 7) are recorded as merged
  into 1 implementation.
- 0 duplicate decision frameworks exist in `src/`.
- At least 6 mutations against the extended guard are caught by the fitness function.

## Measurable success criteria

- `Object.keys(DECISION_PACKAGE_FIELDS).length === 17`, enforced by a fitness function that fails at
  16 or 18.
- All 3 automatically assembled packages satisfy all 17 fields, verified per package rather than in
  aggregate.
- The merge register holds at least 1 entry, and 0 entries lacking an ADR reference — the register
  refuses the second case fail-closed.
- ADR-0012 satisfies 31 required sections (4 legacy + 12 full + 8 extended + 2 governance + 4 merge)
  with 0 missing, checked by `APP-FIT-ADR-SCHEMA`.
- 0 of the 3 merged requirements are unsatisfied after the merge, checked by merge verification
  rather than asserted here.

## Architectural debt assessment

Two debts, both named rather than closed.

**The merge register is declarative.** It records that a merge happened because somebody recorded it.
Nothing scans the codebase for merge-shaped implementations that were never registered, so an
unregistered merge remains invisible. Closing this needs a requirements-traceability matrix that
works from specification identifiers, which is Phase 18.1 Part 1 and is not in this decision.

**Merged requirement satisfaction is checked structurally, not semantically.** Merge verification
confirms that each merged requirement maps to fields that exist and are required. It cannot confirm
that the field means what the specification intended. That judgement is human and this ADR does not
pretend otherwise.

Both come due when the first merge is contested — when somebody argues a requirement was dropped
rather than absorbed. The register makes that argument answerable; it does not make it automatic.

## Merged requirements

Three specification requirements, resolved into one implementation:

| Requirement | Asked for | Where it went |
|---|---|---|
| **Phase 17 Part 15** — Decision Intelligence | evidence chain, assumptions, confidence, alternatives, legal authority, historical outcomes, forecast confidence, validation history | `DECISION_PACKAGE_FIELDS`: `supportingEvidence`, `assumptions`, `confidence`, `alternativesConsidered`, `legalDependencies`, `historicalOutcomes`, `forecastConfidence`, `validationHistory` |
| **Phase 17 Part 17** — Executive Decision Intelligence | confidence, evidence, assumptions, risks, uncertainty, historical precedent, governance owner | `confidence`, `supportingEvidence`, `assumptions`, `risks`, `uncertainties`, `historicalOutcomes`, `governanceOwner` |
| **Phase 18 Part 7** — Executive Decision Intelligence 2.0 | evidence, assumptions, confidence, historical outcomes, legal authority, governance owner, implementation risks, organizational impacts, alternatives considered, predicted consequences, validation history, constitutional implications | all of the above plus `institutionalImpacts`, `predictedConsequences`, `constitutionalImplications` |

Every field named by any of the three is present and required. The union is seventeen fields; no
requirement in any of the three specifications maps to nothing.

## Merge rationale

One implementation rather than three because all three specifications describe the same artefact —
the package a board reads before taking a decision — and each explicitly forbids creating another
decision framework.

The merge was not made for convenience. Three schemas over one concept would have been actively
harmful rather than merely redundant: the failure mode is a board acting on whichever package it was
handed, with no way to tell that another schema required a field this one omitted. Constitutional
implications, required only by Phase 18 Part 7, is exactly the field that would have been missing
from two of the three.

## Compatibility impact

**Callers of `decisionPackage` and `assertAdvisory`**: a package satisfying the Phase 15 eight-field
schema is now refused. Every in-repository caller was updated in the same change. The refusal is
fail-closed and names the missing field, so an external caller would get an actionable error rather
than a silently thinner package.

**Readers of an assembled package**: additive only. Every field present before is present now, with
the same name and the same meaning. Nothing was renamed and nothing was removed.

**`decisionSupport` output shape**: unchanged at the report level — `packages`, `count`, `conclusion`
and `authorizes` are as they were. Each package object carries nine additional keys.

**ADRs 0001–0011**: unaffected. The merge schema applies from 0012 forward.

## Implementation strategy

The requirements were combined by taking the union of the three field lists, mapping each
specification's terminology onto the platform's existing names where one already existed
(Phase 18's "implementation risks" onto the existing `risks`, "organizational impacts" onto
`institutionalImpacts`), and adding a new field only where no existing one covered it.

Where two specifications asked for the same thing under different names, the existing name was kept
and both are recorded above as satisfied by it. Renaming to match a specification would have broken
every existing caller in exchange for vocabulary.

Two fields were made structural rather than documentary, because as prose they would have been
satisfied by anything: `evidenceStrength` is an enum of four grades rather than free text, since
"high — derived from records" and "high — a projection" are not the same claim; and
`forecastConfidence` is required exactly when the grade is `projected` and refused otherwise, so a
confidence figure never describes a forecast that does not exist.

## Verification strategy

Structural, and the boundary is stated rather than implied.

`mergeVerification()` maps each absorbed requirement to the fields that satisfy it and checks every
field against the guard's required set. `APP-FIT-MERGE-GOVERNANCE` fails if any mapped field stops
being required, so a later change that quietly drops `constitutionalImplications` breaks the build
rather than the record.

That proves the fields exist and are enforced. It does not prove they mean what the three
specifications intended, and the section below records what remains open rather than leaving the
verification to imply a completeness it does not have.

Three checks carry it:

- `APP-FIT-MERGE-GOVERNANCE` — the merge is registered, cites a resolvable ADR, and every absorbed
  requirement maps to at least one field the guard requires.
- `APP-FIT-DECISION-SUPPORT` — the guard requires exactly 17 fields and refuses a package missing
  any of them, with six mutations proving each refusal is real.
- `APP-FIT-REQUIREMENTS-TRACEABILITY` — the requirement register can express each of the three as a
  declared requirement mapping to this implementation.

## Unresolved semantic questions

Three, recorded because a merge that claims to have settled everything is a merge nobody checked.

**Does `institutionalImpacts` satisfy Phase 18 Part 7's "organizational impacts"?** Mapped on the
reading that they are the same thing. A reader who thinks the specification meant impacts on *people*
— workload, morale, role change — rather than on institutions should say so, because the current
field collects the second and the packages are written accordingly.

**Does `risks` satisfy Phase 18 Part 7's "implementation risks" specifically?** The existing field
collects risk of any kind. Implementation risk is arguably narrower, and a package that names a
governance risk and no implementation risk currently satisfies the guard.

**Is Phase 17 Part 15's "evidence chain" satisfied by `supportingEvidence` alone?** The specification
says chain, and the field holds a list. The nine-hop explanation machinery exists elsewhere in the
platform and is not attached to decision packages. Phase 18.1 Part 8 revisits this directly; until
it does, the mapping is a reading rather than a settled fact.

None of the three blocks the merge. All three are the kind of thing that is obvious to whoever
performed the merge and invisible six months later, which is why they are here.

## Review schedule

Reviewed by the Architecture Review Board every 12 months, next due 2027-08-07, and immediately on
any of: a fourth specification asking for decision-package fields; a second merge being recorded; or
the seventeen-field guard being changed.

The Oversight Board reviews the merge-governance rule itself every 24 months, next due 2028-08-07 —
a longer cycle because the rule is about process rather than about any one decision.

## Sunset criteria

This decision stops applying when any of the following becomes observably true:

- A formal requirements-management system tracks specification identifiers natively, at which point
  the merge register becomes a view over it rather than the record of truth.
- The decision package is retired or replaced by an artefact with different semantics — not merely
  more fields.
- The platform ceases to assemble decision packages automatically, making the guard's cost
  unjustifiable against zero assembled packages.

Until one of those holds, the merge schema applies to every ADR numbered 0012 and above.

## Decision owner

Architecture Review Board, jointly with the Oversight Board for the merge-governance rule.

The ARB owns whether a given merge was architecturally correct. The OB owns whether the rule
requiring merges to be recorded is working, which is a different question and is reviewed on a
different cycle.

## Approval history

- **2026-08-07** — Proposed by the Architecture Review Board, on the basis that a merge had been
  performed in the preceding change without architectural governance, and that the gap was found by
  the Phase 18.1 specification rather than by the platform's own controls. That is itself recorded
  as a finding: nothing in the assurance suite detected an ungoverned merge, which is why Part 2
  exists.
- **2026-08-07** — Accepted by the Architecture Review Board and the Oversight Board. The ARB
  accepted the merge as correct and the record as sufficient. The OB accepted the merge-schema tier
  and required that the merge register be fail-closed on a missing ADR reference rather than warning,
  which is how it is implemented.
