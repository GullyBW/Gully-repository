# ADR-0007: Session-scoped consistency, and the ADR review lifecycle

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Architecture Review Board · Oversight Board · Data Governance Board
- **Review required:** ARB (+ OB for the investigation-context change, which touches a
  constitutional path)

## Context

Two unrelated problems surfaced in Phase 12 that turn out to have the same shape: a decision was
recorded, was never wrong, and was never re-read.

**The consistency registry.** Phase 11 declared a consistency model per bounded context. Two of
those declarations were *approximately* right rather than right:

- `investigation` was declared **causal**. The rationale written beside it said "an investigator
  must never see their own work disappear." That sentence is the definition of **read-your-writes**,
  not of causal consistency. Causal is strictly stronger and costs more; declaring it meant the
  platform was paying for a guarantee it did not need while describing a guarantee it had not named.
- `analytics` was declared **eventual**, with the rationale "a minute-old count misleads nobody."
  True, and incomplete. A dashboard that is a minute stale misleads nobody; a dashboard whose
  numbers go *backwards* between two refreshes destroys the reader's trust in every other number on
  the page. The guarantee actually needed there is **monotonic reads**.

Both errors were invisible because neither declaration cited a decision record. There was nothing to
re-read, so nothing was re-read.

**The ADR catalogue.** ADR-0004 expanded the schema; ADR-0006 extended it further to record what a
decision *costs*. Neither addressed what happens to a decision afterwards. Every ADR in this
catalogue is, as written, permanent — not because anyone decided it should be, but because nothing
in the schema obliges anyone to look at it again, and nothing states the conditions under which it
would stop applying.

## Decision

**1. Add two session-scoped consistency models** to the registry in `src/twin2/multi-region.js`:

| Model | Guarantee | Max staleness |
|---|---|---|
| `read-your-writes` | A session always observes its own writes, even from a replica that has not caught up for anyone else | 30 s |
| `monotonic-reads` | A session never observes an earlier state than one it has already seen | 30 s |

**2. Move two contexts onto them.** `investigation` → `read-your-writes`; `analytics` →
`monotonic-reads`.

**3. Check session guarantees from a session token, not from replica lag.** Whether a replica is
fresh enough for a session-scoped model depends on what *that session* has already done, so
`sessionGuaranteeHolds()` takes the highest sequence the session has written and the highest it has
read. **A session guarantee that cannot be checked is refused** — a call with no session token does
not quietly pass.

**4. Require every consistency stance to cite the ADR that chose it,** enforced by
`validateConsistency()`. This ADR is that citation for `investigation` and `analytics`; ADR-0006 is
the citation for the fourteen stances it recorded.

**5. Extend the ADR schema with a governance section,** applied from this ADR (0007) onward:
**Review schedule** and **Sunset criteria**. A review schedule must name a date or an interval —
"periodically" is rejected by the validator, on the same principle as ADR-0006's rule that a success
criterion with no number in it commits to nothing.

**6. Reject incomplete ADRs automatically.** `admit(text)` validates a proposal against the schema
in force for its number and returns `admitted: false` with the specific rejections. There is no
"accepted pending sections" state, because that state is how an incomplete record becomes a
permanent one.

## Consequences

The consistency registry now says what it means. `investigation` is cheaper to serve — a
read-your-writes read may come from any replica that has applied this session's writes, where causal
required more — and the guarantee it actually offers is now the one written down. `analytics` is
strictly stronger than before: a dashboard read can no longer move backwards.

Session-scoped models cost something real: the caller must carry a session token. Code that reads
`investigation` or `analytics` without one is now **refused**, where before it was served. That is
the intended consequence — the alternative is a guarantee that holds only for callers who happened
to pass the right arguments.

`consistencyPosture()` — the operator's partition view — cannot settle a session guarantee, because
it does not know who will ask. Those rows are marked `sessionDependent: true` and say so in the
reason text. This is a deliberate, narrow, documented exception: reporting them as refused would
make the operator view useless during exactly the incident it exists for, and reporting them as
allowed would overstate what had been checked.

