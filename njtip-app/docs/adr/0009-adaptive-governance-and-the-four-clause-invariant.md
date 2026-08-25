# ADR-0009: Adaptive governance, strategic decision support, and the four-clause invariant

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** Oversight Board · Architecture Review Board · Operations Review Board · Data Governance Board
- **Review required:** OB (the invariant is constitutional in effect) + ARB

## Context

ADR-0008 gave the platform an invariant about the institution: no critical capability may depend on a
single person, process, document or system. Adopting it while it failed was the point — it made three
persistence dependencies visible and blocked institutional readiness until somebody decided about
them.

Six months of building on that surfaced a harder problem. **A capability can pass that invariant on
every dimension and still be fragile**, in three ways nothing was looking for:

**It can rest on a belief nobody has checked.** The assumption registry knows which assumptions bear
on which bounded contexts. The resilience evaluation knows which contexts each capability spans.
Nothing joined them. A capability with a validated alternative for every person, document and service
could rest entirely on an assumption that stopped being true two years ago.

**It can rest on a dependency nothing would notice breaking.** Phase 13 asked whether an alternative
existed. It never asked whether anything would *detect* the dependency failing. Building this out
found two dependency kinds — communication channels and physical facilities — with no detecting
control at all, which meant the first anybody would hear of either was the incident.

**It can rest on an institutional relationship that exists only on paper.** Every capability spans
several institutions; the ownership record has always named them. Nothing had ever asked whether two
institutions jointly responsible for something had any recorded way to reach each other.

Alongside those, Phase 14 was asked for strategic decision support: scenario planning, capacity
forecasting, governance optimization, regulatory forecasting, learning metrics. Each of those is a
generator of numbers that look authoritative, and several are automated arguments for doing something
the platform exists to prevent.

## Decision

**Adopt a four-clause global invariant.** No critical institutional capability may depend upon an
unvalidated assumption, an unverified dependency, an undocumented governance relationship, or a single
point of organizational failure. The fourth clause is ADR-0008's invariant unchanged; the first three
are new. Each clause is evaluated from a register that already exists, and a clause with no register
behind it reports UNKNOWN and does not hold.

**Generalize the dependency taxonomy to eleven categories** (people, process, technology, data,
knowledge, documentation, facilities, communications, suppliers, legal authority, governance) over
thirteen assessable kinds. A capability must have a validated alternative in every category, and a
category nothing assessed is unvalidated rather than validated.

**Every dependency kind names the control that would fail if it broke.** Communication channels
resolve to the escalation workflow — an escalation raised and never acknowledged is exactly what a
failed channel looks like from inside the platform. Facilities resolve to the multi-region check and
state on every row that it watches the region behind a site, not the building.

**Governance optimization may never reduce the number of distinct authorities in a decision.** Every
recommendation names the integrity properties it preserves; one that would remove an approval, merge a
responsible authority with its approver, or reduce the authorities involved is refused at emission
rather than emitted with a warning.

**Risk factors declare whether they are derived or a declared prior.** Three of six are declared
judgements about how often things fail and how hard they are to close. They are marked as such, and
the ranking uses them only to order within a criticality band — constitutional capabilities rank first
whatever the arithmetic says.

**Public trust is derived as leading indicators and never measured.** The platform has no survey and
no channel to the people who considered reporting and decided not to. It reports whether the
*conditions* under which trust would be warranted currently hold, as a word rather than a score, with
`measuresTrust: false` on every row.

**Confidence intervals are a function of the observation count.** Half-width 1/√n capped at [0,1],
explicitly not a statistical confidence interval. With no observations the interval is [0,1] and says
so.

**Compliance transition exceptions exist and are expensive.** A board may grant a single-obligation,
single-move, time-bound exception; the audit trail records that the state was reached by exception
permanently; and no exception can ever reach `verified`, because that would make `verified` mean
`compliant` with extra steps.

**Regulatory forecasts live in their own register** and can never move an obligation into a compliance
state.

## Consequences

The invariant does not hold, and that is the intended outcome of adopting it. Every critical
capability currently fails the assumption clause — the registry is new and nothing has been verified —
and the single-point clause. `evidence-custody` satisfies all four clauses when fed full continuity
evidence and a verified assumption, which demonstrates the bar is reachable rather than decorative.

