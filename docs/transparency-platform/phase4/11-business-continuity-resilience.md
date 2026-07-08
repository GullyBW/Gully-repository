# Phase 4 · 11 — Business Continuity & Organizational Resilience

**Extends:** DR/BCP `../design/04 §5`, Disaster workflow `../phase2/03 §8`, ESM `../phase3/06`.
**Focus:** the *organizational* resilience beyond technical DR — workforce, crisis comms, suppliers,
alternate operating procedures, exercises, and continuous improvement. Reporter safety and
governance continuity survive disruption.

---

## 1. Resilience objectives

Keep the **safety-critical intake available** (reporters can always file), keep **evidence and audit
integrity** intact, keep **governance functioning** (custodian succession), and keep
**communications honest** during any disruption — without weakening any security control under
pressure.

## 2. Workforce continuity

| Risk | Provision |
|------|-----------|
| Key-person loss (governance custodian, crypto, SecOps) | Cross-training, documented runbooks, **succession plans**, M-of-N so no one person is indispensable to safety |
| Staff unavailability (illness, unrest, disaster) | On-call depth, regional/remote redundancy (A-OPS-01) under operator-in-threat controls |
| Coercion of staff (RK-24) | Dual control + threshold so one coerced person cannot de-anonymize or case-fix; duress procedures; support |

## 3. Crisis communications

- **Pre-approved, honest communication templates** (breach, outage, compelled-access, incident) —
  reviewed by EC + legal; **no false reassurance** (RK-07).
- **Reporter-safety incidents:** communicate via **safe channels** to the affected class, never via
  identifying channels (`../phase2/12 §6`).
- **Warrant-canary** handling for compelled-access transparency where lawful.
- Single source of truth; spokesperson designated; Oversight Board informed.

## 4. Supplier / supply-chain resilience

- **No single-vendor dependency** on the critical path (portability, `06`); alternate providers
  identified for hosting, HSM support, and managed SOC.
- Vendor incidents handled under operator-in-threat controls (`../phase3/06 §4`); SBOM/provenance
  monitoring for upstream compromise (RK-12).
- Contractual continuity/exit terms (🔒 procurement).

## 5. Alternate operating procedures

- **Degrade-to-minimal-intake:** if downstream services fail, a minimal, isolated intake keeps
  accepting reports (queued, encrypted) so the safety-critical function survives (D-1/D-4).
- **Offline/manual fallbacks** for court/registry operations where digital services are down
  (Zone-O), with reconciliation on recovery.
- **Governance continuity:** custodian succession + offshore governance fallback against domestic
  disruption (RK-17).

## 6. Resilience exercises

| Exercise | Frequency | Scope |
|----------|-----------|-------|
| DR restore drill | Semi-annual | Per-zone RTO/RPO, key≠ciphertext |
| Disaster declaration tabletop | Annual | OB→OMT full flow (`../phase2/03 §8`) |
| De-anonymization incident tabletop | Pre-go-live + annual | Sev-1 runbook, safe-channel comms |
| Supplier-failure exercise | Annual | Failover to alternate provider |
| Governance-continuity exercise | Annual | Custodian succession, threshold with substitutes |

## 7. Continuous improvement

Every exercise and real incident yields a **PIR** (`../phase3/08 §6`) → corrective actions tracked
by IRB → threat-model refresh (`../phase3/03 A7`) → updated runbooks/plans. Resilience metrics feed
the Public Trust Index (security-posture, availability).

## 8. Quality gate

- **Traces to:** `../design/04 §5`, `../phase2/03 §8`, `../phase3/06`; RK-13/17/18/24; D-1/D-4.
- **Threats mitigated:** D-1/D-4 (availability), coercion (RK-24 via dual/threshold), governance
  disruption (RK-17).
- **Residual risks:** catastrophic multi-failure; sustained hostile-state disruption; supplier
  concentration in a small market.
- **Trade-offs:** ⚠️ redundancy + drills cost money and time — accepted; the intake must not go dark
  when it matters most.
- **Acceptance criteria:** degrade-to-minimal-intake verified; succession plans in place; all
  exercises scheduled and passed pre-go-live (feeds readiness G7/G8).
- **🔒 Required review:** ops/SRE, security, procurement (supplier terms), OB (governance continuity).

*Next: `12-independent-assurance-framework.md`.*
