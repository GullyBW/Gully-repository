# ADR-0008: Institutional assurance, and the single-dependency invariant

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Oversight Board · Architecture Review Board · Operations Review Board
- **Review required:** OB (the invariant is constitutional in effect) + ARB

## Context

Phase 12 left the platform able to prove a great deal about itself: that its invariants hold, that
its evidence is traceable, that a change would or would not harm a citizen. Every one of those proofs
is about the **system**.

None of them is about the **institution** that runs it. Three gaps were load-bearing:

**Nothing tested the people.** Chaos experiments prove a fault is detected, contained, recovered and
verified. No exercise had ever put a human in front of an escalation path, a break-glass
authorisation or a custody hand-over. Those procedures existed on paper and had never met a person
under time pressure.

**Nothing recorded what the platform assumes.** Load-bearing beliefs — that an investigator's session
is pinned for a case edit, that the synthetic topology reflects production, that case throughput
proxies whether people can report — were written into comments and then stopped being examined. None
had an owner, a cadence or an expiry.

**Nothing asked whether the institution could survive losing one of anything.** The ownership model
names a deputy for every role and the region model a replica for every region, which made the
question look answered. It was not: a deputy who has never acted is a name.

## Decision

**1. Adopt a new global invariant**, evaluated continuously and blocking institutional readiness:

> No critical capability may depend on a single person, a single process, a single document, or a
> single system.

Evaluated across eight dimensions — person, team, document, process, service, region, supplier,
communication channel — for five named critical capabilities, three of them constitutional.

**2. An alternative counts only if VALIDATED.** A derived deputy who has never acted and holds no
current training is a name, not an alternative. Deputy readiness is assessed on the same evidence as
the primary's: available, active, trained **and** rehearsed.

**3. Register the platform's assumptions executably**, each with an owner, a review cadence, an
expiry and a machine-readable claim. Declared confidence and assessed confidence are separate fields,
and the gap between them is reported as an **overclaim**.

**4. Rehearse governance deterministically**, scoring each exercise against the expectations recorded
**before** it began, taken from the documented procedure.

**5. Adopt the institutional assurance framework** over thirteen domains, which proves institutional
readiness and never authorizes anything.

## Consequences

The invariant does not currently hold, and that is the point of adopting it. Three constitutional
capabilities depend on a single service, because each zone has exactly one persistence store:
`anonymous-reporting` on `persistence-ind`, `case-investigation` on `persistence-exec`,
`governance-decision-recording` on `persistence-jud`. Those three are recorded as a **baseline
ratchet** in `APP-FIT-INSTITUTIONAL-RESILIENCE`: any new single dependency fails the build.

Institutional readiness is blocked until each is mitigated or accepted by the Oversight Board with a
stated expiry. That is a real operational constraint, accepted deliberately: a platform that reports
readiness while a single store can stop anonymous reporting is reporting something untrue.

The activity, training, rehearsal, improvement and acceptance registers all start **empty**, so most
Phase 13 reports currently read as unmeasured or unsound. Seeding them would make the dashboards
green and the platform dishonest.

Authors of every future ADR now owe two more sections, and every architectural decision acquires a
lineage obligation: what was built, what happened, what was learned.

## Alternatives considered

1. **Scope the invariant to technical systems only** — services and regions, leaving people,
   documents and processes out.
2. **Count declared alternatives** rather than validated ones: a named deputy, a second region.
3. **Seed the registers** with plausible synthetic history so the dashboards demonstrate the
   capability working.
4. **Make the invariant advisory** rather than blocking.
5. **Defer the invariant** until the persistence redundancy exists, so it holds on the day it is
   adopted.

## Rejected alternatives

**Scoping to technical systems** was rejected because the failures this phase exists to catch are
mostly not technical. An institution loses people far more often than it loses regions, and a
procedure nobody has rehearsed fails on its first real use whatever the infrastructure does.

**Counting declared alternatives** was rejected as the failure mode of the whole idea. This platform
*derives* a deputy for every role by rule; counting names would find two of everything and report
perfect resilience, and the invariant would be decoration that made the situation worse by appearing
to have checked.

