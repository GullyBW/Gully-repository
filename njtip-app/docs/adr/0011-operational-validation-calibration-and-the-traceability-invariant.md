# ADR-0011: Operational validation, institutional calibration, and the traceability invariant

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Oversight Board · Architecture Review Board · Operations Review Board · Information Security Review Board · Attorney General's Chambers · Data Governance Board
- **Review required:** OB (the invariant is constitutional in effect) + ARB + ORB (calibration and exercise maturity)

## Context

ADR-0010 widened the global invariant to six clauses and recorded a debt it could not close: **no
control on this platform has any performance evidence**. Working through that debt surfaced the
shape of the problem the whole of Phase 16 addresses.

**The platform can produce a figure and cannot explain it.** Twenty-two executive panels and ten
readiness dimensions are all derived — `manualEntry: false` says so — and a board member reading
"documentation health: 247" cannot see what it is derived FROM without opening the source. A figure
whose provenance is a code comment is a figure nobody can challenge.

**Nothing has ever been checked against what actually happened.** Twelve governance forecasts have
been produced since Phase 14 and not one has been scored. Sixteen twin scenarios exist and none has
been compared against a real outcome enough times to assess. A forecasting framework nobody scores is
one that cannot be wrong, and a framework that cannot be wrong will be believed indefinitely.

**Every register is empty and there was no auditable way to fill one.** Phase 15 built the legal
authority register, the control observation register and the trust evidence register, and left all
three with no route in beyond a direct method call. The obvious next step — connect them to real
systems — is also the obvious way to start fabricating operational history at scale.

**The estate is synthetic and had no way to say so about a particular record.** The moment a governed
register can hold both synthetic and operational data, a report that counts them together is a report
claiming a history the institution does not have.

## Decision

**Adopt a second global invariant, about CONCLUSIONS rather than capabilities.** No executive
conclusion, readiness assessment, governance recommendation, institutional forecast, or operational
decision shall exist without a complete, explainable, evidence-backed traceability chain. Evaluated
across five subjects and ten areas. It does not replace the six-clause invariant of ADR-0010: that
one asks whether a capability is sound, this one asks whether a conclusion is answerable, and a
platform can be entirely sound and still produce figures nobody can trace.

Acceptance runs through the **same** `ResilienceAcceptance` class as the capability invariant — a
named authority, a rationale, an expiry — because a second acceptance framework is a second place to
forget to expire something.

**Every executive value walks seven derived hops** to a source record: metric → readiness dimension →
evidence → control → policy → ADR → source record. Every hop is derived from a register that already
exists, so a panel that moves to another module re-links itself. A chain is reported as **broken AT
the hop that failed**, never as a percentage: a chain six-sevenths complete supports nothing.

**Traceability is checked in both directions.** Forward answers "what does this conclusion rest on";
backward answers "what does this control actually hold up", and only the backward direction finds a
suite that has grown past what any readiness conclusion depends on.

**A connector's trust level is a ceiling, not a label.** Evidence acquired through a connector can
never be trusted more than the connector it came through. Four blockers cap it — trust, integrity,
synchronization, freshness — each clearable and each capable of returning on its own. A connector
cannot declare itself verified, its owner cannot verify it, and an unprotected path cannot be
verified away. Every kind states what it **cannot** tell you.

**Synthetic data is never operational evidence and cannot become it.** Every onboarding submission
declares its class; there is no default, because whichever way it defaulted would be wrong half the
time in the direction nobody notices. There is no `promote()`, deliberately, and its absence is
checked rather than trusted.

**Unknown calibration is not poor calibration** — in forecasts and in the twin alike. One needs
somebody to start looking; the other needs somebody to fix a model, and merging them sends the wrong
person. Rates are computed over scored dimensions and assessed scenarios only.

**Precision and recall are reported side by side and never combined.** A control can be perfect at
one and useless at the other, and a single score hides which.

**Realism is derived from the conditions, not assessed by the facilitator.** An announced, scheduled
walkthrough against no live system is a tabletop whatever anybody scores it.

**A capability domain with no source is unknown, and unknown is not level zero.** Level zero means
somebody looked and found nothing; unknown means nobody looked.

**Architectural evolution beyond a recorded baseline is REJECTED, not reported.**
`assertNoUndocumentedEvolution` throws fail-closed. A checker that logs undocumented evolution and
lets the build through documents the drift rather than preventing it.

**The production transition framework plans and never acts.** No state in it is `ready`,
`deploymentPermitted` is a constant `false`, and there is no `execute`, `cutover`, `promote`, `deploy`
or `goLive` — the absence of those functions is checked by a fitness function.

## Consequences

The traceability invariant does not hold, and adopting it while it fails is again the point. All
fifteen violations are currently **unknown** rather than examined: none of the five subjects has a
source supplied by default and none of the ten areas has been evaluated.