Two genuine defects were found by the taxonomy widening and corrected rather than excused:
`case-investigation` and `service-recovery` both omitted the event stores they are actually built on,
which made the new data-resilience check report them as holding an unreconstructible store of record.
The declaration was incomplete, not the architecture.

Two genuine gaps were found and recorded rather than closed: nothing in this platform records what
legally authorises case investigation or service recovery. Both report UNKNOWN, and unknown is not
resilient. They join the ratchet.

The platform now refuses a cross-government collaboration proposal that does not state which zone each
shared context sits in — because it turns out the platform does not record that, and reading the
absence as "probably fine" would be reading an unknown as a pass on a constitutional invariant.

Institutional readiness stays blocked. Eighteen assurance domains and fifteen executive panels still
print NOT AUTHORIZED.

## Alternatives considered

**Keep the single-clause invariant and add the three new checks as separate reports.** Rejected: three
reports nobody aggregates is how a capability comes to fail one of them for a year. The invariant is
useful precisely because it is one question with one answer.

**Score risk with a single weighted number.** Rejected below, at length.

**Model public trust from proxy metrics as a percentage.** Rejected below.

**Let the compliance state machine be amended when a jump is needed.** Rejected: amending the machine
widens it for everybody and permanently. An exception is narrow, expires, and leaves a record.

## Rejected alternatives

**A single institutional risk score.** Six factors reduced to one number ranks perfectly and hides
that three of the six are declared priors. Worse, a weighted average eventually lets a well-detected
constitutional dependency fall below a badly-detected trivial one, and no amount of tuning makes that
acceptable. The ranking is therefore lexicographic on criticality first, with the arithmetic used only
within a band.

**A public trust score.** A government told its trust score is 0.87 stops asking. The platform can
measure whether a citizen can file a report, whether cases move, whether evidence is intact, whether
decisions are attributable, and whether the institutions can deliver — and those are conditions, not
opinions. Presenting them as a measurement of trust would be the most consequential invention this
platform could make, because the people whose trust matters most are the ones who considered reporting
and decided not to, and nothing here can reach them.

**Narrow confidence intervals.** A ±0.05 band beside a figure derived from four observations says "we
are nearly certain" when the truth is "we have almost no data". Rejected in favour of a coarse band
that is honest about being coarse, with `constrained: false` on anything under seventeen observations.

**Seeding the new registers.** Rejected again, for the same reason as in ADR-0008. The learning
register, the joint-act register and the forecast register all start empty, so organizational learning
reports as unmeasurable, cross-agency readiness reports 0 of 39 pairs, and regulatory readiness reports
that nobody has looked. Each is the truth.

**Inferring a bounded context's deployment zone.** The platform genuinely does not record it. Guessing
from a naming convention would have made the zone-isolation check on collaboration proposals appear to
work while checking nothing.

## Architectural trade-offs

The four-clause invariant makes institutional readiness harder to reach and easier to reason about.
It costs a permanent block until the assumption register is exercised, which is the same trade ADR-0008
made and the same answer: a gate that never blocks is not a gate.

Deriving the eleven categories from thirteen kinds rather than replacing the kinds keeps every Phase 13
caller working and means the categories are a reporting view rather than a second model to maintain.

The governance optimizer's integrity guard costs the ability to recommend the fastest fixes. That is
deliberate: the fastest fix for every finding it makes is the one that dismantles separation of duties.

## Long-term maintenance impact

Five new modules' worth of surface area, all inside existing bounded contexts (`src/governance/`,
`src/architecture/`, `src/assurance/`, `src/legislation/`, `src/observability/`, `src/twin2/`). No new
bounded context, so the context map and the ownership matrix are unchanged in structure.

The declared priors — dependency likelihood, recovery complexity, board review capacity, effort bands —
are the parts most likely to go stale. Each is in one place, states its reasoning, and is checked by a
fitness function that requires the reasoning to exist.

## Implementation complexity

