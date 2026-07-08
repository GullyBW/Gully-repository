# NJTIP — Phase 2: Governance & Implementation Blueprint (Index)

**Status:** DRAFT — Phase 2 (produced; culminates at the **Operational Readiness Gate**, after
which no implementation may proceed until satisfied).
**Authoritative inputs (do not redesign):** Discovery `../01`–`../11`, Ratified Decisions `../12`,
Design `../design/01`–`../design/07`.
**Last updated:** 2026-07-07

> Phase 2 **operationalizes** the approved architecture — it does not redesign it. It turns the
> reference architecture and ratified decisions into an executable governance subsystem, a fully
> traceable requirement set, a phased programme, and implementation-ready work items — then stops
> at a formal readiness gate. Every deliverable obeys the Quality Gates (references to
> assumptions/DDRs/threats/risks, trade-offs, residual risks, required specialist review,
> measurable acceptance criteria) and keeps the standing `🔒 HUMAN-REVIEW-REQUIRED` topics
> flagged.

## Documents

| # | File | Brief section |
|---|------|---------------|
| 01 | [Governance System](./01-governance-system.md) | Governance as a System — 8 bodies, decision rights, escalation, quorum, cadence |
| 02 | [Policy Engine (policy-as-code)](./02-policy-engine.md) | Policy Engine — lifecycle, versioning, enforcement, rollback, compliance monitoring |
| 03 | [Operational Governance](./03-operational-governance.md) | CoI, appeals, transparency reporting, whistleblower protection, audit scheduling, exceptions, emergency response, disaster declarations |
| 04 | [Requirements Traceability Matrix](./04-traceability-matrix.md) | Traceability — Need→Req→Assumption→Threat→Risk→DDR→Component→Task→Test→Metric |
| 05 | [Operational Readiness Gate](./05-operational-readiness-gate.md) | The formal pre-implementation gate (10 criteria) |
| 06 | [Implementation Roadmap](./06-implementation-roadmap.md) | Phases 0–6: objectives, scope, deps, risks, deliverables, staffing, budget (BWP), exit criteria |
| 07 | [Interoperability Framework](./07-interoperability-framework.md) | API/event standards, identity federation, versioning, schema governance, onboarding |
| 08 | [Digital Chain-of-Custody Procedures](./08-chain-of-custody-procedures.md) | Operational SOPs: ingest→verify→hash→timestamp→retain→archive→delete→audit |
| 09 | [Public Trust Index](./09-public-trust-index.md) | Indicators, data sources, calculation, publication, governance, privacy |
| 10 | [Justice Analytics](./10-justice-analytics.md) | Privacy-preserving analytics; disclosure control; purpose limitation |
| 11 | [GitHub Work Items (MVP)](./11-github-work-items.md) | Epics/Features/Stories/Tasks with full metadata (Phase 0/1/2) |
| 12 | [Representative Implementation Artifacts](./12-implementation-artifacts.md) | Sample OpenAPI, event catalog, schema/migration, IaC, CI/CD, runbook, test plan |

## Phase 2 invariants (inherited, non-negotiable)

Constitutional Architecture (3 zones, D-06) · operator-in-threat-model (D-01) · technical
inability to de-anonymize (D-02) · AI never decides (D-09) · MVP-first (D-05) · integrate not
replace (D-07) · zero trust · data minimization · auditability. Any Phase-2 artifact that would
weaken these is rejected by definition.

## 🔒 Standing human-review topics (never finalized by AI)

Constitutional interpretation · legislation · judicial procedure · evidentiary admissibility ·
cross-border legal matters · cryptographic key-custody policy · privacy regulation · institutional
governance · procurement · funding approvals. Each Phase-2 section that touches these is marked
`🔒` and names the required reviewer. **Producing a plan for these is allowed; finalizing or
enacting them is not — that is a human decision.**

## Where Phase 2 stops

At the **Operational Readiness Gate** (`05`). Work items (`11`) and artifacts (`12`) are produced
as *planning outputs*; **their execution is blocked until the gate is satisfied.** After the gate,
delivery proceeds phase-by-phase per the roadmap (`06`), MVP slice first (D-05).

*Read `01`→`12`; the readiness gate in `05` is the operative pause.*
