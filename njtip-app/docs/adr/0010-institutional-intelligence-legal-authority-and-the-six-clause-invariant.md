# ADR-0010: Institutional intelligence, legal authority assurance, and the six-clause invariant

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Oversight Board · Architecture Review Board · Attorney General's Chambers · Information Security Review Board · Data Governance Board
- **Review required:** OB (the invariant is constitutional in effect) + ARB + AGC (the legal authority framework)

## Context

ADR-0009 adopted a four-clause invariant and, in doing so, recorded two debts it could not close:

> **The platform does not record which deployment zone a bounded context sits in.**
> **Nothing records what legally authorises case investigation or service recovery.**

Both are closed here, and closing them exposed a third gap that neither ADR had seen.

**A control that runs and passes is not a control that works.** Every governance report in this
platform is derived from the fitness gate. The gate says a control *ran* and *passed on a synthetic
counterexample*. It says nothing about whether that control has ever detected a real condition, how
long it took, whether anybody acknowledged it, or how many conditions it missed. One hundred and
seventy-five controls hold on every build and not one of them has a single observation of it doing
its job in anger. Reading a green build as operational effectiveness is the most consequential
inference this platform was quietly making.

**A legal basis is a dependency like any other, and nobody had modelled it.** Phase 14's dependency
taxonomy named `legal authority` as a category and had nothing to resolve it against. A capability
whose statute is repealed stops being lawful at the moment of repeal, with no outage, no failing
control, and no dashboard turning red.

**Two institutions sharing a board are not two institutions that can work together.** Phase 14 asked
whether a pair of institutions had a recorded way to reach each other and called that coordination
readiness. It never asked what legally permitted one to rely on the other, whether their governance
rules agreed about what may cross between them, or whether the relationship had a second path.

Alongside those, Phase 15 was asked for institutional intelligence: maturity models, sustainability
assessment, executive decision packages, workload forecasting. Each is a generator of authoritative-
looking numbers, and the decision package is the most dangerous artefact this platform has ever been
asked to produce — a recommendation with enough evidence attached that a board could act on it
without going and checking, which is exactly what makes it capable of substituting for the decision.

## Decision

**Widen the global invariant to six clauses.** No critical institutional capability may depend upon
an unverified assumption, an undocumented legal authority, an ineffective detecting control, an
undeclared constitutional relationship, or a single point of organizational failure. The four
ADR-0009 clauses are unchanged; `undocumented-legal-authority` and `ineffective-detecting-control`
are new, and the governance relationship clause now additionally requires that every context the
capability spans has a **declared** constitutional placement.

**Record the constitutional zone of all 30 bounded contexts**, with a trust boundary, a data
residency policy, a classification, a failover policy, a collaboration constraint and a written
rationale for each. `contextMap.validate()` refuses to compose the platform on any undeclared or
unknown value, which closes the first ADR-0009 debt by construction rather than by convention.

**Ship the legal authority registry EMPTY of statutory claims.** Declaring that a particular Act
authorises a particular capability is a legal assertion about the Republic of Botswana. It is not a
fact this repository can derive, and a plausible-looking statute name in a governed register is worse
than an empty one: an auditor would read it, an engineer would cite it, and nobody would discover it
was invented until it mattered. The framework is executable; the instruments are the institution's to
record. A declaration is `declared` until the **approving organization itself** reviews it — a review
by anybody else is somebody reading a document.

**Measure control effectiveness from observations, never from the gate.** Seven dimensions —
detection latency, acknowledgement latency, remediation latency, false-positive rate, false-negative
rate, historical reliability, operational availability — each against a declared threshold, with the
overall state the weakest of them. A control with no observations is `unknown`: not effective, not
ineffective, and never averaged into a rate.

**Assess cross-government readiness on five aspects, aggregated to the weakest.** Communication,
legal interoperability, governance interoperability, operational coordination, dependency resilience.
Institutions and their constitutional zones are derived from the accountability and architecture
records; nothing is a list of partners. `unknown` is counted apart from `blocked` at every level,
because "nobody has looked" and "we looked and two rules conflict" need different people to act.

