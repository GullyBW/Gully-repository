# R9 — ARB succession rehearsal: readiness package

> **This exercise is not a production authorization event.** No real administrative authority
> is issued, altered or revoked by it; no live governance permission changes; no real case data
> is touched; nothing outside this platform is triggered.

Generated deterministically from the exercise definition and the readiness gate. Every name is
a ROLE from the accountability record — the humans who hold them are named by the institution
when the exercise is scheduled.

| Field | Value |
|---|---|
| Exercise identifier | `R9-ARB-SUCCESSION-001` |
| Exercise class | **REHEARSAL** — Real people walk the procedure without real authority moving. This is what R9 is. |
| Governance body | Architecture Review Board |
| Primary authority | Architecture Review Board |
| Successor | ARB Vice-Chair |
| Evaluator | Auditor General (holds no role in the exercise) |
| Participants | ARB Vice-Chair · Architecture Review Board · Office of the Chief Architect |
| Accountable for the exercise | Oversight Board |
| Accountable for the assessment | Oversight Board |
| Status | **AWAITING_GOVERNANCE_APPROVAL** |
| Readiness | **NOT_READY** |

## Scenario

The ARB chair becomes unavailable without notice during an open architecture decision window, with an ADR awaiting approval and an invariant breach under review.

## Objectives

- Establish whether the recorded succession chain can actually be walked by the people named in it.
- Establish whether authority transfer is recognised by the parties who must act on it.
- Establish whether the interregnum can be closed cleanly, rather than an acting holder keeping the office by inertia.
- Produce evidence a governance body can assess, rather than a report that asserts success.

## Success criteria

- The successor was identified from the recorded chain without reference to anyone outside it.
- The successor could establish their authority to the parties who needed to act on it.
- A quorate decision was reached under succession.
- The critical capability continued through the interregnum.
- Authority returned to the primary and the acting arrangement was formally closed, as two recorded events.

## Failure criteria

- The successor could not be reached or declined.
- No quorum could be formed.
- A party refused to recognise the transferred authority.
- The interregnum could not be formally closed.
- The evaluator could not determine from the evidence whether the exercise succeeded.

## Expected event sequence

The approved order for **this** exercise, drawn from the declared vocabulary. Invalid ordering
fails closed.

```
authority-unavailable
    ↓
succession-initiated
    ↓
successor-identified
    ↓
credentials-verified
    ↓
governance-conditions-evaluated
    ↓
quorum-reached
    ↓
successor-assumed-authority
    ↓
capability-continued
    ↓
authority-returned
    ↓
interregnum-closed
```

## Evidence requirements

- participant role and the office they stood in for each event
- logical timestamp per event, from the exercise clock
- the decision taken under succession and who took it
- evaluator observations and any deviation from the expected sequence
- any failure mode encountered, from the declared vocabulary

## Safety boundaries

| Boundary | Declared | Means |
|---|---|---|
| `no-production-authority-change` | yes | No real administrative authority is issued, altered or revoked. |
| `no-live-permission-change` | yes | No governance permission in the running system is modified. |
| `no-real-case-data` | yes | No real case record is read, written or referenced. |
| `no-government-action` | yes | Nothing outside this platform is triggered. |
| `evidence-marked-synthetic-or-rehearsal` | yes | Every record produced states which class of exercise made it. |

## Readiness gate

17 of 18 prerequisite(s) satisfied; 1 critical broken, 0 critical unknown.

| Prerequisite | State | Detail |
|---|---|---|
| `governanceBodyDefined` | satisfied | 'Architecture Review Board' |
| `primaryAuthorityIdentified` | satisfied | 'Architecture Review Board' is the primary in the accountability record |
| `successorIdentified` | satisfied | 'ARB Vice-Chair' appears in the succession chain |
| `successionProcedureExists` | satisfied | 3-deep chain terminating at a body |
| `scenarioDefined` | satisfied | a scenario is stated |
| `objectivesDefined` | satisfied | 4 objective(s) |
| `successCriteriaDefined` | satisfied | 5 success criterion(s) |
| `failureCriteriaDefined` | satisfied | 5 failure criterion(s) |
| `evaluatorIdentified` | satisfied | 'Auditor General' |
| `evaluatorIndependent` | satisfied | 'Auditor General' takes no part in the exercise |
| `participantsIdentified` | satisfied | 3 participant(s) |
| `evidenceCollectionEnabled` | satisfied | a succession exercise register was supplied |
| `evidenceVocabularyValid` | satisfied | 10 event(s), all declared and in a possible order |
| `deterministicClockAvailable` | satisfied | the register carries an injected clock |
| `governanceApprovalRecorded` | BROKEN | no governance body has approved this exercise taking place |
| `humanAccountabilityDefined` | satisfied | exercise: 'Oversight Board'; assessment: 'Oversight Board' |
| `exerciseBoundariesDeclared` | satisfied | 5 of 5 boundaries declared |
| `noProductionAuthorityChange` | satisfied | classified as a rehearsal: real people, no real authority moving |

### Blocking

**NOT_READY.** Blocked on: governanceApprovalRecorded.

No governance body has approved this exercise taking place. That approval is a human
governance act and this platform records one — it does not make one. Until it is recorded, the
gate reports NOT_READY, and it is correct to.

## Human accountability

```
automated evidence → automated validation → automated verification result
    → HUMAN ASSESSMENT → INSTITUTIONAL DECISION
```

The software may report `AUTOMATED_EVIDENCE_READY` and `VERIFICATION_CRITERIA_PASSED`. It has no
path to `INSTITUTIONALLY_RESILIENT` or `INSTITUTIONALLY_READY`, and READY on this gate is a
statement about preparation rather than permission.

## Known limitations

- **Institutional assurance is OPEN.** No real rehearsal has occurred. Software assurance and
  exercise assurance are established; the third is not, and is not implied by the first two.
- **Context granularity.** Succession resilience is currently evaluated against the existing
  assurance chain at coarse context granularity: all five governance capabilities resolve to the
  `assurance` subsystem, so they share one succession chain. This does **not** block R9 — R9
  exercises the ARB chain specifically, which is that chain — and is recorded as technical debt.
- **Role-level naming.** The definition names offices, not people. Substituting real names is
  part of scheduling the exercise and is not something this platform does.
- The register holds nothing between runs, so evidence from a real rehearsal must be recorded
  into a durable store that does not yet exist. That is the first engineering task if R9 is approved.

