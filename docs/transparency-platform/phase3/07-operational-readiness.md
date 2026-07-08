# Phase 3 · WS7 — Operational Readiness Assessment & Scorecard

**Operationalizes:** Operational Readiness Gate `../phase2/05` · **Traces:** all Phase-2/3 controls;
all Critical/High risks `../10`.

> Extends the 10-criterion Operational Readiness Gate (`../phase2/05`) into a **domain-by-domain
> readiness scorecard** with explicit **GREEN / AMBER / RED thresholds** and go-live implications.
> The scorecard is the evidence pack the Oversight Board signs at the go-live gate (`08`). It is
> **fail-closed**: any RED (or a Critical-linked AMBER) blocks production go-live. 🔒 Legal,
> privacy-regulation, key-custody, institutional, procurement, and funding domains carry mandatory
> human sign-off.

---

## 1. Readiness domains & criteria

| Domain | Assessed against | Evidence | ORG link |
|--------|------------------|----------|----------|
| **Governance** | 8 bodies constituted, charters signed, RACI adopted, threshold custodians enrolled | `01`, `../phase2/01` | G1 |
| **Security** | ISRB sign-off; pen-test/red-team/crypto-review clean; vuln SLAs met | `03`, `../design/04` | G4 |
| **Privacy** | DPIA approved; Commissioner engaged; privacy tests pass (0 identity retained) | `02`, `04`, `../phase2/10` | G3 |
| **Legal compliance** | Counsel sign-off (whistleblower reach, compelled-access posture, cross-border, admissibility, separation of powers) | `../phase2/05 G2` | G2 |
| **Operations** | ESM live; SLOs instrumented; runbooks; zero standing privilege verified | `06` | G6 |
| **Training** | Role training delivered; competency verified | `05` | part G6 |
| **Support** | Service desk + hypercare plan; escalation paths | `06`, `08` | G6 |
| **Disaster recovery** | DR drill meets RTO/RPO; key≠ciphertext verified | `03 A10`, `../design/04` | G8 |
| **Business continuity** | Degrade-to-minimal-intake; governance continuity; comms plan | `../phase2/03 §8` | part G8 |

## 2. GREEN / AMBER / RED thresholds

| Rating | Definition | Go-live implication |
|--------|-----------|---------------------|
| 🟢 **GREEN** | All criteria met with current, signed evidence | Eligible to proceed |
| 🟡 **AMBER** | Minor gaps with an accepted, time-boxed remediation plan **and no link to a Critical risk** | Conditional; OB may allow with documented risk acceptance + deadline |
| 🔴 **RED** | Criterion unmet, or any gap linked to a **Critical risk (RK-01/02/05/07)** or a 🔒 sign-off missing | **Blocks go-live** — no exceptions |

**Hard rule:** the four **Critical-risk** domains (de-anon by compulsion/metadata/phishing, and
false-confidence UX) and the **🔒 legal/privacy/security/key-custody** sign-offs can **never** be
AMBER-waived. Reporter safety is not a residual to accept at launch.

## 3. Readiness scorecard (template — populated at gate time)

| Domain | Status | Evidence ref | Owner | Gaps | Remediation & date | Critical-linked? |
|--------|--------|-------------|-------|------|--------------------|------------------|
| Governance | ⬜ | | OB | | | — |
| Security | ⬜ | | ISRB | | | yes (RK-01/02/05) |
| Privacy | ⬜ | | PRB | | | yes (RK-01) |
| Legal | ⬜ | | Legal 🔒 | | | yes (RK-10) |
| Operations | ⬜ | | OMT | | | — |
| Training | ⬜ | | Change lead | | | — |
| Support | ⬜ | | OMT | | | — |
| DR | ⬜ | | SRE | | | yes (RK-13) |
| Business continuity | ⬜ | | OMT | | | — |
| **Overall** | ⬜ | | OB | | | Go-live only if all GREEN (Critical domains) |

## 4. Assessment process

1. Each domain owner assembles evidence and self-rates.
2. **Independent assessor** (Operational Readiness Assessor role) validates evidence and
   re-rates (no self-certification for Critical/🔒 domains).
3. Discrepancies escalate to the accountable body; unresolved → OB.
4. OB reviews the consolidated scorecard at the **go-live gate (`08`)**; signs (or holds) a
   non-repudiable decision (anchored audit).
5. Scorecard status feeds the **Public Trust Index** (`../phase2/09`).

## 5. Quality gate

- **Traces to:** `../phase2/05`; all Critical/High risks; every Phase-2/3 control.
- **Threats mitigated:** premature-launch realization of I-1/I-2/S-1/U-1 (RK-01/02/05/07).
- **Residual risks:** even all-GREEN cannot certify away device compromise, coercion, or a global
  adversary — the scorecard certifies the platform's own controls, honestly (stated to OB).
- **Dependencies:** every Phase-2/3 workstream; independent assessor; external sign-offs.
- **Trade-offs:** ⚠️ fail-closed + no-AMBER-for-Critical delays launch — accepted.
- **Measurable outcomes:** scorecard all-GREEN on Critical/🔒 domains before go-live; independent
  assessor validation recorded; OB signed decision anchored.
- **🔒 Required review:** OB (final), Legal/Privacy/ISRB/ARB per domain, independent readiness
  assessor; procurement + funding sign-off (G10).

*Next: `08-production-deployment-governance.md`.*
