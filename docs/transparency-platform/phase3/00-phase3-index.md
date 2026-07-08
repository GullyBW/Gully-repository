# NJTIP — Phase 3: Governance Maturation, Operational Readiness & Production Delivery (Index)

**Status:** DRAFT — Phase 3 (produced; culminates at the **Production Go-Live Gate**, which
extends the Operational Readiness Gate `../phase2/05`). **Do not generate production code.**
**Authoritative, immutable inputs:** Discovery `../01`–`../11`, Ratified `../12`, Design
`../design/*`, Phase 2 `../phase2/*`. **Last updated:** 2026-07-07

> Phase 3 turns the approved programme into a **production-ready national delivery**: mature
> governance (charters + RACI), a data-governance framework, a continuous security-assurance
> programme, an enterprise test strategy, national change management, enterprise service
> management, formal operational-readiness scoring, and production-deployment governance. It
> **operationalizes**; it does not redesign. Every section obeys the Quality Gates (residual
> risks · dependencies · measurable outcomes · architecture + governance references · required
> human review · trade-offs) and keeps 🔒 human-review topics flagged.

## Documents (8 workstreams)

| WS | File | Scope |
|----|------|-------|
| 1 | [Governance Maturation](./01-governance-maturation.md) | Charters, mandate, membership, appointment, terms, voting, quorum, escalation, cadence + full RACI |
| 2 | [Data Governance Framework](./02-data-governance-framework.md) | Ownership model, data lifecycle per class, lineage, quality controls |
| 3 | [Security Validation Programme](./03-security-validation-programme.md) | Pen test, red/blue/purple, vuln mgmt, supply-chain, threat-model & crypto reviews, DR testing |
| 4 | [Enterprise Test Strategy](./04-enterprise-test-strategy.md) | Unit→UAT incl. privacy/governance/DR testing; entry/exit criteria |
| 5 | [Change Management](./05-change-management.md) | National adoption: engagement, comms, training, readiness, metrics, resistance, sponsorship, waves |
| 6 | [Enterprise Service Management](./06-enterprise-service-management.md) | Service catalogue, incident/problem/change/config/knowledge/capacity/availability, SLOs, runbooks |
| 7 | [Operational Readiness](./07-operational-readiness.md) | Readiness assessments + scorecard + GREEN/AMBER/RED thresholds |
| 8 | [Production Deployment Governance](./08-production-deployment-governance.md) | Go-live/rollback criteria, release approvals, emergency, monitoring, hypercare, PIR |

## Phase 3 invariants (inherited, non-negotiable)

Constitutional Architecture (3 zones, D-06) · operator-in-threat-model (D-01) · technical
inability to de-anonymize (D-02) · AI never decides (D-09) · MVP-first (D-05) · integrate-not-
replace (D-07) · zero trust · data minimization · auditability. Nothing in Phase 3 may weaken
these; readiness scoring explicitly checks them.

## Traceability rule (no orphans)

Every Phase-3 recommendation maps to: **Stakeholder need (`../03`) · Requirement (`../phase2/04`)
· Assumption (`../01`) · Threat (`../08`) · Risk (`../10`) · DDR (`../design`) · Architecture
component (`../06`/`../design`) · Governance control (`../phase2/01-03`) · Operational process
(this phase).** Each document's quality gate lists its trace set; the readiness scorecard (`07`)
is the roll-up.

## 🔒 Standing human-review topics (never finalized by AI)

Constitutional interpretation · judicial procedure · evidence admissibility · cross-border legal
· key-custody policy · privacy regulation · institutional governance · procurement · funding
approval. Flagged inline per section with the required reviewer.

## Where Phase 3 stops

At the **Production Go-Live Gate** (`08`), which requires the Operational Readiness scorecard
(`07`) to be **GREEN** across all domains **and** the Operational Readiness Gate (`../phase2/05`)
satisfied, with Oversight Board sign-off. Build/validation on **synthetic data** proceeds; **no
production data flows until the gate passes.**

*Read `01`→`08`; the go-live gate in `08` is the operative pause.*