**Seeding the registers** was rejected outright, and it is the one that would have been easiest. A
fabricated calibration history, a rehearsal nobody ran, a training record nobody earned — each would
make a downstream figure a lie, and the platform's whole claim rests on its figures being derived
from things that actually happened.

**Making the invariant advisory** was rejected because an advisory invariant is a metric. The
platform already has metrics; what it lacked was something that stops.

**Deferring until it holds** was rejected because an invariant adopted only once it passes has never
been tested. Adopting it while it fails is what makes the three persistence dependencies visible, and
visibility is the deliverable.

## Architectural trade-offs

We buy an institution-level answer to "could this survive losing one of anything", and we pay in
**operational friction**: readiness is blocked today, and closing each dependency is real work —
redundancy, rehearsals, training somebody actually completes.

We buy assumptions that expire, and we pay in **recurring review load** that will fall due whether or
not anybody has time.

We buy rehearsals scored against documented expectations, and we pay by making it possible to **fail
an exercise**. A rehearsal that cannot be failed teaches nothing, and one that can will sometimes
embarrass whoever ran it.

## Long-term maintenance impact

Nine assumptions now need reviewing on cadences between 90 and 365 days, and six rehearsals need
running. That is a standing obligation on the Oversight and Operations Review Boards, not a
one-time cost, and it is the first obligation in this platform that cannot be discharged by writing
code.

The registers are in-memory and per-process. A production deployment must persist them, or every
restart re-fabricates the honest emptiness this phase depends on — which would be a different and
subtler way of losing the property.

## Implementation complexity

Moderate. Four new modules, three extended, no new bounded context and no interface break: every new
parameter is optional and absent means unknown, which fails closed. The genuinely subtle part is that
almost every new figure has an "unknown" state distinct from both pass and fail, and getting that
distinction right in each report is where the care went.

## Operational cost

Near zero at runtime — every computation is over in-memory registers, and the heaviest is a
transitive closure over roughly 350 graph edges. The real cost is human: rehearsals take people's
time, and assumption reviews take a board's.

## Lifecycle implications

This decision supersedes nothing. It adds an invariant that outranks the convenience of any later
phase: a future capability that introduces a single-person dependency must close it or have it
accepted, and cannot simply ship.

## Business justification

An institution that cannot survive the departure of one person is one bad month from being unable to
discharge its mandate. For a corruption-reporting platform that is not a continuity problem but a
constitutional one: if the anonymous reporting route stops, people who decided to report do not
report, and most do not decide again.

## Risk assessment

**Risk: the invariant is worked around by narrowing "critical capability".** Likelihood moderate,
impact high — it would neuter the invariant while appearing to satisfy it. Mitigated by requiring
each capability to state what its loss costs, and by the fitness function failing if fewer than three
are marked constitutional.

**Risk: readiness stays blocked indefinitely and people learn to ignore it.** Likelihood moderate,
impact moderate. Mitigated by acceptance being available to a named authority with an expiry, so the
honest path is to accept and revisit rather than to disable.

**Risk: registers are seeded to make dashboards green.** Likelihood low, impact severe. Mitigated by
fitness functions asserting the *absence* of fabricated history — the overclaim list must not be
empty while nothing has been verified.

## Performance impact

None measurable. No new I/O, no new dependency; the heaviest computation is a graph traversal
completing in single-digit milliseconds.

## Security impact

Neutral to positive. No change to authorization, authentication, residency or evidence handling. The
rehearsal framework checks separation of duties inside an exercise, which is a small strengthening.
Reviewed as a no-op for the threat model; no new trust boundary is crossed.

## Operational impact

Six rehearsals become a standing programme. The runbook gains prerequisites and a communication plan.
Operators gain four dashboards, all of which currently read unsound — and that is the intended
initial state rather than a defect to be tuned away.

## Compliance impact

Strengthens the audit position materially: compliance states are now a machine with independent
verification distinguished from self-assessment, and no unknown state can read as compliant.

## Rollback strategy

Setting the invariant advisory is a one-line change to `blocksInstitutionalReadiness`. Every other
capability is additive and read-only: the registers can be left unused with no effect on any existing
path, because absent evidence already reports unknown rather than failing. No data migration is
involved; nothing here is persisted.

## Migration strategy

No stored state to migrate. The migration is organisational: the boards must begin running rehearsals
and reviewing assumptions. Nothing in the platform breaks while they do not — it simply reports, as
it does today, that this has not happened.