**41% of executive values are explainable end to end** (9 of 22). The other thirteen break at the
first hop because the figure itself is unmeasured — which is the correct answer, not a chain defect.

**39% of controls hold up no readiness conclusion at all** (75 of 190), across seventeen bounded
contexts that own controls but own no readiness dimension. That is a finding, not an error, and it
does not make the estate untraceable. But nobody should discover it during an audit.

**The organizational capability level is L0**, driven by legal readiness: assessed, and nothing in
place. Six of the seven domains remain unknown.

**Exercise maturity is E0.** No rehearsal has been closed, and the cheapest way to pass every
rehearsal is to run none.

Every new register ships empty: no connector, no scored forecast, no compared scenario, no workshop,
no recorded baseline. Each says what has not happened rather than reporting health.

## Alternatives considered

**Score the explainability chain as a percentage complete.** Rejected below.

**Connect a real evidence source to demonstrate the acquisition framework.** Rejected: the platform
is offline and synthetic by design, and a declared connector would imply a feed that does not exist.

**Fold the traceability invariant into the six-clause capability invariant.** Rejected: they answer
different questions about different objects, and a nine-clause invariant covering both would be one
question nobody could answer.

**Let the platform record its own architecture baseline at startup.** Rejected below.

**Combine precision and recall into an F-score.** Rejected: it is exactly the number that hides
which of the two failed.

## Rejected alternatives

**A percentage-complete explainability score.** A chain that resolves six of seven hops supports
nothing at all, and a dashboard reading "86% explainable" would be read as mostly fine. The chain is
reported as broken at its first failing hop, with what that break costs in the words of the hop
itself and what would resolve it.

**A self-recorded architecture baseline.** A baseline the tool writes for itself is a baseline that
agrees with whatever it finds, and the check becomes a tautology. The baseline must be recorded by a
named human citing the decision that approved it — which is why, on this build, no baseline exists
and evolution is reported as UNKNOWN rather than compliant.

**Defaulting the data class on an evidence submission.** Whichever default was chosen would be wrong
about half the records, in the direction nobody notices: default synthetic and real evidence is
discounted as a drill; default operational and the institution believes it has a history it does not
have. Refusing the submission is the only option that fails in a visible direction.

**Letting the facilitator grade the realism of their own exercise.** The facilitator can grade
coordination and communication — those genuinely need a human judgement — but a person who can set
`unannounced: true` after seeing the result can make any drill look like whatever they need.

**Treating an unassessed capability domain as level zero.** An institution that scores itself 0 on a
domain it never assessed has invented a finding; one that scores itself 3 has invented a capability.
Both are worse than reporting that nobody looked.

**Counting unscored dimensions as calibration failures.** That would punish the institution for not
yet having a history, which is not a finding about any model.

## Architectural trade-offs

The traceability invariant makes institutional readiness harder to reach and much easier to argue
with: every blocked conclusion names the hop that broke and what would resolve it. It costs a
permanent block until somebody starts recording outcomes, which is the same trade ADR-0008, ADR-0009
and ADR-0010 made and the same answer: a gate that never blocks is not a gate.

Deriving every explainability hop from existing registers means there is no mapping table to maintain
and no second source of truth — at the cost that a panel derived from a module no context claims
cannot be explained at all, which is itself the finding.

Recording a baseline as a human governance act rather than a startup step means the platform ships
reporting UNKNOWN about its own evolution. That is deliberate: the alternative is a check that
always passes.

## Long-term maintenance impact

No new module and no new bounded context. Fifteen parts extended eleven existing files across
`src/assurance/`, `src/architecture/`, `src/governance/`, `src/legislation/`, `src/twin2/` and
`src/migration/`. The context map and the ownership matrix are unchanged in structure.

The declared thresholds most likely to go stale are the calibration floors — five scored outcomes,
three twin comparisons, three performance samples — each stated in one place with its reasoning.

## Implementation complexity

Moderate and additive. Every new parameter is optional; absent means unknown and unknown fails
closed. Two behavioural changes to existing paths, both required by the new discipline: an evidence
submission must now declare its data class, and a control observation may now carry a recovery
timestamp distinct from its remediation timestamp.

One performance change: the HTTP handlers for the new reports share a per-request governance context,
because `readiness()` and `engineeringIntelligence()` each re-run the whole fitness suite internally
and a handler calling them once per sub-report spent minutes doing the same work.

## Operational cost

Five new registers the institution must populate for the metrics to mean anything: evidence
connectors, scored forecast outcomes, twin validations, validation workshops, and a recorded
architecture baseline. Populating none of them is the current state and is reported as such.

The most demanding is the forecast outcome register: it requires somebody to go back, some months
later, and record what actually happened against a prediction nobody would otherwise revisit.

## Lifecycle implications

