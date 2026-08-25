# Operational validation and institutional calibration

**Audience:** reviewer · Oversight Board · Operations Review Board
**Status:** governed documentation — every claim below is verified against the implementation on
every build by `APP-FIT-DOCUMENTATION-ASSURANCE`.

Recorded by [ADR-0011](./adr/0011-operational-validation-calibration-and-the-traceability-invariant.md).
Companion to [institutional-intelligence.md](./institutional-intelligence.md) and
[legal-authority.md](./legal-authority.md).

---

## 1. The traceability invariant

> No executive conclusion, readiness assessment, governance recommendation, institutional forecast,
> or operational decision shall exist without a complete, explainable, evidence-backed traceability
> chain.

This is a **second** global invariant, and it asks a different question from the six-clause one in
[ADR-0010](./adr/0010-institutional-intelligence-legal-authority-and-the-six-clause-invariant.md).
That one asks whether a **capability** is sound. This one asks whether a **conclusion** is
answerable — and a platform can be entirely sound and still produce figures nobody can trace.

Five subjects, evaluated across ten areas: architecture, governance, documentation, legal authority,
evidence, operational readiness, institutional resilience, executive intelligence, organizational
capability and digital twin simulations.

Unknown violations are counted apart from examined ones. "Nobody looked" and "we looked and it does
not trace" need different people. On the current estate all fifteen violations are **unknown**.

Acceptance runs through the **same** `ResilienceAcceptance` register as the capability invariant — a
named authority, a rationale and an expiry — because a second acceptance framework is a second place
to forget to expire something. Acceptances lapse on their own.

Read it at `GET /api/governance/traceability-invariant`, checked by `APP-FIT-TRACEABILITY-INVARIANT`.

## 2. Executive explainability — seven derived hops

```
executive metric → readiness dimension → evidence → control → policy → ADR → source record
```

Every hop is **derived**: the panel names its module, the context map claims the module, the
readiness model owns the dimension, RACI owns the control, the context declares the consistency
stance, the stance cites the ADR, and the module is the record on disk. Nothing here is a hand-kept
mapping, so a panel that moves to another module re-links itself.

**A chain is only as good as its first break.** It is reported as broken AT the hop that failed, with
what that break costs and what would resolve it — never as a percentage, because a chain that is
six-sevenths complete supports nothing.

On the current estate 9 of 22 executive values are explainable end to end. The other thirteen break
at the first hop because the figure itself is unmeasured, which is the correct answer rather than a
chain defect.

Read it at `GET /api/assurance/explainability`, checked by `APP-FIT-EXPLAINABILITY`.

## 3. Readiness traceability — both directions

Forward answers *what does this conclusion rest on*. Backward answers *what does this control
actually hold up*, and only the backward direction can find a suite that has grown past what any
readiness conclusion depends on.

It found one. **75 of 190 controls hold up no readiness conclusion at all**, across seventeen bounded
contexts that own controls but own no readiness dimension. That is a finding, not an error, and it
does not make the estate untraceable — but nobody should discover it during an audit.

Read it at `GET /api/assurance/readiness-traceability`, checked by `APP-FIT-READINESS-TRACEABILITY`.

## 4. Evidence acquisition — trust is a ceiling

`src/assurance/institutional.js` declares eight governed connector kinds: legislation repository,
PKI, SIEM, audit system, monitoring, identity provider, workflow engine, observability platform.

**A connector's trust level is a ceiling, not a label.** Evidence can never be trusted more than the
path it came through. Four blockers cap it, each clearable and each capable of returning on its own:

| Blocker | Cleared by |
|---|---|
| trust | independent verification by somebody who is not the owner |
| integrity | a checksummed or signed path |
| synchronization | a recorded successful sync |
| freshness | a newest record within the connector's own declared requirement |

A connector cannot declare itself verified, its owner cannot verify it, and an unprotected path
cannot be verified away. A connector whose newest record ages past its declared freshness drops back
to `unknown` with nobody doing anything.

Every kind states what it **cannot** tell you — a SIEM reports detections, and the gap is the thing
that matters. The registry ships empty: this platform is offline and synthetic.

