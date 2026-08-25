# User Validation Report — Round 1 (Stabilization Part 15)

Future refinement should be driven by **observed behaviour**, not architectural speculation. This
records the structure and the first round of evidence (`src/ux/usability-validation.js`).

Gated by `APP-FIT-USABILITY-VALIDATION`. Live: `GET /api/ux/validation`.

> **Synthetic round.** The observations below stand in for a real validation round with participating
> agencies — the *shape* is what a production round populates. Participants are **role-coded**
> (`P-INV-01`); the module refuses a participant name, contact detail or any other identifying field,
> exactly as the domain does.

## Representative roles engaged

| Role | Context | Their goal |
|---|---|---|
| Investigator | `investigation` | Work a case from queue to disposition without ever seeing a reporter identity |
| Auditor | `assurance` | Independently verify that what the platform claims happened, happened |
| Platform administrator | `composition` | Operate the platform safely: configuration, health, keys, readiness |
| Governance official | `governance-oversight` | Record a defensible decision with the evidence attached to it |
| Oversight board member | `governance-oversight` | See system-wide posture without seeing any individual case subject |
| Operational staff | `observability` | Detect, triage and recover from an incident within the objectives |

All six were observed; coverage is complete (a role with no session fails the fitness gate).

## Round 1 outcomes — 12 sessions, 10 tasks

| Task | Role | Observed | Completed | Assists | Median |
|---|---|---|---|---|---|
| Triage the queue | Investigator | 2 | 2 | 1 | 62 s |
| Complete a review | Investigator | 2 | 2 | 1 | 180 s |
| Attach evidence | Investigator | 1 | 1 | 0 | 90 s |
| Verify the evidence package | Auditor | 1 | 1 | 0 | 240 s |
| **Trace a decision to its evidence** | Auditor | 1 | **0** | 2 | — |
| Check readiness | Administrator | 1 | 1 | 0 | 75 s |
| Rotate configuration | Administrator | 1 | 1 | 0 | 55 s |
| Record a decision | Governance official | 1 | 1 | 0 | 95 s |
| Review posture | Oversight board | 1 | 1 | 1 | 140 s |
| Triage an incident | Operational staff | 1 | 1 | 1 | 210 s |

## Findings

| Severity | Finding | Context | Evidence |
|---|---|---|---|
| **blocker** | No participant could trace a governance decision back to its originating events unaided | `governance-oversight` | 0/1 completed, 2 assists |
| medium | Review completed only with assistance — unclear which lifecycle transitions are legal from the current state | `investigation` | 1 assist across 2 sessions |
| medium | Posture review completed only with assistance | `governance-oversight` | 1 assist |
| medium | Incident triage completed only with assistance | `observability` | 1 assist |
| low | Expected priority to be shown in the queue, not on the case | `investigation` | participant observation |
| low | Wanted the digest recomputation shown alongside the signature | `assurance` | participant observation |
| low | **Read the readiness score as an approval** until the wording was pointed out | `composition` | participant observation |
| low | Wanted the aggregate suppression rule stated on the dashboard itself | `governance-oversight` | participant observation |
| low | Strategy comparison was clear; the authorization step was not discoverable | `observability` | participant observation |

## What the evidence says — and what it does not

Two findings matter more than the rest, and neither is a UI polish item:

1. **Decision → evidence traceability is a blocker.** An auditor who cannot get from a recorded
   decision back to the events behind it cannot do the job the platform exists to support. The data is
   all there and hash-chained; the *path* is not. That is a product gap, not a data gap.
2. **"Readiness" was read as approval.** A participant treated a readiness score as authorization
   until the wording was pointed out. The platform is emphatic in code and prose that *evidence is not
   authorization* — and a user still misread it. That is the single most important usability finding
   here, because the failure mode is governance, not convenience.

Every finding cites its evidence and the bounded context that would have to change, so refinement is
traceable to observation. **Findings prioritise work; they do not authorize a design change** — that
remains a human product decision by the service owner and the Service Delivery Board.

## Next round

Recruit real participants per role through the responsible authorities in the
[ownership model](./governance-ownership.md); re-run the same task set so results are comparable;
and add tasks for the paths this round did not exercise (appeals, evidence lifecycle transitions,
data exchange requests).