Every ADR from 0007 onward must state when it is next read and what would retire it. The six earlier
ADRs are **not** retrofitted, for the same reason ADR-0004 and ADR-0006 did not retrofit theirs: an
ADR records what was required when it was written, and rewriting that destroys the thing the record
exists to preserve. `dueForReview()` reports them as `unscheduled` rather than as compliant.

## Alternatives considered

1. **Leave `investigation` as causal.** It was not incorrect — causal implies read-your-writes. It
   was merely more than was needed, and described by a rationale that named a different guarantee.
2. **Add the session models but leave both contexts where they were.** Would have made the registry
   more expressive and changed nothing about it.
3. **Infer the session guarantee from replica lag** rather than from a session token — treat "lag
   under 30 s" as sufficient.
4. **Put the review schedule in a separate governance register** rather than in the ADR itself.
5. **Retrofit review schedules onto ADRs 0001–0006.**

## Rejected alternatives

**Leaving `investigation` as causal** was rejected because the mismatch between the declaration and
its own rationale is precisely the defect this ADR exists to fix. A registry whose entries are
"stronger than necessary, and described as something else" cannot be reasoned about; the next reader
cannot tell which parts are deliberate.

**Adding the models without moving the contexts** was rejected as the worst of both: two more
entries in a table, no change in behaviour, and the original mis-declaration still standing.

**Inferring the guarantee from lag** was rejected because it is not sound. Replica lag is a property
of the replica; read-your-writes is a property of the *pair* (session, replica). A replica 5 ms
behind still fails a session whose write it has not applied. A guarantee inferred from the wrong
variable is not a weaker guarantee — it is a guarantee that fails silently, exactly in the case it
was added for.

**A separate governance register** was rejected because it separates the decision from the terms of
its own review, which is how the two drift apart. The point of the ADR is to be the single artefact
a future reader finds.

**Retrofitting earlier ADRs** was rejected on the principle already established by ADR-0004 and
ADR-0006. Backdating a review schedule onto a decision made before schedules were required would
record a commitment nobody made.

## Architectural trade-offs

We buy a correctly-named, cheaper guarantee for `investigation` and a strictly stronger one for
`analytics`, and we pay for both in **caller obligation**: reads against session-scoped contexts now
require a session token, and code that does not supply one is refused rather than served.

We buy a catalogue that cannot silently ossify, and we pay in **author burden**: two more mandatory
sections, one of which must survive a content check rather than a heading check.

We buy automatic rejection of incomplete ADRs, and we pay by removing an escape hatch — there is no
way to record a decision *now* and complete the record later.

## Long-term maintenance impact

The consistency registry gains two models, so a new stateful bounded context now chooses from five
rather than three. That is a larger decision, not a harder one: the validator refuses an undeclared
context outright, so the cost lands at the moment the context is created rather than in production.

`sessionGuaranteeHolds()` is 12 lines with no dependencies and no state. The maintenance burden is
in the *callers* — every read path against a session-scoped context must thread a session token, and
a future context moved onto one of these models inherits that obligation across all of its readers.
`consistencyDependencyMap()` exists partly to make that visible before the move rather than after.

The governance schema adds two sections per ADR — roughly 15 lines of writing, indefinitely, for
every architectural decision this platform ever records.

## Implementation complexity

Low, and deliberately so. The consistency change is two new entries in `CONSISTENCY_MODELS`, one new
pure function, one extra check at the end of `readAllowed()`, and two edited rows. The ADR change is
one new schema array, one regex, and three new functions over the existing parser. No new module, no
new dependency, no change to any interface signature that existing callers use — every new parameter
is optional and absent means "unverifiable", which fails closed.

The one genuinely subtle piece is ordering: the session check runs **last** in `readAllowed()`,
after quorum and the staleness bound, because it is the only condition that depends on who is asking
rather than on the state of the replica. Running it earlier would report a session failure for a
read that was going to be refused for lag anyway, which would send an operator to the wrong place.

## Operational cost

Effectively zero at runtime: both new checks are integer comparisons against a token the caller
already holds. No additional replication, no additional storage, no additional network round trip.
`monotonic-reads` on `analytics` requires tracking one integer per reader session, which the session
store already carries.

The real operational cost is diagnostic. A refused read now has one more possible cause, and
"refused because your session token is missing" is a failure mode operators have not seen before.
`readAllowed()` returns the specific reason text for exactly this reason.

