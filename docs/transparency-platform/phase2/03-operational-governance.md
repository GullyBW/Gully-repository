# Phase 2 · 03 — Operational Governance Workflows

**Implements:** D-01, D-06, governance bodies (`01`), policy engine (`02`) · **Inputs:** Risk
`../10`, Stakeholders `../03`, Security `../design/04`.

> The executable workflows that run the platform's integrity day-to-day. Each is defined as a
> **state machine with owners, controls, audit points, and SLAs**, wired to the governance bodies
> (`01`) and enforced via the policy engine (`02`). 🔒 Several touch legal/institutional matters
> and are flagged for specialist validation.

---

## 1. Conflict-of-Interest (CoI) management
- **Trigger:** a report/case touches an institution or person connected to a governance member,
  operator, or authorized recipient.
- **Flow:** declare → system flags → **mandatory recusal** of conflicted party → **re-route** to
  an unconflicted authorized recipient (signed directory) → audit.
- **Controls:** CoI register per member/operator; routing engine refuses to assign a conflicted
  recipient (mitigates T-4, P7); recusals audited (DDR-13).
- **SLA/metric:** 100% of flagged conflicts recused; CoI-trend feeds Justice Analytics (`10`).
- 🔒 Governance/legal review of recusal thresholds.

## 2. Appeals
- **Scope:** appeals against a platform decision (e.g., a report classification, an access denial,
  an analytics correction) — **not** judicial appeals (those belong to the courts; the platform
  only routes/records them where a court is the owner).
- **Flow:** lodge appeal → independent reviewer (not the original decider, SoD) → decision +
  reasons → record → escalate to EC/OB if systemic.
- **Controls:** decisions explainable and logged; appellant informed; no AI final decision (D-09).
- **Metric:** appeal turnaround; overturn rate (Trust Index: procedural fairness).
- 🔒 Judicial-procedure boundary: appeals affecting court matters require judicial validation.

## 3. Transparency reporting
- **Cadence:** published transparency reports on a fixed schedule (e.g., quarterly) — intake
  volumes, responsiveness, uptime, incidents (non-attributable), audit completion, governance
  activity.
- **Controls:** all figures are **verified aggregates** through the disclosure-control gate
  (`10`); governance signs off each release; **warrant-canary** status included where lawful.
- **Metric:** cadence adherence (Trust Index: transparency).
- 🔒 Legal review of each release (defamation/sub judice/open-justice, A-JUS-04, A-LEG-06).

## 4. Whistleblower / reporter protection (operational)
- **Standing controls:** operator-in-threat-model, technical inability to de-anonymize (D-01/D-02),
  metadata-resistant intake (DDR-11), honest risk UX (U-1).
- **Operational duties:** monitor for de-anonymization indicators; a **top-severity runbook**
  (`../design/04 §5`) for any suspected reporter-safety incident (contain → assess reach →
  safe-channel notify affected class → governance disclosure → post-mortem).
- **Retaliation signals:** if patterns suggest retaliation, escalate to OB → external (Ombudsman/
  oversight) — the platform cannot itself protect a person physically, only route and warn.
- 🔒 Legal review: whistleblower-protection statute reach (A-LEG-02, RK-10).

## 5. Policy exceptions
- **Flow:** request (reason-coded) → dual approval by the accountable body (`01`) → **time-boxed,
  auto-expiring** grant → loud audit → mandatory review at expiry.
- **Hard limit:** exceptions **cannot** weaken a constitutional invariant (zone isolation, key
  custody) — those need OB super-majority policy change, never an exception (`02 §5`).
- **Metric:** open-exception count/age (Trust Index: security posture).

## 6. Audit scheduling
- **Internal:** continuous automated control checks (`02 §6`) + scheduled internal audits.
- **Independent/external:** scheduled independent security, privacy, and governance audits
  (annual + event-driven); findings tracked to closure by IRB; results feed Trust Index
  (independence component).
- **Controls:** auditors have independent, read-only, tamper-evident access (DDR-13); SoD (log
  admin ≠ system admin).
- 🔒 Procurement of independent auditors is a human governance/procurement decision.

## 7. Emergency response
- **Flow:** detect (SIEM/SecOps) → classify severity → invoke IR runbook → OMT executes, IRB
  convened for high severity → OB informed → corrective actions tracked.
- **Break-glass:** emergency privileged access is JIT + dual-control + session-recorded +
  auto-audited (`../design/07 §3`); expires automatically.
- **Metric:** MTTR, incident count/severity (Trust Index: security posture).

## 8. Disaster declaration
- **Flow:** OMT/ISRB recommend → **OB declares disaster** → invoke DR/BCP (`../design/04 §5`) →
  degrade to **minimal intake mode** if needed (reporters can still file) → governance-continuity
  plan (custodian succession) → public communication (honest, non-alarming) → stand-down + review.
- **Controls:** ciphertext-only offshore DR; key shares never co-located; tested restore drills.
- **Metric:** RTO/RPO met in drills and in real events.
- 🔒 Cross-border aspects (offshore failover) need legal review (A-LEG-08).

## 9. Workflow → governance-body → control map

| Workflow | Accountable body | Key control | Primary threat/risk |
|----------|------------------|-------------|---------------------|
| CoI | OB/OMT | Recusal + signed routing | T-4, P7 |
| Appeals | EC/OB | SoD reviewer, no AI decision | P9, D-09 |
| Transparency reporting | OB + PRB | Disclosure control | I-8, R-1 |
| Reporter protection | OB + OMT | De-anon runbook | RK-01, RK-24 |
| Policy exceptions | Accountable body (dual) | Time-box + audit | RK-06 |
| Audit scheduling | ISRB/PRB/OB | Independent read | RK-03, T-2 |
| Emergency response | IRB/OMT | IR runbook, break-glass | RK-06, RK-13 |
| Disaster declaration | OB | DR/BCP | RK-13, RK-17 |

## 10. Quality gate

- **Traces to:** D-01, D-06; DDR-11/13; RK-01/03/06/10/13/17/24.
- **Threats mitigated:** T-4, T-2, I-8, R-1, E-1/E-3, DT-1.
- **Residual risks:** physical retaliation (RK-24) and governance capture (RK-03) — mitigated,
  not removed; statute-reach uncertainty (RK-10).
- **Trade-offs:** ⚠️ dual-control/recusal/threshold add latency to operations — accepted.
- **Success criteria:** every workflow has an owner, audit trail, and SLA metric; break-glass
  always dual-controlled + recorded; disaster drill meets RTO/RPO; 100% conflicts recused.
- **🔒 Required review:** governance + legal (CoI thresholds, whistleblower statute, transparency
  legality), judicial (appeals boundary), procurement (auditor selection).

*Next: `04-traceability-matrix.md`.*
