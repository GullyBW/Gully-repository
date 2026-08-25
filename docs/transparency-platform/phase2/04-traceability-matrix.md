# Phase 2 · 04 — Requirements Traceability Matrix (RTM)

**Implements:** the Traceability mandate · **Inputs:** all Discovery + Design + Ratified artifacts.

> The RTM is the **golden thread**: every requirement is traceable
> **Need → Requirement → Assumption → Threat → Risk → DDR → Component → Task → Test → Metric**.
> It is the audit backbone — an independent reviewer can pick any row and follow it end-to-end.
> Below is the MVP-scope RTM (D-05); the same schema is maintained for all later requirements as
> they enter scope. Requirement IDs are stable (`FR/NFR/SR/PR-###`).

---

## 1. RTM schema (columns)

`ReqID · Stakeholder Need (`../03`) · Requirement · Assumption (`../01`) · Threat (`../08`) ·
Risk (`../10`) · DDR (`../design`) · Component (`../06`/`../design`) · Impl Task (`11`) ·
Acceptance Test · Operational Metric (`09`)`

## 2. MVP Requirements Traceability (representative, complete for the MVP slice)

| ReqID | Need | Requirement | Assump. | Threat | Risk | DDR | Component | Task | Acceptance test | Metric |
|-------|------|-------------|---------|--------|------|-----|-----------|------|-----------------|--------|
| **FR-001** | Citizen: report safely & anonymously | System accepts a report with **no reporter identity collected** | A-ORG-01 | ID-1, I-1 | RK-01 | DDR-05, DDR-10 | Confidential Reporting | EP2-S1 | No C0 identity field exists (schema+CI); report submits without identity | De-anon incidents = 0 |
| **FR-002** | Citizen: know it wasn't intercepted | Report content **E2E-encrypted**; server sees ciphertext | — | T-1, I-4 | RK-01 | DDR-10 | Reporting, KMS | EP2-S3, EP1-S5 | Server store contains only ciphertext (inspection) | Integrity-check pass = 100% |
| **FR-003** | Citizen: not detected using it | **Metadata-resistant intake**; no IP logged | A-TEC-04 | I-2, ID-2, DT-1 | RK-02 | DDR-11 | Intake enclave | EP2-S2 | Traffic inspection shows no IP retention; onion reachable | IP records = 0 |
| **FR-004** | Citizen: understand the real risks | **Honest, layered, Setswana/English risk notice** pre-submission | A-ORG-03 | U-1, U-2 | RK-07 | DDR-03 | PWA (safety UX) | EP2-S4 | Comprehension test ≥ bar with target users; key points unskippable | Comprehension score |
| **FR-005** | Citizen: draft offline | **Offline drafting**, locally encrypted, panic-wipe | A-TEC-02 | DT-1 | RK-21 | DDR-03 | PWA | EP2-S5 | Draft works offline over 2G; panic-wipe clears local data | Offline-success rate |
| **FR-006** | Citizen: follow up anonymously | **Anonymous case code**; secure follow-up thread | — | S-2 | RK-01 | DDR-09 | Reporting, Secure Msg | EP2-S6 | Status retrievable by code with no identifier; capture-resistant | Follow-up usage |
| **FR-007** | Investigator: receive without self-review | **CoI-aware routing** to authorized recipient | A-JUS-01 | T-4 | RK-06 | DDR-08 | Governance routing | EP2-S7 | Conflicted recipient cannot be assigned (test); routing signed | % conflicts recused |
| **FR-008** | System: prove evidence integrity | **Digital Chain of Custody** (hash+timestamp+ledger) | A-LEG-05 | T-1, T-2, T-5 | RK-08 | DDR-06 | Evidence | EP1-S8 | Custody reconstructable; tamper detectable; anchored | Integrity pass = 100% |
| **FR-009** | Recipient: not a black hole | **Delivery receipt + responsiveness metric** (non-attributable) | A-GOV-04 | R-1 | RK-04 | DDR-13, DDR-14 | Oversight/Analytics | EP1-S9 | Signed receipt recorded; latency metric published aggregate | Intake→action latency |
| **NFR-001** | All: it's available when needed | Intake availability **≥ 99.9%**; degrade-to-minimal-intake | — | D-1, D-4 | RK-13 | DDR-02 | Platform/DR | EP1-S10 | Chaos test: intake survives downstream loss | Uptime SLO |
| **NFR-002** | All: recover from disaster | Tested **RTO/RPO**; per-zone DR; keys ≠ ciphertext co-location | A-TEC-03 | D-1 | RK-13 | DDR-02 | DR Platform | EP1-S11 | DR drill meets RTO/RPO | RTO/RPO met |
| **SR-001** | Operator not trusted with identity | **Threshold (M-of-N)** for any de-anon-capable op | A-GOV-01 | E-1, I-1 | RK-01, RK-06 | DDR-10 | KMS/HSM, Governance | EP1-S6 | Op requires M distinct custodians (test) | Threshold-only = 100% |
| **SR-002** | No standing admin power | **Zero standing privilege**; JIT + dual control | A-OPS-01 | E-1, E-3 | RK-06 | DDR-09 | IAM | EP1-S4 | 0 standing sensitive grants in prod (audit) | Standing grants = 0 |
| **SR-003** | Phishing-resistant auth | **FIDO2/WebAuthn** for all privileged roles | — | S-3, S-5 | RK-06 | DDR-09 | IAM | EP1-S3 | Non-FIDO2 auth rejected for privileged scopes | Phishing incidents |
| **SR-004** | Detect insider abuse | **Tamper-evident anchored audit** + SIEM | — | T-2, R-2 | RK-06 | DDR-13 | Audit, SecOps | EP1-S7 | Audit chain verifies + anchors; SIEM alerts on privileged access | Audit anchor cadence |
| **SR-005** | Zones cannot bleed | **No cross-zone DB path**; audited API only | A-JUS-03 | I-6, E-3 | RK-09 | DDR-01, DDR-04, DDR-07 | All zones | EP1-S2 | CI invariant test: 0 cross-zone DB connections | Invariant tests pass |
| **PR-001** | Minimal data held | **Per-field policy** + minimization + crypto-erase | — | DD-1, ID-1 | RK-01, RK-22 | DDR-05 | Data layer | EP1-S12 | Every column has field_policy (CI); crypto-erase verified | Fields w/o policy = 0 |
| **PR-002** | Supply chain trustworthy | **SLSA provenance + SBOM + reproducible build**; published fingerprint | — | T-3, S-1 | RK-12 | DDR-15 | DevSecOps | EP1-S13 | Independent rebuild matches fingerprint; SBOM diffed | Build reproducibility |

