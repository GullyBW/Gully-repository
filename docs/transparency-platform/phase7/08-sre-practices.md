# Phase 7 · WS8 — Site Reliability Engineering (SRE) Practices

**Traces:** ESM `../phase3/06`, Security IR/DR `../design/04 §5`, BCP `../phase4/11`, Observability
`07`. **Purpose:** the operational engineering discipline that keeps NJTIP reliable **without**
weakening the operator-in-threat-model controls — SRE operates under **zero standing privilege** just
like everyone else.

---

## 1. SRE practices

| Practice | Design | NJTIP constraint |
|----------|--------|------------------|
| **Incident response** | Sev taxonomy; detect→respond→resolve→review | **Reporter-safety = Sev-1** (runbook `../phase2/12 §6`); IRB for high sev |
| **On-call** | Rotations, escalation, runbooks | On-call has **no standing access to sensitive data**; JIT + dual control for sensitive actions |
| **Post-incident review (PIR)** | Blameless; root cause; corrective actions | Feeds IRB + threat-model refresh (`../phase3/03 A7`) |
| **Capacity planning** | Forecast + load test | Intake Tier-1 scales independently; abuse/flood handling (S-4/D-3) |
| **Resilience engineering** | Redundancy, graceful degradation, chaos (`06`) | Degrade-to-minimal-intake preserves the safety function |
| **DR validation** | Scheduled drills; RTO/RPO | Ciphertext-only offshore; **key≠ciphertext**; per-zone |
| **Operational runbooks** | Versioned, drilled | Break-glass JIT+dual-control+recorded |

## 2. Zero-standing-privilege operations (the hard part)

**[FACT]** The people keeping NJTIP up are inside the threat model (D-01). So SRE runs with **zero
standing privilege**: routine ops need no sensitive-data access; sensitive actions are **JIT,
dual-authorized, time-boxed, session-recorded, and audited** (`../design/04`, `../phase3/06`).
Break-glass exists but is loud, rare, and retrospectively reviewed by the IRB. ⚠️ This makes some ops
slower than a "root can fix anything" model — accepted, because a coerced or compromised operator must
not be able to de-anonymize.

## 3. Incident severity & the safety exception

| Sev | Definition | Response |
|-----|-----------|----------|
| **Sev-1** | Reporter-safety / de-anonymization / constitutional-invariant breach | Immediate; IRB; safe-channel notify; consider halt/rollback |
| Sev-2 | Major availability/integrity | On-call + escalation; rollback if needed |
| Sev-3/4 | Degraded/minor | Standard queue |

**[REC]** Reporter-safety incidents **always** top severity regardless of system footprint — a small
metadata leak that could identify one reporter outranks a large availability blip.

## 4. Reliability targets

SLOs (`07`, `../phase3/06`): intake availability Tier-1 (safety), routing latency, evidence integrity
100%, DR within RTO/RPO. Error budgets gate risky deploys; a burned budget freezes non-critical
change.

## 5. Quality gate

- **Traces to:** `../phase3/06`, `../design/04 §5`, `../phase4/11`, `07`; D-01; RK-06/13/24.
- **Preserves:** zero standing privilege; operator-in-threat-model; safety-first severity.
- **Threats mitigated:** E-1/E-3 (least-privilege ops), coercion (RK-24 via dual/threshold), D-1/D-4.
- **Residual risks:** managed/outsourced on-call widens trust boundary (A-OPS-01 → same JIT/dual/audit
  controls); alert fatigue.
- **Trade-offs:** ⚠️ zero-standing-privilege ops are slower than root-access ops — accepted for
  insider-threat control.
- **Acceptance criteria:** SRE runs with 0 standing sensitive grants; reporter-safety = Sev-1;
  break-glass dual-controlled + recorded; DR drills meet RTO/RPO; PIRs feed improvement.
- **🔒 Required review:** SRE lead, ISRB (access model), IRB (severity + PIR).

*Next: `09-engineering-metrics.md`.*