**Every decision package concludes with a constant string.** `Human authorization required.` is a
literal that nothing computes, no input can override, and `assertAdvisory` refuses to emit a package
without. Eight kinds of evidence are mandatory — supporting evidence, confidence, assumptions,
affected controls, legal dependencies, institutional impacts, risks, uncertainties — each stating
what its absence would mean.

**Governance recommendations are classified, and only one class may remove anything.** Five classes;
`simplify` is the only one that removes a control and carries `scrutiny: 'high'`. Seven mandatory
controls can never be recommended for removal.

**Sustainability is assessed over a stated horizon per dimension.** Seven dimensions, each naming its
own timeframe, because "sustainable" with no timeframe attached is a word rather than an assessment.

## Consequences

The invariant does not hold, and adopting it while it fails is again the point. Five of six clauses
currently fail for every critical capability. `evidence-custody` satisfies all six under fully
evidenced conditions — a verified assumption, full continuity evidence, a reviewed legal instrument
and twenty clean observations per detecting control — which demonstrates the bar is reachable rather
than decorative.

**Every capability is blocked at the first hop of the legal dependency graph**, because the registry
is empty. That is the honest state of a platform whose legal basis nobody has recorded.

**No control on this estate has any performance evidence.** The effectiveness dashboard reports
`effectivenessRate: null` over 175 controls and states why: a green build says the control ran.

Cross-government readiness is 0 of 39 institutional pairs, and the analysis surfaced three findings
nothing had previously looked for:

- **The Information Security Review Board cluster is disconnected from the governance graph.** Six
  institutions holding identity, cryptography, platform security and incident response share no
  forum with any other institution and appear in no other institution's escalation chain, at any
  distance. In an incident they and the rest of government would find each other by improvisation.
- **31 onward-disclosure conflicts**, where data a context may only share under governance flows into
  a context permitted to share it openly.
- **28 classification downgrades** across institutional boundaries.

Twenty-two executive panels and twenty-one assurance domains still print NOT AUTHORIZED.

## Alternatives considered

**Seed the legal authority registry with plausible instruments.** Rejected below, at length.

**Infer control effectiveness from the fitness gate.** Rejected below.

**Add the two new clauses as separate reports rather than widening the invariant.** Rejected for the
same reason ADR-0009 gave: reports nobody aggregates are how a capability comes to fail one of them
for a year.

**Let a decision package conclude with its own recommendation when confidence is high.** Rejected:
a package that concludes anything other than "a human must decide" is a decision, and the confidence
field would immediately become the thing people tune to get the answer they want.

**Score cross-government readiness as a percentage per pair.** Rejected: averaging five aspects lets
a relationship with no legal basis score 80% because the other four are fine.

## Rejected alternatives

**Seeding the legal authority registry.** The single most tempting shortcut in this phase and the one
that would do the most damage. A register containing "Corruption and Economic Crime Act, s.6" against
`case-investigation` reads as researched fact to every downstream consumer — the dependency graph, the
invariant, the sustainability assessment, the decision packages and any auditor who opens it. The
platform cannot verify that claim, cannot know whether the section was amended, and cannot know
whether it authorises what the capability actually does. An empty register produces a loud, correct
UNKNOWN that somebody must resolve. A populated one produces silence.

**Deriving effectiveness from the gate.** Every control passes, so every control would be reported as
effective, and the one number that matters — how many real conditions went undetected — would be
structurally unmeasurable. False negatives are only recordable if a human records that the condition
occurred and the control said nothing. That is the field the whole module exists to carry.

**Reading a `no-sharing` collaboration constraint as forbidding internal architectural
dependencies.** Tried, and it fired on 35 of 39 institutional pairs. The constraint governs what may
be passed *outward*; an internal dependency on a `no-sharing` context is the architecture working as
designed. A control that fires on almost everything teaches everybody to ignore it, which is worse
than no control. The check now looks only at where data lands.