The traceability invariant blocks institutional readiness until every conclusion traces or a named
authority accepts it with a rationale and an expiry. Acceptances expire without anybody withdrawing
them, which returns the block automatically. A connector's trust ceiling falls back to UNKNOWN when
its newest record ages past its own declared freshness requirement — again with nobody acting.

## Business justification

An institution that cannot explain the figures its board acts on, and has never checked a single
prediction against what happened, will discover both in the same meeting — the one where somebody
asks where a number came from. The cost of finding out now is a blocked readiness gate and five
registers somebody must populate. The cost of finding out then is a governance framework that has
been confidently wrong for years with nothing able to detect it.

## Risk assessment

| Risk | Likelihood | Impact | Treatment |
|---|---|---|---|
| The new registers stay empty and the invariant blocks indefinitely | High | The gate is routed around and stops meaning anything | Sunset criterion 1; acceptance is available, attributed, time-bound and visible |
| An evidence connector is declared for a system that does not exist | Moderate | Fabricated operational history at scale | A connector cannot verify itself, its owner cannot verify it, and its ceiling is UNKNOWN until an independent party clears all four blockers |
| Synthetic records are counted as operational history | Moderate | The institution believes it has a history it does not have | No default data class, no promotion path, and the two classes counted apart at every level |
| Forecast outcomes are recorded selectively, only where the forecast was right | Moderate | The calibration figure means nothing | An outcome cannot be recorded twice, or before the horizon elapses; bias is signed and an optimistic lean is named |
| Explainability is read as a score | Low | A partially traceable figure is treated as traceable | Reported as broken AT a hop; no percentage is offered for a single chain |
| The production transition plan is mistaken for the act | Moderate | A synthetic platform is treated as deployable | No state is `ready`, `deploymentPermitted` is constant `false`, and the absence of execute/cutover/promote is a fitness check |

## Performance impact

The governance reports are deterministic computations over in-memory registers. The one real cost is
that several of them internally re-run the fitness suite; the HTTP layer now shares one context per
request, which is what makes the new endpoints usable at all.

## Security impact

Positive. The evidence acquisition framework makes the trust properties of an external source
explicit before anything it supplies may be counted, and names what each kind **cannot** tell you —
including that a SIEM reports detections and the gap is the thing that matters.

## Operational impact

Seventeen new HTTP endpoints. Read-only except the acts only a human can perform: declaring and
verifying an evidence connector, recording a synchronization, recording a forecast and its outcome,
declaring the conditions of a rehearsal, and everything a validation workshop consists of.

## Compliance impact

Legal dependency intelligence detects five defects that are only visible from a whole-register view,
including an instrument declared as two different kinds of authority — which matters because each
kind is withdrawn a different way. Legal impact analysis answers the question the register could not
answer before: what falls if this instrument is withdrawn.

## Rollback strategy

Every addition is additive and optional. Reverting means removing the new sections and the fitness
functions that check them. The one non-trivial reversal is the mandatory data class on evidence
onboarding, which changes an existing call signature; reverting it would restore the Phase 15
behaviour and reintroduce the defaulting problem.

## Migration strategy

None required. The platform composes identically; all five new registers start empty and every report
says so.

## Estimated implementation cost

Fourteen new fitness functions, one new test file of 44 deterministic tests, and extensions to eleven
existing modules. The larger cost falls outside the repository: the registers only mean something
once the institution populates them, and the forecast outcome register requires an operational habit
that does not currently exist.

## Success metrics

- The traceability invariant is evaluated over **5** subjects and **10** areas on every build, with
  **0** skipped.
- Every executive value walks **7** hops, and a broken chain names **1** hop rather than a percentage.
- **0** of the **6** institutional performance indicators are enterable by hand.
- **0** connectors reach a verified evidence ceiling without clearing all **4** blockers.
- **0** transition tracks reach `ready`, across **8** tracks.
- **9** control performance measures are computed, and **0** controls with **0** observations are
  counted in any rate.
- **5** legal defects are each detectable independently.

## Measurable success criteria

| Criterion | Measured by | Threshold |
|---|---|---|
| The invariant is continuously evaluated | `APP-FIT-TRACEABILITY-INVARIANT` | 5 subjects + 10 areas, every build |
| Each subject can fail alone | Same control | 5 of 5 fail independently when their source is withheld |
| A chain breaks at a hop | `APP-FIT-EXPLAINABILITY` | Every broken chain names exactly one hop and what would resolve it |
| Backward traceability finds orphans | `APP-FIT-READINESS-TRACEABILITY` | >0 orphan controls named, and the estate stays traceable |
| Trust is a ceiling | `APP-FIT-EVIDENCE-ACQUISITION` | 4 blockers, each capable of capping and of being cleared |
| Synthetic never becomes operational | Same control | No `promote`, and no default data class accepted |
| Unknown ≠ poor | `APP-FIT-FORECAST-CALIBRATION`, `APP-FIT-TWIN-CALIBRATION` | Unscored dimensions excluded from every rate |
| Precision and recall stay apart | `APP-FIT-CONTROL-PERFORMANCE` | `combined === false` |
| Evolution is rejected, not reported | `APP-FIT-ARCHITECTURE-VALIDATION` | The gate throws fail-closed on undocumented evolution |
| Nothing deploys | `APP-FIT-PRODUCTION-TRANSITION` | 0 ready states, `deploymentPermitted === false`, 5 forbidden functions absent |