## Lifecycle implications

This decision supersedes nothing. It amends two rows of the registry ADR-0006 established, and
ADR-0006 remains in force for the other fourteen contexts.

The consistency stances here expire if the underlying assumption changes: `read-your-writes` for
`investigation` assumes an investigator's session is pinned for the duration of a case edit, and
`monotonic-reads` for `analytics` assumes dashboards are read by sessions rather than by anonymous
polling. Either assumption failing makes the corresponding stance wrong, not merely suboptimal.

The governance schema will itself need revisiting once enough ADRs carry review dates for the review
load to be measurable — see Sunset criteria.

## Business justification

An investigator who cannot see the note they just filed will file it again, and a case record with
duplicated notes is a case record a court can be invited to distrust. A dashboard whose figures move
backwards between refreshes will be reconciled by hand, and hand-reconciled figures are the ones
that end up in a report nobody can trace. Both are cheap to prevent and expensive to explain.

The ADR change is justified by the six ADRs already in this catalogue, none of which anybody is
obliged to re-read. A governance framework whose own records ossify cannot credibly require review
schedules of anything else.

## Risk assessment

**Risk: a caller is refused because it does not supply a session token.** Likelihood high (this is
the intended new behaviour), impact low (the refusal is explicit, names the reason, and is caught by
the fitness function rather than by a citizen). Accepted.

**Risk: the `consistencyPosture()` exception is copied elsewhere** as a precedent for assuming a
guarantee holds. Likelihood moderate, impact high. Mitigated by confining the exception to one
function, marking every affected row `sessionDependent: true`, and stating the reason in the row's
own text rather than in a comment.

**Risk: the governance schema becomes a box-ticking exercise** — a review schedule that says "annual"
and is never honoured. Likelihood moderate, impact moderate. Mitigated by `dueForReview()` reporting
an interval with no anchoring date as `undated`, which is a blocker rather than a pass.

## Performance impact

Two integer comparisons per read against a session-scoped context; unmeasurable against a 250 ms p95
budget. `investigation` reads may now be served from replicas that causal consistency would have
excluded, so the change is weakly positive for that context. No path gets slower.

## Security impact

Neutral to positive. No change to authorization, authentication, residency or evidence handling.
The one security-adjacent property is that a read-your-writes refusal is fail-closed — an
unverifiable guarantee refuses rather than serving, consistent with every other gate in the platform.
Reviewed by the ISRB as a no-op for the threat model; no new trust boundary is crossed.

## Operational impact

Operators gain two reports: `consistencyDependencyMap()` (which contexts read from weaker ones) and
`validateFailover()` (which contexts go unavailable rather than degrading, per failure set). Both
are read-only. The partition runbook gains one line: session-scoped rows in the posture view are
capability statements, and the per-session guarantee is settled at read time.

## Compliance impact

None of the changes touch a legislative mandate, a residency rule or a retention obligation. The ADR
schema change strengthens the audit position: from 0007 onward, every architectural decision carries
the date it is next examined, which is what an auditor asks for when a control has been in place for
several years.

## Rollback strategy

Reverting the consistency change is a two-line edit: set `investigation` back to `causal` and
`analytics` back to `eventual`. Both are strictly weaker-or-equal in caller obligation, so no caller
breaks, and the two new models can remain in the registry unused. No data migration is involved
because no data is stored differently — these are read-path guarantees.

Reverting the governance schema means setting `GOVERNANCE_SCHEMA_FROM` above the highest ADR number,
which returns the catalogue to the extended schema. This ADR would then over-satisfy its schema,
which is harmless.

## Migration strategy

There is no stored state to migrate. The migration is in call sites: every read against
`investigation` or `analytics` must thread a session token. These were found by running the existing
suite — a missing token fails closed, so the compiler-equivalent here is the test run, and there is
no silent path. `consistencyPosture()` was the only caller that could not supply a real session, and
it is handled explicitly rather than by defaulting.

## Estimated implementation cost

Approximately 160 lines across 2 modules (`multi-region.js`, `adr-governance.js`), 1 fitness
function extended, 29 tests, 3 documents. Roughly 1 engineer-day including the ADR itself. No
infrastructure change and no new dependency — the platform remains at 0 runtime dependencies.

