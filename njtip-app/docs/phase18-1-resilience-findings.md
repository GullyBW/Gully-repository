# Phase 18.1 resilience findings

Recorded at Phase 18.1 close-out. Every figure here is produced by the platform's own controls, and
nothing in this document authorises anything or records a decision any board has taken. Where the
answer to a question is "nobody has recorded it", that is written down as such rather than filled in.

**Status of every remediation item below: OPEN.** No board has reviewed, accepted, scheduled or
rejected any of them. An acceptance nobody recorded is not an acceptance, and the
`ResilienceAcceptance` register remains empty for that reason.

---

## Part 1 — Constitutional capability violations

`evaluateGlobalInvariant()` reports 30 clause results across five critical capabilities:
**10 RESOLVED · 5 BROKEN · 15 UNKNOWN**. The invariant does not hold and blocks institutional
readiness, exactly as ADR-0009 requires. Nothing here weakens it.

Three of the five capabilities are constitutional: `anonymous-reporting`, `evidence-custody`,
`governance-decision-recording`. All five fail the same four clauses.

### What the dependency actually is

| Capability | Constitutional | Single dependencies | Unvalidated categories |
|---|---|---|---|
| `anonymous-reporting` | yes | person · service · knowledge | people · technology · knowledge |
| `evidence-custody` | yes | person · knowledge | people · knowledge |
| `governance-decision-recording` | yes | person · service · knowledge | people · technology · knowledge |
| `case-investigation` | no | person · service · knowledge · legal-authority | + legal-authority |
| `service-recovery` | no | person · knowledge · legal-authority | + legal-authority |

Answering §10's questions from the records rather than from assumption:

**Is it a person?** Partly, and less than the label suggests. The `person` dependency is a *role*,
not a named individual, and `successionPlan()` for each affected subsystem returns a chain of
**depth 3 terminating at a board** — `intake`, `custody` and `governance-oversight` all end at the
Oversight Board sitting as a body with quorum, via a named deputy. A succession chain that ends in a
person can end in nobody; these do not. The single-person reading of this finding is therefore too
pessimistic, and the control does not make that distinction because it counts roles.

**Is it a process, document, system, module or governance body?** The `service` dependency is
technology (`intake-api`, `persistence-ind`, `event-store-ind` for anonymous reporting). The
`knowledge` dependency is the one with no mitigation recorded anywhere: it is the fact that nothing
in the estate records who besides the current holder knows how each capability works.

**Is it genuinely a single point of failure?** For `knowledge`, on the evidence recorded, yes —
and it is the most serious of the three, because unlike a service it cannot be restored from a
backup. For `person`, it is a single *role* with a recorded three-deep succession. For `service`,
the platform's multi-region and recovery machinery exists but no capability declares more than one
service per function.

**What happens if it becomes unavailable?** For `anonymous-reporting`, the recorded loss is stated
in the capability itself: *"A person who decided today to report corruption cannot, and may not
decide again."* That is the sentence that makes this constitutional.

**Is there a recovery mechanism? Can an authorized alternative assume the function?** For the person
dependency, yes — the deputy and then the board. For knowledge and service, **nothing is recorded**,
which is UNKNOWN rather than "no".

**Is the dependency intentional and governed?** Unrecorded. No ADR states that any of these single
dependencies was accepted, and no acceptance exists in the register.

### The 15 UNKNOWN results are the larger finding

Three clauses — `unvalidated-assumption`, `undocumented-legal-authority`,
`ineffective-detecting-control` — report UNKNOWN for all five capabilities. That is not a failure of
the capabilities. It is the platform stating that nobody has recorded an assumption validation, a
legal instrument, or a control observation for any of them. **Absence of evidence is not evidence of
compliance**, and the invariant reports it as unknown rather than as satisfied.

### Remediation requirements — Part 1