**Treating controls with an empty observation register as failing.** Corrected during this phase.
Controls nobody has watched are not controls known to be bad; reporting them as failing puts the
wrong repair on somebody's desk. They are unmeasured, counted separately, and excluded from the rate.

**A single institutional sustainability score.** Seven dimensions with seven different horizons
cannot be averaged into one number without discarding the horizons, and the horizons are the only
thing that distinguishes sustainability from readiness.

## Architectural trade-offs

The six-clause invariant makes institutional readiness harder to reach and easier to reason about, at
the cost of a permanent block until the institution records a legal basis and starts observing its
controls. That is the same trade ADR-0008 and ADR-0009 made, and the same answer: a gate that never
blocks is not a gate.

Recording zone governance for all 30 contexts as a startup gate means a new context cannot be added
without a constitutional decision about where it sits. That is deliberate friction on exactly the
change that should not be made casually.

Deriving cross-government institutions from the ownership record rather than listing partners means
an agency that is renamed or dissolved changes the analysis automatically, at the cost of the
analysis being unable to see relationships with bodies that hold nothing in the platform.

## Long-term maintenance impact

Three new modules — `src/legislation/legal-authority.js`, `src/assurance/control-effectiveness.js`,
and the Phase 15 additions to eleven existing files — all inside existing bounded contexts. No new
bounded context, so the context map and the ownership matrix are unchanged in structure.

The declared thresholds in `control-effectiveness.js` are the part most likely to go stale. Each
states its reasoning inline, and a fitness function requires the reasoning to exist.

## Implementation complexity

Moderate and additive. Every new parameter is optional; absent means unknown and unknown fails
closed. Two behavioural changes to existing paths, both corrections: `institutionalAssurance` now
reports an unobserved control as unmeasured rather than failing, and `forecastInterval` delegates to
the canonical interval in `evidence-confidence.js` so the two cannot diverge.

## Operational cost

Two new registers the institution must actually populate for the metrics to mean anything: legal
authority declarations with named approving organizations, and observations of controls detecting
real conditions. Populating neither is the current state and is reported as such rather than as a low
score. The second is the more demanding: it requires somebody to record the conditions that occurred
and were *not* detected, which nothing else in the platform can observe.

## Lifecycle implications

The invariant blocks institutional readiness until every clause holds or a named authority accepts
the failing clause with a rationale and an expiry. Acceptances expire without anybody withdrawing
them, which returns the block automatically. A legal authority expires and a review falls overdue on
the same principle: the block returns with nobody acting.

## Business justification

An institution that cannot say what legally permits its capabilities to operate, and cannot say
whether its controls have ever caught anything, will discover both at once — in the proceeding where
the authority is challenged, or in the incident nothing detected. The cost of finding out now is a
blocked readiness gate and two registers somebody must populate. The cost of finding out then is a
constitutional capability operating unlawfully, or a breach that ran undetected, while every
dashboard reads green.

## Risk assessment

| Risk | Likelihood | Impact | Treatment |
|---|---|---|---|
| The legal authority registry stays empty and the clause blocks indefinitely | High | The gate is routed around and stops meaning anything | Sunset criterion 1; acceptance is available and is attributed, time-bound and visible |
| Somebody populates the registry with plausible but unverified instruments | Moderate | A fabricated legal basis is cited as fact | A declaration is `declared`, not `reviewed`, until the named approving organization itself reviews it; only that organization can |
| A green build is read as operational effectiveness anyway | Moderate | The institution believes it is protected by controls nothing has tested | `effectivenessRate: null`, `measurable: false`, and a stated basis on every unmeasured report |
| Only detected incidents are recorded, producing a false-negative rate of zero | High | The one figure that matters becomes meaningless | The `false-negative` outcome exists specifically to be recorded, and the decision package for this finding names the risk explicitly |
| A decision package substitutes for the decision | Moderate | A board acts on assembled evidence without checking | The conclusion is a constant string, `authorizes: false` on every package, and `decidedBy` is always `null` |
| Cross-government findings are dismissed because there are many | Moderate | Real conflicts are lost in volume | Each finding names the two contexts, the two institutions and the specific rule that conflicts; none is a score |