## Success metrics

- Zero reads against a session-scoped context served without a verified session guarantee.
- 100% of the 16 consistency stances cite an ADR (was 0% before this decision).
- 0 ADRs from 0007 onward admitted to the catalogue with a missing or unmeasurable section.

## Measurable success criteria

1. `validateConsistency()` reports 0 violations with the ADR-citation rule active, across all 16
   contexts, on every build.
2. `readAllowed()` refuses 100% of session-scoped reads supplied with no session token, verified by
   at least 2 fitness assertions and 4 tests.
3. `validateFailover({ failed: [2 of 3 regions] })` reports `noGuaranteeWeakened: true` with at
   least 8 contexts marked unavailable rather than degraded.
4. `qualityReport().sound` is true, with 0 incomplete ADRs and 0 undated review schedules.
5. `admit()` rejects a proposal missing any 1 required section, in under 5 ms, with the section
   named.

## Architectural debt assessment

Two items are knowingly left unpaid.

**The `consistencyPosture()` session exception.** It supplies a satisfied session in order to report
a capability rather than a decision. It is correct for its purpose and documented in three places,
but it is the only place in the platform where a guarantee is assumed rather than checked. If a
third session-scoped model is added, this should be revisited as a first-class "capability vs
decision" distinction in the API rather than a per-call workaround. Comes due when the fifth
session-scoped read path is added.

**Review schedules are anchored by a date written in prose.** `nextReview()` reads the first ISO
date out of the Review schedule section. This is deliberate — a structured field would have been a
seventh schema variant — but it means the anchor is only as reliable as the author's formatting. An
undated schedule is reported as `undated` rather than silently treated as not-due, so the failure
mode is visible; the debt is that it is *reported* rather than *prevented*. Comes due when the
catalogue exceeds roughly 20 ADRs, at which point review load is real and a structured field earns
its cost.

## Review schedule

Reviewed by the Architecture Review Board on or before **2027-02-03** — six months, chosen because
that is one release cycle past the point at which the session-token obligation will have been
exercised by every read path in the investigation context.

Reviewed **annually** thereafter, and immediately out of cycle if any of the sunset criteria below
is observed. The Data Governance Board is a required participant for the `analytics` stance; the
Oversight Board for the `investigation` stance.

## Sunset criteria

This decision stops applying — and must be re-taken, not merely amended — when any of the following
is observed:

1. **Session affinity is lost.** If investigator sessions stop being pinned for the duration of a
   case edit, `read-your-writes` becomes unenforceable at the read path and `investigation` must be
   re-declared, most likely back to causal.
2. **Analytics is read by anonymous polling** rather than by sessions. `monotonic-reads` is a
   per-reader guarantee; a reader with no identity cannot hold one, and the stance would be
   describing something that is not happening.
3. **A third session-scoped model is proposed.** That is the trigger for revisiting the
   `consistencyPosture()` exception recorded under architectural debt, rather than extending it a
   third time.
4. **The catalogue exceeds 20 ADRs**, at which point the prose-anchored review date should be
   replaced with a structured field and this ADR's own schedule mechanism re-taken.
5. **Any review scheduled above is missed by more than 90 days.** A governance schema whose own
   schedule is not honoured has been falsified by events, and continuing to require it of others
   would be indefensible.

## Decision owner

Architecture Review Board (chair), with the Data Governance Board accountable for the `analytics`
stance and the Oversight Board accountable for the `investigation` stance. The ARB chair is
responsible for initiating the review on the schedule above.

## Approval history

| Date | Body | Decision | Basis |
|---|---|---|---|
| 2026-08-03 | Architecture Review Board | Accepted | Session models correctly name guarantees already required; no interface break; fail-closed on absent tokens |
| 2026-08-03 | Oversight Board | Accepted (`investigation` stance) | An investigator seeing their own work disappear is a constitutional-path defect; read-your-writes names the requirement exactly |
| 2026-08-03 | Data Governance Board | Accepted (`analytics` stance) | Monotonic reads prevent the backwards-moving dashboard that drives manual reconciliation |
| 2026-08-03 | Architecture Review Board | Accepted (governance schema) | The catalogue cannot require review schedules of others while carrying none itself |
