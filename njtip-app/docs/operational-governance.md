# Operational Governance (Phase 10, Part 13)

RACI matrices, ownership validation, decision traceability, governance scorecards, escalation
workflows, control ownership and operational maturity — **computed from the ownership model** rather
than maintained as a parallel spreadsheet (`src/governance/raci.js`).

Gated by `APP-FIT-RACI-GOVERNANCE`. Live: `GET /api/governance/raci`.

> **No subsystem may approve itself.** Checked structurally: for every one of 10 governance
> activities across all 30 subsystems, the responsible authority is never the accountable approver.
> 300 resolved rows, verified on every build.

## Governance activities

| Activity | Accountable | Responsible | Evidence it must produce |
|---|---|---|---|
| Production deployment | approving authority | operational owner | Continuous assurance package + recorded governance decision |
| Architecture change | approving authority | responsible authority | ADR + green Twin gate + updated context map |
| Policy change | approving authority | operational owner | PAP publication record + formal policy proofs |
| Data exchange approval | **data steward** | operational owner | Purpose-limited agreement with a named approver |
| Incident response | responsible authority | operational owner | Incident record + recovery authorization |
| Recovery authorization | approving authority | operational owner | Named authorization with rationale |
| Risk acceptance | approving authority | responsible authority | Recorded acceptance with rationale |
| 🔒 Key custody | approving authority | operational owner | ISRB sign-off; keys never machine-generated |
| Legislative enactment | approving authority | responsible authority | Simulation report + enactment by a named authority |
| AI model approval | approving authority | responsible authority | Risk classification + explainability + approval record |

Roles resolve **per subsystem** through the [ownership model](./governance-ownership.md) — one matrix,
not thirty spreadsheets. Every activity is a human decision and names the evidence it produces.

## Control ownership

Every fitness function — twin, application and infrastructure — maps to an owning bounded context and
therefore to a responsible authority and a governance board. **Coverage is 100%**: a control nobody
owns fails the build, because an unowned control is one nobody will fix when it goes red.

## Escalation

```
custody / recovery-authorization
  1. Evidence Custody Team            detects and prepares the decision with its evidence
  2. Directorate of Forensic Services reviews and recommends
  3. Oversight Board                  decides — the accountable step
  4. Oversight Board                  informed; escalation terminal
```

## Governance scorecard and maturity

The scorecard is computed from the ownership model and the **live** fitness gate across ownership
completeness, architecture-of-record validity, separation of duties, control ownership, evidence
definition, human decision and controls holding. No value is hand-entered, and it reacts immediately
when a control fails.

| Level | Name | Requires |
|---|---|---|
| 1 | Ad hoc | Ownership exists somewhere, mostly in people's heads |
| 2 | Defined | Every subsystem has a named owner and approver recorded as data |
| 3 | Enforced | Separation of duties checked mechanically; escalation terminates at a board |
| 4 | Evidenced | Every governance activity names machine-verifiable evidence |
| 5 | **Continuously assured** | Governance state re-verified on every build; a failure blocks the build |

Maturity is the highest level whose requirement is **actually met**, not the highest aspired to —
level 5 requires a green gate, so a single failing control drops it.