## Architectural debt assessment

**One ADR-0010 debt is now measurable rather than closed.** Control performance can be measured in
nine ways; the register is still empty, so every figure is unknown. That is the institution's debt to
discharge, not the platform's.

**A new debt is recorded: 39% of the control suite holds up no readiness conclusion.** Seventeen
bounded contexts own controls and own no readiness dimension. This may be entirely correct — not
every control exists to support a readiness conclusion — but nobody had ever counted it, and it
should be examined rather than left as a number in a report.

**A second new debt: no architecture baseline is recorded in the register.** Baseline v1.7 is frozen
in documentation and has never been recorded with the decision that approved it, so the platform
cannot tell whether it has evolved beyond what was approved.

The cross-context coupling baseline is unchanged at **125** across this phase.

## Review schedule

Reviewed by the Oversight Board on or before **2027-02-06** — six months, to coincide with the
ADR-0008, ADR-0009 and ADR-0010 reviews, because the invariants are one question and reviewing them
apart would invite divergence.

Reviewed **annually** thereafter, and immediately out of cycle on any sunset trigger below. The
Operations Review Board is a required participant for calibration and exercise maturity; the
Information Security Review Board for the evidence acquisition trust model; the Attorney General's
Chambers for legal dependency intelligence.

## Sunset criteria

This decision stops applying — and must be re-taken, not amended — when any of the following is
observed:

1. **The traceability invariant holds for every subject and area.** The registers are then being
   exercised and the invariant's blocking behaviour should be re-examined against what it costs.
2. **An evidence connector is found declared for a system that does not exist.** The acquisition
   framework's central guarantee failed and it should be withdrawn rather than patched.
3. **A synthetic record is found counted as operational evidence anywhere downstream.** The class
   distinction failed, and everything resting on it needs re-examining.
4. **Forecast outcomes are recorded for more than 80% of forecasts that were right and fewer than
   20% of those that were wrong.** The calibration figure is then measuring selection, not accuracy.
5. **A production transition artefact is cited in a deployment decision as evidence of readiness.**
   The framing failed and the framework should be withdrawn.
6. **More than 5 traceability acceptances are active at once, or any single acceptance is renewed
   more than twice.** Acceptance is meant to be the exception; the invariant is being routed around.
7. **An architecture baseline is recorded by anything other than a named human citing an ADR.** The
   check has become a tautology.

## Decision owner

Oversight Board (chair), with the Architecture Review Board accountable for continuous architecture
validation, the explainability chain and the coupling baseline; the Operations Review Board for
forecast and twin calibration, control performance and exercise maturity; the Information Security
Review Board for the evidence acquisition trust model; the Attorney General's Chambers for legal
dependency intelligence; and the Data Governance Board for cross-government workflow validation. The
OB chair is responsible for initiating the review on the schedule above.

## Approval history

| Date | Body | Decision | Basis |
|---|---|---|---|
| 2026-08-06 | Oversight Board | Accepted | The platform can produce a figure and cannot explain it, and has never checked a prediction against what happened; adopting an invariant about conclusions while it fails is what makes both visible |
| 2026-08-06 | Architecture Review Board | Accepted | Additive, no new module and no new bounded context, coupling baseline unchanged at 125; every explainability hop is derived from a register that already exists |
| 2026-08-06 | Operations Review Board | Accepted (calibration and exercises) | Unknown calibration is kept distinct from poor calibration, realism is derived from the conditions rather than graded, and precision and recall are never combined |
| 2026-08-06 | Information Security Review Board | Accepted (evidence acquisition) | A connector's trust level is a ceiling with four independently clearable blockers; no connector may verify itself and an unprotected path cannot be verified away |
| 2026-08-06 | Attorney General's Chambers | Accepted (legal dependency intelligence) | Five defects, each with its own correction, and an impact analysis that states it is not an argument for or against withdrawal |
| 2026-08-06 | Data Governance Board | Accepted (workflow validation) | Workflows derived from the architecture rather than listed, and unknown collaboration never counted as successful collaboration |
| 2026-08-06 | Oversight Board | Accepted (production transition) | Planning artefacts only: no ready state, no deployment permission, and the absence of any execution path checked rather than trusted |