## Performance impact

None measurable. Every addition is a deterministic computation over in-memory registries, run in the
verification suite rather than on a request path. The cross-government analysis is O(pairs × flows)
over 39 pairs and 48 declared flows.

## Security impact

Positive. The Information Security Review Board cluster's isolation from the governance graph is a
security finding that no previous analysis could produce, and it concerns the six institutions
holding the platform's most sensitive contexts. The classification-downgrade and onward-disclosure
checks are information-security findings derived from the architecture rather than from a review.

## Operational impact

Thirteen new HTTP endpoints, all read-only except three that record a **human** act: declaring a
legal authority, reviewing one, and recording an observation of a control. None can be performed by
the platform, which is why each is a POST by a named person.

## Compliance impact

The legal authority registry is the first place this platform records what permits a capability to
exist, as distinct from what obliges it to behave a certain way. The legislative registry answers
"what must we comply with"; this answers "what allows us to operate", and the two were previously
conflated.

## Rollback strategy

Every addition is additive and optional. Reverting means removing the new modules and the fitness
functions that check them; nothing in the frozen baseline depends on any of it. The one non-trivial
reversal is `contextMap.validate()`'s zone-governance gate, which would refuse composition if the
declarations were removed without also removing the check — both are in one file and revert together.

## Migration strategy

None required. The platform composes identically; both new registers start empty and every report
says so.

## Estimated implementation cost

Three new fitness functions, one new test file, and extensions to fourteen existing modules and four
existing test files. The larger cost is organizational and falls outside the repository: the registers
only mean something once the institution populates them, and the control observation register
requires an operational practice that does not currently exist.

## Success metrics

- The six-clause invariant is evaluated for **5** critical capabilities × **6** clauses on every
  build, with **0** clauses skipped.
- At least **1** capability satisfies all **6** clauses under evidenced conditions, so the bar is
  demonstrably reachable.
- **0** decision packages conclude with anything other than the constant string, across **8**
  mandatory evidence fields.
- **0** of the **22** executive panels and **0** of the **7** sustainability dimensions are enterable
  by hand.
- **7** control effectiveness dimensions each report against a declared threshold, and **0** controls
  with **0** observations are counted in the effectiveness rate.
- Cross-government readiness is evaluated over **5** aspects for **39** institutional pairs, with
  `unknown` and `blocked` counted separately at **3** levels.

## Measurable success criteria

| Criterion | Measured by | Threshold |
|---|---|---|
| The invariant is continuously evaluated | `APP-FIT-GLOBAL-INVARIANT` | 5 capabilities × 6 clauses, every build |
| The bar is reachable | Same control, evidenced-estate branch | `evidence-custody` satisfies all 6 clauses |
| A declaration is not a review | `APP-FIT-LEGAL-AUTHORITY` | An unreviewed declaration reports `declared`, never `reviewed` |
| Unobserved is not effective | `APP-FIT-CONTROL-EFFECTIVENESS` | 0 unknown controls counted in `effectivenessRate` |
| No aspect is decoration | `APP-FIT-CROSS-GOVERNMENT` | No aspect is `ready` for all 39 pairs; each can fail and pass |
| The weakest link, never the mean | Same control | Pair readiness equals its worst aspect, for all 39 pairs |
| A package never decides | `APP-FIT-DECISION-SUPPORT` | `conclusion` is the constant for 100% of packages; `authorizes === false` |
| Sustainability has a horizon | `APP-FIT-INSTITUTIONAL-SUSTAINABILITY` | 7 of 7 dimensions state a horizon; each can fail alone |
| Workload forecasts are not invented | `APP-FIT-ADAPTIVE-ANALYTICS` | 5 of 6 workload forecasts return `null` with no source supplied |

## Architectural debt assessment