Read it at `GET /api/assurance/evidence-connectors`, checked by `APP-FIT-EVIDENCE-ACQUISITION`.

## 5. Synthetic is never operational

Every evidence submission declares its data class. There is **no default**: whichever way it
defaulted would be wrong about half the records, in the direction nobody notices. Default synthetic
and real evidence is discounted as a drill; default operational and the institution believes it has a
history it does not have.

There is no `promote()`, deliberately, and its absence is checked rather than trusted. Operational
records must carry a source system, an observation time and an acquisition path, or they do not land.
The audit trail counts the two classes apart and never sums them.

## 6. Calibration — unknown is not poor

The same discipline applies to forecasts and to the twin:

**UNKNOWN CALIBRATION IS NOT POOR CALIBRATION.** One needs somebody to start looking; the other needs
somebody to fix a model, and merging them sends the wrong person.

Forecast calibration measures accuracy, mean absolute error, bias, confidence calibration, stability
and drift over a register that records a forecast **as it was made**, so scoring uses the interval
that was actually offered. A forecast cannot be scored before its horizon elapses (that scores
something else) or twice (that is a forecast scored until it passes). Bias is signed and a dimension
that leans optimistic is named, because an optimistic governance forecast is the one that gets
somebody hurt.

Twin calibration measures prediction accuracy, simulation confidence, calibration error and model
stability. Every comparison is stamped with the model digest it was recorded against, because
calibration evidence is about the model that produced it — a twin that changed since it was last
checked has not been checked.

Rates are computed over scored dimensions and assessed scenarios only. Counting the unexamined as
failures would punish the institution for not yet having a history.

Read them at `GET /api/governance/forecast-calibration` and `GET /api/twin/operations/calibration`,
checked by `APP-FIT-FORECAST-CALIBRATION` and `APP-FIT-TWIN-CALIBRATION`.

## 7. Control performance — precision and recall stay apart

Nine measures: detection rate, precision, recall, false positives, false negatives, and the four mean
times (detect, acknowledge, respond, recover).

**Precision and recall are reported side by side and never combined.** Precision asks *when it fires,
is it right*; recall asks *when it matters, does it fire*. A control can be perfect at one and useless
at the other, and an F-score hides exactly which.

`recoveredAt` is distinct from `remediatedAt` on purpose: remediation is when the fix was applied,
recovery is when the affected capability was back. Conflating them reports the moment an engineer
finished typing as the moment a citizen could file a report again.

A mean over fewer than three observations is marked **indicative** rather than reported as a
measurement. A period containing no observations is not a period scoring zero.

Read it at `GET /api/assurance/control-performance`, checked by `APP-FIT-CONTROL-PERFORMANCE`.

## 8. Exercise intelligence — realism is derived

Seven qualities over the rehearsal register. **Realism is derived from the conditions, not assessed
by the facilitator**: an announced, scheduled walkthrough against no live system is a tabletop
whatever anybody scores it. Conditions are declared before the run and cannot be restated.

Coordination and communication genuinely need a human judgement and are assessed — as bands, not
numbers, because a numeric score implies a precision a human judgement does not have. Assessments are
refused after close. A lesson requires an owner: a lesson nobody owns is an observation.

**An unassessed quality is UNKNOWN, not adequate.** Exercise maturity runs E0–E4 and every level
requires everything below it, because the cheapest way to pass every rehearsal is to run easier ones.

The estate is at **E0**: no rehearsal has been closed.

Read it at `GET /api/governance/exercise-maturity`, checked by `APP-FIT-EXERCISE-INTELLIGENCE`.

## 9. Capability maturity — unknown is not level zero

Seven domains: governance, operations, security, resilience, compliance, legal readiness,
organizational continuity. Every level is derived from a report the platform already produces.

**A domain with no source is UNKNOWN, and unknown is not level zero.** Level zero means somebody
looked and found nothing; unknown means nobody looked. An institution that scores itself 0 on a
domain it never assessed has invented a finding; one that scores itself 3 has invented a capability.

