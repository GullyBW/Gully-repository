# Phase 3 · WS6 — Enterprise Service Management (ESM)

**Operationalizes:** Observability `../design/06`, DevSecOps `../design/07`, Operational
Governance `../phase2/03`, OMT `../phase2/01` · **Traces:** NFRs, RK-06/13, D-06.

> ITIL-aligned operational support, adapted to the platform's non-negotiables: **zero standing
> privilege, three-zone isolation, and operator-in-threat-model**. Support staff run the service
> **without** standing access to sensitive data; every operational action is JIT, dual-controlled
> where sensitive, and audited. This is service operations, not architecture.

---

## 1. Service catalogue (representative)

| Service | Description | Zone | SLO tier |
|---------|-------------|------|----------|
| Confidential Reporting intake | Anonymous report submission | Independent | Tier-1 (safety-critical) |
| Case status / follow-up | Anonymous tracking | Independent | Tier-1 |
| Evidence & chain of custody | Integrity-protected evidence | Shared/zone | Tier-1 |
| Secure routing | CoI-aware delivery | Independent | Tier-1 |
| IAM | AuthN/authZ | Shared | Tier-1 |
| Investigator/Prosecutor/Court workspaces | Zone-O workflows | Exec/Judiciary | Tier-2 |
| Oversight/Transparency/Analytics | Aggregate insight | Independent | Tier-2 |
| Notifications/Messaging | Comms | Shared | Tier-2 |
| Public transparency site | Read-only aggregates | Public | Tier-3 |

## 2. ITIL practices (adapted)

| Practice | Design | Platform-specific control |
|----------|--------|---------------------------|
| **Incident management** | Detect→classify→respond→resolve→review; severity taxonomy | **Reporter-safety incidents = Sev-1** with dedicated runbook (`../phase2/12 §6`); IRB for high sev |
| **Problem management** | Root-cause of recurring incidents; known-error DB | Corrective actions tracked by IRB; feeds threat-model review (`03 A7`) |
| **Change management** | RFC→review→approve→deploy→verify; CAB = TSC/ARB/ISRB per class | 🔒 subsystem changes need ISRB sign-off; constitutional changes need OB super-majority |
| **Configuration management** | CMDB of services/assets/dependencies; IaC as source of truth | Per-zone config isolation; drift detection (`02`/policy engine) |
| **Knowledge management** | Runbooks, SOPs, known errors, decisions | Anchored decision log; runbooks versioned |
| **Capacity management** | Forecast + scale; load testing | Autoscale intake; abuse/flood handling (S-4/D-3) |
| **Availability management** | HA design, redundancy, degrade modes | Degrade-to-minimal-intake; DR (`../design/04 §5`) |
| **Service level management** | SLOs + error budgets + reporting | Tier-1 intake availability ≥ 99.9%; feeds Trust Index |

## 3. Service level objectives (seed — refine per service)

| SLO | Target (proposed `⟦validate⟧`) | Consequence of breach |
|-----|-------------------------------|-----------------------|
| Intake availability (Tier-1) | ≥ 99.9% | Error-budget freeze on risky deploys; incident |
| Routing latency P95 | ≤ target | Investigate; capacity review |
| Evidence integrity-check | 100% pass | Sev-1 (possible tamper) |
| DR restore | Within RTO/RPO | Disaster review |
| Security patch (Critical) | ≤ SLA | Vuln-mgmt escalation (`03 A5`) |

## 4. Operational access model (operator-in-threat-model)

- **Zero standing privilege**; all sensitive ops are **JIT + dual-control + session-recorded +
  audited** (`../design/04`, `../phase2/03`).
- Support tiers see **only** what their role+purpose permits (ABAC); L1 support has **no** access
  to report/case content or identity (there is none for reporters).
- **Break-glass** is time-boxed, dual-approved, loudly audited; auto-expires.

## 5. Runbooks (catalogue — details generated in build)

Sev-1 reporter de-anonymization (`../phase2/12 §6`) · zone-egress-violation · threshold-op ·
evidence-integrity-failure · DDoS/degrade · DR restore · key-rotation · break-glass ·
external-integration outage. Each: trigger, steps, owner, comms, audit points, closure.

## 6. Quality gate

- **Traces to:** NFRs, D-01/D-06; DDR-09/13; RK-06/13; `../phase2/01/03`.
- **Threats mitigated:** E-1/E-3 (least-privilege ops), T-2 (audited actions), D-1/D-4
  (availability/DR), S-4/D-3 (capacity/abuse).
- **Residual risks:** managed/outsourced SOC widens trust boundary (A-OPS-01 → JIT+dual-control+
  audit); alert fatigue.
- **Dependencies:** OMT/SecOps staffed (RK-18), observability + policy engine live, CMDB/IaC.
- **Trade-offs:** ⚠️ JIT/dual-control slows routine ops — accepted for insider-threat control.
- **Measurable outcomes:** SLOs instrumented + reported; 0 standing sensitive grants; every
  sensitive op audited; runbooks drilled; MTTR within target.
- **🔒 Required review:** ESM/ops lead, security (access model), procurement (managed-SOC vendor).

*Next: `07-operational-readiness.md`.*