**One ADR-0009 debt is closed and one is replaced by a larger, honest one.** Zone governance is now
recorded for all 30 contexts. The legal authority framework exists, but the register is empty, so the
debt is no longer "nothing models this" — it is "the institution has not recorded it", which is a
debt somebody outside this repository owns and can discharge.

**A new debt is recorded rather than closed: no control on this platform has any performance
evidence.** The framework to measure it exists and the register is empty. Until it is populated,
every effectiveness figure is `unknown` and the invariant's sixth clause fails for every capability.

**The Information Security Review Board cluster is disconnected from the governance graph.** This is
an organizational finding, not a code defect, and it is recorded here because nothing else in the
platform would carry it.

The cross-context coupling baseline is unchanged at **125** across this phase.

## Review schedule

Reviewed by the Oversight Board on or before **2027-02-06** — six months, chosen to coincide with the
ADR-0008 and ADR-0009 reviews, because the three invariants are one question and reviewing them apart
would invite divergence.

Reviewed **annually** thereafter, and immediately out of cycle on any sunset trigger below. The
Attorney General's Chambers is a required participant for the legal authority framework; the
Information Security Review Board for control effectiveness thresholds and the governance-graph
isolation finding; the Data Governance Board for the cross-government information-sharing analysis.

## Sunset criteria

This decision stops applying — and must be re-taken, not amended — when any of the following is
observed:

1. **The legal authority clause holds for every capability.** The registry is then being exercised
   and the clause's blocking behaviour should be re-examined against what it then costs.
2. **A legal authority declaration is found in the register that no instrument supports.** The
   framework's central guarantee failed, and it should be withdrawn rather than patched.
3. **The control effectiveness clause holds while the recorded false-negative rate is exactly zero
   across more than 50 observations.** That is the signature of only recording detected incidents,
   and the figure is then measuring nothing.
4. **A decision package is cited in a board minute as the decision rather than as input to one.**
   The framing failed, and packages should be withdrawn rather than restated.
5. **More than 5 clause acceptances are active at once, or any single acceptance is renewed more
   than twice.** Acceptance is meant to be the exception; the invariant is being routed around.
6. **A bounded context is added without a declared constitutional placement.** The startup gate was
   removed or routed around, and the zone model needs re-taking.
7. **Cross-government readiness reaches `ready` for any pair with no recorded joint act.** The
   derivation broke, and it is reporting an org chart as a capability.

## Decision owner

Oversight Board (chair), with the Attorney General's Chambers accountable for the legal authority
framework and every declaration in it; the Architecture Review Board for zone governance, the
assumption maturity model and the coupling baseline; the Information Security Review Board for the
control effectiveness thresholds and the governance-graph isolation finding; and the Data Governance
Board for cross-government information sharing. The OB chair is responsible for initiating the review
on the schedule above.

## Approval history

| Date | Body | Decision | Basis |
|---|---|---|---|
| 2026-08-06 | Oversight Board | Accepted | A capability can satisfy four clauses and still be operating with no recorded legal basis, watched by controls nobody has ever seen work; adopting the wider invariant while it fails is what makes both visible |
| 2026-08-06 | Architecture Review Board | Accepted | Additive, no new bounded context, no interface break, coupling baseline unchanged at 125; every new parameter is optional and absent fails closed |
| 2026-08-06 | Attorney General's Chambers | Accepted (legal authority framework) | The register ships empty of statutory claims; a declaration is not a review, and only the named approving organization can review its own |
| 2026-08-06 | Information Security Review Board | Accepted (control effectiveness) | Seven dimensions against declared thresholds, weakest-link aggregation, and an unobserved control excluded from the rate rather than counted as working |
| 2026-08-06 | Data Governance Board | Accepted (cross-government analysis) | Institutions and constitutional zones derived from the accountability and architecture records; unknown counted apart from blocked at every level |
| 2026-08-06 | Oversight Board | Accepted (governance-graph finding) | The ISRB cluster's isolation is recorded as an organizational finding rather than corrected by widening a board's membership in code |