The institution sits at the level of its weakest **assessed** domain. Maturity evolution carries a
note for the case most often misread: a level that fell only because assessed coverage widened is the
assessment working, not the institution regressing.

Read it at `GET /api/governance/capability-maturity`, checked by `APP-FIT-CAPABILITY-MATURITY`.

## 10. Continuous architecture validation — evolution is rejected

Six properties — dependency correctness, bounded-context integrity, ownership consistency,
documentation synchronization, ADR compliance, API compatibility — each falsified by drift kinds the
existing detector already finds, so there is no second detector to keep in step with the first.

**Architectural evolution beyond a recorded baseline is REJECTED, not reported.**
`assertNoUndocumentedEvolution` throws fail-closed. A checker that logs undocumented evolution and
lets the build through documents the drift rather than preventing it.

A baseline must be recorded by a named human citing the decision that approved it — a baseline the
tool writes for itself is one that agrees with whatever it finds. No baseline is currently recorded,
so whether the architecture has evolved beyond what was approved is **unknown**, and undetectable
evolution is not absent evolution.

Read it at `GET /api/architecture/validation`, checked by `APP-FIT-ARCHITECTURE-VALIDATION`.

## 11. Production transition — planning artefacts only

Eight tracks: deployment readiness, accreditation, identity integration, operational monitoring,
disaster recovery, migration planning, operational support, change management. Each names its owner,
what only a named human can close, and what would be true if somebody mistook the plan for the act.

**Nothing here deploys anything and nothing here authorizes a deployment.** No state in the framework
is `ready`, `deploymentPermitted` is a constant `false`, and there is no `execute`, `cutover`,
`promote`, `deploy` or `goLive` — the **absence** of those functions is checked by a fitness function
rather than trusted. The platform remains synthetic-only.

Read it at `GET /api/migration/production-transition`, checked by `APP-FIT-PRODUCTION-TRANSITION`.

## HTTP surface

| Method | Route | Role |
|---|---|---|
| GET · POST | `/api/assurance/evidence-connectors` | admin |
| POST | `/api/assurance/evidence-connectors/{id}/verify` | admin |
| POST | `/api/assurance/evidence-connectors/{id}/sync` | admin |
| GET | `/api/governance/forecast-calibration` | admin |
| POST | `/api/governance/forecasts` | admin |
| POST | `/api/governance/forecasts/{id}/outcome` | admin |
| GET | `/api/twin/operations/calibration` | admin |
| GET | `/api/assurance/explainability` | oversight-board |
| GET | `/api/assurance/readiness-traceability` | oversight-board |
| GET | `/api/assurance/control-performance` | admin |
| GET | `/api/governance/exercise-maturity` | oversight-board |
| GET | `/api/governance/capability-maturity` | oversight-board |
| GET | `/api/legislation/legal-dependencies` | oversight-board |
| GET · POST | `/api/governance/validation-workshops` | oversight-board |
| GET | `/api/governance/workflow-validation` | oversight-board |
| GET | `/api/architecture/validation` | admin |
| POST | `/api/architecture/baseline` | admin |
| GET | `/api/executive/performance` | oversight-board |
| GET | `/api/governance/traceability-invariant` | oversight-board |
| GET | `/api/migration/production-transition` | admin |

Every one of these reports carries `authorizes: false`.

## Where it lives

- `src/assurance/institutional.js` — connectors, data classes, explainability, traceability, workshops, performance, the invariant
- `src/assurance/control-effectiveness.js` — the nine performance measures and their trends
- `src/architecture/drift-prevention.js` — forecast calibration and continuous architecture validation
- `src/twin2/operations-twin.js` — twin calibration
- `src/governance/rehearsals.js` — exercise intelligence
- `src/governance/ownership.js` — organizational capability maturity
- `src/governance/cross-agency.js` — cross-government workflow validation
- `src/legislation/legal-authority.js` — legal dependency intelligence
- `src/migration/roadmap.js` — production transition planning

Run the checks with `npm run assurance`, and the deterministic tests with `npm test`.