Moderate and additive. Every new parameter is optional; absent means unknown and unknown fails closed.
The one behavioural change to an existing path is that `assumptions.health()` now reads propagated
confidence rather than intrinsic, which cannot raise a level and lowered none of the platform's own.

## Operational cost

Six new registers the institution must actually populate for the metrics to mean anything: assumption
verifications, joint governance acts, training after incidents, rehearsals after training, regulatory
forecasts, and improvement outcomes. Populating none of them is the current state and is reported as
such rather than as a low score.

## Lifecycle implications

The invariant blocks institutional readiness until every clause holds or a named authority accepts the
failing clause with a rationale and an expiry. Acceptances expire without anybody withdrawing them,
which returns the block automatically.

## Business justification

An institution that cannot say what it assumes, cannot detect its own dependencies breaking, and has
never exercised the relationships it depends on will discover all three at once, during the incident
that needed them. The cost of finding out now is a blocked readiness gate; the cost of finding out then
is a constitutional capability failing while every dashboard reads green.

## Risk assessment

| Risk | Likelihood | Impact | Treatment |
|---|---|---|---|
| The invariant blocks indefinitely because the registers stay empty | High | The gate is routed around and stops meaning anything | Sunset criterion 3 below; acceptance is available and is attributed, time-bound and visible |
| The declared priors are wrong and skew the risk ranking | Moderate | Effort goes to the wrong dependency | Every prior states its reasoning in one place; criticality, not the arithmetic, decides the band |
| Public trust indicators are read as a trust measurement anyway | Moderate | A board stops asking citizens | `measuresTrust: false` on every row, a word rather than a score, and the report states what would actually measure it |
| Governance optimization recommendations are implemented without the integrity constraint | Low | Separation of duties is dismantled for efficiency | Recommendations that would do so cannot be emitted; the guard is a fitness function fed crafted counterexamples |
| The coupling baseline is moved routinely rather than deliberately | Moderate | Bounded contexts become boundaries on paper | Each move is a code change with a stated reason, reviewed like any other |

## Performance impact

None measurable. Every addition is a deterministic computation over in-memory registries, run in the
verification suite rather than on a request path.

## Security impact

Neutral to positive. Security drift is now a classified drift kind routed to the Information Security
Review Board: a threat whose treating control stopped running is reported as an untreated threat rather
than sitting on the register as treated.

## Operational impact

The runbook gains four verified diagrams — service dependencies, the report-submission sequence, the
case lifecycle, and the deployment topology — each checked against the implementation on every build.
`APP-FIT-DIAGRAM-ASSURANCE` fails if any node or arrow stops resolving, so a diagram an operator opens
at 03:00 is one the build has confirmed is still true.

## Compliance impact

Transition exceptions are now possible and expensive. The audit trail distinguishes `by-default`,
`by-exception` and `refused`, and reports the exception rate — an estate where more than a tenth of
transitions are exceptional has a state machine that no longer describes practice, and the remedy is an
ADR amending it rather than more exceptions.

## Rollback strategy

Every addition is additive and optional. Reverting means removing the new modules and the fitness
functions that check them; nothing in the frozen baseline depends on any of it. The one non-trivial
reversal is `assumptions.health({ propagate: false })`, which restores the Phase 13 behaviour exactly
and is already a supported parameter.

## Migration strategy

None required. The platform composes identically; the new registers start empty and every report says
so.

## Estimated implementation cost

Eleven new fitness functions and four test files, inside seven existing modules and two new files in
existing bounded contexts. The larger cost is organizational and falls outside the repository: the
registers only mean something once the institution populates them.

## Success metrics

- The four-clause invariant is evaluated for **5** critical capabilities × **4** clauses on every
  build, with **0** clauses skipped.
- At least **1** capability satisfies all **4** clauses under evidenced conditions, so the bar is
  demonstrably reachable.
- **0** governance optimization recommendations reduce the distinct authorities in a decision.
- **0** of the **15** executive panels and **0** of the **6** capacity dimensions are enterable by hand.
- **0** unresolved nodes or arrows across at least **5** governed diagrams.

## Measurable success criteria

