# Automated Compliance Intelligence (Phase 12, Part 19)

`src/legislation/compliance-intelligence.js` extends the legislation & regulatory governance bounded
context from *"what does this instrument map to?"* to the question somebody actually asks the morning
an amendment is gazetted: **which of our bounded contexts, ADRs, policies, datasets, workflows and
readiness dimensions does this land on, and where are we short?**

Gated by `APP-FIT-COMPLIANCE-INTELLIGENCE`. Live: `GET /api/compliance/intelligence` ·
`POST /api/compliance/changes` · `POST /api/compliance/changes/:id/assess`.

## Two principles

> **An unassessed change is not a compliant one.** A change nobody has mapped produces a gap, not
> silence. The register is the list of changes we know about; it is never evidence that there are no
> others, and the report says so.

> **A control that exists but does not hold is not a control.** "Mapped" and "holding" are different
> facts, reported separately, because a failing control and a missing one need different work from
> different people.

## What is watched

| Change kind | Originator | What a missed one costs |
|---|---|---|
| `legislative-change` | Parliament | The platform enforces a rule that is no longer law, or fails to enforce one that now is |
| `regulatory-amendment` | A regulator | A supervisory expectation goes unimplemented until an inspection finds it |
| `policy-update` | A governance board | Practice and published policy diverge, and the platform is the one that is wrong |
| `governance-change` | An accountable authority | A control keeps an owner who no longer holds the post |
| `control-effectiveness` | Assurance | A control is counted as holding when its evidence says otherwise |

A change kind nobody can state the consequence of is a change kind nobody prioritises, so the
consequence is part of the declaration.

## Mapping

`mapChange()` resolves a change onto seven dimensions, each against a named registry:

| Dimension | Resolved against |
|---|---|
| bounded contexts | `src/architecture/context-map.js` |
| ADRs | `docs/adr/*.md`, matched on the ADR's own text |
| policies | the consistency stances, each citing its ADR |
| controls | the executable fitness identifiers supplied by the caller |
| datasets | the governed estate |
| workflows | context-map relationships, in **both** directions |
| readiness dimensions | a declared kind→dimension map |

Two things this is careful about:

- **A name the architecture does not contain is reported, not carried through.** `unresolvedContexts`
  is how a typo stops becoming a compliance record.
- **ADRs are matched on their text, not on a curated index.** A curated index is another artefact to
  keep in step; the ADR text is the record of what was actually decided.

Owners are **derived** from the affected readiness dimensions rather than asked for on the form.

## Control states

```
holding      the check ran and held
failing      the check ran and did not hold        → critical gap
unverified   the check exists but no result was supplied  → major gap ("unverified is not holding")
missing      no executable check of that name ran  → critical gap
```

## Gaps and remediation

`gapAnalysis()` produces eight gap kinds — `unassessed`, `no-control`, `control-failing`,
`control-unverified`, `no-mapped-control`, `unresolved-context`, `ungoverned-dataset`, `no-adr` —
each naming the change it belongs to and its severity.

`remediation()` turns each into a **recommendation**: what to do, who owns it, and what it was
derived from, ranked critical → major → minor. There is no code path in this module that changes a
control, a policy or an ADR. Each recommendation is carried out by the named owner and recorded as
their decision.

## Empty by design

The composition root starts the change register **empty**. The platform has observed no legislative
or regulatory change yet, and seeding one would record a compliance history that never happened.

---

# Compliance State Lifecycle (Phase 13, Part 4)

Eight states, and one rule that shapes all of them:

> **No unknown state may be reported as compliant.**

Every state therefore declares `compliant` explicitly rather than it being inferred from the name.

| State | Compliant? | Meaning |
|---|---|---|
| `unknown` | ❌ | Nothing assessed. **Not neutral** — an obligation nobody has looked at is one nobody can say is met |
| `under-assessment` | ❌ | In progress. Work in progress is not an outcome |
| `compliant` | ✅ | Assessed as met, on our own evidence |
| `partially-compliant` | ❌ | Deliberately not compliant — **partial compliance with a legal obligation is non-compliance with part of it** |
| `failing` | ❌ | Controls exist and do not hold |
| `governance-gap` | ❌ | No control exists at all. Distinct from failing: the remedy is to build, not to fix |
| `remediating` | ❌ | A named human is closing a known gap under a recorded plan |
| `verified` | ✅ | **Independently** confirmed by somebody other than the assessor |

## Transitions are a machine

`unknown` can only go to `under-assessment`. The jump a hurried audit most wants to make —
`unknown` straight to `verified` — is refused, and so is any other undeclared move.

**`verified` cannot be self-declared.** It requires `independent: true` *and* a different person from
the one who assessed it. Collapsing `compliant` and `verified` is how self-assessment becomes
assurance, so the two are kept apart structurally.

## Derived state, and reconciliation

`deriveState()` computes what the evidence says, independent of what anyone declared:

```
no control mapped        → governance-gap
no mapped control ran    → governance-gap
all ran and failed       → failing
some hold, some do not   → partially-compliant
ran but no result given  → under-assessment   ("unverified is not compliant")
all ran and held         → compliant
```

`stateReconciliation()` compares the two. **An obligation declared compliant whose evidence
disagrees is reported as `overstated`** — that is the finding this whole lifecycle exists for.

## Timelines and evolution

`timeline()` records every state an obligation has been in, who moved it, why, how long it stayed and
whether it counted as compliant during that time. An obligation with an empty timeline is
`neverAssessed` — *"no state change has ever been recorded — this obligation is unknown, which is not
a form of compliant."*

`evolution()` reports `direction` (net movement across the window) **and** `recentDirection`
separately. An estate that went `unknown → compliant → failing` has a net of zero — literally true,
because it began and ended non-compliant — and a problem. Reporting only the net would hide it.
Obligations never assessed are counted and named separately rather than diluting the rate.

Live: `GET /api/compliance/lifecycle` · `POST /api/compliance/obligations/:id/state` ·
`GET /api/compliance/obligations/:id/timeline`.