*(FR = functional, NFR = non-functional, SR = security, PR = privacy. Task IDs map to `11`.)*

## 3. Coverage assertions (how we know nothing is orphaned)

- **Every Critical/High risk** in `../10` has ≥1 requirement mitigating it: RK-01→FR-001/002/
  SR-001/PR-001; RK-02→FR-003; RK-03→governance (`01`); RK-04→FR-009; RK-06→SR-001..004; RK-07→
  FR-004; RK-08→FR-008; RK-09→SR-005; RK-12→PR-002; RK-13→NFR-001/002.
- **Every MVP component** (`../design/01 §7`) has ≥1 requirement + task.
- **Every 🔒 subsystem** requirement carries a specialist-review flag (below).

## 4. Maintenance & tooling

- The RTM is a **living, machine-checkable artifact** (proposed: a CSV/DB in-repo + CI check that
  every open requirement has non-empty Threat, Risk, DDR, Task, Test, Metric cells).
- **New requirements** cannot be marked ready without a full row (definition-of-ready).
- **Change control:** editing a requirement re-validates its downstream Task/Test/Metric;
  removing a mitigation without an approved risk acceptance is blocked.

## 5. Quality gate

- **Traces to:** all approved artifacts by construction.
- **Threats/risks:** every MVP requirement maps to ≥1 STRIDE/LINDDUN threat and ≥1 risk.
- **Residual risks:** RTM completeness depends on discipline — mitigated by the CI definition-of-
  ready check.
- **Trade-offs:** ⚠️ RTM upkeep is overhead; justified by audit defensibility and safety.
- **Success criteria:** 100% of in-scope requirements have complete rows (CI-enforced); every
  Critical/High risk has traced mitigation; independent auditor can trace any row end-to-end.
- **🔒 Required review:** independent architecture/audit review (traceability completeness);
  legal/privacy for FR-001..004, FR-008, PR-001.

*Next: `05-operational-readiness-gate.md`.*