| Criterion | Measured by | Threshold |
|---|---|---|
| The invariant is continuously evaluated | `APP-FIT-GLOBAL-INVARIANT` | 5 capabilities × 4 clauses, every build |
| The bar is reachable | Same control, evidenced-estate branch | `evidence-custody` satisfies all four clauses |
| Optimization preserves integrity | `APP-FIT-GOVERNANCE-OPTIMIZATION` | 0 recommendations emitted without a preserved property |
| No invented capacity figure | Same control | Every unmeasurable dimension returns `null` with a stated basis |
| Diagrams match the implementation | `APP-FIT-DIAGRAM-ASSURANCE` | 0 unresolved nodes or arrows, ≥5 governed diagrams |
| Forecasts move nothing | `APP-FIT-REGULATORY-FORECAST` | `obligationsMoved === 0` |
| Intervals reflect the evidence | `APP-FIT-ADAPTIVE-ANALYTICS` | Interval width strictly decreasing in observation count |

## Architectural debt assessment

Two known debts are recorded rather than closed. **The platform does not record which deployment zone
a bounded context sits in**, so a collaboration proposal must declare it and an undeclared zone blocks.
**Nothing records what legally authorises case investigation or service recovery**, so both report
UNKNOWN on the legal-authority dimension and sit in the resilience ratchet.

The cross-context coupling baseline moved 121 → 125 across this phase, in two deliberate steps: the
diagram verifier must read the topology, the region table and the mission chain to check diagrams
against them, and the drift checker must read the threat model to report a treatment whose control
stopped running.

## Review schedule

Reviewed by the Oversight Board on or before **2027-02-05** — six months, chosen to coincide with the
ADR-0008 review, because the two invariants are one question and reviewing them apart would invite
divergence.

Reviewed **annually** thereafter, and immediately out of cycle on any sunset trigger below. The Data
Governance Board is a required participant for the cross-agency and information-sharing analysis; the
Architecture Review Board for the assumption dependency graph and the drift classification.

## Sunset criteria

This decision stops applying — and must be re-taken, not amended — when any of the following is
observed:

1. **The assumption clause holds for every capability.** At that point the registry is being exercised
   and the clause's blocking behaviour should be re-examined against what it then costs.
2. **A governance optimization recommendation is implemented that reduces separation of duties.** That
   would mean the guard was routed around outside the platform, and the constraint belongs somewhere
   the platform can see it.
3. **The public trust indicators are cited in a published document as a measurement of public trust.**
   The framing failed, and the indicators should be withdrawn rather than restated.
4. **More than 5 clause acceptances are active at once, or any single acceptance is renewed more than
   twice.** Acceptance is meant to be the exception; at that point the invariant is being routed around.
5. **The exception rate on compliance transitions exceeds one in ten over a review period.** The state
   machine no longer describes practice and needs amending by ADR.
6. **A capacity or executive figure is found to have been entered by hand.** The derivation guarantee
   failed, and everything resting on it needs re-examining rather than patching.

## Decision owner

Oversight Board (chair), with the Architecture Review Board accountable for the assumption dependency
graph, the drift classification and the coupling baseline; the Operations Review Board for the
strategic scenarios and capacity planning; and the Data Governance Board for cross-agency information
sharing. The OB chair is responsible for initiating the review on the schedule above.

## Approval history

| Date | Body | Decision | Basis |
|---|---|---|---|
| 2026-08-05 | Oversight Board | Accepted | A capability can pass the single-dependency invariant and rest on an unchecked belief, an undetected dependency and an untested relationship; adopting the wider invariant while it fails is what makes those visible |
| 2026-08-05 | Architecture Review Board | Accepted | Additive, no new bounded context, no interface break; every new parameter is optional and absent fails closed |
| 2026-08-05 | Operations Review Board | Accepted (strategic scenarios) | Seven scenarios that can each block and each pass, rehearsing institutional change the twin could not previously model |
| 2026-08-05 | Data Governance Board | Accepted (cross-agency analysis) | Institutions derived from the accountability record rather than listed, so a dissolved agency cannot linger in a hand-kept partner list |
| 2026-08-05 | Oversight Board | Accepted (ratchet extension) | The two legal-authority gaps are recorded rather than excused, and any new single dependency fails the build |