## Estimated implementation cost

Approximately 2,400 lines across 4 new and 6 extended modules, 12 fitness functions, 133 tests and 8
documents. Roughly 4 engineer-days. No infrastructure change and no new dependency; the platform
remains at 0 runtime dependencies.

## Success metrics

- The single-dependency invariant is evaluated on every build across all 8 dimensions.
- 100% of executive dashboard panels are derived, with 0 accepting a hand-entered figure.
- 0 assurance domains report as verified without evidence.

## Measurable success criteria

1. `APP-FIT-INSTITUTIONAL-RESILIENCE` evaluates 5 capabilities × 8 dimensions on every build, and
   fails on any single dependency outside the 3-item baseline.
2. `executiveGovernanceIntelligence()` reports `everyMetricDerived: true` for all 10 panels, and 0
   panels accept a supplied value.
3. `institutionalAssurance()` returns `authorizationStatus: 'NOT AUTHORIZED'` in 100% of cases,
   including with all 13 domains verified.
4. At least 6 governance rehearsals are declared, each with at least 3 steps and at least 1
   expectation traceable to a documented procedure.
5. The assumption registry holds at least 9 assumptions, 0 orphaned, 0 unevidenced, 0 contradictory.

## Architectural debt assessment

Two items are knowingly left unpaid.

**The registers are in-memory.** Activity, training, rehearsal, improvement and acceptance history
do not survive a restart. For a synthetic platform that is correct — persisting fabricated history
would be worse — but a production deployment must persist them or the honest emptiness resets daily
and the invariant becomes noise. Comes due at the first production deployment.

**Cross-context coupling is ratcheted, not reduced.** The drift checker measures 121 source-level
couplings that the curated context map does not name. They are informational and capped at today's
count. That is a holding position: the real question — which of those couplings should become
declared relationships and which should be removed — has not been answered. Comes due when the count
next needs to rise for a legitimate reason.

## Review schedule

Reviewed by the Oversight Board on or before **2027-02-04** — six months, chosen because it is the
point by which the first cycle of rehearsals and assumption reviews should have completed, making
the invariant's operational cost measurable rather than estimated.

Reviewed **annually** thereafter, and immediately out of cycle on any sunset trigger below. The
Operations Review Board is a required participant for the rehearsal programme; the Architecture
Review Board for the assumption registry.

## Sunset criteria

This decision stops applying — and must be re-taken, not amended — when any of the following is
observed:

1. **The single-dependency baseline is closed.** Once the three persistence dependencies are
   mitigated, the ratchet has no exceptions and the invariant's blocking behaviour should be
   re-examined against what it then costs.
2. **A rehearsal has been failed and no corrective action followed within 90 days.** That would show
   the exercises are theatre, and a rehearsal nobody acts on is worse than none because it
   manufactures assurance.
3. **The registers are still empty at the first production deployment.** An invariant evaluated
   against no evidence blocks everything and distinguishes nothing.
4. **More than 3 single-dependency acceptances are active at once.** Acceptance is meant to be the
   exception; at that point the invariant is being routed around rather than satisfied.
5. **The platform acquires a runtime dependency.** The supplier dimension currently passes because
   there is nothing to be single about; that stops being true the moment it is false.

## Decision owner

Oversight Board (chair), with the Operations Review Board accountable for the rehearsal programme and
the Architecture Review Board for the assumption registry and drift baseline. The OB chair is
responsible for initiating the review on the schedule above.

## Approval history

| Date | Body | Decision | Basis |
|---|---|---|---|
| 2026-08-04 | Oversight Board | Accepted | An institution that cannot survive one departure cannot discharge a constitutional mandate; adopting the invariant while it fails is what makes the gaps visible |
| 2026-08-04 | Architecture Review Board | Accepted | Additive, no new bounded context, no interface break; every new parameter is optional and absent fails closed |
| 2026-08-04 | Operations Review Board | Accepted (rehearsal programme) | Six exercises scored against documented expectations, with the standing cost accepted explicitly |
| 2026-08-04 | Oversight Board | Accepted (baseline ratchet) | The three persistence dependencies are recorded rather than excused, and any new one fails the build |