| # | Requirement | Classification |
|---|---|---|
| R1 | Record, for each constitutional capability, whether its single `knowledge` dependency is accepted or is to be mitigated, and by whom. | GOVERNANCE_REVIEW_REQUIRED |
| R2 | Record a legal instrument for each capability, or record that none exists. Currently neither is recorded. | UNKNOWN |
| R3 | Record control observations so `ineffective-detecting-control` can report something other than unknown. | UNKNOWN |
| R4 | Record assumption validations, or record that the assumptions are unvalidated and accepted. | UNKNOWN |
| R5 | Decide whether a role-level single dependency with a three-deep succession chain terminating at a board should continue to count as a single point of organizational failure. | GOVERNANCE_REVIEW_REQUIRED |

R5 is a question about the control, not about the estate. It is recorded here rather than acted on,
because changing what the invariant counts is a governance decision and not an implementation detail.

---

## Part 2 — The ARB single-point dependency

`governanceCapabilityResilience()` reports **11 single-point dependencies** across the five Phase
18.1 governance capabilities: all five rest on a single accountable body (ARB), four on a single
implementing module, and two on a single governed document. None blocks the build; all five are
GOVERNANCE_REVIEW_REQUIRED, per ADR-0014.

Answering §11's questions from the records:

**What happens if ARB is unavailable?** Less than the raw finding implies. `successionPlan('assurance')`
returns a chain of depth 3: the board chair acting under delegated authority, then the **ARB
Vice-Chair** as named deputy, then **the Architecture Review Board sitting as a body, quorum
required**. It terminates at a board rather than at a person.

**Who can perform, authorize, record and verify the function?** The chain above, for all four. ARB's
recorded mandate is *"Architecture changes, ADR conformance; veto on invariant breach."*

**Is delegation permitted? Is succession defined?** Yes to both, and it is already machine-readable:
`DEPUTY_RULE` is *"Deputy <primary office>, unless an override records a different named deputy"*,
and ARB has a named override rather than relying on the default.

**Is recovery tested?** **No.** The exercise register records no exercise against ARB succession, and
`EXERCISE_KINDS` contains four kinds — `disaster-recovery`, `incident-escalation`, `evidence-custody`,
`emergency-authorization` — none of which is governance succession. So this is not merely untested;
there is currently no kind of exercise that *would* test it.

**Can another authorized governance body assume the function?** **Unrecorded.** ARB governs 8 of 30
subsystems. Five other boards exist (OB, ISRB, ORB, DGB, SDB). Nothing states whether any of them
may assume ARB's architectural mandate if ARB as a whole is unavailable, and inventing that here
would be recording a decision no board has taken.

### What this finding is, and is not

It is **not** an argument for creating a second architecture board. A second body with the same
mandate would be a governance structure created to satisfy a control, which is the failure mode the
control exists to prevent. §11 forbids it and this document does not propose it.

It **is** two concrete gaps: an exercise kind that does not exist, and a cross-board delegation
question nobody has answered.

### Remediation requirements — Part 2

| # | Requirement | Classification |
|---|---|---|
| R6 | Add a governance-succession exercise kind so that "ARB recovery has never been rehearsed" becomes a measurable gap rather than an unaskable question. | GOVERNANCE_REVIEW_REQUIRED |
| R7 | Record whether another board may assume ARB's mandate, or record that none may. Either answer closes the gap; the absence of both is what leaves it open. | UNKNOWN |
| R8 | Decide whether four governance capabilities resting on a single implementing module is acceptable. A small capability living in one place is normal, and no test can tell the difference. | GOVERNANCE_REVIEW_REQUIRED |
| R9 | Rehearse the ARB succession chain once R6 exists, and record the result. | GOVERNANCE_REVIEW_REQUIRED |

---

## What was deliberately not done

**No finding was downgraded, and no control was changed to remove one.** The temptation at close-out
is to make the dashboard green by adjusting what it counts. Every number above is the number the
platform reported before this document was written and after it.

**No acceptance was recorded on any capability's behalf.** The `ResilienceAcceptance` register takes
a named person or board and a rationale, and this platform records human statements rather than
making them.

**No new governance body, and no new bounded context.** Both are explicitly forbidden at this phase
without an architectural decision, and neither is warranted by these findings.
